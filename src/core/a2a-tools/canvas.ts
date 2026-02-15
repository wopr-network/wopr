/**
 * Canvas A2A tools (WOP-113)
 *
 * Provides agents with tools to push visual content to the WebUI canvas:
 *   canvas_push     — push HTML/Markdown/chart/form content
 *   canvas_remove   — remove a single item by id
 *   canvas_reset    — clear all canvas items for the session
 *   canvas_snapshot — take a snapshot of the current canvas state
 *   canvas_get      — get current canvas items (no side-effects)
 */

import { canvasGet, canvasPush, canvasRemove, canvasReset, canvasSnapshot } from "../canvas.js";
import { tool, withSecurityCheck, z } from "./_base.js";

export function createCanvasTools(sessionName: string): unknown[] {
  const tools: unknown[] = [];

  // ── canvas_push ──────────────────────────────────────────────────────
  tools.push(
    tool(
      "canvas_push",
      "Push visual content (HTML, Markdown, chart, or form) to the WebUI canvas for the current session.",
      {
        type: z.enum(["html", "markdown", "chart", "form"]).describe("Content type to render"),
        content: z.string().describe("The content body (HTML string, Markdown text, chart JSON, or form schema)"),
        title: z.string().optional().describe("Optional display title for the canvas item"),
        id: z.string().optional().describe("Optional custom id (auto-generated if omitted)"),
      },
      async (args: { type: "html" | "markdown" | "chart" | "form"; content: string; title?: string; id?: string }) => {
        return withSecurityCheck("canvas_push", sessionName, async () => {
          const item = await canvasPush(sessionName, args.type, args.content, {
            title: args.title,
            id: args.id,
          });
          return {
            content: [
              {
                type: "text",
                text: `Canvas item pushed: ${item.id} (${item.type})`,
              },
            ],
          };
        });
      },
    ),
  );

  // ── canvas_remove ────────────────────────────────────────────────────
  tools.push(
    tool(
      "canvas_remove",
      "Remove a single item from the canvas by its id.",
      {
        id: z.string().describe("The id of the canvas item to remove"),
      },
      async (args: { id: string }) => {
        return withSecurityCheck("canvas_remove", sessionName, async () => {
          const removed = await canvasRemove(sessionName, args.id);
          return {
            content: [
              {
                type: "text",
                text: removed ? `Canvas item ${args.id} removed` : `Canvas item ${args.id} not found`,
              },
            ],
          };
        });
      },
    ),
  );

  // ── canvas_reset ─────────────────────────────────────────────────────
  tools.push(
    tool("canvas_reset", "Clear all items from the canvas for the current session.", {}, async () => {
      return withSecurityCheck("canvas_reset", sessionName, async () => {
        await canvasReset(sessionName);
        return {
          content: [{ type: "text", text: "Canvas cleared" }],
        };
      });
    }),
  );

  // ── canvas_snapshot ──────────────────────────────────────────────────
  tools.push(
    tool("canvas_snapshot", "Take a snapshot of the current canvas state and return all items.", {}, async () => {
      return withSecurityCheck("canvas_snapshot", sessionName, async () => {
        const snap = await canvasSnapshot(sessionName);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(snap, null, 2),
            },
          ],
        };
      });
    }),
  );

  // ── canvas_get ───────────────────────────────────────────────────────
  tools.push(
    tool("canvas_get", "Get current canvas items for the session without emitting events.", {}, async () => {
      return withSecurityCheck("canvas_get", sessionName, async () => {
        const items = canvasGet(sessionName);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(items, null, 2),
            },
          ],
        };
      });
    }),
  );

  return tools;
}
