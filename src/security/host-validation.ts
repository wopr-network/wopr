import { isIP } from "node:net";

/**
 * Validate a node registration host to prevent SSRF.
 * Blocks loopback, link-local, multicast, broadcast, and unspecified addresses always.
 * Blocks private ranges (10.x, 172.16-31.x, 192.168.x, fc00::/7) unless
 * ALLOW_PRIVATE_NODE_HOSTS=true (for VPC deployments).
 *
 * NOTE: This validates the host string only. It does NOT perform DNS resolution,
 * so hostnames that resolve to private IPs (e.g., via DNS rebinding or nip.io tricks)
 * are not caught here. Out-of-scope for this issue.
 */
export function validateNodeHost(host: string): void {
  const trimmed = host.trim();
  if (trimmed.length === 0) {
    throw new Error("Invalid node host: empty");
  }

  // Check for "localhost" hostname
  if (trimmed.toLowerCase() === "localhost") {
    throw new Error("Invalid node host: loopback hostname");
  }

  const ipVersion = isIP(trimmed);

  if (ipVersion === 4) {
    validateIPv4(trimmed);
    return;
  }

  if (ipVersion === 6) {
    validateIPv6(trimmed);
    return;
  }

  // Reject malformed IPv4-looking strings (e.g. 999.999.999.999) that isIP()
  // returns 0 for but validateHostname() would accept as digit-only labels.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(trimmed)) {
    throw new Error("Invalid node host: malformed IPv4 address");
  }

  // Not an IP — treat as hostname
  validateHostname(trimmed);
}

function validateIPv4(ip: string): void {
  const parts = ip.split(".").map(Number);
  const [a, b] = parts;

  // Unspecified
  if (a === 0) throw new Error("Invalid node host: unspecified address");

  // Loopback — ALWAYS blocked
  if (a === 127) throw new Error("Invalid node host: loopback address");

  // Link-local — ALWAYS blocked
  if (a === 169 && b === 254) throw new Error("Invalid node host: link-local address");

  // Multicast
  if (a >= 224 && a <= 239) throw new Error("Invalid node host: multicast address");

  // Broadcast
  if (a === 255 && b === 255) throw new Error("Invalid node host: broadcast address");

  // Private ranges — blocked unless ALLOW_PRIVATE_NODE_HOSTS
  if (!allowPrivateHosts()) {
    if (a === 10) throw new Error("Invalid node host: private address");
    if (a === 172 && b >= 16 && b <= 31) throw new Error("Invalid node host: private address");
    if (a === 192 && b === 168) throw new Error("Invalid node host: private address");
  }
}

function validateIPv6(ip: string): void {
  const normalized = ip.toLowerCase();

  // Loopback ::1 — ALWAYS blocked
  if (normalized === "::1") throw new Error("Invalid node host: loopback address");

  // Unspecified :: — ALWAYS blocked
  if (normalized === "::") throw new Error("Invalid node host: unspecified address");

  // IPv6-mapped IPv4 — check the embedded IPv4
  const v4MappedMatch = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4MappedMatch) {
    validateIPv4(v4MappedMatch[1]);
    return;
  }

  // Link-local fe80::/10 — ALWAYS blocked
  if (normalized.startsWith("fe80:") || normalized.startsWith("fe80")) {
    throw new Error("Invalid node host: link-local address");
  }

  // Unique local fc00::/7 (fc00:: and fd00::) — private
  if (!allowPrivateHosts()) {
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
      throw new Error("Invalid node host: private address");
    }
  }
}

function validateHostname(host: string): void {
  if (host.length > 253) throw new Error("Invalid node host: hostname too long");
  if (host.startsWith(".") || host.endsWith(".")) throw new Error("Invalid node host: invalid hostname");
  // RFC 1123: labels separated by dots, alphanumeric + hyphens
  const labelPattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/;
  const labels = host.split(".");
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) throw new Error("Invalid node host: invalid hostname");
    if (!labelPattern.test(label)) throw new Error("Invalid node host: invalid hostname");
  }
}

function allowPrivateHosts(): boolean {
  return process.env.ALLOW_PRIVATE_NODE_HOSTS === "true";
}
