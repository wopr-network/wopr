import { describe, expect, it } from "vitest";
import { securityConfigSchema, securityPluginRuleSchema } from "../../../src/security/schema.js";

describe("securityConfigSchema", () => {
  it("should accept a valid config row", () => {
    const valid = { id: "global", config: '{"enforcement":"enforce"}', updatedAt: Date.now() };
    expect(securityConfigSchema.parse(valid)).toEqual(valid);
  });

  it("should reject missing id", () => {
    expect(() => securityConfigSchema.parse({ config: "{}", updatedAt: 1 })).toThrow();
  });

  it("should reject missing config", () => {
    expect(() => securityConfigSchema.parse({ id: "global", updatedAt: 1 })).toThrow();
  });

  it("should reject missing updatedAt", () => {
    expect(() => securityConfigSchema.parse({ id: "global", config: "{}" })).toThrow();
  });

  it("should reject non-string config", () => {
    expect(() => securityConfigSchema.parse({ id: "global", config: 123, updatedAt: 1 })).toThrow();
  });

  it("should reject non-number updatedAt", () => {
    expect(() => securityConfigSchema.parse({ id: "global", config: "{}", updatedAt: "not-a-number" })).toThrow();
  });
});

describe("securityPluginRuleSchema", () => {
  const validRule = {
    id: "abc-123",
    pluginName: "my-plugin",
    ruleType: "trust-override" as const,
    ruleData: "{}",
    createdAt: Date.now(),
  };

  it("should accept a valid rule row", () => {
    expect(securityPluginRuleSchema.parse(validRule)).toEqual(validRule);
  });

  it("should accept optional targetSession and targetTrust", () => {
    const withOptionals = { ...validRule, targetSession: "main", targetTrust: "trusted" };
    expect(securityPluginRuleSchema.parse(withOptionals)).toEqual(withOptionals);
  });

  it("should accept all valid ruleType values", () => {
    for (const rt of ["trust-override", "session-access", "capability-grant", "tool-policy"]) {
      expect(securityPluginRuleSchema.parse({ ...validRule, ruleType: rt })).toBeTruthy();
    }
  });

  it("should reject invalid ruleType", () => {
    expect(() => securityPluginRuleSchema.parse({ ...validRule, ruleType: "invalid" })).toThrow();
  });

  it("should reject missing pluginName", () => {
    const { pluginName: _p, ...rest } = validRule;
    expect(() => securityPluginRuleSchema.parse(rest)).toThrow();
  });

  it("should reject missing ruleData", () => {
    const { ruleData: _r, ...rest } = validRule;
    expect(() => securityPluginRuleSchema.parse(rest)).toThrow();
  });
});
