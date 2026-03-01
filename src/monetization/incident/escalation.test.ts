import { afterEach, describe, expect, it } from "vitest";
import { getEscalationMatrix } from "./escalation.js";

describe("getEscalationMatrix", () => {
  const saved: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    "ESCALATION_PAGERDUTY_SERVICE",
    "ESCALATION_SLACK_CHANNEL",
    "ESCALATION_CTO_PHONE",
    "ESCALATION_CTO_EMAIL",
  ] as const;

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
    // Clear saved state for next test
    for (const key of ENV_KEYS) {
      delete saved[key];
    }
  });

  it("uses default targets when env vars are unset", () => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    const sev1 = getEscalationMatrix("SEV1");
    expect(sev1[0].target).toBe("on-call-eng");
    expect(sev1[1].target).toBe("#billing-incidents");
    expect(sev1[3].target).toBe("cto-oncall");

    const sev2 = getEscalationMatrix("SEV2");
    expect(sev2[2].target).toBe("cto@wopr.network");
  });

  it("overrides pagerduty target via ESCALATION_PAGERDUTY_SERVICE", () => {
    saved.ESCALATION_PAGERDUTY_SERVICE = process.env.ESCALATION_PAGERDUTY_SERVICE;
    process.env.ESCALATION_PAGERDUTY_SERVICE = "custom-pd";
    const sev1 = getEscalationMatrix("SEV1");
    expect(sev1[0].target).toBe("custom-pd");
  });

  it("overrides slack channel via ESCALATION_SLACK_CHANNEL", () => {
    saved.ESCALATION_SLACK_CHANNEL = process.env.ESCALATION_SLACK_CHANNEL;
    process.env.ESCALATION_SLACK_CHANNEL = "#ops-alerts";
    const sev1 = getEscalationMatrix("SEV1");
    expect(sev1[1].target).toBe("#ops-alerts");
    expect(sev1[2].target).toBe("#ops-alerts");

    const sev2 = getEscalationMatrix("SEV2");
    expect(sev2[0].target).toBe("#ops-alerts");

    const sev3 = getEscalationMatrix("SEV3");
    expect(sev3[0].target).toBe("#ops-alerts");
  });

  it("overrides CTO phone via ESCALATION_CTO_PHONE", () => {
    saved.ESCALATION_CTO_PHONE = process.env.ESCALATION_CTO_PHONE;
    process.env.ESCALATION_CTO_PHONE = "cto-custom-phone";
    const sev1 = getEscalationMatrix("SEV1");
    expect(sev1[3].target).toBe("cto-custom-phone");
  });

  it("overrides CTO email via ESCALATION_CTO_EMAIL", () => {
    saved.ESCALATION_CTO_EMAIL = process.env.ESCALATION_CTO_EMAIL;
    process.env.ESCALATION_CTO_EMAIL = "cto@custom.org";
    const sev2 = getEscalationMatrix("SEV2");
    expect(sev2[2].target).toBe("cto@custom.org");
  });

  it("returns correct structure for all severities", () => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    const sev1 = getEscalationMatrix("SEV1");
    expect(sev1).toHaveLength(4);
    expect(sev1[0].channel).toBe("pagerduty");

    const sev2 = getEscalationMatrix("SEV2");
    expect(sev2).toHaveLength(3);

    const sev3 = getEscalationMatrix("SEV3");
    expect(sev3).toHaveLength(2);
  });
});
