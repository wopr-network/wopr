import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

/** Normalize and sanitize an IP string from XFF or socket. */
function normalizeIp(raw: string): string {
  let ip = raw;
  // Strip IPv6 brackets: [2001:db8::1] → 2001:db8::1
  if (ip.startsWith("[")) {
    ip = ip.replace(/^\[|\]$/g, "");
  } else {
    // Strip port suffix for IPv4:port only (e.g. 1.2.3.4:8080 → 1.2.3.4)
    // IPv6 addresses contain colons so only strip if no other colons present
    if (!ip.includes(":") || /^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) {
      ip = ip.replace(/:\d+$/, "");
    }
  }
  // Strip IPv6-mapped IPv4 prefix (::ffff:1.2.3.4 → 1.2.3.4)
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  return ip;
}

/** Return true if the string looks like a valid IPv4 or IPv6 address. */
function isValidIp(ip: string): boolean {
  if (IPV4_RE.test(ip)) return true;
  // IPv6: must contain at least one colon
  if (ip.includes(":")) return true;
  return false;
}

/**
 * Extract the real client IP address.
 *
 * Uses a right-to-left walk of X-Forwarded-For when trustedProxies is set:
 * walk from right (nearest proxy) to left, skipping trusted proxy IPs, and
 * return the first non-trusted entry. Falls back to the socket remote address.
 */
export function getClientIp(c: Context, trustedProxies?: string[]): string {
  let socketIp: string | undefined;
  try {
    const info = getConnInfo(c);
    socketIp = info.remote.address;
  } catch {
    // getConnInfo throws when there's no real socket (e.g., in tests)
  }

  const normalizedSocket = socketIp ? normalizeIp(socketIp) : undefined;

  if (trustedProxies && trustedProxies.length > 0) {
    const trustedSet = new Set(trustedProxies);
    const forwarded = c.req.header("x-forwarded-for");
    if (forwarded) {
      const ips = forwarded
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      // Walk right to left: skip trusted proxies, return first non-trusted
      for (let i = ips.length - 1; i >= 0; i--) {
        const ip = normalizeIp(ips[i]);
        if (!isValidIp(ip)) continue;
        if (!trustedSet.has(ip)) {
          return ip;
        }
      }
    }
  }

  return normalizedSocket ?? "unknown";
}

/** Parse TRUSTED_PROXY env var into array of IPs, filtering non-IP values. */
export function parseTrustedProxies(): string[] | undefined {
  const envVal = process.env.TRUSTED_PROXY;
  if (!envVal) return undefined;
  const result = envVal
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter(isValidIp);
  return result.length > 0 ? result : undefined;
}
