import { afterEach, describe, expect, it, vi } from "vitest";

describe("capability-catalog hostedDefaults baseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses WOPR_CAPABILITY_CATALOG_URL when set (takes precedence over WOPR_API_BASE_URL)", async () => {
    vi.stubEnv("WOPR_CAPABILITY_CATALOG_URL", "http://catalog:8080");
    vi.stubEnv("WOPR_API_BASE_URL", "http://should-not-use:9999");
    const { CAPABILITY_CATALOG } = await import(
      "../../src/core/capability-catalog.js"
    );
    const voice = CAPABILITY_CATALOG.find((c: any) => c.id === "voice");
    expect(
      voice?.plugins.every((p: any) => p?.hostedConfig?.baseUrl === "http://catalog:8080")
    ).toBe(true);
  });

  it("falls back to WOPR_API_BASE_URL when WOPR_CAPABILITY_CATALOG_URL is whitespace-only", async () => {
    vi.stubEnv("WOPR_CAPABILITY_CATALOG_URL", "   ");
    vi.stubEnv("WOPR_API_BASE_URL", "http://api-base:1234");
    const { CAPABILITY_CATALOG } = await import(
      "../../src/core/capability-catalog.js"
    );
    const voice = CAPABILITY_CATALOG.find((c: any) => c.id === "voice");
    expect(
      voice?.plugins.every(
        (p: any) => p?.hostedConfig?.baseUrl === "http://api-base:1234",
      ),
    ).toBe(true);
  });

  it("strips trailing slashes from WOPR_CAPABILITY_CATALOG_URL", async () => {
    vi.stubEnv("WOPR_CAPABILITY_CATALOG_URL", "http://catalog:8080///");
    const { CAPABILITY_CATALOG } = await import(
      "../../src/core/capability-catalog.js"
    );
    const voice = CAPABILITY_CATALOG.find((c: any) => c.id === "voice");
    expect(
      voice?.plugins.every((p: any) => p?.hostedConfig?.baseUrl === "http://catalog:8080")
    ).toBe(true);
  });

  it("uses WOPR_API_BASE_URL when set", async () => {
    vi.stubEnv("WOPR_API_BASE_URL", "http://localhost:9999");
    const { CAPABILITY_CATALOG } = await import(
      "../../src/core/capability-catalog.js"
    );
    const voice = CAPABILITY_CATALOG.find((c: any) => c.id === "voice");
    expect(
      voice?.plugins.every((p: any) => p?.hostedConfig?.baseUrl === "http://localhost:9999")
    ).toBe(true);
  });

  it("falls back to https://api.wopr.bot when env var absent", async () => {
    delete process.env.WOPR_API_BASE_URL;
    const { CAPABILITY_CATALOG } = await import(
      "../../src/core/capability-catalog.js"
    );
    const voice = CAPABILITY_CATALOG.find((c: any) => c.id === "voice");
    expect(
      voice?.plugins.every((p: any) => p?.hostedConfig?.baseUrl === "https://api.wopr.bot")
    ).toBe(true);
  });
});
