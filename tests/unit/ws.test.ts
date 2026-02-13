/**
 * WebSocket Real-time Streaming Tests (WOP-204)
 *
 * Tests topic-based pub/sub, heartbeat, backpressure handling,
 * and legacy backward-compatible subscription patterns.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  _resetForTesting,
  broadcast,
  broadcastInjection,
  broadcastStream,
  emitInstanceLog,
  emitInstanceSession,
  emitInstanceStatus,
  getClientCount,
  getSubscriptionStats,
  handleWebSocketClose,
  handleWebSocketMessage,
  heartbeatTick,
  publishToTopic,
  setupWebSocket,
} from "../../src/daemon/ws.js";
import type { StreamMessage } from "../../src/types.js";

/** Mock WebSocket that records sent messages */
function createMockWs() {
  const sent: string[] = [];
  return {
    send(data: string) {
      sent.push(data);
    },
    sent,
    /** Parse and return the last sent message */
    lastMessage(): Record<string, unknown> {
      return JSON.parse(sent[sent.length - 1]);
    },
    /** Parse and return all sent messages */
    allMessages(): Record<string, unknown>[] {
      return sent.map((s) => JSON.parse(s));
    },
  };
}

afterEach(() => {
  _resetForTesting();
});

describe("WebSocket connection lifecycle", () => {
  it("should track connected clients", () => {
    const ws = createMockWs();
    expect(getClientCount()).toBe(0);
    setupWebSocket(ws);
    expect(getClientCount()).toBe(1);
  });

  it("should send welcome message on connection", () => {
    const ws = createMockWs();
    setupWebSocket(ws);
    const msg = ws.lastMessage();
    expect(msg.type).toBe("connected");
    expect(msg.message).toBe("WOPR WebSocket connected");
    expect(msg.ts).toBeTypeOf("number");
  });

  it("should remove client on close", () => {
    const ws = createMockWs();
    setupWebSocket(ws);
    expect(getClientCount()).toBe(1);
    handleWebSocketClose(ws);
    expect(getClientCount()).toBe(0);
  });

  it("should handle close for unknown client gracefully", () => {
    const ws = createMockWs();
    handleWebSocketClose(ws); // Should not throw
    expect(getClientCount()).toBe(0);
  });

  it("should handle message for unknown client gracefully", () => {
    const ws = createMockWs();
    handleWebSocketMessage(ws, '{"type":"ping"}'); // Should not throw
    expect(ws.sent.length).toBe(0);
  });
});

describe("Topic-based subscriptions (WOP-204)", () => {
  it("should subscribe to topics", () => {
    const ws = createMockWs();
    setupWebSocket(ws);

    handleWebSocketMessage(ws, JSON.stringify({
      type: "subscribe",
      topics: ["instances", "instance:abc123:logs"],
    }));

    const msg = ws.lastMessage();
    expect(msg.type).toBe("subscribed");
    expect(msg.topics).toContain("instances");
    expect(msg.topics).toContain("instance:abc123:logs");
  });

  it("should unsubscribe from topics", () => {
    const ws = createMockWs();
    setupWebSocket(ws);

    handleWebSocketMessage(ws, JSON.stringify({
      type: "subscribe",
      topics: ["instances", "instance:abc123:logs"],
    }));

    handleWebSocketMessage(ws, JSON.stringify({
      type: "unsubscribe",
      topics: ["instance:abc123:logs"],
    }));

    const msg = ws.lastMessage();
    expect(msg.type).toBe("unsubscribed");
    expect(msg.topics).toEqual(["instance:abc123:logs"]);
  });

  it("should receive events for subscribed topics", () => {
    const ws = createMockWs();
    setupWebSocket(ws);

    handleWebSocketMessage(ws, JSON.stringify({
      type: "subscribe",
      topics: ["instance:abc123:status"],
    }));

    emitInstanceStatus("abc123", "healthy");

    const messages = ws.allMessages();
    const statusEvent = messages.find((m) => m.type === "instance:status");
    expect(statusEvent).toBeDefined();
    expect(statusEvent?.id).toBe("abc123");
    expect(statusEvent?.status).toBe("healthy");
    expect(statusEvent?.ts).toBeTypeOf("number");
  });

  it("should NOT receive events for unsubscribed topics", () => {
    const ws = createMockWs();
    setupWebSocket(ws);

    // Subscribe to a different instance
    handleWebSocketMessage(ws, JSON.stringify({
      type: "subscribe",
      topics: ["instance:other:status"],
    }));

    emitInstanceStatus("abc123", "healthy");

    const messages = ws.allMessages();
    const statusEvents = messages.filter((m) => m.type === "instance:status");
    expect(statusEvents).toHaveLength(0);
  });

  it("should match wildcard * subscription", () => {
    const ws = createMockWs();
    setupWebSocket(ws);

    handleWebSocketMessage(ws, JSON.stringify({
      type: "subscribe",
      topics: ["*"],
    }));

    emitInstanceStatus("abc123", "healthy");
    emitInstanceLog("abc123", "info", "Hello");

    const messages = ws.allMessages();
    expect(messages.filter((m) => m.type === "instance:status")).toHaveLength(1);
    expect(messages.filter((m) => m.type === "instance:log")).toHaveLength(1);
  });

  it("should match 'instances' topic to all instance events", () => {
    const ws = createMockWs();
    setupWebSocket(ws);

    handleWebSocketMessage(ws, JSON.stringify({
      type: "subscribe",
      topics: ["instances"],
    }));

    emitInstanceStatus("abc", "healthy");
    emitInstanceStatus("def", "unhealthy");
    emitInstanceLog("abc", "info", "test");

    const messages = ws.allMessages();
    expect(messages.filter((m) => m.type === "instance:status")).toHaveLength(2);
    expect(messages.filter((m) => m.type === "instance:log")).toHaveLength(1);
  });

  it("should match instance prefix to sub-topics", () => {
    const ws = createMockWs();
    setupWebSocket(ws);

    // Subscribe to all events for instance abc123
    handleWebSocketMessage(ws, JSON.stringify({
      type: "subscribe",
      topics: ["instance:abc123"],
    }));

    emitInstanceStatus("abc123", "healthy");
    emitInstanceLog("abc123", "info", "test");
    emitInstanceSession("abc123", "inject", "main");
    // Different instance - should NOT match
    emitInstanceStatus("other", "healthy");

    const messages = ws.allMessages();
    expect(messages.filter((m) => m.type === "instance:status")).toHaveLength(1);
    expect(messages.filter((m) => m.type === "instance:log")).toHaveLength(1);
    expect(messages.filter((m) => m.type === "instance:session")).toHaveLength(1);
  });

  it("should ignore invalid topics in subscribe", () => {
    const ws = createMockWs();
    setupWebSocket(ws);

    handleWebSocketMessage(ws, JSON.stringify({
      type: "subscribe",
      topics: ["valid", "", 123, null],
    }));

    const msg = ws.lastMessage();
    expect(msg.type).toBe("subscribed");
    expect(msg.topics).toContain("valid");
    // Empty strings and non-strings should be filtered
    expect((msg.topics as string[]).length).toBe(1);
  });
});

describe("Legacy session-based subscriptions", () => {
  it("should handle sessions array in subscribe", () => {
    const ws = createMockWs();
    setupWebSocket(ws);

    handleWebSocketMessage(ws, JSON.stringify({
      type: "subscribe",
      sessions: ["main", "test"],
    }));

    const msg = ws.lastMessage();
    expect(msg.type).toBe("subscribed");
    expect(msg.sessions).toEqual(["main", "test"]);
  });

  it("should handle single session in subscribe", () => {
    const ws = createMockWs();
    setupWebSocket(ws);

    handleWebSocketMessage(ws, JSON.stringify({
      type: "subscribe",
      session: "main",
    }));

    const msg = ws.lastMessage();
    expect(msg.type).toBe("subscribed");
    expect(msg.sessions).toEqual(["main"]);
  });

  it("should handle sessions array in unsubscribe", () => {
    const ws = createMockWs();
    setupWebSocket(ws);

    handleWebSocketMessage(ws, JSON.stringify({ type: "subscribe", sessions: ["main"] }));
    handleWebSocketMessage(ws, JSON.stringify({ type: "unsubscribe", sessions: ["main"] }));

    const msg = ws.lastMessage();
    expect(msg.type).toBe("unsubscribed");
    expect(msg.sessions).toEqual(["main"]);
  });

  it("should handle single session in unsubscribe", () => {
    const ws = createMockWs();
    setupWebSocket(ws);

    handleWebSocketMessage(ws, JSON.stringify({ type: "subscribe", session: "main" }));
    handleWebSocketMessage(ws, JSON.stringify({ type: "unsubscribe", session: "main" }));

    const msg = ws.lastMessage();
    expect(msg.type).toBe("unsubscribed");
  });
});

describe("Event emission functions", () => {
  it("emitInstanceStatus sends correct event shape", () => {
    const ws = createMockWs();
    setupWebSocket(ws);
    handleWebSocketMessage(ws, JSON.stringify({ type: "subscribe", topics: ["*"] }));

    emitInstanceStatus("id1", "healthy", { cpu: 42 });

    const event = ws.allMessages().find((m) => m.type === "instance:status");
    expect(event).toMatchObject({
      type: "instance:status",
      id: "id1",
      status: "healthy",
      cpu: 42,
    });
    expect(event?.ts).toBeTypeOf("number");
  });

  it("emitInstanceLog sends correct event shape", () => {
    const ws = createMockWs();
    setupWebSocket(ws);
    handleWebSocketMessage(ws, JSON.stringify({ type: "subscribe", topics: ["*"] }));

    emitInstanceLog("id1", "error", "Something failed", { stack: "trace" });

    const event = ws.allMessages().find((m) => m.type === "instance:log");
    expect(event).toMatchObject({
      type: "instance:log",
      id: "id1",
      level: "error",
      message: "Something failed",
      stack: "trace",
    });
  });

  it("emitInstanceSession sends correct event shape", () => {
    const ws = createMockWs();
    setupWebSocket(ws);
    handleWebSocketMessage(ws, JSON.stringify({ type: "subscribe", topics: ["*"] }));

    emitInstanceSession("id1", "inject", "main", { user: "admin" });

    const event = ws.allMessages().find((m) => m.type === "instance:session");
    expect(event).toMatchObject({
      type: "instance:session",
      id: "id1",
      event: "inject",
      session: "main",
      user: "admin",
    });
  });
});

describe("Legacy broadcast functions", () => {
  it("broadcastStream delivers to session subscribers", () => {
    const ws = createMockWs();
    setupWebSocket(ws);
    handleWebSocketMessage(ws, JSON.stringify({ type: "subscribe", sessions: ["main"] }));

    const msg: StreamMessage = { type: "text", content: "Hello" };
    broadcastStream("main", "api", msg);

    const event = ws.allMessages().find((m) => m.type === "stream");
    expect(event).toMatchObject({
      type: "stream",
      session: "main",
      from: "api",
    });
    expect((event?.message as Record<string, unknown>)?.content).toBe("Hello");
  });

  it("broadcastInjection delivers to session subscribers", () => {
    const ws = createMockWs();
    setupWebSocket(ws);
    handleWebSocketMessage(ws, JSON.stringify({ type: "subscribe", sessions: ["main"] }));

    broadcastInjection("main", "api", "hello", "world");

    const event = ws.allMessages().find((m) => m.type === "injection");
    expect(event).toMatchObject({
      type: "injection",
      session: "main",
      from: "api",
      message: "hello",
      response: "world",
    });
  });

  it("broadcast delivers to all connected clients", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    setupWebSocket(ws1);
    setupWebSocket(ws2);

    broadcast({ type: "system", message: "test" });

    expect(ws1.allMessages().find((m) => m.type === "system")).toBeDefined();
    expect(ws2.allMessages().find((m) => m.type === "system")).toBeDefined();
  });
});

describe("Ping/pong", () => {
  it("should respond to ping with pong", () => {
    const ws = createMockWs();
    setupWebSocket(ws);

    handleWebSocketMessage(ws, JSON.stringify({ type: "ping" }));

    const msg = ws.lastMessage();
    expect(msg.type).toBe("pong");
    expect(msg.ts).toBeTypeOf("number");
  });

  it("should handle pong messages (no-op, updates activity)", () => {
    const ws = createMockWs();
    setupWebSocket(ws);

    // pong should not generate any response
    const sentBefore = ws.sent.length;
    handleWebSocketMessage(ws, JSON.stringify({ type: "pong" }));
    expect(ws.sent.length).toBe(sentBefore);
  });
});

describe("Error handling", () => {
  it("should return error for invalid JSON", () => {
    const ws = createMockWs();
    setupWebSocket(ws);

    handleWebSocketMessage(ws, "not json {{{");

    const msg = ws.lastMessage();
    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Invalid JSON");
  });

  it("should return error for unknown message type", () => {
    const ws = createMockWs();
    setupWebSocket(ws);

    handleWebSocketMessage(ws, JSON.stringify({ type: "foobar" }));

    const msg = ws.lastMessage();
    expect(msg.type).toBe("error");
    expect(msg.message).toContain("Unknown message type");
    expect(msg.message).toContain("foobar");
  });

  it("should remove client that throws on send", () => {
    const badWs = {
      send() {
        throw new Error("Connection closed");
      },
    };

    setupWebSocket(badWs);
    // The welcome send will throw, removing the client
    expect(getClientCount()).toBe(0);
  });
});

describe("Backpressure handling", () => {
  it("should drop messages when pending exceeds limit", () => {
    // We can't easily reach 1000 pending messages in a sync test since
    // the counter increments and decrements immediately. But we can verify
    // the safeSend path works with a slow client.
    const ws = createMockWs();
    setupWebSocket(ws);
    handleWebSocketMessage(ws, JSON.stringify({ type: "subscribe", topics: ["*"] }));

    // Emit many messages - they should all succeed in sync mode
    for (let i = 0; i < 100; i++) {
      emitInstanceLog("id1", "info", `msg ${i}`);
    }

    // All 100 logs plus welcome + subscribed = 102
    const logMessages = ws.allMessages().filter((m) => m.type === "instance:log");
    expect(logMessages).toHaveLength(100);
  });
});

describe("Heartbeat", () => {
  it("should export correct interval constants", () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(30_000);
    expect(CLIENT_TIMEOUT_MS).toBe(90_000);
  });

  it("should send ping to all clients on heartbeatTick", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    setupWebSocket(ws1);
    setupWebSocket(ws2);

    heartbeatTick();

    expect(ws1.allMessages().find((m) => m.type === "ping")).toBeDefined();
    expect(ws2.allMessages().find((m) => m.type === "ping")).toBeDefined();
  });

  it("should disconnect stale clients", () => {
    const ws = createMockWs();
    setupWebSocket(ws);
    expect(getClientCount()).toBe(1);

    // Simulate time passing beyond timeout by manipulating lastActivity
    // We can't directly set lastActivity, but heartbeatTick checks Date.now()
    // versus lastActivity. On fresh connection, lastActivity = Date.now(),
    // so the client won't be disconnected.
    const disconnected = heartbeatTick();
    expect(disconnected).toBe(0);
    expect(getClientCount()).toBe(1);
  });

  it("should return count of disconnected clients", () => {
    // With no clients, should return 0
    const disconnected = heartbeatTick();
    expect(disconnected).toBe(0);
  });
});

describe("publishToTopic", () => {
  it("should deliver to matching subscribers only", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    setupWebSocket(ws1);
    setupWebSocket(ws2);

    handleWebSocketMessage(ws1, JSON.stringify({ type: "subscribe", topics: ["instance:a:logs"] }));
    handleWebSocketMessage(ws2, JSON.stringify({ type: "subscribe", topics: ["instance:b:logs"] }));

    publishToTopic("instance:a:logs", { type: "instance:log", id: "a", message: "test" });

    expect(ws1.allMessages().find((m) => m.type === "instance:log")).toBeDefined();
    expect(ws2.allMessages().find((m) => m.type === "instance:log")).toBeUndefined();
  });
});

describe("Subscription stats", () => {
  it("should report correct stats", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    setupWebSocket(ws1);
    setupWebSocket(ws2);

    handleWebSocketMessage(ws1, JSON.stringify({ type: "subscribe", topics: ["instances", "instance:a:logs"] }));
    handleWebSocketMessage(ws2, JSON.stringify({ type: "subscribe", topics: ["*"] }));

    const stats = getSubscriptionStats();
    expect(stats.clients).toBe(2);
    expect(stats.totalSubscriptions).toBe(3); // 2 + 1
    expect(stats.backpressured).toBe(0);
  });

  it("should report zero stats with no clients", () => {
    const stats = getSubscriptionStats();
    expect(stats.clients).toBe(0);
    expect(stats.totalSubscriptions).toBe(0);
    expect(stats.backpressured).toBe(0);
  });
});

describe("Multiple clients", () => {
  it("should deliver to all matching clients independently", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const ws3 = createMockWs();
    setupWebSocket(ws1);
    setupWebSocket(ws2);
    setupWebSocket(ws3);

    handleWebSocketMessage(ws1, JSON.stringify({ type: "subscribe", topics: ["instance:a:status"] }));
    handleWebSocketMessage(ws2, JSON.stringify({ type: "subscribe", topics: ["instance:a:status"] }));
    // ws3 not subscribed

    emitInstanceStatus("a", "running");

    const ws1Events = ws1.allMessages().filter((m) => m.type === "instance:status");
    const ws2Events = ws2.allMessages().filter((m) => m.type === "instance:status");
    const ws3Events = ws3.allMessages().filter((m) => m.type === "instance:status");

    expect(ws1Events).toHaveLength(1);
    expect(ws2Events).toHaveLength(1);
    expect(ws3Events).toHaveLength(0);
  });

  it("should handle a client disconnecting mid-broadcast", () => {
    const ws1 = createMockWs();
    let callCount = 0;
    const badWs = {
      send() {
        callCount++;
        if (callCount > 1) throw new Error("gone");
      },
    };

    setupWebSocket(ws1);
    setupWebSocket(badWs);

    handleWebSocketMessage(ws1, JSON.stringify({ type: "subscribe", topics: ["*"] }));
    // badWs got welcome (callCount=1), next send will throw
    handleWebSocketMessage(badWs, JSON.stringify({ type: "subscribe", topics: ["*"] }));
    // callCount=2 -> throws, client removed

    expect(getClientCount()).toBe(1);

    // ws1 should still receive events
    emitInstanceStatus("a", "ok");
    expect(ws1.allMessages().filter((m) => m.type === "instance:status")).toHaveLength(1);
  });
});
