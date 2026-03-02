import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture constructor args for each test
const constructorCalls: unknown[] = [];

vi.mock("pg", () => {
  class MockPool {
    constructor(opts: unknown) {
      constructorCalls.push(opts);
    }
    query = vi.fn();
    end = vi.fn();
  }
  return { Pool: MockPool };
});

describe("getPool config", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
    constructorCalls.length = 0;
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses default pool config when no DB_POOL_* env vars are set", async () => {
    const { getPool } = await import("./services.js");
    getPool();
    expect(constructorCalls[0]).toEqual({
      connectionString: "postgresql://test:test@localhost:5432/test",
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  });

  it("respects DB_POOL_MAX env var", async () => {
    vi.stubEnv("DB_POOL_MAX", "50");
    const { getPool } = await import("./services.js");
    getPool();
    expect(constructorCalls[0]).toMatchObject({ max: 50 });
  });

  it("respects DB_POOL_IDLE_TIMEOUT_MS env var", async () => {
    vi.stubEnv("DB_POOL_IDLE_TIMEOUT_MS", "60000");
    const { getPool } = await import("./services.js");
    getPool();
    expect(constructorCalls[0]).toMatchObject({ idleTimeoutMillis: 60_000 });
  });

  it("respects DB_POOL_CONNECTION_TIMEOUT_MS env var", async () => {
    vi.stubEnv("DB_POOL_CONNECTION_TIMEOUT_MS", "10000");
    const { getPool } = await import("./services.js");
    getPool();
    expect(constructorCalls[0]).toMatchObject({ connectionTimeoutMillis: 10_000 });
  });

  it("falls back to defaults for non-numeric env values", async () => {
    vi.stubEnv("DB_POOL_MAX", "not-a-number");
    const { getPool } = await import("./services.js");
    getPool();
    expect(constructorCalls[0]).toMatchObject({ max: 20 });
  });
});
