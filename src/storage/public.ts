/**
 * Storage module - plugin-extensible database storage
 *
 * Public exports for the storage system.
 * Plugins use these types and the StorageApi via ctx.storage
 */

// Public API types (plugins see these)
export type {
  Filter,
  FilterCondition,
  FilterOperator,
  OrderDirection,
  PluginSchema,
  QueryBuilder,
  Repository,
  StorageApi,
  TableIndex,
  TableSchema,
} from "./api/plugin-storage.js";

// Storage implementation (core uses this)
export { getStorage, resetStorage, Storage } from "./index.js";
