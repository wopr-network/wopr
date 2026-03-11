/**
 * WebSocket authentication enforcement tests (WOP-1407)
 *
 * Tests that WebSocket connections are rejected at HTTP upgrade time
 * without valid authentication, and that auth timeout closes
 * unauthenticated connections.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Task 3 & 4: WebSocket auth timeout and pre-auth (real ws.js) ──────────
// These tests use the real ws.js module directly — no mocking of ws.js needed.

describe("WebSocket auth timeout (WOP-1407)", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.useFakeTimers();
  });

  afterEach(async () => {
    const { _resetForTesting } = await import("../../src/daemon/ws.js");
    _resetForTesting();
    vi.useRealTimers();
  });

  it("closes unauthenticated connection after 2 seconds", async () => {
    const { setupWebSocket, getClientCount, _resetForTesting, _setTokenVerifier } = await import(
      "../../src/daemon/ws.js"
    );
    _resetForTesting();
    _setTokenVerifier((t) => t === "valid-token");

    const sent: string[] = [];
    let closed = false;
    const ws = {
      send: (data: string) => sent.push(data),
      close: () => {
        closed = true;
      },
    };

    setupWebSocket(ws as unknown as { send(data: string): void });
    expect(getClientCount()).toBe(1);

    // Advance time by 2 seconds + buffer
    vi.advanceTimersByTime(2500);

    const lastMsg = JSON.parse(sent[sent.length - 1]);
    expect(lastMsg.type).toBe("error");
    expect(lastMsg.message).toContain("Authentication timeout");
    expect(closed).toBe(true);
    expect(getClientCount()).toBe(0);
  });

  it("does not close authenticated connection after 2 seconds", async () => {
    const { setupWebSocket, handleWebSocketMessage, getClientCount, _resetForTesting, _setTokenVerifier } =
      await import("../../src/daemon/ws.js");
    _resetForTesting();
    _setTokenVerifier((t) => t === "valid-token");

    const sent: string[] = [];
    const ws = {
      send: (data: string) => sent.push(data),
      close: () => {},
    };

    setupWebSocket(ws as unknown as { send(data: string): void });
    handleWebSocketMessage(
      ws as unknown as { send(data: string): void },
      JSON.stringify({ type: "auth", token: "valid-token" }),
    );

    vi.advanceTimersByTime(2500);

    expect(getClientCount()).toBe(1);
  });

  it("skips auth timeout when pre-authenticated via upgrade", async () => {
    const { setupWebSocket, handleWebSocketMessage, getClientCount, _resetForTesting, _setTokenVerifier } =
      await import("../../src/daemon/ws.js");
    _resetForTesting();
    _setTokenVerifier((t) => t === "valid-token");

    const sent: string[] = [];
    const ws = {
      send: (data: string) => sent.push(data),
      close: () => {},
    };

    setupWebSocket(ws as unknown as { send(data: string): void }, { preAuthenticated: true });

    vi.advanceTimersByTime(2500);

    // Should still be connected — no timeout fired
    expect(getClientCount()).toBe(1);

    // Should be able to subscribe without sending auth message
    handleWebSocketMessage(
      ws as unknown as { send(data: string): void },
      JSON.stringify({ type: "subscribe", topics: ["test"] }),
    );
    const subMsg = JSON.parse(sent[sent.length - 1]);
    expect(subMsg.type).toBe("subscribed");
  });
});

describe("WebSocket ticket-based auth (WOP-2095)", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.useFakeTimers();
  });

  afterEach(async () => {
    const { _resetForTesting } = await import("../../src/daemon/ws.js");
    _resetForTesting();
    vi.useRealTimers();
  });

  it("rejects when no auth message is sent (unauthenticated subscribe)", async () => {
    const { setupWebSocket, handleWebSocketMessage, _resetForTesting, _setTokenVerifier } =
      await import("../../src/daemon/ws.js");
    _resetForTesting();
    _setTokenVerifier((t) => t === "valid-token");

    const sent: string[] = [];
    const ws = {
      send: (data: string) => sent.push(data),
      close: () => {},
    };

    setupWebSocket(ws as unknown as { send(data: string): void });

    // Try to subscribe without authenticating first
    handleWebSocketMessage(
      ws as unknown as { send(data: string): void },
      JSON.stringify({ type: "subscribe", topics: ["test"] }),
    );

    const lastMsg = JSON.parse(sent[sent.length - 1]);
    expect(lastMsg.type).toBe("error");
    expect(lastMsg.message).toContain("Not authenticated");
  });

  it("rejects invalid token", async () => {
    const { setupWebSocket, handleWebSocketMessage, _resetForTesting, _setTokenVerifier } =
      await import("../../src/daemon/ws.js");
    _resetForTesting();
    _setTokenVerifier((t) => t === "valid-token");

    const sent: string[] = [];
    const ws = {
      send: (data: string) => sent.push(data),
      close: () => {},
    };

    setupWebSocket(ws as unknown as { send(data: string): void });

    handleWebSocketMessage(
      ws as unknown as { send(data: string): void },
      JSON.stringify({ type: "auth", token: "wrong-token" }),
    );

    const lastMsg = JSON.parse(sent[sent.length - 1]);
    expect(lastMsg.type).toBe("error");
    expect(lastMsg.message).toBe("Authentication failed");
  });

  it("rejects auth message with missing token field", async () => {
    const { setupWebSocket, handleWebSocketMessage, _resetForTesting, _setTokenVerifier } =
      await import("../../src/daemon/ws.js");
    _resetForTesting();
    _setTokenVerifier((t) => t === "valid-token");

    const sent: string[] = [];
    const ws = {
      send: (data: string) => sent.push(data),
      close: () => {},
    };

    setupWebSocket(ws as unknown as { send(data: string): void });

    // Send auth message without token field
    handleWebSocketMessage(
      ws as unknown as { send(data: string): void },
      JSON.stringify({ type: "auth" }),
    );

    const lastMsg = JSON.parse(sent[sent.length - 1]);
    expect(lastMsg.type).toBe("error");
    expect(lastMsg.message).toBe("Authentication failed");
  });

  it("accepts valid token and sends authenticated response", async () => {
    const { setupWebSocket, handleWebSocketMessage, getClientCount, _resetForTesting, _setTokenVerifier } =
      await import("../../src/daemon/ws.js");
    _resetForTesting();
    _setTokenVerifier((t) => t === "valid-token");

    const sent: string[] = [];
    const ws = {
      send: (data: string) => sent.push(data),
      close: () => {},
    };

    setupWebSocket(ws as unknown as { send(data: string): void });

    handleWebSocketMessage(
      ws as unknown as { send(data: string): void },
      JSON.stringify({ type: "auth", token: "valid-token" }),
    );

    const lastMsg = JSON.parse(sent[sent.length - 1]);
    expect(lastMsg.type).toBe("authenticated");
    expect(lastMsg.ts).toBeTypeOf("number");

    // Client should remain connected
    expect(getClientCount()).toBe(1);
  });

  it("allows subscribe after successful auth", async () => {
    const { setupWebSocket, handleWebSocketMessage, _resetForTesting, _setTokenVerifier } =
      await import("../../src/daemon/ws.js");
    _resetForTesting();
    _setTokenVerifier((t) => t === "valid-token");

    const sent: string[] = [];
    const ws = {
      send: (data: string) => sent.push(data),
      close: () => {},
    };

    setupWebSocket(ws as unknown as { send(data: string): void });

    // Authenticate
    handleWebSocketMessage(
      ws as unknown as { send(data: string): void },
      JSON.stringify({ type: "auth", token: "valid-token" }),
    );

    // Now subscribe
    handleWebSocketMessage(
      ws as unknown as { send(data: string): void },
      JSON.stringify({ type: "subscribe", topics: ["test-topic"] }),
    );

    const lastMsg = JSON.parse(sent[sent.length - 1]);
    expect(lastMsg.type).toBe("subscribed");
    expect(lastMsg.topics).toContain("test-topic");
  });

  it("clears auth timeout after successful auth", async () => {
    const { setupWebSocket, handleWebSocketMessage, getClientCount, _resetForTesting, _setTokenVerifier } =
      await import("../../src/daemon/ws.js");
    _resetForTesting();
    _setTokenVerifier((t) => t === "valid-token");

    const sent: string[] = [];
    let closed = false;
    const ws = {
      send: (data: string) => sent.push(data),
      close: () => {
        closed = true;
      },
    };

    setupWebSocket(ws as unknown as { send(data: string): void });

    // Authenticate before timeout
    handleWebSocketMessage(
      ws as unknown as { send(data: string): void },
      JSON.stringify({ type: "auth", token: "valid-token" }),
    );

    // Advance past the 2s auth timeout
    vi.advanceTimersByTime(2500);

    // Should still be connected — timeout was cleared
    expect(getClientCount()).toBe(1);
    expect(closed).toBe(false);
  });

  it("rejects subscribe after failed auth (client stays unauthenticated)", async () => {
    const { setupWebSocket, handleWebSocketMessage, _resetForTesting, _setTokenVerifier } =
      await import("../../src/daemon/ws.js");
    _resetForTesting();
    _setTokenVerifier((t) => t === "valid-token");

    const sent: string[] = [];
    const ws = {
      send: (data: string) => sent.push(data),
      close: () => {},
    };

    setupWebSocket(ws as unknown as { send(data: string): void });

    // Send wrong token
    handleWebSocketMessage(
      ws as unknown as { send(data: string): void },
      JSON.stringify({ type: "auth", token: "bad-token" }),
    );

    // Try to subscribe — should fail because still unauthenticated
    handleWebSocketMessage(
      ws as unknown as { send(data: string): void },
      JSON.stringify({ type: "subscribe", topics: ["test"] }),
    );

    const lastMsg = JSON.parse(sent[sent.length - 1]);
    expect(lastMsg.type).toBe("error");
    expect(lastMsg.message).toContain("Not authenticated");
  });
});
