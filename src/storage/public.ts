/**
 * Storage module - plugin-extensible database storage
 * 
 * Public exports for the storage system.
 * Plugins use these types and the StorageApi via ctx.storage
 */

// Public API types (plugins see these)
export type {
  StorageApi,
  Repository,
  QueryBuilder,
  Filter,
  FilterOperator,
  FilterCondition,
  OrderDirection,
  PluginSchema,
  TableSchema,
  TableIndex,
} from "./api/plugin-storage.js";

// Storage implementation (core uses this)
export { Storage, getStorage, resetStorage } from "./index.js";
