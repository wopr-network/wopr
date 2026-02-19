/**
 * CORS configuration for the WOPR daemon (WOP-622)
 *
 * Restricts cross-origin requests to known localhost origins only.
 * The daemon port is read from WOPR_DAEMON_PORT (default: 7437) so
 * the allowlist stays in sync when the port is customised.
 */

const DEFAULT_DAEMON_PORT = 7437;

/**
 * Build the list of allowed CORS origins for the daemon.
 *
 * Always includes:
 *   - http://localhost:<port>     — daemon itself / CLI tools
 *   - http://127.0.0.1:<port>    — same, numeric loopback
 *   - http://localhost:3000       — wopr-platform-ui dev server
 *
 * The daemon port is resolved from `WOPR_DAEMON_PORT` at call time so
 * that tests can override it via environment variable.
 */
export function buildCorsOrigins(): string[] {
  const port = parseInt(process.env.WOPR_DAEMON_PORT || String(DEFAULT_DAEMON_PORT), 10);

  return [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    "http://localhost:3000", // wopr-platform-ui dev
  ];
}
