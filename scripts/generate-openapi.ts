#!/usr/bin/env tsx
/**
 * Generate OpenAPI spec to a file (WOP-522).
 *
 * Usage:
 *   npx tsx scripts/generate-openapi.ts [output-path]
 *
 * Defaults to writing dist/openapi.json.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const outputPath = process.argv[2] ?? resolve(repoRoot, "dist", "openapi.json");

async function main() {
  // Dynamically import to avoid loading the full daemon at top level
  const { createApp } = await import("../src/daemon/index.js");

  const app = createApp();

  // Invoke the /openapi.json endpoint directly with a synthetic Request
  const req = new Request("http://localhost/openapi.json");
  const res = await app.fetch(req);
  const spec = await res.json();

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(spec, null, 2));
  console.log(`OpenAPI spec written to ${outputPath}`);
}

main().catch((err) => {
  console.error("Failed to generate OpenAPI spec:", err);
  process.exit(1);
});
