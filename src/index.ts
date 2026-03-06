/**
 * @wopr-network/wopr — public API surface.
 *
 * Re-exports the plugin type system, HTTP client, and core constants.
 * Internal daemon/CLI implementation details are NOT exported.
 */

export type { ClientConfig, InjectResult, Session as ClientSession } from "./client.js";

// HTTP client for programmatic daemon access
export { WoprClient } from "./client.js";
// Plugin type system (canonical source for all plugin-facing types)
export * from "./plugin-types/index.js";
// Core type re-exports (types useful externally, not already in plugin-types)
export type {
  AccessGrant,
  ConversationEntry,
  ConversationEntryType,
  DiscoveryMessage,
  DiscoveryMessageType,
  Identity,
  InviteToken,
  KeyHistory,
  KeyRotation,
  P2PMessage,
  P2PMessageType,
  Peer,
  Profile,
  RateLimitConfig,
  RateLimits,
  Session,
} from "./types.js";
// Core constants (value exports — must use export, not export type)
export {
  EXIT_INVALID,
  EXIT_OFFLINE,
  EXIT_OK,
  EXIT_RATE_LIMITED,
  EXIT_REJECTED,
  EXIT_VERSION_MISMATCH,
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
} from "./types.js";
