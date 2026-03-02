import { afterEach, describe, expect, it, vi } from "vitest";

describe("capability-catalog hostedDefaults baseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses WOPR_API_BASE_URL when set", async () => {
    vi.stubEnv("WOPR_API_BASE_URL", "http://localhost:9999");
    const { CAPABILITY_CATALOG } = await import(
      "../../src/core/capability-catalog.js"
    );
    const voice = CAPABILITY_CATALOG.find((c: any) => c.id === "voice");
    expect(voice?.plugins[0]?.hostedConfig?.baseUrl).toBe("http://localhost:9999");
  });

  it("falls back to https://api.wopr.bot when env var absent", async () => {
    vi.stubEnv("WOPR_API_BASE_URL", "");
    const { CAPABILITY_CATALOG } = await import(
      "../../src/core/capability-catalog.js"
    );
    const voice = CAPABILITY_CATALOG.find((c: any) => c.id === "voice");
    expect(voice?.plugins[0]?.hostedConfig?.baseUrl).toBe("https://api.wopr.bot");
  });
});
