import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 10_000,
    coverage: {
      provider: "istanbul",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts", "src/daemon/**", "src/commands/**"],
    },
    include: ["tests/**/*.test.ts"],
  },
});
