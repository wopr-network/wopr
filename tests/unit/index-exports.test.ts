import { describe, it, expect } from "vitest";

describe("package exports", () => {
  it("exports WoprClient class", async () => {
    const mod = await import("../../src/index.js");
    expect(mod.WoprClient).toBeDefined();
    expect(typeof mod.WoprClient).toBe("function");
  });

  it("exports PROTOCOL_VERSION constant", async () => {
    const mod = await import("../../src/index.js");
    expect(mod.PROTOCOL_VERSION).toBeDefined();
    expect(typeof mod.PROTOCOL_VERSION).toBe("number");
  });

  it("exports exit code constants", async () => {
    const mod = await import("../../src/index.js");
    expect(mod.EXIT_OK).toBe(0);
    expect(mod.EXIT_OFFLINE).toBe(1);
    expect(mod.EXIT_REJECTED).toBe(2);
    expect(mod.EXIT_INVALID).toBe(3);
    expect(mod.EXIT_RATE_LIMITED).toBe(4);
    expect(mod.EXIT_VERSION_MISMATCH).toBe(5);
  });
});
