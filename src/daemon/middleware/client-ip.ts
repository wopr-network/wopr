import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

/**
 * Extract the real client IP address.
 *
 * Uses the socket remote address by default. Only trusts X-Forwarded-For
 * when the connecting IP is in the trustedProxies list.
 */
export function getClientIp(c: Context, trustedProxies?: string[]): string {
  let socketIp: string | undefined;
  try {
    const info = getConnInfo(c);
    socketIp = info.remote.address;
  } catch {
    // getConnInfo throws when there's no real socket (e.g., in tests)
  }

  // Normalize IPv6-mapped IPv4 addresses (e.g. ::ffff:127.0.0.1 → 127.0.0.1)
  // so that trustedProxies entries written as plain IPv4 match local connections.
  const normalizedIp = socketIp?.startsWith("::ffff:") ? socketIp.slice(7) : socketIp;

  if (trustedProxies && normalizedIp && trustedProxies.includes(normalizedIp)) {
    const forwarded = c.req.header("x-forwarded-for");
    if (forwarded) {
      // X-Forwarded-For: client, proxy1, proxy2 — leftmost is the original client
      // Use find(Boolean) to skip empty segments from malformed headers like ", 1.2.3.4"
      const first = forwarded
        .split(",")
        .map((s) => s.trim())
        .find(Boolean);
      if (first) return first;
    }
  }

  return normalizedIp ?? "unknown";
}

/** Parse TRUSTED_PROXY env var into array of IPs. */
export function parseTrustedProxies(): string[] | undefined {
  const envVal = process.env.TRUSTED_PROXY;
  if (!envVal) return undefined;
  return envVal
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
