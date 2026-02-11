/**
 * Validation helpers for daemon HTTP routes
 */

import { resolve, sep } from "node:path";
import { HTTPException } from "hono/http-exception";

/**
 * Validates a session name from URL parameters to prevent path traversal (CWE-22).
 * Only allows alphanumeric characters, dots, underscores, and hyphens.
 * Throws an HTTPException(400) if the name is invalid.
 */
export function validateSessionName(name: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(name) || name.includes("..") || name === ".") {
    throw new HTTPException(400, { message: "Invalid session name" });
  }
}

/**
 * Defense-in-depth: verifies that a resolved path stays within the expected base directory.
 * Throws an HTTPException(400) if the resolved path escapes the base directory.
 */
export function assertPathContained(baseDir: string, name: string): void {
  const resolvedBase = resolve(baseDir);
  const resolvedPath = resolve(baseDir, name);
  if (!resolvedPath.startsWith(resolvedBase + sep)) {
    throw new HTTPException(400, { message: "Invalid session path" });
  }
}
