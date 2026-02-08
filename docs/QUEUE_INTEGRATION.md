# Queue Integration Guide

## Overview

This document explains how to integrate the new queue system into WOPR core.

## Files Created

```
src/core/queue/
├── types.ts          # Type definitions
├── SessionQueue.ts   # Per-session FIFO queue
├── QueueManager.ts   # Central queue coordinator
└── index.ts          # Module exports
```

## Integration Steps

### 1. Update `src/core/sessions.ts`

Replace the old inject function with queue-based version:

```typescript
import { queueManager, type InjectOptions, type InjectResult } from "./queue/index.js";

// Remove: pendingInjects Map
// Remove: waitForPendingInject function
// Keep: executeInject function (renamed to executeInjectInternal)

// Initialize the queue manager with the executor
queueManager.setExecutor(executeInjectInternal);

// Optional: Set V2 injector if provider supports it
// queueManager.setV2Injector(v2InjectFunction);

/**
 * Main inject function - now uses queue
 */
export async function inject(
  name: string,
  message: string | MultimodalMessage,
  options?: InjectOptions
): Promise<InjectResult> {
  return queueManager.inject(name, message, options);
}

/**
 * Cancel inject - delegates to queue manager
 */
export function cancelInject(session: string): boolean {
  return queueManager.cancelActive(session);
}

/**
 * Check if session has pending inject
 */
export function hasPendingInject(session: string): boolean {
  return queueManager.hasPending(session);
}
```

### 2. Update Discord Plugin

Remove the plugin's own queue since core now handles it:

```typescript
// REMOVE: channelQueues Map
// REMOVE: queueInject function
// REMOVE: addToChain function
// REMOVE: processPendingBotResponses function

// SIMPLIFY handleWoprMessage:
async function handleWoprMessage(message: Message) {
  // ... validation code ...

  // Just call inject directly - core handles queuing
  const response = await ctx.inject(sessionKey, messageContent, {
    from: authorDisplayName,
    channel: { type: "discord", id: channelId, name: (message.channel as any).name },
    onStream: (msg) => handleChunk(msg, streamKey),
  });
}
```

### 3. Benefits of New Architecture

**Before:**
```
Discord Plugin                    WOPR Core
     │                                │
     ├── channelQueues Map           │
     ├── queueInject()               │
     ├── addToChain()                ├── pendingInjects Map
     └── processPendingBotResponses()├── waitForPendingInject()
                                     │      ↓
                                     │   60s timeout
                                     │      ↓
                                     │   CANCEL first inject! ❌
```

**After:**
```
Discord Plugin                    WOPR Core
     │                                │
     └── ctx.inject() ───────────────┼── queueManager.inject()
                                     │      │
                                     │      ├── SessionQueue (per session)
                                     │      │      │
                                     │      │      └── FIFO promise chain
                                     │      │          (no timeout, no cancel)
                                     │      │
                                     │      └── V2 fast-path (optional)
                                     │
A2A sessions_send ───────────────────┘
CLI inject ──────────────────────────┘
Webhooks ────────────────────────────┘
```

### 4. Monitoring

The queue provides events and stats:

```typescript
// Subscribe to queue events
queueManager.on((event) => {
  console.log(`[queue] ${event.type} - ${event.sessionKey} - ${event.injectId}`);
});

// Get stats for all active sessions
const stats = queueManager.getActiveStats();
for (const [session, stat] of stats) {
  console.log(`${session}: depth=${stat.queueDepth}, active=${stat.isProcessing}`);
}
```

### 5. Cleanup

Add periodic cleanup to prevent memory leaks:

```typescript
// In daemon or scheduler
setInterval(() => {
  queueManager.cleanup(5 * 60 * 1000); // Clean queues idle > 5 min
}, 60 * 1000);
```

## Migration Checklist

- [ ] Add `src/core/queue/` directory and files
- [ ] Update `src/core/sessions.ts` to use QueueManager
- [ ] Remove old `pendingInjects` and `waitForPendingInject`
- [ ] Update Discord plugin to remove its queue
- [ ] Update A2A sessions_send to use new inject
- [ ] Add queue cleanup to daemon
- [ ] Test concurrent requests from multiple sources
- [ ] Test cancellation still works
- [ ] Test V2 injection (if implemented)

## Testing

```bash
# Test concurrent injects (should queue, not cancel)
curl -X POST http://localhost:7437/inject -d '{"session":"test","message":"hello 1"}'
curl -X POST http://localhost:7437/inject -d '{"session":"test","message":"hello 2"}'
curl -X POST http://localhost:7437/inject -d '{"session":"test","message":"hello 3"}'

# All three should complete in order without cancellation
```
