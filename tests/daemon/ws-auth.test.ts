/**
 * WebSocket authentication enforcement tests (WOP-1407)
 *
 * Tests that WebSocket connections are rejected at HTTP upgrade time
 * without valid authentication, and that auth timeout closes
 * unauthenticated connections.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as WsApi from "../../src/daemon/ws.js";

// ─── Task 3 & 4: WebSocket auth timeout and pre-auth (real ws.js) ──────────
// These tests use the real ws.js module directly — no mocking of ws.js needed.

/** Minimal WebSocket shape used in tests */
interface TestWS {
  send(data: string): void;
  close(): void;
}

describe("WebSocket auth timeout (WOP-1407)", () => {
  let api!: typeof WsApi;

  beforeAll(async () => {
    api = await import("../../src/daemon/ws.js");
  });

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    api._resetForTesting();
    api._setTokenVerifier((t) => t === "valid-token");
    vi.useFakeTimers();
  });

  afterEach(() => {
    api._resetForTesting();
    vi.useRealTimers();
  });

  function makeClient() {
    const sent: string[] = [];
    const state = { closed: false };
    const ws: TestWS = {
      send: (data) => sent.push(data),
      close: () => {
        state.closed = true;
      },
    };
    api.setupWebSocket(ws);
    return { ws, sent, state };
  }

  it("closes unauthenticated connection after 2 seconds", () => {
    const { sent, state } = makeClient();
    expect(api.getClientCount()).toBe(1);

    vi.advanceTimersByTime(2500);

    const lastMsg = JSON.parse(sent[sent.length - 1]);
    expect(lastMsg.type).toBe("error");
    expect(lastMsg.message).toContain("Authentication timeout");
    expect(state.closed).toBe(true);
    expect(api.getClientCount()).toBe(0);
  });

  it("does not close authenticated connection after 2 seconds", () => {
    const { ws } = makeClient();
    api.handleWebSocketMessage(ws, JSON.stringify({ type: "auth", token: "valid-token" }));

    vi.advanceTimersByTime(2500);

    expect(api.getClientCount()).toBe(1);
  });

  it("skips auth timeout when pre-authenticated via upgrade", () => {
    const sent: string[] = [];
    const ws: TestWS = {
      send: (data) => sent.push(data),
      close: () => {},
    };
    api.setupWebSocket(ws, { preAuthenticated: true });

    vi.advanceTimersByTime(2500);

    // Should still be connected — no timeout fired
    expect(api.getClientCount()).toBe(1);

    // Should be able to subscribe without sending auth message
    api.handleWebSocketMessage(ws, JSON.stringify({ type: "subscribe", topics: ["test"] }));
    const subMsg = JSON.parse(sent[sent.length - 1]);
    expect(subMsg.type).toBe("subscribed");
  });
});

describe("WebSocket ticket-based auth (WOP-2095)", () => {
  let api!: typeof WsApi;

  beforeAll(async () => {
    api = await import("../../src/daemon/ws.js");
  });

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    api._resetForTesting();
    api._setTokenVerifier((t) => t === "valid-token");
    vi.useFakeTimers();
  });

  afterEach(() => {
    api._resetForTesting();
    vi.useRealTimers();
  });

  function makeClient() {
    const sent: string[] = [];
    const state = { closed: false };
    const ws: TestWS = {
      send: (data) => sent.push(data),
      close: () => {
        state.closed = true;
      },
    };
    api.setupWebSocket(ws);
    return { ws, sent, state };
  }

  it("rejects when no auth message is sent (unauthenticated subscribe)", () => {
    const { ws, sent } = makeClient();

    // Try to subscribe without authenticating first
    api.handleWebSocketMessage(ws, JSON.stringify({ type: "subscribe", topics: ["test"] }));

    const lastMsg = JSON.parse(sent[sent.length - 1]);
    expect(lastMsg.type).toBe("error");
    expect(lastMsg.message).toContain("Not authenticated");
  });

  it("rejects invalid token", () => {
    const { ws, sent } = makeClient();

    api.handleWebSocketMessage(ws, JSON.stringify({ type: "auth", token: "wrong-token" }));

    const lastMsg = JSON.parse(sent[sent.length - 1]);
    expect(lastMsg.type).toBe("error");
    expect(lastMsg.message).toBe("Authentication failed");
  });

  it("rejects auth message with missing token field", () => {
    const { ws, sent } = makeClient();

    // Send auth message without token field
    api.handleWebSocketMessage(ws, JSON.stringify({ type: "auth" }));

    const lastMsg = JSON.parse(sent[sent.length - 1]);
    expect(lastMsg.type).toBe("error");
    expect(lastMsg.message).toBe("Authentication failed");
  });

  it("accepts valid token and sends authenticated response", () => {
    const { ws, sent } = makeClient();

    api.handleWebSocketMessage(ws, JSON.stringify({ type: "auth", token: "valid-token" }));

    const lastMsg = JSON.parse(sent[sent.length - 1]);
    expect(lastMsg.type).toBe("authenticated");
    expect(lastMsg.ts).toBeTypeOf("number");

    // Client should remain connected
    expect(api.getClientCount()).toBe(1);
  });

  it("allows subscribe after successful auth", () => {
    const { ws, sent } = makeClient();

    // Authenticate
    api.handleWebSocketMessage(ws, JSON.stringify({ type: "auth", token: "valid-token" }));

    // Now subscribe
    api.handleWebSocketMessage(ws, JSON.stringify({ type: "subscribe", topics: ["test-topic"] }));

    const lastMsg = JSON.parse(sent[sent.length - 1]);
    expect(lastMsg.type).toBe("subscribed");
    expect(lastMsg.topics).toContain("test-topic");
  });

  it("closes connection after 2 seconds when auth fails and client goes silent", () => {
    // This tests the security backstop: a client that sends a wrong credential
    // and then goes silent must still be reaped by the auth timeout (WOP-1407).
    // Unlike the success path, a failed auth does NOT clear the timeout.
    const { ws, sent, state } = makeClient();

    // Client sends wrong token — auth fails, timeout remains active
    api.handleWebSocketMessage(ws, JSON.stringify({ type: "auth", token: "bad-token" }));

    const authErrorMsg = JSON.parse(sent[sent.length - 1]);
    expect(authErrorMsg.type).toBe("error");
    expect(authErrorMsg.message).toBe("Authentication failed");

    // Advance past the 2s auth timeout — the backstop should still fire
    vi.advanceTimersByTime(2500);

    expect(api.getClientCount()).toBe(0);
    expect(state.closed).toBe(true);
  });

  it("rejects subscribe after failed auth (client stays unauthenticated)", () => {
    const { ws, sent } = makeClient();

    // Send wrong token
    api.handleWebSocketMessage(ws, JSON.stringify({ type: "auth", token: "bad-token" }));

    // Try to subscribe — should fail because still unauthenticated
    api.handleWebSocketMessage(ws, JSON.stringify({ type: "subscribe", topics: ["test"] }));

    const lastMsg = JSON.parse(sent[sent.length - 1]);
    expect(lastMsg.type).toBe("error");
    expect(lastMsg.message).toContain("Not authenticated");
  });
});
