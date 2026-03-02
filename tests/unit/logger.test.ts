import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("shouldLogStack", () => {
  let origNodeEnv: string | undefined;
  let origLogLevel: string | undefined;

  beforeEach(() => {
    origNodeEnv = process.env.NODE_ENV;
    origLogLevel = process.env.LOG_LEVEL;
  });

  afterEach(() => {
    if (origNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = origNodeEnv;
    if (origLogLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = origLogLevel;
  });

  it("returns true when NODE_ENV is not production", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.LOG_LEVEL;
    const { shouldLogStack } = await import("../../src/logger.js");
    expect(shouldLogStack()).toBe(true);
  });

  it("returns false when NODE_ENV is production and LOG_LEVEL is not debug", async () => {
    process.env.NODE_ENV = "production";
    process.env.LOG_LEVEL = "info";
    const { shouldLogStack } = await import("../../src/logger.js");
    expect(shouldLogStack()).toBe(false);
  });

  it("returns true when NODE_ENV is production but LOG_LEVEL is debug", async () => {
    process.env.NODE_ENV = "production";
    process.env.LOG_LEVEL = "debug";
    const { shouldLogStack } = await import("../../src/logger.js");
    expect(shouldLogStack()).toBe(true);
  });

  it("returns true when NODE_ENV is undefined", async () => {
    delete process.env.NODE_ENV;
    delete process.env.LOG_LEVEL;
    const { shouldLogStack } = await import("../../src/logger.js");
    expect(shouldLogStack()).toBe(true);
  });
});
