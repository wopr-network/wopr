// Type definitions for WOPR memory system
// For semantic/vector search, install wopr-plugin-memory-semantic

export type MemorySource = "global" | "session" | "sessions";

export type MemorySearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: MemorySource;
};

export type MemoryConfig = {
  chunking: {
    tokens: number;
    overlap: number;
  };
  query: {
    maxResults: number;
    minScore: number;
  };
  store: {
    path: string;
  };
  sync: {
    onSearch: boolean;
    watch: boolean;
    watchDebounceMs: number;
    indexSessions: boolean;
  };
};

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  chunking: {
    tokens: 400,
    overlap: 80,
  },
  query: {
    maxResults: 10,
    minScore: 0.35,
  },
  store: {
    path: "", // Will be set dynamically
  },
  sync: {
    onSearch: true,
    watch: true,
    watchDebounceMs: 1500,
    indexSessions: true,
  },
};
