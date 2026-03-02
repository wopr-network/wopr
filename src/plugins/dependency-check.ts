/**
 * Plugin dependency pre-flight check (WOP-1461)
 *
 * Checks whether a plugin's manifest.dependencies are already installed
 * before completing the install flow. Returns missing dependency names so
 * callers can return a 422 with a clear list instead of silently
 * auto-installing.
 */

import { normalizeDependencyName } from "./loading.js";

export interface DependencyCheckResult {
  ok: boolean;
  missing: string[];
}

/**
 * Check whether all of a plugin's declared dependencies are present in the
 * installed plugin list.
 *
 * @param dependencies  - The manifest.dependencies array (may be undefined/empty)
 * @param installedNames - Short names of plugins currently installed
 * @returns { ok: true, missing: [] } when all deps are satisfied, or
 *          { ok: false, missing: [...] } with the unsatisfied dep names
 */
export function checkPluginDependencies(
  dependencies: string[] | undefined,
  installedNames: string[],
): DependencyCheckResult {
  if (!dependencies || dependencies.length === 0) {
    return { ok: true, missing: [] };
  }

  const installedSet = new Set(installedNames.map((n) => normalizeDependencyName(n)));
  const missing = dependencies.map((dep) => normalizeDependencyName(dep)).filter((dep) => !installedSet.has(dep));

  return {
    ok: missing.length === 0,
    missing,
  };
}
