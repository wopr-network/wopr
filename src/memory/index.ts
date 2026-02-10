// WOPR Memory System - FTS5 keyword search
// For semantic/vector search, install wopr-plugin-memory-semantic

export { initMemoryHooks } from "./init.js";
export { MemoryIndexManager } from "./manager.js";
export { getRecentSessionContent, listSessionFiles } from "./session-files.js";
export { createSessionDestroyHandler, saveSessionToMemory } from "./session-hook.js";
export {
  DEFAULT_MEMORY_CONFIG,
  type MemoryConfig,
  type MemorySearchResult,
  type MemorySource,
  parseTemporalFilter,
  type TemporalFilter,
} from "./types.js";
