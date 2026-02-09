# WOPR Core Session Queue Implementation

## Problem

Current implementation uses timeout-cancel:
```typescript
async function waitForPendingInject(session) {
  // Wait up to 60s, then CANCEL the first inject
  if (timeout) {
    pending.abortController.abort();  // BAD: cancels user's request
  }
}
```

## Solution: True Promise Chain Queue

Replace `pendingInjects` Map and `waitForPendingInject` with a per-session promise chain.

### Changes to `src/core/sessions.ts`

```typescript
// ============================================================================
// Session Queue - True FIFO Promise Chain (replaces timeout-cancel)
// ============================================================================

interface ActiveSession {
  abortController: AbortController;
  startTime: number;
  sessionKey: string;
  // V2: Reference to the query generator for mid-stream injection
  queryGenerator?: AsyncGenerator<unknown>;
}

// Per-session promise chain - ensures FIFO ordering
const sessionQueues = new Map<string, Promise<InjectResult | void>>();

// Track the currently active inject per session (for V2 and cancellation)
const activeInjects = new Map<string, ActiveSession>();

/**
 * Cancel any running inject for a session
 */
export function cancelInject(session: string): boolean {
  const active = activeInjects.get(session);
  if (active) {
    active.abortController.abort();
    activeInjects.delete(session);
    logger.info(`[sessions] Cancelled inject for session: ${session}`);
    return true;
  }
  return false;
}

/**
 * Check if a session has a pending/active inject
 */
export function hasPendingInject(session: string): boolean {
  return activeInjects.has(session);
}

/**
 * Get queue depth for a session (for monitoring)
 */
export function getQueueDepth(session: string): number {
  // We can't easily count promises in a chain, but we can check if there's activity
  return activeInjects.has(session) ? 1 : 0;
}

/**
 * Main inject function - queues requests per session
 */
export async function inject(
  name: string,
  message: string | MultimodalMessage,
  options?: InjectOptions
): Promise<InjectResult> {
  // Get or create the queue for this session
  const prevPromise = sessionQueues.get(name) || Promise.resolve();

  // Create abort controller for this inject
  const abortController = new AbortController();

  // Chain this inject after the previous one completes
  const thisInject = prevPromise
    .catch(() => {
      // Don't let previous failures break the chain
      // Errors are logged in executeInject
    })
    .then(async (): Promise<InjectResult> => {
      // Register as active
      activeInjects.set(name, {
        abortController,
        startTime: Date.now(),
        sessionKey: name,
      });

      try {
        return await executeInject(name, message, options, abortController.signal);
      } finally {
        // Clean up active inject
        activeInjects.delete(name);
      }
    });

  // Update the queue with this promise
  sessionQueues.set(name, thisInject);

  // Clean up queue entry when done (prevents memory leak)
  thisInject.finally(() => {
    // Only clean up if this is still the last promise in the chain
    if (sessionQueues.get(name) === thisInject) {
      sessionQueues.delete(name);
    }
  });

  return thisInject;
}
```

### Benefits

1. **No more cancellations** - messages wait their turn
2. **FIFO ordering** - first message in, first message out
3. **All sources handled** - Discord, A2A, CLI all use same queue
4. **Memory efficient** - queue cleans up after itself

### Backward Compatibility

- `cancelInject()` still works (aborts the active inject)
- `hasPendingInject()` still works (checks if queue is active)
- All existing callers of `inject()` work unchanged

---

## 2. V2 Fast-Path (Optional Enhancement)

Add V2 check at the start of `executeInject` to inject into active streams:

```typescript
async function executeInject(
  name: string,
  message: string | MultimodalMessage,
  options?: InjectOptions,
  abortSignal?: AbortSignal
): Promise<InjectResult> {
  // V2 FAST PATH: If there's an active streaming session, inject directly
  // This allows messages to be seen by Claude mid-stream
  const active = activeInjects.get(name);
  if (active?.queryGenerator && options?.allowV2Inject !== false) {
    try {
      // Delegate to provider's V2 injection
      const client = await getProviderClientForSession(name);
      if (client?.sendToActiveSession) {
        logger.info(`[sessions] V2 inject into active session: ${name}`);
        await client.sendToActiveSession(name, normalizeMessage(message));
        // Return empty result - response flows through original stream
        return { response: "", sessionId: active.sessionKey, cost: 0 };
      }
    } catch (e) {
      logger.warn(`[sessions] V2 inject failed, falling back to queue: ${e}`);
      // Fall through to normal queue
    }
  }

  // Normal inject flow...
  // (existing executeInject code)
}
```

This is optional - the queue alone fixes the cancellation issue.
