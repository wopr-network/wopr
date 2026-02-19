/**
 * WebSocket API documentation — served as a supplementary JSON document.
 * OpenAPI 3.1 does not natively support WebSocket, so this is a separate
 * reference document linked from the main API docs.
 */
export const websocketDocs = {
  title: "WOPR WebSocket API",
  description: "Real-time event streaming via WebSocket at /ws or /api/ws",
  connection: {
    endpoints: ["ws://localhost:7437/ws", "ws://localhost:7437/api/ws"],
    authentication: "Ticket-based: send { type: 'auth', token: '<bearer-token>' } as first message after connecting.",
  },
  clientMessages: {
    auth: {
      description: "Authenticate the WebSocket connection",
      schema: { type: "auth", token: "string (bearer token)" },
    },
    subscribe: {
      description: "Subscribe to topics for real-time events",
      schema: { type: "subscribe", topics: ["string[]"] },
      topicPatterns: [
        "* — wildcard, receives everything",
        "instances — all instance status changes",
        "instance:<id>:logs — logs for a specific instance",
        "instance:<id>:status — status changes for a specific instance",
        "instance:<id>:session — session events for a specific instance",
        "capability:health — capability health status changes",
      ],
    },
    unsubscribe: {
      description: "Unsubscribe from topics",
      schema: { type: "unsubscribe", topics: ["string[]"] },
    },
    ping: {
      description: "Client heartbeat",
      schema: { type: "ping" },
    },
  },
  serverMessages: {
    connected: { description: "Sent on connection open" },
    authenticated: { description: "Sent after successful auth" },
    subscribed: { description: "Confirms subscription with current topic list" },
    unsubscribed: { description: "Confirms unsubscription" },
    pong: { description: "Response to client ping" },
    ping: { description: "Server heartbeat (every 30s)" },
    stream: { description: "Real-time stream event from session injection" },
    injection: { description: "Injection completion event" },
    "instance:status": { description: "Instance status change event" },
    "instance:log": { description: "Instance log event" },
    "instance:session": { description: "Instance session event" },
    "capability:health": { description: "Capability health change event" },
    error: {
      description: "Error message (invalid JSON, auth failure, backpressure)",
    },
  },
  backpressure: {
    description:
      "Slow consumers exceeding 512 messages per heartbeat interval (30s) are disconnected with BACKPRESSURE_DISCONNECT error.",
    clientTimeout: "90 seconds without activity",
  },
};
