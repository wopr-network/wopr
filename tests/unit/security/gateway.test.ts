import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../src/security/policy.js", () => ({
  isGatewaySession: vi.fn(),
  canGatewayForward: vi.fn(),
  getGatewayRules: vi.fn(),
  getSecurityConfig: vi.fn(),
}));

vi.mock("../../../src/security/context.js", () => ({
  createSecurityContext: vi.fn(),
}));

let gateway: typeof import("../../../src/security/gateway.js");
let policy: typeof import("../../../src/security/policy.js");
let context: typeof import("../../../src/security/context.js");

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  gateway = await import("../../../src/security/gateway.js");
  policy = await import("../../../src/security/policy.js");
  context = await import("../../../src/security/context.js");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("isGateway", () => {
  it("should delegate to isGatewaySession from policy", () => {
    vi.mocked(policy.isGatewaySession).mockReturnValue(true);
    expect(gateway.isGateway("gw-session")).toBe(true);
    expect(policy.isGatewaySession).toHaveBeenCalledWith("gw-session");
  });

  it("should return false when policy says no", () => {
    vi.mocked(policy.isGatewaySession).mockReturnValue(false);
    expect(gateway.isGateway("not-a-gateway")).toBe(false);
  });
});

describe("getForwardRules", () => {
  it("should return rules from policy", () => {
    const rules = { allowForwardTo: ["main"], allowActions: ["chat"] };
    vi.mocked(policy.getGatewayRules).mockReturnValue(rules as any);
    expect(gateway.getForwardRules("gw")).toEqual(rules);
  });

  it("should return null when no rules", () => {
    vi.mocked(policy.getGatewayRules).mockReturnValue(undefined);
    expect(gateway.getForwardRules("gw")).toBeNull();
  });
});

describe("canForwardTo", () => {
  it("should return true when policy allows", () => {
    vi.mocked(policy.canGatewayForward).mockReturnValue({ allowed: true } as any);
    expect(gateway.canForwardTo("gw", "target")).toBe(true);
  });

  it("should return false when policy denies", () => {
    vi.mocked(policy.canGatewayForward).mockReturnValue({ allowed: false, reason: "denied" } as any);
    expect(gateway.canForwardTo("gw", "target")).toBe(false);
  });
});

describe("createForwardRequest", () => {
  it("should create a pending request with correct fields", () => {
    const source = { type: "p2p" as const, trustLevel: "untrusted" as const };
    const req = gateway.createForwardRequest("gw", "target", "hello", source, "chat");

    expect(req.requestId).toMatch(/^fwd-/);
    expect(req.sourceSession).toBe("gw");
    expect(req.targetSession).toBe("target");
    expect(req.message).toBe("hello");
    expect(req.originalSource).toBe(source);
    expect(req.actionType).toBe("chat");
    expect(req.status).toBe("pending");
    expect(req.timestamp).toBeTypeOf("number");
  });
});

describe("validateForwardRequest", () => {
  it("should reject when context cannot forward", () => {
    const mockCtx = { canForward: () => false } as any;
    const req = gateway.createForwardRequest("gw", "target", "hi", {
      type: "p2p" as const,
      trustLevel: "untrusted" as const,
    });
    const result = gateway.validateForwardRequest(req, mockCtx);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not authorized to forward");
  });

  it("should reject when target is not allowed", () => {
    const mockCtx = { canForward: () => true } as any;
    vi.mocked(policy.canGatewayForward).mockReturnValue({ allowed: false, reason: "nope" } as any);
    const req = gateway.createForwardRequest("gw", "target", "hi", {
      type: "p2p" as const,
      trustLevel: "untrusted" as const,
    });
    const result = gateway.validateForwardRequest(req, mockCtx);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Cannot forward to session");
  });

  it("should reject when no forward rules", () => {
    const mockCtx = { canForward: () => true } as any;
    vi.mocked(policy.canGatewayForward).mockReturnValue({ allowed: true } as any);
    vi.mocked(policy.getGatewayRules).mockReturnValue(undefined);
    const req = gateway.createForwardRequest("gw", "target", "hi", {
      type: "p2p" as const,
      trustLevel: "untrusted" as const,
    });
    const result = gateway.validateForwardRequest(req, mockCtx);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("No forward rules");
  });

  it("should reject disallowed action type", () => {
    const mockCtx = { canForward: () => true } as any;
    vi.mocked(policy.canGatewayForward).mockReturnValue({ allowed: true } as any);
    vi.mocked(policy.getGatewayRules).mockReturnValue({ allowForwardTo: ["target"], allowActions: ["chat"] } as any);
    const req = gateway.createForwardRequest(
      "gw",
      "target",
      "hi",
      { type: "p2p" as const, trustLevel: "untrusted" as const },
      "exec",
    );
    const result = gateway.validateForwardRequest(req, mockCtx);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Action type not allowed");
  });

  it("should pass valid request", () => {
    const mockCtx = { canForward: () => true } as any;
    vi.mocked(policy.canGatewayForward).mockReturnValue({ allowed: true } as any);
    vi.mocked(policy.getGatewayRules).mockReturnValue({ allowForwardTo: ["target"] } as any);
    const req = gateway.createForwardRequest("gw", "target", "hi", {
      type: "p2p" as const,
      trustLevel: "untrusted" as const,
    });
    const result = gateway.validateForwardRequest(req, mockCtx);
    expect(result.valid).toBe(true);
  });

  it("should enforce rate limit", () => {
    const mockCtx = { canForward: () => true } as any;
    vi.mocked(policy.canGatewayForward).mockReturnValue({ allowed: true } as any);
    vi.mocked(policy.getGatewayRules).mockReturnValue({
      allowForwardTo: ["target"],
      rateLimit: { perMinute: 2 },
    } as any);

    const source = { type: "p2p" as const, trustLevel: "untrusted" as const };

    // First two should pass
    const req1 = gateway.createForwardRequest("gw", "target", "hi", source);
    expect(gateway.validateForwardRequest(req1, mockCtx).valid).toBe(true);

    const req2 = gateway.createForwardRequest("gw", "target", "hi", source);
    expect(gateway.validateForwardRequest(req2, mockCtx).valid).toBe(true);

    // Third should hit rate limit
    const req3 = gateway.createForwardRequest("gw", "target", "hi", source);
    const result = gateway.validateForwardRequest(req3, mockCtx);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Rate limit exceeded");
  });

  it("should reset rate limit after window expires", () => {
    const mockCtx = { canForward: () => true } as any;
    vi.mocked(policy.canGatewayForward).mockReturnValue({ allowed: true } as any);
    vi.mocked(policy.getGatewayRules).mockReturnValue({
      allowForwardTo: ["target"],
      rateLimit: { perMinute: 1 },
    } as any);

    const source = { type: "p2p" as const, trustLevel: "untrusted" as const };

    // First passes
    const req1 = gateway.createForwardRequest("gw", "target", "hi", source);
    expect(gateway.validateForwardRequest(req1, mockCtx).valid).toBe(true);

    // Second blocked
    const req2 = gateway.createForwardRequest("gw", "target", "hi", source);
    expect(gateway.validateForwardRequest(req2, mockCtx).valid).toBe(false);

    // Advance past 60s window
    vi.advanceTimersByTime(61000);

    // Third passes (new window)
    const req3 = gateway.createForwardRequest("gw", "target", "hi", source);
    expect(gateway.validateForwardRequest(req3, mockCtx).valid).toBe(true);
  });
});

describe("queueForApproval / approveRequest / rejectRequest", () => {
  it("should queue and retrieve pending requests", () => {
    const req = gateway.createForwardRequest("gw", "target", "hi", {
      type: "p2p" as const,
      trustLevel: "untrusted" as const,
    });
    gateway.queueForApproval(req);

    const pending = gateway.getPendingRequests("gw");
    expect(pending).toHaveLength(1);
    expect(pending[0].requestId).toBe(req.requestId);
  });

  it("should approve a pending request", () => {
    const req = gateway.createForwardRequest("gw", "target", "hi", {
      type: "p2p" as const,
      trustLevel: "untrusted" as const,
    });
    gateway.queueForApproval(req);

    const approved = gateway.approveRequest(req.requestId);
    expect(approved).not.toBeNull();
    expect(approved!.status).toBe("approved");
  });

  it("should return null when approving non-existent request", () => {
    expect(gateway.approveRequest("nonexistent")).toBeNull();
  });

  it("should reject a pending request", () => {
    const req = gateway.createForwardRequest("gw", "target", "hi", {
      type: "p2p" as const,
      trustLevel: "untrusted" as const,
    });
    gateway.queueForApproval(req);

    const rejected = gateway.rejectRequest(req.requestId, "not allowed");
    expect(rejected).not.toBeNull();
    expect(rejected!.status).toBe("rejected");
    expect(rejected!.rejectionReason).toBe("not allowed");

    // Should be removed from pending
    expect(gateway.getPendingRequests()).toHaveLength(0);
  });

  it("should return null when rejecting non-existent request", () => {
    expect(gateway.rejectRequest("nonexistent", "reason")).toBeNull();
  });
});

describe("completeRequest", () => {
  it("should complete a queued request with response", () => {
    const req = gateway.createForwardRequest("gw", "target", "hi", {
      type: "p2p" as const,
      trustLevel: "untrusted" as const,
    });
    gateway.queueForApproval(req);

    const completed = gateway.completeRequest(req.requestId, "done");
    expect(completed).not.toBeNull();
    expect(completed!.status).toBe("completed");
    expect(completed!.response).toBe("done");
    expect(gateway.getPendingRequests()).toHaveLength(0);
  });

  it("should return null for non-existent request", () => {
    expect(gateway.completeRequest("nonexistent", "done")).toBeNull();
  });
});

describe("getPendingRequests", () => {
  it("should filter by gateway session", () => {
    const req1 = gateway.createForwardRequest("gw1", "target", "hi", {
      type: "p2p" as const,
      trustLevel: "untrusted" as const,
    });
    const req2 = gateway.createForwardRequest("gw2", "target", "hi", {
      type: "p2p" as const,
      trustLevel: "untrusted" as const,
    });
    gateway.queueForApproval(req1);
    gateway.queueForApproval(req2);

    expect(gateway.getPendingRequests("gw1")).toHaveLength(1);
    expect(gateway.getPendingRequests("gw2")).toHaveLength(1);
    expect(gateway.getPendingRequests()).toHaveLength(2);
  });
});

describe("createForwardedContext", () => {
  it("should create a gateway-sourced security context", () => {
    const mockCtx = { session: "target" } as any;
    vi.mocked(context.createSecurityContext).mockReturnValue(mockCtx);

    const req = gateway.createForwardRequest("gw", "target", "hi", {
      type: "p2p" as const,
      trustLevel: "untrusted" as const,
      identity: { publicKey: "pk123" },
    });

    const result = gateway.createForwardedContext(req);
    expect(context.createSecurityContext).toHaveBeenCalled();
    // First arg should be gateway-type source with semi-trusted
    const callArgs = vi.mocked(context.createSecurityContext).mock.calls[0];
    expect(callArgs[0].type).toBe("gateway");
    expect(callArgs[0].trustLevel).toBe("semi-trusted");
    expect(callArgs[1]).toBe("target");
    expect(result).toBe(mockCtx);
  });
});

describe("findGatewayForSource", () => {
  it("should find a gateway that can forward to target", () => {
    vi.mocked(policy.getSecurityConfig).mockReturnValue({
      gateways: { sessions: ["gw1", "gw2"] },
    } as any);
    vi.mocked(policy.canGatewayForward)
      .mockReturnValueOnce({ allowed: false, reason: "no" } as any)
      .mockReturnValueOnce({ allowed: true } as any);

    const source = { type: "p2p" as const, trustLevel: "untrusted" as const };
    expect(gateway.findGatewayForSource(source, "target")).toBe("gw2");
  });

  it("should return null when no gateway can forward", () => {
    vi.mocked(policy.getSecurityConfig).mockReturnValue({
      gateways: { sessions: ["gw1"] },
    } as any);
    vi.mocked(policy.canGatewayForward).mockReturnValue({ allowed: false, reason: "no" } as any);

    const source = { type: "p2p" as const, trustLevel: "untrusted" as const };
    expect(gateway.findGatewayForSource(source, "target")).toBeNull();
  });

  it("should return null when no gateways configured", () => {
    vi.mocked(policy.getSecurityConfig).mockReturnValue({} as any);
    const source = { type: "p2p" as const, trustLevel: "untrusted" as const };
    expect(gateway.findGatewayForSource(source, "target")).toBeNull();
  });
});

describe("requiresGateway", () => {
  it("should return false for owner trust", () => {
    expect(gateway.requiresGateway({ type: "cli", trustLevel: "owner" }, "target")).toBe(false);
  });

  it("should return false for trusted trust", () => {
    expect(gateway.requiresGateway({ type: "plugin", trustLevel: "trusted" }, "target")).toBe(false);
  });

  it("should return false for internal source type", () => {
    expect(gateway.requiresGateway({ type: "internal", trustLevel: "semi-trusted" }, "target")).toBe(false);
  });

  it("should return false for cli source type", () => {
    expect(gateway.requiresGateway({ type: "cli", trustLevel: "semi-trusted" }, "target")).toBe(false);
  });

  it("should return false for daemon source type", () => {
    expect(gateway.requiresGateway({ type: "daemon", trustLevel: "semi-trusted" }, "target")).toBe(false);
  });

  it("should return false when target is a gateway session", () => {
    vi.mocked(policy.isGatewaySession).mockReturnValue(true);
    expect(gateway.requiresGateway({ type: "p2p", trustLevel: "untrusted" }, "gw-session")).toBe(false);
  });

  it("should return true for untrusted p2p targeting non-gateway", () => {
    vi.mocked(policy.isGatewaySession).mockReturnValue(false);
    expect(gateway.requiresGateway({ type: "p2p", trustLevel: "untrusted" }, "privileged")).toBe(true);
  });

  it("should return true for semi-trusted api targeting non-gateway", () => {
    vi.mocked(policy.isGatewaySession).mockReturnValue(false);
    expect(gateway.requiresGateway({ type: "api", trustLevel: "semi-trusted" }, "privileged")).toBe(true);
  });
});

describe("cleanupExpiredRequests", () => {
  it("should remove expired pending requests", () => {
    const req = gateway.createForwardRequest("gw", "target", "hi", {
      type: "p2p" as const,
      trustLevel: "untrusted" as const,
    });
    gateway.queueForApproval(req);
    expect(gateway.getPendingRequests()).toHaveLength(1);

    // Advance past 5 minute expiry
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    gateway.cleanupExpiredRequests();

    expect(gateway.getPendingRequests()).toHaveLength(0);
  });
});
