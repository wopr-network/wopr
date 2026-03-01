import { describe, expect, it } from "vitest";
import { buildUpstreamHeaders, extractTenantSubdomain } from "../../../src/api/routes/tenant-proxy.js";

describe("extractTenantSubdomain", () => {
  it("returns the subdomain for a valid tenant host", () => {
    expect(extractTenantSubdomain("alice.wopr.bot")).toBe("alice");
  });

  it("returns null for the root domain", () => {
    expect(extractTenantSubdomain("wopr.bot")).toBeNull();
  });

  it("returns null for the reserved app subdomain", () => {
    expect(extractTenantSubdomain("app.wopr.bot")).toBeNull();
  });

  it("returns null for the reserved api subdomain", () => {
    expect(extractTenantSubdomain("api.wopr.bot")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(extractTenantSubdomain("ALICE.WOPR.BOT")).toBe("alice");
  });

  it("strips port before extracting subdomain", () => {
    expect(extractTenantSubdomain("alice.wopr.bot:443")).toBe("alice");
  });

  it("returns null for a different domain", () => {
    expect(extractTenantSubdomain("evil.example.com")).toBeNull();
  });

  it("returns null for sub-sub-domains", () => {
    expect(extractTenantSubdomain("a.b.wopr.bot")).toBeNull();
  });

  it("returns null for an invalid DNS label starting with a hyphen", () => {
    expect(extractTenantSubdomain("-invalid.wopr.bot")).toBeNull();
  });

  it("returns null for the staging subdomain", () => {
    expect(extractTenantSubdomain("staging.wopr.bot")).toBeNull();
  });

  it("returns null for the www subdomain", () => {
    expect(extractTenantSubdomain("www.wopr.bot")).toBeNull();
  });

  it("handles hyphenated tenant names", () => {
    expect(extractTenantSubdomain("my-bot.wopr.bot")).toBe("my-bot");
  });
});

describe("buildUpstreamHeaders", () => {
  it("forwards allowed headers", () => {
    const incoming = new Headers({
      "content-type": "application/json",
      "accept": "text/html",
      "x-request-id": "abc-123",
    });
    const result = buildUpstreamHeaders(incoming, "user-1", "tenant-1");
    expect(result.get("content-type")).toBe("application/json");
    expect(result.get("accept")).toBe("text/html");
    expect(result.get("x-request-id")).toBe("abc-123");
  });

  it("strips cookie header", () => {
    const incoming = new Headers({
      "content-type": "application/json",
      "cookie": "better-auth.session_token=secret123",
    });
    const result = buildUpstreamHeaders(incoming, "user-1", "tenant-1");
    expect(result.has("cookie")).toBe(false);
  });

  it("strips authorization header", () => {
    const incoming = new Headers({
      "content-type": "application/json",
      "authorization": "Bearer sk-secret-key",
    });
    const result = buildUpstreamHeaders(incoming, "user-1", "tenant-1");
    expect(result.has("authorization")).toBe(false);
  });

  it("strips host header", () => {
    const incoming = new Headers({
      "host": "alice.wopr.bot",
      "content-type": "text/plain",
    });
    const result = buildUpstreamHeaders(incoming, "user-1", "tenant-1");
    expect(result.has("host")).toBe(false);
  });

  it("injects x-wopr-user-id and x-wopr-tenant-id", () => {
    const incoming = new Headers({ "content-type": "application/json" });
    const result = buildUpstreamHeaders(incoming, "user-42", "tenant-7");
    expect(result.get("x-wopr-user-id")).toBe("user-42");
    expect(result.get("x-wopr-tenant-id")).toBe("tenant-7");
  });

  it("does not forward unknown headers", () => {
    const incoming = new Headers({
      "content-type": "application/json",
      "x-custom-secret": "should-be-stripped",
      "x-forwarded-for": "1.2.3.4",
    });
    const result = buildUpstreamHeaders(incoming, "user-1", "tenant-1");
    expect(result.has("x-custom-secret")).toBe(false);
    expect(result.has("x-forwarded-for")).toBe(false);
  });
});
