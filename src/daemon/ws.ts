/**
 * WebSocket handler for real-time streaming (WOP-204)
 *
 * Supports topic-based pub/sub, heartbeat/keepalive,
 * and backpressure handling for high-volume log streams.
 *
 * Topics follow the pattern:
 *   "instances"              - all instance status changes
 *   "instance:<id>:logs"     - logs for a specific instance
 *   "instance:<id>:status"   - status changes for a specific instance
 *   "instance:<id>:session"  - session events for a specific instance
 *   "*"                      - wildcard, receives everything
 *
 * Legacy session-based subscriptions are mapped to topics automatically.
 */

import type { StreamMessage } from "../types.js";

// Simple interface for what we need from WebSocket
interface WS {
  send(data: string): void;
}

/** Per-client state */
interface ClientState {
  ws: WS;
  topics: Set<string>;
  /** Number of messages queued but not yet flushed */
  pendingMessages: number;
  /** Whether this client is experiencing backpressure */
  backpressured: boolean;
  /** Last time we received a pong or message from this client */
  lastActivity: number;
}

/** Maximum queued messages per client before dropping */
const MAX_PENDING_MESSAGES = 1000;

/** Heartbeat interval in ms (30 seconds) */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** Client considered dead after this many ms without activity */
export const CLIENT_TIMEOUT_MS = 90_000;

// Connected WebSocket clients
const clients = new Map<WS, ClientState>();

/**
 * Register a new WebSocket client.
 */
export function setupWebSocket(ws: WS): void {
  const state: ClientState = {
    ws,
    topics: new Set(),
    pendingMessages: 0,
    backpressured: false,
    lastActivity: Date.now(),
  };
  clients.set(ws, state);

  // Send welcome
  safeSend(state, {
    type: "connected",
    message: "WOPR WebSocket connected",
    ts: Date.now(),
  });
}

/**
 * Handle an incoming WebSocket message (already parsed from raw data).
 */
export function handleWebSocketMessage(ws: WS, data: string): void {
  const state = clients.get(ws);
  if (!state) return;

  state.lastActivity = Date.now();

  try {
    const msg = JSON.parse(data);
    handleMessage(state, msg);
  } catch {
    safeSend(state, { type: "error", message: "Invalid JSON" });
  }
}

/**
 * Handle WebSocket close.
 */
export function handleWebSocketClose(ws: WS): void {
  clients.delete(ws);
}

function handleMessage(state: ClientState, msg: Record<string, unknown>): void {
  switch (msg.type) {
    case "subscribe": {
      // Topic-based subscriptions (WOP-204)
      const topics = msg.topics as string[] | undefined;
      if (topics && Array.isArray(topics)) {
        for (const t of topics) {
          if (typeof t === "string" && t.length > 0) {
            state.topics.add(t);
          }
        }
        safeSend(state, { type: "subscribed", topics: Array.from(state.topics) });
        break;
      }

      // Legacy: session-based subscriptions (map to topic pattern)
      const sessions = msg.sessions as string[] | undefined;
      if (sessions && Array.isArray(sessions)) {
        for (const s of sessions) {
          if (typeof s === "string") state.topics.add(s);
        }
        safeSend(state, { type: "subscribed", sessions, topics: Array.from(state.topics) });
      } else if (typeof msg.session === "string") {
        state.topics.add(msg.session);
        safeSend(state, { type: "subscribed", sessions: [msg.session], topics: Array.from(state.topics) });
      }
      break;
    }

    case "unsubscribe": {
      const topics = msg.topics as string[] | undefined;
      if (topics && Array.isArray(topics)) {
        for (const t of topics) {
          state.topics.delete(t);
        }
        safeSend(state, { type: "unsubscribed", topics });
        break;
      }

      // Legacy: session-based unsubscribe
      const sessions = msg.sessions as string[] | undefined;
      if (sessions && Array.isArray(sessions)) {
        for (const s of sessions) {
          state.topics.delete(s);
        }
        safeSend(state, { type: "unsubscribed", sessions });
      } else if (typeof msg.session === "string") {
        state.topics.delete(msg.session);
        safeSend(state, { type: "unsubscribed", sessions: [msg.session] });
      }
      break;
    }

    case "ping":
      safeSend(state, { type: "pong", ts: Date.now() });
      break;

    case "pong":
      // Client responded to our heartbeat; lastActivity already updated
      break;

    default:
      safeSend(state, { type: "error", message: `Unknown message type: ${msg.type}` });
  }
}

/**
 * Send a message to a client with backpressure protection.
 * Returns false if the message was dropped due to backpressure.
 */
function safeSend(state: ClientState, payload: Record<string, unknown>): boolean {
  if (state.pendingMessages >= MAX_PENDING_MESSAGES) {
    if (!state.backpressured) {
      state.backpressured = true;
      // Try to notify the client they're falling behind
      try {
        state.ws.send(
          JSON.stringify({
            type: "error",
            message: "Backpressure: messages being dropped. Reduce subscription scope or consume faster.",
            ts: Date.now(),
          }),
        );
      } catch {
        // Client is gone
        clients.delete(state.ws);
      }
    }
    return false;
  }

  try {
    state.pendingMessages++;
    state.ws.send(JSON.stringify(payload));
    // In a real buffered scenario we'd decrement on drain;
    // since hono-ws send is synchronous, decrement immediately
    state.pendingMessages--;
    state.backpressured = false;
    return true;
  } catch {
    // Client disconnected
    clients.delete(state.ws);
    return false;
  }
}

/**
 * Check if a client is subscribed to a given topic.
 *
 * Matching rules:
 *  - "*" matches everything
 *  - Exact match on topic string
 *  - "instances" matches any "instance:*" event
 *  - Legacy session name matches "instance:<session>:*" events
 */
function isSubscribed(state: ClientState, topic: string): boolean {
  if (state.topics.has("*")) return true;
  if (state.topics.has(topic)) return true;

  // "instances" topic matches all instance events
  if (state.topics.has("instances") && topic.startsWith("instance:")) return true;

  // Check if any subscription is a prefix of the topic
  // e.g. subscribing to "instance:abc123" matches "instance:abc123:logs"
  for (const sub of state.topics) {
    if (topic.startsWith(`${sub}:`)) return true;
  }

  return false;
}

// ─── Public broadcast functions ───

/**
 * Emit an instance status event.
 */
export function emitInstanceStatus(id: string, status: string, meta?: Record<string, unknown>): void {
  const topic = `instance:${id}:status`;
  const event = {
    type: "instance:status",
    id,
    status,
    ...meta,
    ts: Date.now(),
  };
  publishToTopic(topic, event);
}

/**
 * Emit an instance log event.
 */
export function emitInstanceLog(id: string, level: string, message: string, meta?: Record<string, unknown>): void {
  const topic = `instance:${id}:logs`;
  const event = {
    type: "instance:log",
    id,
    level,
    message,
    ...meta,
    ts: Date.now(),
  };
  publishToTopic(topic, event);
}

/**
 * Emit an instance session event (inject, create, destroy, etc.).
 */
export function emitInstanceSession(
  id: string,
  eventName: string,
  session: string,
  meta?: Record<string, unknown>,
): void {
  const topic = `instance:${id}:session`;
  const event = {
    type: "instance:session",
    id,
    event: eventName,
    session,
    ...meta,
    ts: Date.now(),
  };
  publishToTopic(topic, event);
}

/**
 * Publish an event to all clients subscribed to the given topic.
 */
export function publishToTopic(topic: string, event: Record<string, unknown>): void {
  for (const state of clients.values()) {
    if (isSubscribed(state, topic)) {
      safeSend(state, event);
    }
  }
}

// ─── Legacy broadcast functions (backward-compatible) ───

/**
 * Broadcast a stream event to all subscribed clients.
 * Legacy: maps session to topic pattern.
 */
export function broadcastStream(session: string, from: string, message: StreamMessage): void {
  const event = {
    type: "stream",
    session,
    from,
    message,
    ts: Date.now(),
  };

  // Publish to session topic (legacy) and instance log topic
  for (const state of clients.values()) {
    if (state.topics.has(session) || state.topics.has("*") || isSubscribed(state, `instance:${session}:logs`)) {
      safeSend(state, event);
    }
  }
}

/**
 * Broadcast an injection completion to all subscribed clients.
 * Legacy: maps session to topic pattern.
 */
export function broadcastInjection(session: string, from: string, message: string, response: string): void {
  const event = {
    type: "injection",
    session,
    from,
    message,
    response,
    ts: Date.now(),
  };

  for (const state of clients.values()) {
    if (state.topics.has(session) || state.topics.has("*") || isSubscribed(state, `instance:${session}:session`)) {
      safeSend(state, event);
    }
  }
}

/**
 * Broadcast any message to all connected clients.
 */
export function broadcast(event: Record<string, unknown>): void {
  for (const state of clients.values()) {
    safeSend(state, event);
  }
}

// ─── Heartbeat ───

/**
 * Send heartbeat pings to all clients and disconnect stale ones.
 * Should be called on an interval (e.g. every HEARTBEAT_INTERVAL_MS).
 * Returns the number of clients that were disconnected.
 */
export function heartbeatTick(): number {
  const now = Date.now();
  let disconnected = 0;

  for (const [ws, state] of clients) {
    if (now - state.lastActivity > CLIENT_TIMEOUT_MS) {
      // Client hasn't responded in too long; remove it
      clients.delete(ws);
      disconnected++;
      continue;
    }

    // Send heartbeat ping
    safeSend(state, { type: "ping", ts: now });
  }

  return disconnected;
}

// ─── Metrics ───

/**
 * Get number of connected clients.
 */
export function getClientCount(): number {
  return clients.size;
}

/**
 * Get subscription stats for monitoring.
 */
export function getSubscriptionStats(): { clients: number; totalSubscriptions: number; backpressured: number } {
  let totalSubscriptions = 0;
  let backpressured = 0;
  for (const state of clients.values()) {
    totalSubscriptions += state.topics.size;
    if (state.backpressured) backpressured++;
  }
  return { clients: clients.size, totalSubscriptions, backpressured };
}

/**
 * Reset all state (for testing).
 */
export function _resetForTesting(): void {
  clients.clear();
}
