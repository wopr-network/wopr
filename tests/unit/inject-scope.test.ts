import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { sessionsRouter } from "../../src/daemon/routes/sessions.js";

// Mock dependencies
vi.mock("../../src/core/sessions.js", () => ({
  listSessions: vi.fn().mockResolvedValue({}),
  getSessions: vi.fn().mockResolvedValue({ test: "session-id" }),
  getSessionContext: vi.fn().mockResolvedValue("context"),
  setSessionContext: vi.fn().mockResolvedValue(undefined),
  deleteSession: vi.fn().mockResolvedValue(undefined),
  inject: vi.fn().mockResolvedValue({ sessionId: "sid", response: "ok" }),
  logMessage: vi.fn().mockResolvedValue(undefined),
  readConversationLog: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/security/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/security/index.js")>();
  return {
    ...original,
    createInjectionSource: vi.fn(original.createInjectionSource),
  };
});

vi.mock("../../src/daemon/ws.js", () => ({
  broadcastInjection: vi.fn(),
  broadcastStream: vi.fn(),
}));

describe("inject endpoint scope enforcement", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    // Simulate middleware setting apiKeyScope on context
    app.use("*", async (c, next) => {
      const scope = c.req.header("X-Test-Scope");
      if (scope) {
        c.set("apiKeyScope", scope);
      }
      // If no scope header, apiKeyScope stays undefined (daemon bearer token path)
      await next();
    });
    app.route("/sessions", sessionsRouter);
  });

  it("returns 403 for read-only API key scope", async () => {
    const res = await app.request("/sessions/test/inject", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Test-Scope": "read-only",
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/forbidden|insufficient.*scope/i);
  });

  it("allows full scope API key to inject", async () => {
    const res = await app.request("/sessions/test/inject", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Test-Scope": "full",
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(200);
  });

  it("allows daemon bearer token (no apiKeyScope) to inject", async () => {
    const res = await app.request("/sessions/test/inject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(200);
  });

  it("uses owner trust for full scope", async () => {
    const { createInjectionSource } = await import("../../src/security/index.js");
    await app.request("/sessions/test/inject", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Test-Scope": "full",
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(createInjectionSource).toHaveBeenCalledWith("daemon", expect.objectContaining({ trustLevel: "owner" }));
  });

  it("uses owner trust for daemon bearer (undefined scope)", async () => {
    const { createInjectionSource } = await import("../../src/security/index.js");
    await app.request("/sessions/test/inject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(createInjectionSource).toHaveBeenCalledWith("daemon");
  });
});
