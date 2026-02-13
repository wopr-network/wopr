/**
 * Canvas Protocol Tests (WOP-113)
 *
 * Tests canvas state operations, duplicate ID upsert, snapshot memory safety,
 * publish injection, REST route validation, and event emission.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock logger so we don't produce output
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock eventBus
vi.mock("../../src/core/events.js", () => ({
  eventBus: {
    emitCustom: vi.fn().mockResolvedValue(undefined),
  },
}));

let canvasPush: typeof import("../../src/core/canvas.js").canvasPush;
let canvasRemove: typeof import("../../src/core/canvas.js").canvasRemove;
let canvasReset: typeof import("../../src/core/canvas.js").canvasReset;
let canvasSnapshot: typeof import("../../src/core/canvas.js").canvasSnapshot;
let canvasGet: typeof import("../../src/core/canvas.js").canvasGet;
let setCanvasPublish: typeof import("../../src/core/canvas.js").setCanvasPublish;
let _resetCanvasState: typeof import("../../src/core/canvas.js")._resetCanvasState;
let eventBus: any;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import("../../src/core/canvas.js");
  canvasPush = mod.canvasPush;
  canvasRemove = mod.canvasRemove;
  canvasReset = mod.canvasReset;
  canvasSnapshot = mod.canvasSnapshot;
  canvasGet = mod.canvasGet;
  setCanvasPublish = mod.setCanvasPublish;
  _resetCanvasState = mod._resetCanvasState;
  const evtMod = await import("../../src/core/events.js");
  eventBus = evtMod.eventBus;
});

afterEach(() => {
  _resetCanvasState();
  vi.restoreAllMocks();
});

// ============================================================================
// Core canvas operations
// ============================================================================

describe("Canvas State Operations", () => {
  it("should push an item and retrieve it", async () => {
    const item = await canvasPush("s1", "html", "<b>hello</b>");
    expect(item.id).toMatch(/^cv_/);
    expect(item.type).toBe("html");
    expect(item.content).toBe("<b>hello</b>");
    expect(item.pushedAt).toBeGreaterThan(0);

    const items = canvasGet("s1");
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(item.id);
  });

  it("should push with custom id and title", async () => {
    const item = await canvasPush("s1", "markdown", "# Hi", { id: "my-id", title: "Title" });
    expect(item.id).toBe("my-id");
    expect(item.title).toBe("Title");
  });

  it("should upsert when pushing a duplicate custom id", async () => {
    await canvasPush("s1", "html", "v1", { id: "dup" });
    const updated = await canvasPush("s1", "html", "v2", { id: "dup" });

    const items = canvasGet("s1");
    expect(items).toHaveLength(1);
    expect(items[0].content).toBe("v2");
    expect(updated.content).toBe("v2");
  });

  it("should not upsert auto-generated ids", async () => {
    const a = await canvasPush("s1", "html", "a");
    const b = await canvasPush("s1", "html", "b");
    expect(a.id).not.toBe(b.id);
    expect(canvasGet("s1")).toHaveLength(2);
  });

  it("should remove an item by id", async () => {
    const item = await canvasPush("s1", "html", "x");
    const removed = await canvasRemove("s1", item.id);
    expect(removed).toBe(true);
    expect(canvasGet("s1")).toHaveLength(0);
  });

  it("should return false when removing from nonexistent session", async () => {
    expect(await canvasRemove("nope", "id")).toBe(false);
  });

  it("should return false when removing nonexistent item", async () => {
    await canvasPush("s1", "html", "x");
    expect(await canvasRemove("s1", "no-such-id")).toBe(false);
  });

  it("should reset a session", async () => {
    await canvasPush("s1", "html", "a");
    await canvasPush("s1", "html", "b");
    await canvasReset("s1");
    expect(canvasGet("s1")).toHaveLength(0);
  });

  it("should isolate sessions", async () => {
    await canvasPush("s1", "html", "a");
    await canvasPush("s2", "html", "b");
    expect(canvasGet("s1")).toHaveLength(1);
    expect(canvasGet("s2")).toHaveLength(1);
    expect(canvasGet("s1")[0].content).toBe("a");
    expect(canvasGet("s2")[0].content).toBe("b");
  });
});

// ============================================================================
// Snapshot
// ============================================================================

describe("canvasSnapshot", () => {
  it("should return a snapshot with items", async () => {
    await canvasPush("s1", "html", "a");
    const snap = await canvasSnapshot("s1");
    expect(snap.session).toBe("s1");
    expect(snap.items).toHaveLength(1);
    expect(snap.takenAt).toBeGreaterThan(0);
  });

  it("should return empty snapshot for unknown session without growing state", async () => {
    const snap = await canvasSnapshot("unknown");
    expect(snap.items).toHaveLength(0);
    // The internal Map should NOT have been grown by the read-only snapshot
    expect(canvasGet("unknown")).toHaveLength(0);
  });

  it("snapshot items should be a copy, not a reference", async () => {
    await canvasPush("s1", "html", "a");
    const snap = await canvasSnapshot("s1");
    // Mutating the snapshot should not affect the live canvas
    snap.items.length = 0;
    expect(canvasGet("s1")).toHaveLength(1);
  });
});

// ============================================================================
// Publish injection (finding 5 — cross-layer dependency)
// ============================================================================

describe("setCanvasPublish", () => {
  it("should call the injected publish function on push", async () => {
    const publishFn = vi.fn();
    setCanvasPublish(publishFn);

    await canvasPush("s1", "html", "hi");
    expect(publishFn).toHaveBeenCalledTimes(1);
    expect(publishFn).toHaveBeenCalledWith(
      "canvas:s1",
      expect.objectContaining({ type: "canvas:push" }),
    );
  });

  it("should call injected publish on remove", async () => {
    const publishFn = vi.fn();
    setCanvasPublish(publishFn);

    const item = await canvasPush("s1", "html", "x");
    publishFn.mockClear();
    await canvasRemove("s1", item.id);
    expect(publishFn).toHaveBeenCalledWith(
      "canvas:s1",
      expect.objectContaining({ type: "canvas:remove" }),
    );
  });

  it("should not throw when no publish function is set", async () => {
    // _publish is undefined after resetModules — operations should still work
    await expect(canvasPush("s1", "html", "ok")).resolves.toBeDefined();
  });
});

// ============================================================================
// Event emission
// ============================================================================

describe("Event emission", () => {
  it("should emit canvas:push on eventBus", async () => {
    await canvasPush("s1", "html", "x");
    expect(eventBus.emitCustom).toHaveBeenCalledWith(
      "canvas:push",
      expect.objectContaining({ session: "s1", operation: "push" }),
      "core",
    );
  });

  it("should emit canvas:reset on eventBus", async () => {
    await canvasReset("s1");
    expect(eventBus.emitCustom).toHaveBeenCalledWith(
      "canvas:reset",
      expect.objectContaining({ session: "s1", operation: "reset" }),
      "core",
    );
  });

  it("should emit canvas:snapshot on eventBus", async () => {
    await canvasSnapshot("s1");
    expect(eventBus.emitCustom).toHaveBeenCalledWith(
      "canvas:snapshot",
      expect.objectContaining({ session: "s1", operation: "snapshot" }),
      "core",
    );
  });
});

// ============================================================================
// REST route validation (findings 2 & 3)
// ============================================================================

describe("Canvas REST routes", () => {
  let app: any;

  beforeEach(async () => {
    const { Hono } = await import("hono");
    const { canvasRouter } = await import("../../src/daemon/routes/canvas.js");
    app = new Hono();
    app.route("/canvas", canvasRouter);
  });

  it("GET /:session should return items", async () => {
    await canvasPush("test-session", "html", "hello");
    const res = await app.request("/canvas/test-session");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
  });

  it("GET /:session should reject invalid session name", async () => {
    const res = await app.request("/canvas/bad%20session%21");
    expect(res.status).toBe(400);
  });

  it("POST /:session/push should reject invalid session name", async () => {
    const res = await app.request("/canvas/bad%20name/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "html", content: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /:session/push should reject invalid type", async () => {
    const res = await app.request("/canvas/s1/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "evil", content: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /:session/push should reject non-string content", async () => {
    const res = await app.request("/canvas/s1/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "html", content: 123 }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /:session/push should reject non-string title", async () => {
    const res = await app.request("/canvas/s1/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "html", content: "ok", title: 42 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("title");
  });

  it("POST /:session/push should reject non-string id", async () => {
    const res = await app.request("/canvas/s1/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "html", content: "ok", id: 999 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("id");
  });

  it("POST /:session/push should accept valid payload", async () => {
    const res = await app.request("/canvas/s1/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "html", content: "<p>hi</p>", title: "Greeting" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.pushed).toBe(true);
    expect(body.item.title).toBe("Greeting");
  });

  it("DELETE /:session/:itemId should reject invalid session", async () => {
    const res = await app.request("/canvas/bad%20session/some-id", { method: "DELETE" });
    expect(res.status).toBe(400);
  });

  it("DELETE /:session/:itemId should return 404 for missing item", async () => {
    const res = await app.request("/canvas/s1/no-such-id", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("POST /:session/reset should reject invalid session", async () => {
    const res = await app.request("/canvas/bad%20session/reset", { method: "POST" });
    expect(res.status).toBe(400);
  });

  it("GET /:session/snapshot should reject invalid session", async () => {
    const res = await app.request("/canvas/bad%20session/snapshot");
    expect(res.status).toBe(400);
  });

  it("GET /:session/snapshot should return snapshot for valid session", async () => {
    await canvasPush("snap-test", "markdown", "# Hello");
    const res = await app.request("/canvas/snap-test/snapshot");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session).toBe("snap-test");
    expect(body.items).toHaveLength(1);
  });
});
