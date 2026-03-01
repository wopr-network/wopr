import { describe, expect, it } from "vitest";
import { assertSafeRedirectUrl } from "./redirect-allowlist.js";

describe("assertSafeRedirectUrl", () => {
  it("allows https://app.wopr.bot paths", () => {
    expect(() => assertSafeRedirectUrl("https://app.wopr.bot/billing/success")).not.toThrow();
  });

  it("allows https://app.wopr.bot with query params", () => {
    expect(() => assertSafeRedirectUrl("https://app.wopr.bot/dashboard?vps=activated")).not.toThrow();
  });

  it("allows https://wopr.network paths", () => {
    expect(() => assertSafeRedirectUrl("https://wopr.network/welcome")).not.toThrow();
  });

  it("allows http://localhost:3000 in dev", () => {
    expect(() => assertSafeRedirectUrl("http://localhost:3000/billing")).not.toThrow();
  });

  it("allows http://localhost:3001 in dev", () => {
    expect(() => assertSafeRedirectUrl("http://localhost:3001/billing")).not.toThrow();
  });

  it("rejects external domains", () => {
    expect(() => assertSafeRedirectUrl("https://evil.com/phishing")).toThrow("Invalid redirect URL");
  });

  it("rejects subdomain spoofing (app.wopr.bot.evil.com)", () => {
    expect(() => assertSafeRedirectUrl("https://app.wopr.bot.evil.com/phishing")).toThrow("Invalid redirect URL");
  });

  it("rejects non-URL strings", () => {
    expect(() => assertSafeRedirectUrl("not-a-url")).toThrow("Invalid redirect URL");
  });

  it("rejects javascript: URIs", () => {
    expect(() => assertSafeRedirectUrl("javascript:alert(1)")).toThrow("Invalid redirect URL");
  });

  it("rejects data: URIs", () => {
    expect(() => assertSafeRedirectUrl("data:text/html,<h1>pwned</h1>")).toThrow("Invalid redirect URL");
  });

  it("rejects empty string", () => {
    expect(() => assertSafeRedirectUrl("")).toThrow("Invalid redirect URL");
  });
});
