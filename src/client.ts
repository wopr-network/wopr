/**
 * WOPR HTTP Client
 *
 * Thin client for communicating with the WOPR daemon.
 */

import type { WoprConfig } from "./core/config.js";
import { getToken } from "./daemon/auth-token.js";
import type { ConversationEntry, CronJob, StreamCallback, StreamMessage } from "./types.js";

const DEFAULT_URL = "http://127.0.0.1:7437";

export interface ClientConfig {
  baseUrl?: string;
  /** Override token instead of reading from daemon-token file */
  token?: string;
}

export interface Session {
  name: string;
  id?: string;
  hasContext: boolean;
}

export interface InjectResult {
  sessionId: string;
  response: string;
  cost: number;
}

export class WoprClient {
  private baseUrl: string;
  private tokenOverride?: string;

  constructor(config: ClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? DEFAULT_URL;
    this.tokenOverride = config.token;
  }

  private authHeaders(): Record<string, string> {
    const token = this.tokenOverride ?? getToken();
    if (token) {
      return { Authorization: `Bearer ${token}` };
    }
    return {};
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...this.authHeaders(),
        ...options?.headers,
      },
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: "Request failed" }));
      throw new Error(error.error || `HTTP ${res.status}`);
    }

    return res.json();
  }

  async isRunning(): Promise<boolean> {
    try {
      await this.request("/health");
      return true;
    } catch {
      return false;
    }
  }

  // Sessions
  async getSessions(): Promise<Session[]> {
    const data = await this.request<{ sessions: Session[] }>("/sessions");
    return data.sessions;
  }

  async createSession(name: string, context?: string): Promise<void> {
    await this.request("/sessions", {
      method: "POST",
      body: JSON.stringify({ name, context }),
    });
  }

  async deleteSession(name: string): Promise<void> {
    await this.request(`/sessions/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  }

  async getSession(name: string): Promise<{ name: string; id?: string; context?: string }> {
    return this.request(`/sessions/${encodeURIComponent(name)}`);
  }

  async getConversationHistory(
    name: string,
    limit?: number,
  ): Promise<{ name: string; entries: ConversationEntry[]; count: number }> {
    const url = `/sessions/${encodeURIComponent(name)}/conversation${limit ? `?limit=${limit}` : ""}`;
    return this.request(url);
  }

  async inject(
    session: string,
    message: string,
    onStream?: StreamCallback,
    options?: { from?: string; silent?: boolean },
  ): Promise<InjectResult> {
    const bodyPayload: Record<string, unknown> = { message };
    if (options?.from) bodyPayload.from = options.from;
    if (options?.silent != null) bodyPayload.silent = options.silent;

    if (onStream) {
      // Use SSE for streaming
      const res = await fetch(`${this.baseUrl}/sessions/${encodeURIComponent(session)}/inject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...this.authHeaders(),
        },
        body: JSON.stringify(bodyPayload),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(error.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      const result: InjectResult = { sessionId: "", response: "", cost: 0 };
      const chunks: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6)) as StreamMessage & { sessionId?: string; cost?: number };
              onStream(data);
              if (data.type === "text") {
                chunks.push(data.content);
              } else if (data.type === "complete") {
                result.sessionId = data.sessionId || "";
                result.cost = data.cost || 0;
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      result.response = chunks.join("");
      return result;
    }

    // Non-streaming request
    return this.request(`/sessions/${encodeURIComponent(session)}/inject`, {
      method: "POST",
      body: JSON.stringify(bodyPayload),
    });
  }

  // Crons
  async getCrons(): Promise<CronJob[]> {
    const data = await this.request<{ crons: CronJob[] }>("/crons");
    return data.crons;
  }

  async addCron(cron: Omit<CronJob, "runAt"> & { runAt?: number }): Promise<void> {
    await this.request("/crons", {
      method: "POST",
      body: JSON.stringify(cron),
    });
  }

  async removeCron(name: string): Promise<void> {
    await this.request(`/crons/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  }

  // Auth
  async getAuthStatus(): Promise<{ authenticated: boolean; type?: string; email?: string }> {
    return this.request("/auth");
  }

  // Peers
  async getPeers(): Promise<any[]> {
    const data = await this.request<{ peers: any[] }>("/peers");
    return data.peers;
  }

  async getAccessGrants(): Promise<any[]> {
    const data = await this.request<{ grants: any[] }>("/peers/access");
    return data.grants;
  }

  async revokePeer(peer: string): Promise<void> {
    await this.request(`/peers/${encodeURIComponent(peer)}`, {
      method: "DELETE",
    });
  }

  async namePeer(id: string, name: string): Promise<void> {
    await this.request(`/peers/${encodeURIComponent(id)}/name`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    });
  }

  async injectPeer(peer: string, session: string, message: string): Promise<{ code: number; message?: string }> {
    return this.request("/peers/inject", {
      method: "POST",
      body: JSON.stringify({ peer, session, message }),
    });
  }

  async logMessage(session: string, message: string, from?: string): Promise<void> {
    await this.request(`/sessions/${encodeURIComponent(session)}/log`, {
      method: "POST",
      body: JSON.stringify({ message, from: from || "cli" }),
    });
  }

  async initSessionDocs(
    session: string,
    options?: { agentName?: string; userName?: string },
  ): Promise<{ created: string[] }> {
    return this.request(`/sessions/${encodeURIComponent(session)}/init-docs`, {
      method: "POST",
      body: JSON.stringify(options || {}),
    });
  }

  // Plugins
  async getPlugins(): Promise<any[]> {
    const data = await this.request<{ plugins: any[] }>("/plugins");
    return data.plugins;
  }

  async installPlugin(source: string): Promise<void> {
    await this.request("/plugins", {
      method: "POST",
      body: JSON.stringify({ source }),
    });
  }

  async removePlugin(name: string): Promise<void> {
    await this.request(`/plugins/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  }

  async enablePlugin(name: string): Promise<void> {
    await this.request(`/plugins/${encodeURIComponent(name)}/enable`, {
      method: "POST",
    });
  }

  async disablePlugin(name: string): Promise<void> {
    await this.request(`/plugins/${encodeURIComponent(name)}/disable`, {
      method: "POST",
    });
  }

  async reloadPlugin(name: string): Promise<void> {
    await this.request(`/plugins/${encodeURIComponent(name)}/reload`, {
      method: "POST",
    });
  }

  async searchPlugins(query: string): Promise<any[]> {
    const data = await this.request<{ results: any[] }>(`/plugins/search?q=${encodeURIComponent(query)}`);
    return data.results;
  }

  async getPluginRegistries(): Promise<{ name: string; url: string }[]> {
    const data = await this.request<{ registries: { name: string; url: string }[] }>("/plugins/registries");
    return data.registries;
  }

  async addPluginRegistry(name: string, url: string): Promise<void> {
    await this.request("/plugins/registries", {
      method: "POST",
      body: JSON.stringify({ name, url }),
    });
  }

  async removePluginRegistry(name: string): Promise<void> {
    await this.request(`/plugins/registries/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  }

  // Skills
  async getSkills(): Promise<any[]> {
    const data = await this.request<{ skills: any[] }>("/skills");
    return data.skills;
  }

  async installSkill(source: string, name?: string): Promise<void> {
    await this.request("/skills/install", {
      method: "POST",
      body: JSON.stringify({ source, name }),
    });
  }

  async removeSkill(name: string): Promise<void> {
    await this.request(`/skills/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  }

  async createSkill(name: string, description?: string): Promise<void> {
    await this.request("/skills/create", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    });
  }

  async searchSkills(query: string): Promise<any[]> {
    const data = await this.request<{ results: any[] }>(`/skills/search?q=${encodeURIComponent(query)}`);
    return data.results;
  }

  async getSkillRegistries(): Promise<{ name: string; url: string }[]> {
    const data = await this.request<{ registries: { name: string; url: string }[] }>("/skills/registries");
    return data.registries;
  }

  async addSkillRegistry(name: string, url: string): Promise<void> {
    await this.request("/skills/registries", {
      method: "POST",
      body: JSON.stringify({ name, url }),
    });
  }

  async removeSkillRegistry(name: string): Promise<void> {
    await this.request(`/skills/registries/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  }

  async clearSkillCache(): Promise<void> {
    await this.request("/skills/cache", {
      method: "DELETE",
    });
  }

  // Config
  async getConfig(): Promise<WoprConfig> {
    return this.request("/config");
  }

  async getConfigValue(key: string): Promise<any> {
    const data = await this.request<{ key: string; value: any }>(`/config/${encodeURIComponent(key)}`);
    return data.value;
  }

  async setConfigValue(key: string, value: any): Promise<void> {
    await this.request(`/config/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    });
  }

  async resetConfig(): Promise<void> {
    await this.request("/config", {
      method: "DELETE",
    });
  }

  // Identity
  async getIdentity(): Promise<any | null> {
    try {
      return this.request("/identity");
    } catch {
      return null;
    }
  }

  async initIdentity(force?: boolean): Promise<any> {
    return this.request("/identity", {
      method: "POST",
      body: JSON.stringify({ force }),
    });
  }

  async rotateIdentity(broadcast?: boolean): Promise<any> {
    return this.request("/identity/rotate", {
      method: "POST",
      body: JSON.stringify({ broadcast }),
    });
  }

  async createInvite(peerPubkey: string, sessions: string[]): Promise<{ token: string }> {
    return this.request("/identity/invite", {
      method: "POST",
      body: JSON.stringify({ peerPubkey, sessions }),
    });
  }

  async claimInvite(token: string): Promise<{ code: number; peerKey?: string; sessions?: string[]; message?: string }> {
    return this.request("/identity/claim", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  }

  // Discovery
  async joinTopic(topic: string): Promise<void> {
    await this.request("/discover/join", {
      method: "POST",
      body: JSON.stringify({ topic }),
    });
  }

  async leaveTopic(topic: string): Promise<void> {
    await this.request("/discover/leave", {
      method: "POST",
      body: JSON.stringify({ topic }),
    });
  }

  async getTopics(): Promise<string[]> {
    const data = await this.request<{ topics: string[] }>("/discover/topics");
    return data.topics;
  }

  async getDiscoveredPeers(topic?: string): Promise<any[]> {
    const path = topic ? `/discover/peers?topic=${encodeURIComponent(topic)}` : "/discover/peers";
    const data = await this.request<{ peers: any[] }>(path);
    return data.peers;
  }

  async requestConnection(peerId: string): Promise<{ code: number; sessions?: string[]; message?: string }> {
    return this.request("/discover/connect", {
      method: "POST",
      body: JSON.stringify({ peerId }),
    });
  }

  async getProfile(): Promise<any | null> {
    try {
      return this.request("/discover/profile");
    } catch {
      return null;
    }
  }

  async setProfile(content: Record<string, any>): Promise<any> {
    return this.request("/discover/profile", {
      method: "PUT",
      body: JSON.stringify(content),
    });
  }

  // Providers
  async getProviders(): Promise<any[]> {
    const data = await this.request<{ providers: any[] }>("/providers");
    return data.providers;
  }

  async addProviderCredential(providerId: string, credential: string): Promise<void> {
    await this.request("/providers", {
      method: "POST",
      body: JSON.stringify({ providerId, credential }),
    });
  }

  async removeProviderCredential(providerId: string): Promise<void> {
    await this.request(`/providers/${encodeURIComponent(providerId)}`, {
      method: "DELETE",
    });
  }

  async checkProvidersHealth(): Promise<any> {
    return this.request("/providers/health", {
      method: "POST",
    });
  }

  // Session provider management
  async setSessionProvider(sessionName: string, providerId: string, fallback?: string[]): Promise<void> {
    await this.request(`/sessions/${encodeURIComponent(sessionName)}/provider`, {
      method: "PUT",
      body: JSON.stringify({ providerId, fallback }),
    });
  }

  // Middleware management
  async getMiddlewares(): Promise<
    { name: string; priority: number; enabled: boolean; hasIncoming: boolean; hasOutgoing: boolean }[]
  > {
    const data = await this.request<{
      middlewares: { name: string; priority: number; enabled: boolean; hasIncoming: boolean; hasOutgoing: boolean }[];
    }>("/middleware");
    return data.middlewares;
  }

  async getMiddlewareChain(): Promise<{ name: string; priority: number; enabled: boolean }[]> {
    const data = await this.request<{ chain: { name: string; priority: number; enabled: boolean }[] }>(
      "/middleware/chain",
    );
    return data.chain;
  }

  async getMiddleware(
    name: string,
  ): Promise<{ name: string; priority: number; enabled: boolean; hasIncoming: boolean; hasOutgoing: boolean }> {
    return this.request(`/middleware/${encodeURIComponent(name)}`);
  }

  async enableMiddleware(name: string): Promise<void> {
    await this.request(`/middleware/${encodeURIComponent(name)}/enable`, {
      method: "POST",
    });
  }

  async disableMiddleware(name: string): Promise<void> {
    await this.request(`/middleware/${encodeURIComponent(name)}/disable`, {
      method: "POST",
    });
  }

  async setMiddlewarePriority(name: string, priority: number): Promise<void> {
    await this.request(`/middleware/${encodeURIComponent(name)}/priority`, {
      method: "PUT",
      body: JSON.stringify({ priority }),
    });
  }

  // Context provider management
  async getContextProviders(): Promise<{ name: string; priority: number; enabled: boolean }[]> {
    const data = await this.request<{ providers: { name: string; priority: number; enabled: boolean }[] }>(
      "/middleware/context",
    );
    return data.providers;
  }

  async getContextProvider(name: string): Promise<{ name: string; priority: number; enabled: boolean }> {
    return this.request(`/middleware/context/${encodeURIComponent(name)}`);
  }

  async enableContextProvider(name: string): Promise<void> {
    await this.request(`/middleware/context/${encodeURIComponent(name)}/enable`, {
      method: "POST",
    });
  }

  async disableContextProvider(name: string): Promise<void> {
    await this.request(`/middleware/context/${encodeURIComponent(name)}/disable`, {
      method: "POST",
    });
  }

  async setContextProviderPriority(name: string, priority: number): Promise<void> {
    await this.request(`/middleware/context/${encodeURIComponent(name)}/priority`, {
      method: "PUT",
      body: JSON.stringify({ priority }),
    });
  }
}

// ─── WebSocket streaming client (WOP-204) ───

export interface WsClientConfig {
  /** Base HTTP URL of the daemon (default: http://127.0.0.1:7437) */
  baseUrl?: string;
  /** Override token */
  token?: string;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Max reconnection attempts (default: Infinity) */
  maxReconnectAttempts?: number;
  /** Base delay between reconnect attempts in ms (default: 1000) */
  reconnectBaseDelay?: number;
  /** Max delay between reconnect attempts in ms (default: 30000) */
  reconnectMaxDelay?: number;
  /** Heartbeat interval in ms for client-side pings (default: 25000) */
  heartbeatInterval?: number;
}

export type WsEventHandler = (event: Record<string, unknown>) => void;

/**
 * WebSocket client for real-time event streaming from the WOPR daemon.
 *
 * Supports topic-based subscriptions with auto-reconnect and heartbeat.
 *
 * ```ts
 * const ws = new WoprWsClient({ baseUrl: "http://localhost:7437" });
 * ws.on("instance:status", (event) => console.log(event));
 * ws.subscribe(["instances", "instance:abc123:logs"]);
 * await ws.connect();
 * ```
 */
export class WoprWsClient {
  private baseUrl: string;
  private tokenOverride?: string;
  private autoReconnect: boolean;
  private maxReconnectAttempts: number;
  private reconnectBaseDelay: number;
  private reconnectMaxDelay: number;
  private heartbeatIntervalMs: number;

  private ws: import("ws").WebSocket | null = null;
  private handlers = new Map<string, Set<WsEventHandler>>();
  private pendingTopics = new Set<string>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(config: WsClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? DEFAULT_URL;
    this.tokenOverride = config.token;
    this.autoReconnect = config.autoReconnect ?? true;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? Number.POSITIVE_INFINITY;
    this.reconnectBaseDelay = config.reconnectBaseDelay ?? 1000;
    this.reconnectMaxDelay = config.reconnectMaxDelay ?? 30_000;
    this.heartbeatIntervalMs = config.heartbeatInterval ?? 25_000;
  }

  /**
   * Register a handler for events of a given type.
   * Use "*" to receive all events.
   */
  on(eventType: string, handler: WsEventHandler): void {
    let set = this.handlers.get(eventType);
    if (!set) {
      set = new Set();
      this.handlers.set(eventType, set);
    }
    set.add(handler);
  }

  /**
   * Remove a handler for events of a given type.
   */
  off(eventType: string, handler: WsEventHandler): void {
    this.handlers.get(eventType)?.delete(handler);
  }

  /**
   * Subscribe to topics on the server.
   */
  subscribe(topics: string[]): void {
    for (const t of topics) this.pendingTopics.add(t);
    if (this.ws) {
      this.send({ type: "subscribe", topics });
    }
  }

  /**
   * Unsubscribe from topics on the server.
   */
  unsubscribe(topics: string[]): void {
    for (const t of topics) this.pendingTopics.delete(t);
    if (this.ws) {
      this.send({ type: "unsubscribe", topics });
    }
  }

  /**
   * Connect to the daemon WebSocket endpoint.
   * Resolves when the connection is established.
   */
  async connect(): Promise<void> {
    this.closed = false;
    return this.doConnect();
  }

  /**
   * Close the connection and stop auto-reconnect.
   */
  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private async doConnect(): Promise<void> {
    const wsUrl = this.baseUrl.replace(/^http/, "ws") + "/api/ws";
    const token = this.tokenOverride ?? getToken();

    // Dynamically import ws (Node.js WebSocket client)
    const { default: WebSocket } = await import("ws");

    return new Promise<void>((resolve, reject) => {
      // Token is sent via Authorization header for the HTTP upgrade, and
      // as a first-message "auth" ticket after connection opens.
      // NEVER pass token in URL query params (leaks via logs/referrer/history).
      const ws = new WebSocket(wsUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      ws.on("open", () => {
        this.ws = ws;
        this.reconnectAttempt = 0;
        this.startHeartbeat();

        // Authenticate via first-message ticket exchange
        if (token) {
          this.send({ type: "auth", token });
        }

        // Re-subscribe to pending topics (server will queue until auth completes)
        if (this.pendingTopics.size > 0) {
          this.send({ type: "subscribe", topics: Array.from(this.pendingTopics) });
        }

        this.emit("connected", { type: "connected" });
        resolve();
      });

      ws.on("message", (data: Buffer | string) => {
        const str = typeof data === "string" ? data : data.toString("utf-8");
        try {
          const event = JSON.parse(str) as Record<string, unknown>;
          const eventType = typeof event.type === "string" ? event.type : "unknown";
          this.emit(eventType, event);
          this.emit("*", event);
        } catch {
          // Ignore unparseable messages
        }
      });

      ws.on("close", () => {
        this.stopHeartbeat();
        this.ws = null;
        this.emit("disconnected", { type: "disconnected" });
        if (!this.closed && this.autoReconnect) {
          this.scheduleReconnect();
        }
      });

      ws.on("error", (err: Error) => {
        this.emit("error", { type: "error", message: err.message });
        if (!this.ws) {
          // Connection never opened
          reject(err);
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this.emit("reconnect_failed", { type: "reconnect_failed", attempts: this.reconnectAttempt });
      return;
    }

    // Exponential backoff with jitter
    const delay = Math.min(
      this.reconnectBaseDelay * 2 ** this.reconnectAttempt + Math.random() * 500,
      this.reconnectMaxDelay,
    );
    this.reconnectAttempt++;

    this.emit("reconnecting", { type: "reconnecting", attempt: this.reconnectAttempt, delay });

    this.reconnectTimer = setTimeout(() => {
      this.doConnect().catch(() => {
        // doConnect rejection means the connection failed;
        // the close handler will schedule the next attempt
      });
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: "ping" });
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private emit(eventType: string, event: Record<string, unknown>): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(event);
        } catch {
          // Don't let user handler errors crash the client
        }
      }
    }
  }
}

// Default singleton
export const client = new WoprClient();
