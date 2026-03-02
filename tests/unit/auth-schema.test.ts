import { describe, expect, it } from "vitest";
import { authApiKeySchema, authCredentialSchema, authPluginSchema } from "../../src/auth/auth-schema.js";

describe("authCredentialSchema", () => {
  it("accepts a valid credential record", () => {
    const valid = {
      id: "anthropic-key-1",
      provider: "anthropic",
      encryptedValue: "encrypted-data-here",
      encryptionMethod: "aes-256-gcm",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(authCredentialSchema.parse(valid)).toEqual(valid);
  });

  it("accepts a credential without optional encryptionMethod", () => {
    const valid = {
      id: "openai-key-1",
      provider: "openai",
      encryptedValue: "plaintext-key",
      createdAt: 1000,
      updatedAt: 2000,
    };
    const result = authCredentialSchema.parse(valid);
    expect(result.id).toBe("openai-key-1");
    expect(result.encryptionMethod).toBeUndefined();
  });

  it("rejects a credential missing required id", () => {
    const invalid = {
      provider: "anthropic",
      encryptedValue: "data",
      createdAt: 1000,
      updatedAt: 2000,
    };
    expect(() => authCredentialSchema.parse(invalid)).toThrow();
  });

  it("rejects a credential missing required provider", () => {
    const invalid = {
      id: "key-1",
      encryptedValue: "data",
      createdAt: 1000,
      updatedAt: 2000,
    };
    expect(() => authCredentialSchema.parse(invalid)).toThrow();
  });

  it("rejects a credential with wrong type for createdAt", () => {
    const invalid = {
      id: "key-1",
      provider: "anthropic",
      encryptedValue: "data",
      createdAt: "not-a-number",
      updatedAt: 2000,
    };
    expect(() => authCredentialSchema.parse(invalid)).toThrow();
  });

  it("rejects a completely empty object", () => {
    expect(() => authCredentialSchema.parse({})).toThrow();
  });

  it("rejects null and undefined", () => {
    expect(() => authCredentialSchema.parse(null)).toThrow();
    expect(() => authCredentialSchema.parse(undefined)).toThrow();
  });
});

describe("authApiKeySchema", () => {
  it("accepts a fully populated API key record", () => {
    const valid = {
      id: "uuid-1234",
      userId: "user-1",
      name: "My API Key",
      keyHash: "scrypt-hash-here",
      keyPrefix: "wopr_abc123",
      scope: "full",
      lastUsedAt: Date.now(),
      createdAt: Date.now(),
      expiresAt: Date.now() + 86400000,
    };
    expect(authApiKeySchema.parse(valid)).toEqual(valid);
  });

  it("accepts an API key with only required fields", () => {
    const minimal = {
      id: "uuid-5678",
      name: "Minimal Key",
      keyHash: "hash",
      keyPrefix: "wopr_xyz789",
      createdAt: Date.now(),
    };
    const result = authApiKeySchema.parse(minimal);
    expect(result.userId).toBeUndefined();
    expect(result.scope).toBeUndefined();
    expect(result.lastUsedAt).toBeUndefined();
    expect(result.expiresAt).toBeUndefined();
  });

  it("rejects an API key missing required name", () => {
    const invalid = {
      id: "uuid-1",
      keyHash: "hash",
      keyPrefix: "wopr_abc",
      createdAt: 1000,
    };
    expect(() => authApiKeySchema.parse(invalid)).toThrow();
  });

  it("rejects an API key missing required keyHash", () => {
    const invalid = {
      id: "uuid-1",
      name: "Key",
      keyPrefix: "wopr_abc",
      createdAt: 1000,
    };
    expect(() => authApiKeySchema.parse(invalid)).toThrow();
  });

  it("rejects an API key with wrong type for expiresAt", () => {
    const invalid = {
      id: "uuid-1",
      name: "Key",
      keyHash: "hash",
      keyPrefix: "wopr_abc",
      createdAt: 1000,
      expiresAt: "tomorrow",
    };
    expect(() => authApiKeySchema.parse(invalid)).toThrow();
  });
});

describe("authPluginSchema", () => {
  it("has namespace 'auth'", () => {
    expect(authPluginSchema.namespace).toBe("auth");
  });

  it("has version 1", () => {
    expect(authPluginSchema.version).toBe(1);
  });

  it("defines auth_credentials table with correct primaryKey", () => {
    expect(authPluginSchema.tables.auth_credentials).toBeDefined();
    expect(authPluginSchema.tables.auth_credentials.primaryKey).toBe("id");
  });

  it("defines auth_api_keys table with correct primaryKey", () => {
    expect(authPluginSchema.tables.auth_api_keys).toBeDefined();
    expect(authPluginSchema.tables.auth_api_keys.primaryKey).toBe("id");
  });

  it("has provider and updatedAt indexes on auth_credentials", () => {
    const indexes = authPluginSchema.tables.auth_credentials.indexes;
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fields: ["provider"] }),
        expect.objectContaining({ fields: ["updatedAt"] }),
      ]),
    );
  });

  it("has keyPrefix, userId, createdAt, expiresAt indexes on auth_api_keys", () => {
    const indexes = authPluginSchema.tables.auth_api_keys.indexes;
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fields: ["keyPrefix"] }),
        expect.objectContaining({ fields: ["userId"] }),
        expect.objectContaining({ fields: ["createdAt"] }),
        expect.objectContaining({ fields: ["expiresAt"] }),
      ]),
    );
  });
});
