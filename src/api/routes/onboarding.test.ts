import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AuthEnv, AuthUser } from "../../auth/index.js";
import type { OnboardingSession } from "../../onboarding/drizzle-onboarding-session-repository.js";
import type { OnboardingService } from "../../onboarding/onboarding-service.js";
import { onboardingRoutes, setOnboardingDeps } from "./onboarding.js";

function fakeSession(overrides: Partial<OnboardingSession> = {}): OnboardingSession {
  return {
    id: "sess-1",
    userId: "user-owner",
    anonymousId: null,
    woprSessionName: "onboarding-sess-1",
    status: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    graduatedAt: null,
    graduationPath: null,
    totalPlatformCostUsd: null,
    ...overrides,
  };
}

function buildApp(session: OnboardingSession | null, userId?: string, _anonymousId?: string) {
  const mockService = {
    getSession: vi.fn().mockResolvedValue(session),
    getHistory: vi.fn().mockResolvedValue([{ role: "assistant", content: "hello" }]),
    createSession: vi.fn(),
    inject: vi.fn(),
    upgradeAnonymousToUser: vi.fn(),
    handoff: vi.fn(),
  };
  const mockRepo = {
    getById: vi.fn(),
    getByUserId: vi.fn(),
    getByAnonymousId: vi.fn(),
    getActiveByAnonymousId: vi.fn(),
    create: vi.fn(),
    upgradeAnonymousToUser: vi.fn(),
    setStatus: vi.fn(),
    graduate: vi.fn(),
    getGraduatedByUserId: vi.fn(),
  };
  setOnboardingDeps(mockService as unknown as OnboardingService, mockRepo);

  const app = new Hono<AuthEnv>();
  // Inject fake auth context
  app.use("*", async (c, next) => {
    if (userId) {
      c.set("user", { id: userId, roles: [] } satisfies AuthUser);
    }
    await next();
  });
  app.route("/api/onboarding", onboardingRoutes);
  return { app, mockService };
}

describe("GET /api/onboarding/session/:id/history", () => {
  it("returns history when authenticated user owns the session", async () => {
    const session = fakeSession({ userId: "user-owner" });
    const { app } = buildApp(session, "user-owner");
    const res = await app.request("/api/onboarding/session/sess-1/history");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.history).toBeDefined();
  });

  it("returns 404 when authenticated user does NOT own the session", async () => {
    const session = fakeSession({ userId: "user-owner" });
    const { app } = buildApp(session, "user-attacker");
    const res = await app.request("/api/onboarding/session/sess-1/history");
    expect(res.status).toBe(404);
  });

  it("returns history when anonymous user owns the session via x-anonymous-id", async () => {
    const session = fakeSession({ userId: null, anonymousId: "anon-123" });
    const { app } = buildApp(session, undefined, "anon-123");
    const res = await app.request("/api/onboarding/session/sess-1/history", {
      headers: { "x-anonymous-id": "anon-123" },
    });
    expect(res.status).toBe(200);
  });

  it("returns 404 when anonymous user does NOT own the session", async () => {
    const session = fakeSession({ userId: null, anonymousId: "anon-123" });
    const { app } = buildApp(session, undefined, "anon-other");
    const res = await app.request("/api/onboarding/session/sess-1/history", {
      headers: { "x-anonymous-id": "anon-other" },
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when session does not exist", async () => {
    const { app } = buildApp(null, "user-owner");
    const res = await app.request("/api/onboarding/session/nonexistent/history");
    expect(res.status).toBe(404);
  });

  it("returns 404 when no auth and no anonymous-id header", async () => {
    const session = fakeSession();
    const { app } = buildApp(session);
    const res = await app.request("/api/onboarding/session/sess-1/history");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/onboarding/session/:id/graduate", () => {
  it("returns 404 when authenticated user does NOT own the session", async () => {
    const session = fakeSession({ userId: "user-owner" });
    const { app } = buildApp(session, "user-attacker");
    const res = await app.request("/api/onboarding/session/sess-1/graduate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "byok" }),
    });
    expect(res.status).toBe(404);
  });

  it("allows graduation when authenticated user owns the session", async () => {
    const session = fakeSession({ userId: "user-owner" });
    const { app } = buildApp(session, "user-owner");
    // Note: will get 503 because _graduationService is null in test, but that's
    // AFTER the ownership check passes — proving ownership check passed
    const res = await app.request("/api/onboarding/session/sess-1/graduate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "byok" }),
    });
    // 503 = graduation service not available (expected in test), NOT 404
    expect(res.status).toBe(503);
  });
});
