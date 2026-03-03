/**
 * Per-provider rate limit tracking with exponential backoff.
 *
 * Tracks 429 responses from LLM providers and enforces backoff windows
 * so the fallback chain skips rate-limited providers automatically.
 * State is in-memory only — does not persist across restarts.
 */

export interface RateLimitEntry {
  /** When the backoff expires (Date.now() + backoff duration) */
  retryAfter: number;
  /** Number of consecutive 429s from this provider */
  consecutiveHits: number;
}

export class RateLimitTracker {
  private limits = new Map<string, RateLimitEntry>();

  /** Base delay in ms for exponential backoff */
  private readonly baseDelayMs: number;
  /** Maximum backoff cap in ms */
  private readonly maxDelayMs: number;

  constructor(baseDelayMs = 1000, maxDelayMs = 60_000) {
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
  }

  /**
   * Record a 429 for a provider.
   * @param providerId The provider that returned 429
   * @param retryAfterSeconds Value from Retry-After header, if present
   */
  markRateLimited(providerId: string, retryAfterSeconds?: number): void {
    const existing = this.limits.get(providerId);
    // Reset the hit counter when the previous backoff has already expired —
    // a 429 after recovery is not "consecutive" and should not escalate backoff.
    const isStillLimited = existing !== undefined && Date.now() < existing.retryAfter;
    const hits = isStillLimited ? (existing.consecutiveHits ?? 0) + 1 : 1;

    let backoffMs: number;
    if (retryAfterSeconds !== undefined && retryAfterSeconds > 0) {
      // Respect Retry-After header, but cap to maxDelayMs to prevent a
      // misbehaving or malicious provider from forcing unbounded backoff.
      backoffMs = Math.min(retryAfterSeconds * 1000, this.maxDelayMs);
    } else {
      // Exponential backoff with jitter: base * 2^(hits-1) + random jitter.
      // Cap exponent at 30 to prevent 2**n from producing Infinity for large
      // hit counts (the outer Math.min already caps the final value).
      const exp = Math.min(hits - 1, 30);
      backoffMs = Math.min(this.baseDelayMs * 2 ** exp + Math.random() * 500, this.maxDelayMs);
    }

    this.limits.set(providerId, {
      retryAfter: Date.now() + backoffMs,
      consecutiveHits: hits,
    });
  }

  /**
   * Check if a provider is currently rate-limited.
   * Expired entries are retained so consecutive-hit counts survive until
   * a successful request calls {@link clearProvider}.
   */
  isRateLimited(providerId: string): boolean {
    const entry = this.limits.get(providerId);
    if (!entry) return false;
    if (Date.now() >= entry.retryAfter) {
      // Mark as available but retain consecutiveHits so exponential backoff
      // continues to grow correctly if the provider gets rate-limited again.
      entry.retryAfter = 0;
      return false;
    }
    return true;
  }

  /**
   * Get remaining backoff time in ms for a provider (0 if not limited).
   */
  getRetryAfterMs(providerId: string): number {
    const entry = this.limits.get(providerId);
    if (!entry) return 0;
    const remaining = entry.retryAfter - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Clear rate limit state for a provider (e.g., after successful request).
   */
  clearProvider(providerId: string): void {
    this.limits.delete(providerId);
  }

  /** Clear all tracked state. */
  clearAll(): void {
    this.limits.clear();
  }
}

export const rateLimitTracker = new RateLimitTracker();
