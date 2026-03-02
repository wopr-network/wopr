import { logger } from "../logger.js";
import { countActiveSessionsAsync, findExpiredSessionsAsync, findLruSessionsAsync } from "./session-repository.js";
import { deleteSession, hasPendingInject } from "./sessions.js";

export interface SessionCleanerConfig {
  ttlMs: number;
  maxCount: number;
  cleanupIntervalMs: number;
}

export interface SessionCleanerStats {
  expiredRemoved: number;
  lruEvicted: number;
  lastCleanupAt: number;
  isRunning: boolean;
}

export class SessionCleaner {
  private config: SessionCleanerConfig;
  private interval: ReturnType<typeof setInterval> | null = null;
  private cleanupInProgress = false;
  private stats: SessionCleanerStats = {
    expiredRemoved: 0,
    lruEvicted: 0,
    lastCleanupAt: 0,
    isRunning: false,
  };

  constructor(config: SessionCleanerConfig) {
    this.config = config;
  }

  start(): void {
    if (this.interval) return;
    this.stats.isRunning = true;
    this.interval = setInterval(() => {
      this.cleanup().catch((err) => {
        logger.error(`[session-cleaner] cleanup error: ${err}`);
      });
    }, this.config.cleanupIntervalMs);
    // Unref so the interval does not prevent process exit during graceful shutdown
    (this.interval as unknown as { unref?: () => void }).unref?.();
    // Run first cleanup async, don't block startup
    this.cleanup().catch((err) => {
      logger.error(`[session-cleaner] initial cleanup error: ${err}`);
    });
    logger.info(
      `[session-cleaner] started (TTL=${this.config.ttlMs}ms, max=${this.config.maxCount}, interval=${this.config.cleanupIntervalMs}ms)`,
    );
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.stats.isRunning = false;
    logger.info("[session-cleaner] stopped");
  }

  async cleanup(): Promise<SessionCleanerStats> {
    // Skip if a cleanup is already in progress to avoid concurrent runs
    if (this.cleanupInProgress) {
      return { ...this.stats };
    }
    this.cleanupInProgress = true;

    const runStats = {
      expiredRemoved: 0,
      lruEvicted: 0,
      lastCleanupAt: Date.now(),
      isRunning: this.stats.isRunning,
    };

    try {
      // Phase 1: Remove expired sessions (TTL)
      const expired = await findExpiredSessionsAsync(this.config.ttlMs);
      for (const session of expired) {
        if (hasPendingInject(session.name)) {
          logger.debug(`[session-cleaner] skipping "${session.name}" — has pending inject`);
          continue;
        }
        try {
          await deleteSession(session.name, "ttl-expired");
          runStats.expiredRemoved++;
        } catch (err) {
          logger.error(`[session-cleaner] failed to delete expired session "${session.name}": ${err}`);
        }
      }

      // Phase 2: LRU eviction if over maxCount
      const activeCount = await countActiveSessionsAsync();
      if (activeCount > this.config.maxCount) {
        const excess = activeCount - this.config.maxCount;
        // Fetch extra candidates to account for sessions skipped due to pending injects
        const lruCandidates = await findLruSessionsAsync(excess * 2);
        let evicted = 0;
        for (const session of lruCandidates) {
          if (evicted >= excess) break;
          if (hasPendingInject(session.name)) {
            continue;
          }
          try {
            await deleteSession(session.name, "lru-evicted");
            runStats.lruEvicted++;
            evicted++;
          } catch (err) {
            logger.error(`[session-cleaner] failed to evict session "${session.name}": ${err}`);
          }
        }
      }

      // Update cumulative stats
      this.stats.expiredRemoved += runStats.expiredRemoved;
      this.stats.lruEvicted += runStats.lruEvicted;
      this.stats.lastCleanupAt = runStats.lastCleanupAt;

      if (runStats.expiredRemoved > 0 || runStats.lruEvicted > 0) {
        logger.info(`[session-cleaner] removed ${runStats.expiredRemoved} expired, evicted ${runStats.lruEvicted} LRU`);
      }
    } finally {
      this.cleanupInProgress = false;
    }

    return runStats;
  }

  getStats(): SessionCleanerStats {
    return { ...this.stats };
  }
}
