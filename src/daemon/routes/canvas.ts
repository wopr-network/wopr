/**
 * Canvas REST API routes (WOP-113)
 *
 * Provides HTTP endpoints for the Canvas protocol so WebUI and
 * external clients can interact with the canvas without WebSocket.
 *
 * Routes:
 *   GET    /canvas/:session         — get current canvas items
 *   POST   /canvas/:session/push    — push a new item
 *   DELETE /canvas/:session/:itemId — remove an item
 *   POST   /canvas/:session/reset   — clear the canvas
 *   GET    /canvas/:session/snapshot — take and return a snapshot
 */

import { Hono } from "hono";
import {
  type CanvasContentType,
  canvasGet,
  canvasPush,
  canvasRemove,
  canvasReset,
  canvasSnapshot,
} from "../../core/canvas.js";
import { validateSessionName } from "../validation.js";

export const canvasRouter = new Hono();

const VALID_TYPES = new Set<string>(["html", "markdown", "chart", "form"]);

// Get current canvas items
canvasRouter.get("/:session", (c) => {
  const session = c.req.param("session");
  validateSessionName(session);
  const items = canvasGet(session);
  return c.json({ session, items });
});

// Push a new canvas item
canvasRouter.post("/:session/push", async (c) => {
  const session = c.req.param("session");
  validateSessionName(session);
  const body = await c.req.json();
  const { type, content, title, id } = body;

  if (!type || !VALID_TYPES.has(type)) {
    return c.json({ error: `type must be one of: ${[...VALID_TYPES].join(", ")}` }, 400);
  }
  if (!content || typeof content !== "string") {
    return c.json({ error: "content is required and must be a string" }, 400);
  }
  if (title !== undefined && typeof title !== "string") {
    return c.json({ error: "title must be a string" }, 400);
  }
  if (id !== undefined && typeof id !== "string") {
    return c.json({ error: "id must be a string" }, 400);
  }

  const item = await canvasPush(session, type as CanvasContentType, content, { title, id });
  return c.json({ pushed: true, item }, 201);
});

// Remove a canvas item
canvasRouter.delete("/:session/:itemId", async (c) => {
  const session = c.req.param("session");
  validateSessionName(session);
  const itemId = c.req.param("itemId");
  const removed = await canvasRemove(session, itemId);

  if (!removed) {
    return c.json({ error: "Item not found" }, 404);
  }

  return c.json({ removed: true });
});

// Reset (clear) the canvas
canvasRouter.post("/:session/reset", async (c) => {
  const session = c.req.param("session");
  validateSessionName(session);
  await canvasReset(session);
  return c.json({ reset: true });
});

// Take a snapshot
canvasRouter.get("/:session/snapshot", async (c) => {
  const session = c.req.param("session");
  validateSessionName(session);
  const snapshot = await canvasSnapshot(session);
  return c.json(snapshot);
});
