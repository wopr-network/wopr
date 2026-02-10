/**
 * WOPR Sandbox Module
 *
 * Docker-based session isolation for untrusted sessions.
 * Copied from OpenClaw with WOPR adaptations.
 */

// Configuration
export {
  resolveSandboxConfig,
  resolveSandboxDockerConfig,
  resolveSandboxPruneConfig,
  resolveSandboxScope,
  shouldSandbox,
} from "./config.js";
export { computeSandboxConfigHash } from "./config-hash.js";
// Constants
export {
  DEFAULT_SANDBOX_CONTAINER_PREFIX,
  DEFAULT_SANDBOX_IDLE_HOURS,
  DEFAULT_SANDBOX_IMAGE,
  DEFAULT_SANDBOX_MAX_AGE_DAYS,
  DEFAULT_SANDBOX_WORKDIR,
  DEFAULT_SANDBOX_WORKSPACE_ROOT,
  DEFAULT_TOOL_ALLOW,
  DEFAULT_TOOL_DENY,
  SANDBOX_REGISTRY_PATH,
  SANDBOX_STATE_DIR,
} from "./constants.js";
// Context
export {
  ensureSandboxWorkspace,
  getSandboxWorkspaceInfo,
  resolveSandboxContext,
} from "./context.js";
// Docker
export {
  buildSandboxCreateArgs,
  dockerContainerState,
  ensureDockerImage,
  ensureSandboxContainer,
  execDocker,
  execInContainer,
  removeSandboxContainer,
} from "./docker.js";
// Prune
export {
  ensureDockerContainerIsRunning,
  maybePruneSandboxes,
  pruneAllSandboxes,
} from "./prune.js";
// Registry
export type { SandboxRegistryEntry } from "./registry.js";
export {
  findRegistryEntry,
  listRegistryEntries,
  readRegistry,
  removeRegistryEntry,
  updateRegistry,
} from "./registry.js";
// Utilities
export {
  resolveSandboxScopeKey,
  resolveSandboxWorkspaceDir,
  slugifySessionKey,
} from "./shared.js";
// Tool Policy
export {
  filterToolsByPolicy,
  isToolAllowed,
  resolveSandboxToolPolicy,
} from "./tool-policy.js";
// Types
export type {
  SandboxConfig,
  SandboxContext,
  SandboxDockerConfig,
  SandboxPruneConfig,
  SandboxScope,
  SandboxToolPolicy,
  SandboxToolPolicyResolved,
  SandboxWorkspaceAccess,
  SandboxWorkspaceInfo,
} from "./types.js";
