/**
 * ACP Context Tests
 *
 * Tests editor context handling:
 * - Formatting editor context into prompt text
 * - Storing/retrieving per-session editor context
 * - Context merging (inline + stored)
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  clearEditorContext,
  formatEditorContext,
  getEditorContext,
  updateEditorContext,
} from "../../../src/core/acp/context.js";
import type { AcpChatMessageParams, AcpContextUpdateParams } from "../../../src/core/acp/types.js";

describe("ACP Context", () => {
  afterEach(() => {
    clearEditorContext("test-session");
    clearEditorContext("other-session");
  });

  describe("formatEditorContext", () => {
    it("returns empty string with no context", () => {
      const params: AcpChatMessageParams = { message: "Hello" };
      expect(formatEditorContext(params)).toBe("");
    });

    it("formats cursor position", () => {
      const params: AcpChatMessageParams = {
        message: "Hello",
        context: {
          cursorPosition: { path: "/src/main.ts", line: 42, column: 10 },
        },
      };
      const result = formatEditorContext(params);
      expect(result).toContain("Cursor: /src/main.ts:42:10");
    });

    it("formats selection", () => {
      const params: AcpChatMessageParams = {
        message: "Fix this",
        context: {
          selection: {
            path: "/src/app.ts",
            startLine: 5,
            endLine: 10,
            text: "function hello() {\n  return 'world';\n}",
          },
        },
      };
      const result = formatEditorContext(params);
      expect(result).toContain("Selected text in /src/app.ts (lines 5-10):");
      expect(result).toContain("function hello()");
    });

    it("formats open files with content", () => {
      const params: AcpChatMessageParams = {
        message: "Review",
        context: {
          files: [{ path: "/src/index.ts", content: "export const x = 1;", language: "typescript" }],
        },
      };
      const result = formatEditorContext(params);
      expect(result).toContain("File: /src/index.ts");
      expect(result).toContain("```typescript");
      expect(result).toContain("export const x = 1;");
    });

    it("formats open files without content", () => {
      const params: AcpChatMessageParams = {
        message: "Review",
        context: {
          files: [{ path: "/src/utils.ts" }],
        },
      };
      const result = formatEditorContext(params);
      expect(result).toContain("Open file: /src/utils.ts");
    });

    it("formats diagnostics", () => {
      const params: AcpChatMessageParams = {
        message: "Help",
        context: {
          diagnostics: [
            { path: "/src/main.ts", line: 5, severity: "error", message: "Type mismatch" },
            { path: "/src/main.ts", line: 12, severity: "warning", message: "Unused variable" },
          ],
        },
      };
      const result = formatEditorContext(params);
      expect(result).toContain("Diagnostics:");
      expect(result).toContain("[error] /src/main.ts:5 - Type mismatch");
      expect(result).toContain("[warning] /src/main.ts:12 - Unused variable");
    });

    it("formats all context types together", () => {
      const params: AcpChatMessageParams = {
        message: "Help me fix this",
        context: {
          cursorPosition: { path: "/src/main.ts", line: 5, column: 1 },
          selection: { path: "/src/main.ts", startLine: 5, endLine: 5, text: "let x: number = 'hello';" },
          files: [{ path: "/src/main.ts", content: "let x: number = 'hello';", language: "typescript" }],
          diagnostics: [{ path: "/src/main.ts", line: 5, severity: "error", message: "Type mismatch" }],
        },
      };
      const result = formatEditorContext(params);
      expect(result).toContain("Cursor:");
      expect(result).toContain("Selected text");
      expect(result).toContain("File:");
      expect(result).toContain("Diagnostics:");
    });
  });

  describe("updateEditorContext / getEditorContext", () => {
    it("stores and retrieves context", () => {
      const params: AcpContextUpdateParams = {
        sessionId: "test-session",
        context: {
          files: [{ path: "/a.ts" }],
        },
      };
      updateEditorContext("test-session", params);
      const ctx = getEditorContext("test-session");
      expect(ctx?.files).toHaveLength(1);
      expect(ctx?.files?.[0].path).toBe("/a.ts");
    });

    it("merges updates without overwriting unset fields", () => {
      // First update: set files
      updateEditorContext("test-session", {
        sessionId: "test-session",
        context: { files: [{ path: "/a.ts" }] },
      });

      // Second update: set cursor (files should remain)
      updateEditorContext("test-session", {
        sessionId: "test-session",
        context: { cursorPosition: { path: "/a.ts", line: 1, column: 1 } },
      });

      const ctx = getEditorContext("test-session");
      expect(ctx?.files).toHaveLength(1);
      expect(ctx?.cursorPosition?.line).toBe(1);
    });

    it("overwrites fields when explicitly set", () => {
      updateEditorContext("test-session", {
        sessionId: "test-session",
        context: { files: [{ path: "/a.ts" }] },
      });

      updateEditorContext("test-session", {
        sessionId: "test-session",
        context: { files: [{ path: "/b.ts" }, { path: "/c.ts" }] },
      });

      const ctx = getEditorContext("test-session");
      expect(ctx?.files).toHaveLength(2);
      expect(ctx?.files?.[0].path).toBe("/b.ts");
    });

    it("returns undefined for unknown session", () => {
      expect(getEditorContext("nonexistent")).toBeUndefined();
    });
  });

  describe("clearEditorContext", () => {
    it("clears stored context", () => {
      updateEditorContext("test-session", {
        sessionId: "test-session",
        context: { files: [{ path: "/a.ts" }] },
      });
      clearEditorContext("test-session");
      expect(getEditorContext("test-session")).toBeUndefined();
    });

    it("does not affect other sessions", () => {
      updateEditorContext("test-session", {
        sessionId: "test-session",
        context: { files: [{ path: "/a.ts" }] },
      });
      updateEditorContext("other-session", {
        sessionId: "other-session",
        context: { files: [{ path: "/b.ts" }] },
      });

      clearEditorContext("test-session");
      expect(getEditorContext("test-session")).toBeUndefined();
      expect(getEditorContext("other-session")?.files).toHaveLength(1);
    });
  });

  describe("formatEditorContext with stored context", () => {
    it("uses stored context when no inline context provided", () => {
      updateEditorContext("test-session", {
        sessionId: "test-session",
        context: {
          cursorPosition: { path: "/stored.ts", line: 10, column: 5 },
        },
      });

      const params: AcpChatMessageParams = { message: "Help" };
      const result = formatEditorContext(params, "test-session");
      expect(result).toContain("Cursor: /stored.ts:10:5");
    });

    it("inline context overrides stored context", () => {
      updateEditorContext("test-session", {
        sessionId: "test-session",
        context: {
          cursorPosition: { path: "/stored.ts", line: 10, column: 5 },
        },
      });

      const params: AcpChatMessageParams = {
        message: "Help",
        context: {
          cursorPosition: { path: "/inline.ts", line: 1, column: 1 },
        },
      };
      const result = formatEditorContext(params, "test-session");
      expect(result).toContain("Cursor: /inline.ts:1:1");
      expect(result).not.toContain("stored.ts");
    });
  });
});
