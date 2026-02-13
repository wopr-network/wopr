/**
 * Canvas Protocol — agent-driven visual workspace (WOP-113)
 *
 * Agents push visual content (HTML, Markdown, charts, forms) to the
 * WebUI via Canvas operations. Each session maintains its own canvas
 * state. WebSocket subscribers on the `canvas:<session>` topic receive
 * real-time updates.
 */

import { logger } from "../logger.js";
import { eventBus } from "./events.js";

// ---------------------------------------------------------------------------
// Publish injection — avoids core -> daemon cross-layer dependency
// ---------------------------------------------------------------------------

type PublishFn = (topic: string, event: Record<string, unknown>) => void;
let _publish: PublishFn | undefined;

/** Inject the WebSocket publish function from the daemon layer. */
export function setCanvasPublish(fn: PublishFn): void {
  _publish = fn;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Content types the canvas can render */
export type CanvasContentType = "html" | "markdown" | "chart" | "form";

/** A single item on the canvas */
export interface CanvasItem {
  id: string;
  type: CanvasContentType;
  content: string;
  /** Optional display title */
  title?: string;
  /** Optional metadata (chart config, form schema, etc.) */
  meta?: Record<string, unknown>;
  /** Epoch ms when the item was pushed */
  pushedAt: number;
}

/** Immutable snapshot of the canvas at a point in time */
export interface CanvasSnapshot {
  session: string;
  items: CanvasItem[];
  takenAt: number;
}

/** All possible canvas operations */
export type CanvasOperation = "push" | "remove" | "reset" | "snapshot";

/** Payload emitted on canvas events */
export interface CanvasEvent {
  session: string;
  operation: CanvasOperation;
  item?: CanvasItem;
  itemId?: string;
  snapshot?: CanvasSnapshot;
}

// ---------------------------------------------------------------------------
// State — one canvas per session, kept in memory
// ---------------------------------------------------------------------------

const canvases = new Map<string, CanvasItem[]>();

function ensureCanvas(session: string): CanvasItem[] {
  let items = canvases.get(session);
  if (!items) {
    items = [];
    canvases.set(session, items);
  }
  return items;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

let idCounter = 0;

function nextId(): string {
  return `cv_${Date.now()}_${++idCounter}`;
}

/**
 * Push a new visual item onto the canvas.
 */
export async function canvasPush(
  session: string,
  type: CanvasContentType,
  content: string,
  options?: { title?: string; meta?: Record<string, unknown>; id?: string },
): Promise<CanvasItem> {
  const items = ensureCanvas(session);
  const item: CanvasItem = {
    id: options?.id ?? nextId(),
    type,
    content,
    title: options?.title,
    meta: options?.meta,
    pushedAt: Date.now(),
  };

  // Upsert: if a custom id already exists, replace in-place
  const existingIdx = options?.id ? items.findIndex((i) => i.id === options.id) : -1;
  if (existingIdx !== -1) {
    items[existingIdx] = item;
  } else {
    items.push(item);
  }
  logger.debug(`[canvas] push ${item.id} (${type}) to session ${session}`);

  const event: CanvasEvent = { session, operation: "push", item };
  await broadcast(session, event);
  return item;
}

/**
 * Remove a single item by id.
 */
export async function canvasRemove(session: string, itemId: string): Promise<boolean> {
  const items = canvases.get(session);
  if (!items) return false;
  const idx = items.findIndex((i) => i.id === itemId);
  if (idx === -1) return false;
  items.splice(idx, 1);
  logger.debug(`[canvas] remove ${itemId} from session ${session}`);

  const event: CanvasEvent = { session, operation: "remove", itemId };
  await broadcast(session, event);
  return true;
}

/**
 * Clear the entire canvas for a session.
 */
export async function canvasReset(session: string): Promise<void> {
  canvases.set(session, []);
  logger.debug(`[canvas] reset session ${session}`);

  const event: CanvasEvent = { session, operation: "reset" };
  await broadcast(session, event);
}

/**
 * Take a snapshot of the current canvas state.
 */
export async function canvasSnapshot(session: string): Promise<CanvasSnapshot> {
  const items = canvases.get(session) ?? [];
  const snapshot: CanvasSnapshot = {
    session,
    items: [...items],
    takenAt: Date.now(),
  };
  logger.debug(`[canvas] snapshot session ${session} (${items.length} items)`);

  const event: CanvasEvent = { session, operation: "snapshot", snapshot };
  await broadcast(session, event);
  return snapshot;
}

/**
 * Get the live canvas items for a session (no event emitted).
 */
export function canvasGet(session: string): CanvasItem[] {
  return [...(canvases.get(session) ?? [])];
}

/** Reset all canvas state (for testing). */
export function _resetCanvasState(): void {
  canvases.clear();
  idCounter = 0;
}

// ---------------------------------------------------------------------------
// Broadcast helper
// ---------------------------------------------------------------------------

async function broadcast(session: string, event: CanvasEvent): Promise<void> {
  // WebSocket topic: canvas:<session> (injected to avoid cross-layer import)
  _publish?.(`canvas:${session}`, {
    type: `canvas:${event.operation}`,
    ...event,
    ts: Date.now(),
  });

  // Event bus for plugins
  await eventBus.emitCustom(`canvas:${event.operation}`, event, "core");
}
