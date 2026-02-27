import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../src/security/context.js", () => ({
  createSecurityContext: vi.fn(),
  storeContext: vi.fn(),
  clearContext: vi.fn(),
}));

vi.mock("../../../src/security/gateway.js", () => ({
  isGateway: vi.fn(),
  createForwardRequest: vi.fn(),
  validateForwardRequest: vi.fn(),
  getForwardRules: vi.fn(),
  queueForApproval: vi.fn(),
  createForwardedContext: vi.fn(),
  completeRequest: vi.fn(),
  approveRequest: vi.fn(),
  requiresGateway: vi.fn(),
  findGatewayForSource: vi.fn(),
}));

let forward: typeof import("../../../src/security/forward.js");
let gw: typeof import("../../../src/security/gateway.js");
let ctx: typeof import("../../../src/security/context.js");

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  forward = await import("../../../src/security/forward.js");
  gw = await import("../../../src/security/gateway.js");
  ctx = await import("../../../src/security/context.js");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("forwardRequest", () => {
  it("should fail when session is not a gateway", async () => {
    vi.mocked(gw.isGateway).mockReturnValue(false);
    vi.mocked(ctx.createSecurityContext).mockReturnValue({} as any);
    vi.mocked(gw.createForwardRequest).mockReturnValue({ requestId: "fwd-1" } as any);
    vi.mocked(gw.validateForwardRequest).mockReturnValue({ valid: true });

    const result = await forward.forwardRequest("not-gw", "target", "hello", {
      type: "p2p",
      trustLevel: "untrusted",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("is not a gateway");
  });

  it("should fail when validation fails", async () => {
    vi.mocked(gw.isGateway).mockReturnValue(true);
    vi.mocked(ctx.createSecurityContext).mockReturnValue({} as any);
    vi.mocked(gw.createForwardRequest).mockReturnValue({ requestId: "fwd-1" } as any);
    vi.mocked(gw.validateForwardRequest).mockReturnValue({ valid: false, reason: "denied" });

    const result = await forward.forwardRequest("gw", "target", "hello", {
      type: "p2p",
      trustLevel: "untrusted",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("denied");
  });

  it("should queue for approval when rules require it", async () => {
    vi.mocked(gw.isGateway).mockReturnValue(true);
    vi.mocked(ctx.createSecurityContext).mockReturnValue({} as any);
    vi.mocked(gw.createForwardRequest).mockReturnValue({ requestId: "fwd-1" } as any);
    vi.mocked(gw.validateForwardRequest).mockReturnValue({ valid: true });
    vi.mocked(gw.getForwardRules).mockReturnValue({ allowForwardTo: ["target"], requireApproval: true } as any);

    const result = await forward.forwardRequest("gw", "target", "hello", {
      type: "p2p",
      trustLevel: "untrusted",
    });

    expect(result.requiresApproval).toBe(true);
    expect(gw.queueForApproval).toHaveBeenCalled();
  });

  it("should skip approval when skipApproval option is set", async () => {
    vi.mocked(gw.isGateway).mockReturnValue(true);
    vi.mocked(ctx.createSecurityContext).mockReturnValue({} as any);
    const mockReq = { requestId: "fwd-1", sourceSession: "gw", targetSession: "target", message: "hello" };
    vi.mocked(gw.createForwardRequest).mockReturnValue(mockReq as any);
    vi.mocked(gw.validateForwardRequest).mockReturnValue({ valid: true });
    vi.mocked(gw.getForwardRules).mockReturnValue({ allowForwardTo: ["target"], requireApproval: true } as any);
    vi.mocked(gw.createForwardedContext).mockReturnValue({ source: {}, session: "target" } as any);
    vi.mocked(gw.completeRequest).mockReturnValue(null);

    const injectFn = vi.fn().mockResolvedValue({ response: "ok" });

    const result = await forward.forwardRequest(
      "gw",
      "target",
      "hello",
      { type: "p2p", trustLevel: "untrusted" },
      { skipApproval: true, injectFn },
    );

    expect(gw.queueForApproval).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});

describe("executeForward", () => {
  it("should fail when no injectFn provided", async () => {
    vi.mocked(gw.createForwardedContext).mockReturnValue({ source: {}, session: "target" } as any);

    const result = await forward.executeForward({ requestId: "fwd-1" } as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain("No inject function");
  });

  it("should execute injection and complete request", async () => {
    vi.mocked(gw.createForwardedContext).mockReturnValue({ source: { type: "gateway" }, session: "target" } as any);
    vi.mocked(gw.completeRequest).mockReturnValue(null);

    const injectFn = vi.fn().mockResolvedValue({ response: "result" });
    const result = await forward.executeForward(
      { requestId: "fwd-1", sourceSession: "gw", targetSession: "target" } as any,
      injectFn,
    );

    expect(result.success).toBe(true);
    expect(result.response).toBe("result");
    expect(ctx.storeContext).toHaveBeenCalled();
    expect(ctx.clearContext).toHaveBeenCalledWith("target");
    expect(gw.completeRequest).toHaveBeenCalledWith("fwd-1", "result");
  });

  it("should handle injection errors gracefully", async () => {
    vi.mocked(gw.createForwardedContext).mockReturnValue({ source: {}, session: "target" } as any);

    const injectFn = vi.fn().mockRejectedValue(new Error("injection failed"));
    const result = await forward.executeForward(
      { requestId: "fwd-1", sourceSession: "gw", targetSession: "target" } as any,
      injectFn,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Forward execution failed");
  });

  it("should clear context even on error", async () => {
    vi.mocked(gw.createForwardedContext).mockReturnValue({ source: {}, session: "target" } as any);

    const injectFn = vi.fn().mockRejectedValue(new Error("boom"));
    await forward.executeForward(
      { requestId: "fwd-1", sourceSession: "gw", targetSession: "target" } as any,
      injectFn,
    );

    expect(ctx.clearContext).toHaveBeenCalledWith("target");
  });
});

describe("approveAndExecute", () => {
  it("should fail when request not found", async () => {
    vi.mocked(gw.approveRequest).mockReturnValue(null);

    const result = await forward.approveAndExecute("nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found or not pending");
  });

  it("should approve and execute", async () => {
    const req = { requestId: "fwd-1", sourceSession: "gw", targetSession: "target" } as any;
    vi.mocked(gw.approveRequest).mockReturnValue(req);
    vi.mocked(gw.createForwardedContext).mockReturnValue({ source: {}, session: "target" } as any);
    vi.mocked(gw.completeRequest).mockReturnValue(null);

    const injectFn = vi.fn().mockResolvedValue({ response: "ok" });
    const result = await forward.approveAndExecute("fwd-1", injectFn);

    expect(result.success).toBe(true);
    expect(result.response).toBe("ok");
  });
});

describe("routeThroughGateway", () => {
  it("should return null when gateway not required", async () => {
    vi.mocked(gw.requiresGateway).mockReturnValue(false);

    const result = await forward.routeThroughGateway({ type: "cli", trustLevel: "owner" }, "target", "hello");

    expect(result).toBeNull();
  });

  it("should fail when no gateway available", async () => {
    vi.mocked(gw.requiresGateway).mockReturnValue(true);
    vi.mocked(gw.findGatewayForSource).mockReturnValue(null);

    const result = await forward.routeThroughGateway(
      { type: "p2p", trustLevel: "untrusted" },
      "target",
      "hello",
    );

    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.error).toContain("No gateway available");
  });

  it("should forward through found gateway", async () => {
    vi.mocked(gw.requiresGateway).mockReturnValue(true);
    vi.mocked(gw.findGatewayForSource).mockReturnValue("gw1");
    vi.mocked(gw.isGateway).mockReturnValue(true);
    vi.mocked(ctx.createSecurityContext).mockReturnValue({} as any);
    vi.mocked(gw.createForwardRequest).mockReturnValue({ requestId: "fwd-1" } as any);
    vi.mocked(gw.validateForwardRequest).mockReturnValue({ valid: true });
    vi.mocked(gw.getForwardRules).mockReturnValue({ allowForwardTo: ["target"] } as any);
    vi.mocked(gw.createForwardedContext).mockReturnValue({ source: {}, session: "target" } as any);
    vi.mocked(gw.completeRequest).mockReturnValue(null);

    const injectFn = vi.fn().mockResolvedValue({ response: "routed" });
    const result = await forward.routeThroughGateway(
      { type: "p2p", trustLevel: "untrusted" },
      "target",
      "hello",
      injectFn,
    );

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
  });
});

describe("handleGatewayForward", () => {
  it("should fail on context mismatch", async () => {
    const mockCtx = { session: "wrong-session" } as any;
    const result = await forward.handleGatewayForward("gw", "target", "hello", mockCtx);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Context mismatch");
  });

  it("should forward when context matches", async () => {
    const mockCtx = { session: "gw", trustLevel: "semi-trusted" } as any;
    vi.mocked(gw.isGateway).mockReturnValue(true);
    vi.mocked(ctx.createSecurityContext).mockReturnValue({} as any);
    vi.mocked(gw.createForwardRequest).mockReturnValue({ requestId: "fwd-1" } as any);
    vi.mocked(gw.validateForwardRequest).mockReturnValue({ valid: true });
    vi.mocked(gw.getForwardRules).mockReturnValue({ allowForwardTo: ["target"] } as any);
    vi.mocked(gw.createForwardedContext).mockReturnValue({ source: {}, session: "target" } as any);
    vi.mocked(gw.completeRequest).mockReturnValue(null);

    const injectFn = vi.fn().mockResolvedValue({ response: "ok" });
    const result = await forward.handleGatewayForward("gw", "target", "hello", mockCtx, injectFn);
    expect(result.success).toBe(true);
  });
});

describe("gatewayToolDefinitions", () => {
  it("should export tool definitions", () => {
    expect(forward.gatewayToolDefinitions).toBeDefined();
    expect(forward.gatewayToolDefinitions.gateway_forward).toBeDefined();
    expect(forward.gatewayToolDefinitions.gateway_queue).toBeDefined();
    expect(forward.gatewayToolDefinitions.gateway_approve).toBeDefined();
    expect(forward.gatewayToolDefinitions.gateway_reject).toBeDefined();
  });
});
