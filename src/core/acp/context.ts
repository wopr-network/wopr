/**
 * ACP Context — transforms editor context into WOPR session context.
 *
 * Accepts structured context from IDE (open files, selections, diagnostics,
 * cursor position) and formats it for injection into the WOPR agent's
 * system prompt / context window.
 */
import type { AcpChatMessageParams, AcpContextUpdateParams } from "./types.js";

// Per-session editor context (mutable, updated by context/update messages)
const sessionContexts = new Map<string, EditorContext>();

export interface EditorContext {
  files?: Array<{ path: string; content?: string; language?: string }>;
  selection?: { path: string; startLine: number; endLine: number; text: string };
  diagnostics?: Array<{ path: string; line: number; severity: string; message: string }>;
  cursorPosition?: { path: string; line: number; column: number };
}

/**
 * Store editor context for a session from a context/update message.
 */
export function updateEditorContext(sessionId: string, params: AcpContextUpdateParams): void {
  const existing = sessionContexts.get(sessionId) ?? {};
  const ctx = params.context;

  // Merge: new fields overwrite, undefined fields keep old value
  if (ctx.files !== undefined) existing.files = ctx.files;
  if (ctx.selection !== undefined) existing.selection = ctx.selection;
  if (ctx.diagnostics !== undefined) existing.diagnostics = ctx.diagnostics;
  if (ctx.cursorPosition !== undefined) existing.cursorPosition = ctx.cursorPosition;

  sessionContexts.set(sessionId, existing);
}

/**
 * Get stored editor context for a session.
 */
export function getEditorContext(sessionId: string): EditorContext | undefined {
  return sessionContexts.get(sessionId);
}

/**
 * Clear stored editor context for a session.
 */
export function clearEditorContext(sessionId: string): void {
  sessionContexts.delete(sessionId);
}

/**
 * Build a context string from chat message params and any stored editor context.
 * This is injected into the WOPR prompt so the agent has full editor awareness.
 */
export function formatEditorContext(params: AcpChatMessageParams, sessionId?: string): string {
  // Merge inline context from the message with stored session context
  const stored = sessionId ? sessionContexts.get(sessionId) : undefined;
  const inline = params.context;

  const files = inline?.files ?? stored?.files;
  const selection = inline?.selection ?? stored?.selection;
  const diagnostics = inline?.diagnostics ?? stored?.diagnostics;
  const cursorPosition = inline?.cursorPosition ?? stored?.cursorPosition;

  const parts: string[] = [];

  // Active file / cursor
  if (cursorPosition) {
    parts.push(`Cursor: ${cursorPosition.path}:${cursorPosition.line}:${cursorPosition.column}`);
  }

  // Selection
  if (selection) {
    parts.push(`Selected text in ${selection.path} (lines ${selection.startLine}-${selection.endLine}):`);
    parts.push("```");
    parts.push(selection.text);
    parts.push("```");
  }

  // Open files
  if (files && files.length > 0) {
    for (const file of files) {
      if (file.content) {
        const lang = file.language ?? "";
        parts.push(`File: ${file.path}`);
        parts.push(`\`\`\`${lang}`);
        parts.push(file.content);
        parts.push("```");
      } else {
        parts.push(`Open file: ${file.path}`);
      }
    }
  }

  // Diagnostics
  if (diagnostics && diagnostics.length > 0) {
    parts.push("Diagnostics:");
    for (const d of diagnostics) {
      parts.push(`  [${d.severity}] ${d.path}:${d.line} - ${d.message}`);
    }
  }

  return parts.join("\n");
}
