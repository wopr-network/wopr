/**
 * Redact sensitive values from configuration objects.
 *
 * Walks an object tree and replaces any leaf value whose key name
 * contains a sensitive keyword (apikey, secret, token, etc.) with
 * the string "[REDACTED]".
 */

const SENSITIVE_KEYS = ["apikey", "api_key", "secret", "token", "password", "privatekey", "private_key"];

export function redactSensitive(obj: any, path: string = ""): any {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj !== "object") {
    const keyName = path.split(".").pop()?.toLowerCase() || "";
    if (SENSITIVE_KEYS.some((sk) => keyName.includes(sk))) return "[REDACTED]";
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item, i) => redactSensitive(item, `${path}[${i}]`));
  }

  const result: any = Object.create(null);
  for (const [k, v] of Object.entries(obj)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    result[k] = redactSensitive(v, path ? `${path}.${k}` : k);
  }
  return result;
}
