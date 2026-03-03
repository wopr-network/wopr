import { describe, expect, it } from "vitest";
import { selectProvider, type RoutingStrategy, type RoutableProvider } from "../../src/daemon/routes/openai-routing.js";

describe("selectProvider", () => {
  const providers: RoutableProvider[] = [
    { id: "anthropic", name: "Anthropic", available: true, supportedModels: ["claude-sonnet-4-5-20250929"] },
    { id: "openai", name: "OpenAI", available: true, supportedModels: ["gpt-4o", "gpt-4o-mini"] },
    { id: "kilo", name: "Kilo", available: false, supportedModels: ["kilo-1"] },
  ];

  it("first: returns first available provider", () => {
    const result = selectProvider(providers, "gpt-4o", "first", {});
    expect(result?.id).toBe("anthropic");
  });

  it("capable: returns provider that supports the requested model", () => {
    const result = selectProvider(providers, "gpt-4o", "capable", {});
    expect(result?.id).toBe("openai");
  });

  it("capable: falls back to first if no model match", () => {
    const result = selectProvider(providers, "nonexistent-model", "capable", {});
    expect(result?.id).toBe("anthropic");
  });

  it("cheapest: returns provider with lowest costPerToken", () => {
    const costs = { anthropic: { costPerToken: 0.01 }, openai: { costPerToken: 0.005 } };
    const result = selectProvider(providers, "gpt-4o", "cheapest", costs);
    expect(result?.id).toBe("openai");
  });

  it("cheapest: providers without cost data sort last", () => {
    const costs = { openai: { costPerToken: 0.005 } };
    const result = selectProvider(providers, "gpt-4o", "cheapest", costs);
    expect(result?.id).toBe("openai");
  });

  it("preferred: returns provider marked preferred", () => {
    const providerConfigs = { openai: { preferred: true } };
    const result = selectProvider(providers, "gpt-4o", "preferred", providerConfigs);
    expect(result?.id).toBe("openai");
  });

  it("preferred: falls back to first if none marked", () => {
    const result = selectProvider(providers, "gpt-4o", "preferred", {});
    expect(result?.id).toBe("anthropic");
  });

  it("returns null when no providers available", () => {
    const result = selectProvider([], "gpt-4o", "first", {});
    expect(result).toBeNull();
  });

  it("skips unavailable providers", () => {
    const onlyUnavailable: RoutableProvider[] = [
      { id: "kilo", name: "Kilo", available: false, supportedModels: ["kilo-1"] },
    ];
    const result = selectProvider(onlyUnavailable, "kilo-1", "first", {});
    expect(result).toBeNull();
  });
});
