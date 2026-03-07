import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/cli.ts", "src/daemon/**", "src/commands/**"],
      reporter: ["text", "json-summary"],
      reportOnFailure: true,
    },
    include: ["tests/**/*.test.ts"],
  },
});
