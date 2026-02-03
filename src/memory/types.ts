// Type definitions for WOPR memory system

export type MemorySource = "global" | "session" | "sessions";

/**
 * Temporal filter for memory search
 * Supports both relative ("24h", "7d", "2w") and absolute dates
 */
export type TemporalFilter = {
  /** Start timestamp (inclusive) - ms since epoch */
  after?: number;
  /** End timestamp (inclusive) - ms since epoch */
  before?: number;
};

/**
 * Parse a temporal expression into a TemporalFilter
 *
 * Supports:
 * - Relative: "24h", "7d", "2w", "1m" (hours, days, weeks, months)
 * - Absolute: "2026-01-01", "2026-01-01T12:00:00"
 * - Range: "2026-01-01-2026-01-05" or "2026-01-01 to 2026-01-05"
 *
 * Returns null if the expression can't be parsed
 */
export function parseTemporalFilter(expr: string): TemporalFilter | null {
  if (!expr || typeof expr !== "string") {
    return null;
  }

  const trimmed = expr.trim().toLowerCase();

  // Check for relative time expressions: "24h", "7d", "2w", "1m"
  const relativeMatch = trimmed.match(/^(\d+)(h|d|w|m)$/);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const now = Date.now();

    let msAgo: number;
    switch (unit) {
      case "h":
        msAgo = amount * 60 * 60 * 1000;
        break;
      case "d":
        msAgo = amount * 24 * 60 * 60 * 1000;
        break;
      case "w":
        msAgo = amount * 7 * 24 * 60 * 60 * 1000;
        break;
      case "m":
        msAgo = amount * 30 * 24 * 60 * 60 * 1000; // ~30 days
        break;
      default:
        return null;
    }

    return { after: now - msAgo };
  }

  // Check for "last X hours/days/weeks" format
  const lastMatch = trimmed.match(/^last\s+(\d+)\s+(hours?|days?|weeks?|months?)$/);
  if (lastMatch) {
    const amount = parseInt(lastMatch[1], 10);
    const unit = lastMatch[2];
    const now = Date.now();

    let msAgo: number;
    if (unit.startsWith("hour")) {
      msAgo = amount * 60 * 60 * 1000;
    } else if (unit.startsWith("day")) {
      msAgo = amount * 24 * 60 * 60 * 1000;
    } else if (unit.startsWith("week")) {
      msAgo = amount * 7 * 24 * 60 * 60 * 1000;
    } else if (unit.startsWith("month")) {
      msAgo = amount * 30 * 24 * 60 * 60 * 1000;
    } else {
      return null;
    }

    return { after: now - msAgo };
  }

  // Check for date range: "2026-01-01-2026-01-05" or "2026-01-01 to 2026-01-05"
  const rangeMatch = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})(?:T[\d:]+)?(?:\s*(?:-|to)\s*)(\d{4}-\d{2}-\d{2})(?:T[\d:]+)?$/
  );
  if (rangeMatch) {
    const startDate = new Date(rangeMatch[1]);
    const endDate = new Date(rangeMatch[2]);
    // Set end date to end of day
    endDate.setHours(23, 59, 59, 999);

    if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
      return {
        after: startDate.getTime(),
        before: endDate.getTime(),
      };
    }
  }

  // Check for single date: "2026-01-01" (entire day)
  const singleDateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (singleDateMatch) {
    const startDate = new Date(singleDateMatch[1]);
    const endDate = new Date(singleDateMatch[1]);
    endDate.setHours(23, 59, 59, 999);

    if (!isNaN(startDate.getTime())) {
      return {
        after: startDate.getTime(),
        before: endDate.getTime(),
      };
    }
  }

  // Check for ISO datetime: "2026-01-01T12:00:00"
  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2}T[\d:]+)$/);
  if (isoMatch) {
    const date = new Date(isoMatch[1]);
    if (!isNaN(date.getTime())) {
      // Single datetime - treat as "since this time"
      return { after: date.getTime() };
    }
  }

  return null;
}

export type MemorySearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: MemorySource;
};

export type MemoryConfig = {
  provider: "openai" | "gemini" | "local" | "auto";
  model: string;
  fallback: "openai" | "gemini" | "local" | "none";
  chunking: {
    tokens: number;
    overlap: number;
  };
  hybrid: {
    enabled: boolean;
    vectorWeight: number;
    textWeight: number;
    candidateMultiplier: number;
  };
  query: {
    maxResults: number;
    minScore: number;
  };
  store: {
    path: string;
    vector: {
      enabled: boolean;
      extensionPath?: string;
    };
  };
  cache: {
    enabled: boolean;
    maxEntries?: number;
  };
  sync: {
    onSearch: boolean;
    watch: boolean;
    watchDebounceMs: number;
    indexSessions: boolean;
  };
  remote?: {
    baseUrl?: string;
    apiKey?: string;
    headers?: Record<string, string>;
  };
  local?: {
    modelPath?: string;
    modelCacheDir?: string;
  };
};

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  provider: "auto",
  model: "text-embedding-3-small",
  fallback: "gemini",
  chunking: {
    tokens: 400,
    overlap: 80,
  },
  hybrid: {
    enabled: true,
    vectorWeight: 0.7,
    textWeight: 0.3,
    candidateMultiplier: 4,
  },
  query: {
    maxResults: 10,
    minScore: 0.35,
  },
  store: {
    path: "", // Will be set dynamically
    vector: {
      enabled: true,
    },
  },
  cache: {
    enabled: true,
    maxEntries: 10000,
  },
  sync: {
    onSearch: true,
    watch: true,
    watchDebounceMs: 1500,
    indexSessions: true,
  },
};
