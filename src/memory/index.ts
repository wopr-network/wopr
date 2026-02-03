// WOPR Memory System - FTS5 keyword search
// For semantic/vector search, install wopr-plugin-memory-semantic

export { MemoryIndexManager } from "./manager.js";
export {
  type MemoryConfig,
  type MemorySearchResult,
  type MemorySource,
  type TemporalFilter,
  DEFAULT_MEMORY_CONFIG,
  parseTemporalFilter,
} from "./types.js";
export { saveSessionToMemory, createSessionDestroyHandler } from "./session-hook.js";
export { listSessionFiles, getRecentSessionContent } from "./session-files.js";
export { initMemoryHooks } from "./init.js";
