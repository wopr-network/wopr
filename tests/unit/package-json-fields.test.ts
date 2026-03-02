import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("package.json fields", () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8"));

  it("has main field pointing to dist/index.js", () => {
    expect(pkg.main).toBe("./dist/index.js");
  });

  it("has types field pointing to dist/index.d.ts", () => {
    expect(pkg.types).toBe("./dist/index.d.ts");
  });

  it("has exports map with . entry", () => {
    expect(pkg.exports).toBeDefined();
    expect(pkg.exports["."]).toBeDefined();
  });

  it("exports . entry has import and types conditions", () => {
    const dot = pkg.exports["."];
    expect(dot.import).toBe("./dist/index.js");
    expect(dot.types).toBe("./dist/index.d.ts");
  });

  it("exports package.json", () => {
    expect(pkg.exports["./package.json"]).toBe("./package.json");
  });

  it("retains existing bin field", () => {
    expect(pkg.bin).toBeDefined();
    expect(pkg.bin.wopr).toBe("./dist/cli.js");
  });
});
