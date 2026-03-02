import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RUNTIME_INTERVAL_MS, startRuntimeScheduler } from "./runtime-scheduler.js";

// Minimal ICreditLedger stub — only the methods runRuntimeDeductions calls.
function makeLedger() {
  return {
    tenantsWithBalance: vi.fn().mockResolvedValue([]),
    hasReferenceId: vi.fn().mockResolvedValue(false),
    debit: vi.fn().mockResolvedValue(undefined),
    balance: vi.fn().mockResolvedValue({ lessThan: () => false, isZero: () => true }),
  };
}

// Minimal IBotInstanceRepository stub.
function makeBotInstanceRepo() {
  return {
    listByTenant: vi.fn().mockResolvedValue([]),
  };
}

// Minimal ITenantAddonRepository stub.
function makeTenantAddonRepo() {
  return {
    listByTenant: vi.fn().mockResolvedValue([]),
  };
}

describe("startRuntimeScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls runRuntimeDeductions with today's date after interval fires", async () => {
    const ledger = makeLedger();
    const botInstanceRepo = makeBotInstanceRepo();
    const tenantAddonRepo = makeTenantAddonRepo();

    const scheduler = startRuntimeScheduler({
      ledger: ledger as never,
      botInstanceRepo: botInstanceRepo as never,
      tenantAddonRepo: tenantAddonRepo as never,
    });

    // Before interval fires, no deduction attempted.
    expect(ledger.tenantsWithBalance).not.toHaveBeenCalled();

    // Advance past the 24h interval.
    await vi.advanceTimersByTimeAsync(RUNTIME_INTERVAL_MS);

    // tenantsWithBalance is the first call inside runRuntimeDeductions.
    expect(ledger.tenantsWithBalance).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it("uses date-only string (YYYY-MM-DD) as the date argument", async () => {
    const ledger = makeLedger();
    // Return one tenant so we can observe the referenceId check.
    ledger.tenantsWithBalance.mockResolvedValue([{ tenantId: "t1", balance: { lessThan: () => false } }]);
    ledger.hasReferenceId.mockResolvedValue(false);

    const botInstanceRepo = makeBotInstanceRepo();
    const tenantAddonRepo = makeTenantAddonRepo();

    const scheduler = startRuntimeScheduler({
      ledger: ledger as never,
      botInstanceRepo: botInstanceRepo as never,
      tenantAddonRepo: tenantAddonRepo as never,
    });

    await vi.advanceTimersByTimeAsync(RUNTIME_INTERVAL_MS);

    // referenceId should be runtime:<YYYY-MM-DD>:t1 — date-only, no time component.
    const [refId] = ledger.hasReferenceId.mock.calls[0];
    expect(refId).toMatch(/^runtime:\d{4}-\d{2}-\d{2}:t1$/);

    scheduler.stop();
  });

  it("stop() prevents further invocations", async () => {
    const ledger = makeLedger();
    const scheduler = startRuntimeScheduler({
      ledger: ledger as never,
      botInstanceRepo: makeBotInstanceRepo() as never,
      tenantAddonRepo: makeTenantAddonRepo() as never,
    });

    await vi.advanceTimersByTimeAsync(RUNTIME_INTERVAL_MS);
    expect(ledger.tenantsWithBalance).toHaveBeenCalledTimes(1);

    scheduler.stop();

    // Advance another full day — should not fire again.
    await vi.advanceTimersByTimeAsync(RUNTIME_INTERVAL_MS * 2);
    expect(ledger.tenantsWithBalance).toHaveBeenCalledTimes(1);
  });

  it("calls onSuspend when provided and a tenant is suspended", async () => {
    const ledger = makeLedger();
    ledger.tenantsWithBalance.mockResolvedValue([
      { tenantId: "t1", balance: { lessThan: () => true, greaterThan: () => false, isZero: () => true } },
    ]);
    ledger.hasReferenceId.mockResolvedValue(false);

    // Simulate active bot so cost is non-zero.
    const botInstanceRepo = makeBotInstanceRepo();
    botInstanceRepo.listByTenant.mockResolvedValue([{ id: "b1", billingState: "active" }]);

    const onSuspend = vi.fn();

    const scheduler = startRuntimeScheduler({
      ledger: ledger as never,
      botInstanceRepo: botInstanceRepo as never,
      tenantAddonRepo: makeTenantAddonRepo() as never,
      onSuspend,
    });

    await vi.advanceTimersByTimeAsync(RUNTIME_INTERVAL_MS);
    // onSuspend is invoked inside runRuntimeDeductions when balance is insufficient.
    expect(onSuspend).toHaveBeenCalledWith("t1");

    scheduler.stop();
  });

  it("interval is 24 hours", () => {
    expect(RUNTIME_INTERVAL_MS).toBe(24 * 60 * 60 * 1_000);
  });
});
