// WOPR Memory System - Vector-based semantic search
// Adapted from OpenClaw's memory implementation

export { MemoryIndexManager } from "./manager.js";
export {
  type MemoryConfig,
  type MemorySearchResult,
  type MemorySource,
  type TemporalFilter,
  DEFAULT_MEMORY_CONFIG,
  parseTemporalFilter,
} from "./types.js";
export { type EmbeddingProvider } from "./embeddings.js";
export { saveSessionToMemory, createSessionDestroyHandler } from "./session-hook.js";
export { listSessionFiles, getRecentSessionContent } from "./session-files.js";
export { initMemoryHooks } from "./init.js";
