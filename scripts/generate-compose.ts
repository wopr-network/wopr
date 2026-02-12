// Generate docker-compose.generated.yml from bots/<name>/profile.yaml.
//
// Usage:
//   npx tsx scripts/generate-compose.ts [--bots-dir ./bots] [--out docker-compose.generated.yml]

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateCompose } from "../src/compose-gen/generate.js";

const args = process.argv.slice(2);

function flag(name: string, fallback: string): string {
  const idx = args.indexOf(name);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return fallback;
}

const botsDir = resolve(flag("--bots-dir", "bots"));
const outFile = resolve(flag("--out", "docker-compose.generated.yml"));

const result = generateCompose(botsDir);

if (result.errors.length > 0) {
  console.error("Validation errors:");
  for (const e of result.errors) {
    console.error(`  ${e.dir}: ${e.error}`);
  }
  if (result.profiles.length === 0) {
    process.exit(1);
  }
  console.error("Continuing with valid profiles...\n");
}

if (result.profiles.length === 0) {
  console.log("No bot profiles found in", botsDir);
  process.exit(0);
}

writeFileSync(outFile, result.yaml, "utf-8");
console.log(`Generated ${outFile} with ${result.profiles.length} service(s):`);
for (const p of result.profiles) {
  console.log(`  - ${p.name} (${p.release_channel}, ${p.update_policy})`);
}
