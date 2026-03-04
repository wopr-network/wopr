import { describe, it, expect } from "vitest";
import {
  sessionSchema,
  sessionMessageSchema,
  sessionsPluginSchema,
} from "../../src/core/session-schema.js";

const validSession = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "test-session",
  status: "active",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  lastActivityAt: Date.now(),
};

const validMessage = {
  id: "660e8400-e29b-41d4-a716-446655440001",
  sessionId: "550e8400-e29b-41d4-a716-446655440000",
  role: "user",
  content: "Hello world",
  sequence: 1,
  entryType: "message",
  createdAt: Date.now(),
};

describe("session-schema", () => {
  describe("sessionSchema", () => {
    it("accepts a valid session with required fields only", () => {
      const result = sessionSchema.safeParse(validSession);
      expect(result.success).toBe(true);
    });

    it("accepts a valid session with all optional fields", () => {
      const result = sessionSchema.safeParse({
        ...validSession,
        providerId: "anthropic",
        providerConfig: '{"model":"claude-3"}',
        context: "You are a helpful assistant",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.providerId).toBe("anthropic");
        expect(result.data.providerConfig).toBe('{"model":"claude-3"}');
        expect(result.data.context).toBe("You are a helpful assistant");
      }
    });

    it("rejects when id is missing", () => {
      const { id, ...rest } = validSession;
      const result = sessionSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects when name is missing", () => {
      const { name, ...rest } = validSession;
      const result = sessionSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects when status is missing", () => {
      const { status, ...rest } = validSession;
      const result = sessionSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects when createdAt is missing", () => {
      const { createdAt, ...rest } = validSession;
      const result = sessionSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects when updatedAt is missing", () => {
      const { updatedAt, ...rest } = validSession;
      const result = sessionSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects when lastActivityAt is missing", () => {
      const { lastActivityAt, ...rest } = validSession;
      const result = sessionSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects wrong types for required fields", () => {
      expect(sessionSchema.safeParse({ ...validSession, id: 123 }).success).toBe(false);
      expect(sessionSchema.safeParse({ ...validSession, name: 42 }).success).toBe(false);
      expect(sessionSchema.safeParse({ ...validSession, status: true }).success).toBe(false);
      expect(sessionSchema.safeParse({ ...validSession, createdAt: "now" }).success).toBe(false);
      expect(sessionSchema.safeParse({ ...validSession, updatedAt: "now" }).success).toBe(false);
      expect(sessionSchema.safeParse({ ...validSession, lastActivityAt: "now" }).success).toBe(false);
    });

    it("strips unknown fields by default", () => {
      const result = sessionSchema.safeParse({ ...validSession, unknownField: "foo" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect("unknownField" in result.data).toBe(false);
      }
    });

    it("rejects null and undefined input", () => {
      expect(sessionSchema.safeParse(null).success).toBe(false);
      expect(sessionSchema.safeParse(undefined).success).toBe(false);
    });

    it("rejects empty object", () => {
      expect(sessionSchema.safeParse({}).success).toBe(false);
    });
  });

  describe("sessionMessageSchema", () => {
    it("accepts a valid message with required fields only", () => {
      const result = sessionMessageSchema.safeParse(validMessage);
      expect(result.success).toBe(true);
    });

    it("accepts a valid message with all optional fields", () => {
      const result = sessionMessageSchema.safeParse({
        ...validMessage,
        source: "discord",
        senderId: "user-123",
        tokens: 50,
        model: "claude-3-opus",
        channelId: "ch-1",
        channelType: "discord",
        channelName: "general",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.source).toBe("discord");
        expect(result.data.senderId).toBe("user-123");
        expect(result.data.tokens).toBe(50);
        expect(result.data.model).toBe("claude-3-opus");
        expect(result.data.channelId).toBe("ch-1");
        expect(result.data.channelType).toBe("discord");
        expect(result.data.channelName).toBe("general");
      }
    });

    it("rejects when id is missing", () => {
      const { id, ...rest } = validMessage;
      expect(sessionMessageSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects when sessionId is missing", () => {
      const { sessionId, ...rest } = validMessage;
      expect(sessionMessageSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects when role is missing", () => {
      const { role, ...rest } = validMessage;
      expect(sessionMessageSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects when content is missing", () => {
      const { content, ...rest } = validMessage;
      expect(sessionMessageSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects when sequence is missing", () => {
      const { sequence, ...rest } = validMessage;
      expect(sessionMessageSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects when entryType is missing", () => {
      const { entryType, ...rest } = validMessage;
      expect(sessionMessageSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects when createdAt is missing", () => {
      const { createdAt, ...rest } = validMessage;
      expect(sessionMessageSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects wrong types for required fields", () => {
      expect(sessionMessageSchema.safeParse({ ...validMessage, id: 1 }).success).toBe(false);
      expect(sessionMessageSchema.safeParse({ ...validMessage, sessionId: 1 }).success).toBe(false);
      expect(sessionMessageSchema.safeParse({ ...validMessage, role: 99 }).success).toBe(false);
      expect(sessionMessageSchema.safeParse({ ...validMessage, content: [] }).success).toBe(false);
      expect(sessionMessageSchema.safeParse({ ...validMessage, sequence: "one" }).success).toBe(false);
      expect(sessionMessageSchema.safeParse({ ...validMessage, entryType: 0 }).success).toBe(false);
      expect(sessionMessageSchema.safeParse({ ...validMessage, createdAt: "now" }).success).toBe(false);
    });

    it("strips unknown fields by default", () => {
      const result = sessionMessageSchema.safeParse({ ...validMessage, extra: true });
      expect(result.success).toBe(true);
      if (result.success) {
        expect("extra" in result.data).toBe(false);
      }
    });
  });

  describe("sessionsPluginSchema", () => {
    it("has correct namespace", () => {
      expect(sessionsPluginSchema.namespace).toBe("sessions");
    });

    it("has version 1", () => {
      expect(sessionsPluginSchema.version).toBe(1);
    });

    it("defines sessions table with correct primary key", () => {
      expect(sessionsPluginSchema.tables.sessions).toBeDefined();
      expect(sessionsPluginSchema.tables.sessions.primaryKey).toBe("id");
    });

    it("defines session_messages table with correct primary key", () => {
      expect(sessionsPluginSchema.tables.session_messages).toBeDefined();
      expect(sessionsPluginSchema.tables.session_messages.primaryKey).toBe("id");
    });

    it("sessions table has expected indexes", () => {
      const indexes = sessionsPluginSchema.tables.sessions.indexes!;
      expect(indexes).toContainEqual({ fields: ["name"], unique: true });
      expect(indexes).toContainEqual({ fields: ["status"] });
      expect(indexes).toContainEqual({ fields: ["lastActivityAt"] });
    });

    it("session_messages table has expected indexes", () => {
      const indexes = sessionsPluginSchema.tables.session_messages.indexes!;
      expect(indexes).toContainEqual({ fields: ["sessionId", "sequence"] });
      expect(indexes).toContainEqual({ fields: ["sessionId", "createdAt"] });
      expect(indexes).toContainEqual({ fields: ["role"] });
      expect(indexes).toContainEqual({ fields: ["entryType"] });
      expect(indexes).toContainEqual({ fields: ["createdAt"] });
    });

    it("sessions table schema matches sessionSchema", () => {
      // Verify the schema in the plugin config is the same object as the exported schema
      expect(sessionsPluginSchema.tables.sessions.schema).toBe(sessionSchema);
      const result = sessionsPluginSchema.tables.sessions.schema.safeParse(validSession);
      expect(result.success).toBe(true);
    });

    it("session_messages table schema matches sessionMessageSchema", () => {
      expect(sessionsPluginSchema.tables.session_messages.schema).toBe(sessionMessageSchema);
      const result = sessionsPluginSchema.tables.session_messages.schema.safeParse(validMessage);
      expect(result.success).toBe(true);
    });
  });
});
