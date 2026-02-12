/**
 * WOPR Security Module
 *
 * Three-layer security model for session isolation:
 * - Layer 1: Trust Levels (Who) - owner, trusted, semi-trusted, untrusted
 * - Layer 2: Capabilities (What) - granular permissions
 * - Layer 3: Sandbox (Where) - Docker isolation
 */

// Export context functions
export {
  clearContext,
  createApiContext,
  createCliContext,
  createCronContext,
  createDaemonContext,
  createP2PContext,
  createP2PDiscoveryContext,
  createPluginContext,
  createSecurityContext,
  getContext,
  SecurityContext,
  storeContext,
  withSecurityContext,
} from "./context.js";
// Export forward functions
export {
  approveAndExecute,
  executeForward,
  type ForwardResult,
  forwardRequest,
  gatewayToolDefinitions,
  handleGatewayForward,
  routeThroughGateway,
} from "./forward.js";
// Export gateway functions
export {
  approveRequest,
  canForwardTo,
  completeRequest,
  createForwardedContext,
  createForwardRequest,
  type ForwardRequest,
  findGatewayForSource,
  type GatewayForwardRules,
  getForwardRules,
  getPendingRequests,
  isGateway,
  queueForApproval,
  rejectRequest,
  requiresGateway,
  validateForwardRequest,
} from "./gateway.js";
// Export hooks
export {
  addSourceMetadata,
  auditLogHook,
  createHookContext,
  type HookContext,
  type PostInjectResult,
  type PreInjectResult,
  parseHookCommand,
  processInjection,
  runPostInjectHooks,
  runPreInjectHooks,
} from "./hooks.js";
// Export policy functions
export {
  canGatewayForward,
  canSessionForward,
  checkCapability,
  checkSandboxRequired,
  checkSessionAccess,
  checkToolAccess,
  filterToolsByPolicy,
  getGatewayRules,
  getSecurityConfig,
  initSecurity,
  isEnforcementEnabled,
  // Legacy (deprecated)
  isGatewaySession,
  type PolicyCheckResult,
  type ResolvedPolicy,
  resolvePolicy,
  saveSecurityConfig,
  // New session access helpers
  sessionAllowsUntrusted,
  shouldLogSecurityEvent,
} from "./policy.js";
// Export sandbox functions
export {
  buildSandboxImage,
  cleanupAllSandboxes,
  createSandbox,
  destroySandbox,
  execInSandbox,
  // New security-aware sandbox functions
  getSandboxForSession,
  getSandboxStatus,
  isDockerAvailable,
  isSandboxImageAvailable,
  isSessionSandboxed,
  listSandboxes,
  type SandboxContext,
} from "./sandbox.js";
// Export all types
export {
  // Session config (new)
  type AccessPattern,
  CAPABILITY_PROFILES,
  // Capabilities
  type Capability,
  canIndexSession,
  compareTrustLevel,
  createInjectionSource,
  // Session indexable (transcript visibility in memory search)
  DEFAULT_INDEXABLE_BY_TRUST,
  DEFAULT_SANDBOX_BY_TRUST,
  DEFAULT_SECURITY_CONFIG,
  DEFAULT_TRUST_BY_SOURCE,
  expandCapabilities,
  getSessionAccess,
  getSessionConfig,
  getSessionIndexable,
  getToolCapability,
  type HookConfig,
  hasCapability,
  type InjectionSource,
  // Injection source
  type InjectionSourceType,
  matchesAccessPattern,
  matchesAnyAccessPattern,
  meetsTrustLevel,
  type SandboxConfig,
  // Sandbox
  type SandboxNetworkMode,
  type SecurityConfig,
  type SecurityEvent,
  // Events
  type SecurityEventType,
  type SecurityPolicy,
  type SessionConfig,
  // Tool mapping
  TOOL_CAPABILITY_MAP,
  // Policy
  type ToolPolicy,
  TRUST_LEVEL_ORDER,
  // Trust levels
  type TrustLevel,
} from "./types.js";
