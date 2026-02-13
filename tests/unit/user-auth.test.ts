/**
 * User Auth Tests (WOP-208)
 *
 * Tests user registration, login, token refresh, logout, and profile
 * endpoints using Hono's test client.
 */

import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jwtAuth } from "../../src/daemon/middleware/jwt-auth.js";
import {
  AuthError,
  closeAuthDb,
  getUserProfile,
  loginUser,
  logoutUser,
  refreshAccessToken,
  registerUser,
  verifyToken,
} from "../../src/daemon/user-auth/index.js";
import { resetKeyCache } from "../../src/daemon/user-auth/tokens.js";
import type { UserAuthEnv } from "../../src/daemon/user-auth/types.js";
import { createUserAuthRouter } from "../../src/daemon/routes/user-auth.js";

const TEST_DIR = join(tmpdir(), `wopr-auth-test-${process.pid}-${Date.now()}`);

// Unique email counter to avoid collisions between tests
let emailCounter = 0;
function uniqueEmail(prefix = "user"): string {
  return `${prefix}-${++emailCounter}-${Date.now()}@test.example`;
}

beforeAll(() => {
  process.env.WOPR_HOME = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  closeAuthDb();
  resetKeyCache();
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

// ---- Service Layer Tests ----

describe("User Auth Service", () => {
  describe("registerUser", () => {
    it("should register a user with valid email and password", async () => {
      const email = uniqueEmail("register");
      const result = await registerUser({
        email,
        password: "securepass123",
        displayName: "Test User",
      });

      expect(result.user).toBeDefined();
      expect(result.user.email).toBe(email);
      expect(result.user.display_name).toBe("Test User");
      expect(result.user.role).toBe("user");
      expect(result.user.id).toBeTruthy();
    });

    it("should reject duplicate email", async () => {
      const email = uniqueEmail("dup");
      await registerUser({ email, password: "securepass123" });

      await expect(
        registerUser({ email, password: "anotherpass1" }),
      ).rejects.toThrow("Email already registered");
    });

    it("should reject invalid email format", async () => {
      await expect(
        registerUser({ email: "notanemail", password: "securepass123" }),
      ).rejects.toThrow("Invalid email format");
    });

    it("should reject short passwords", async () => {
      await expect(
        registerUser({ email: uniqueEmail("short"), password: "abc" }),
      ).rejects.toThrow("Password must be at least 8 characters");
    });

    it("should normalize email to lowercase", async () => {
      const email = uniqueEmail("UPPER").toUpperCase();
      const result = await registerUser({
        email,
        password: "securepass123",
      });
      expect(result.user.email).toBe(email.toLowerCase());
    });
  });

  describe("loginUser", () => {
    const email = `login-svc-${Date.now()}@test.example`;

    beforeAll(async () => {
      await registerUser({ email, password: "securepass123" });
    });

    it("should login with valid credentials", async () => {
      const result = await loginUser({ email, password: "securepass123" });

      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      expect(result.user.email).toBe(email);
    });

    it("should reject wrong password", async () => {
      await expect(
        loginUser({ email, password: "wrongpassword" }),
      ).rejects.toThrow("Invalid email or password");
    });

    it("should reject non-existent email", async () => {
      await expect(
        loginUser({ email: "nobody@test.example", password: "securepass123" }),
      ).rejects.toThrow("Invalid email or password");
    });
  });

  describe("verifyToken", () => {
    const email = `verify-svc-${Date.now()}@test.example`;

    beforeAll(async () => {
      await registerUser({ email, password: "securepass123" });
    });

    it("should verify a valid access token", async () => {
      const login = await loginUser({ email, password: "securepass123" });

      const payload = await verifyToken(login.accessToken);
      expect(payload).not.toBeNull();
      expect(payload!.email).toBe(email);
      expect(payload!.role).toBe("user");
    });

    it("should return null for invalid token", async () => {
      const payload = await verifyToken("invalid.token.here");
      expect(payload).toBeNull();
    });
  });

  describe("refreshAccessToken", () => {
    const email = `refresh-svc-${Date.now()}@test.example`;

    beforeAll(async () => {
      await registerUser({ email, password: "securepass123" });
    });

    it("should issue new tokens with valid refresh token", async () => {
      const login = await loginUser({ email, password: "securepass123" });

      const result = await refreshAccessToken(login.refreshToken);
      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      // Refresh tokens should always differ (new jti)
      expect(result.refreshToken).not.toBe(login.refreshToken);
    });

    it("should reject an already-used refresh token (rotation)", async () => {
      const login = await loginUser({ email, password: "securepass123" });

      await refreshAccessToken(login.refreshToken);

      await expect(refreshAccessToken(login.refreshToken)).rejects.toThrow(
        "Refresh token revoked or not found",
      );
    });

    it("should reject an invalid refresh token", async () => {
      await expect(refreshAccessToken("invalid.token.here")).rejects.toThrow(
        "Invalid refresh token",
      );
    });
  });

  describe("logoutUser", () => {
    const email = `logout-svc-${Date.now()}@test.example`;

    beforeAll(async () => {
      await registerUser({ email, password: "securepass123" });
    });

    it("should revoke all refresh tokens for a user", async () => {
      const login = await loginUser({ email, password: "securepass123" });

      const payload = await verifyToken(login.accessToken);
      expect(payload).not.toBeNull();

      logoutUser(payload!.sub);

      await expect(refreshAccessToken(login.refreshToken)).rejects.toThrow(
        "Refresh token revoked or not found",
      );
    });
  });

  describe("getUserProfile", () => {
    const email = `profile-svc-${Date.now()}@test.example`;

    beforeAll(async () => {
      await registerUser({ email, password: "securepass123" });
    });

    it("should return user profile by ID", async () => {
      const login = await loginUser({ email, password: "securepass123" });

      const payload = await verifyToken(login.accessToken);
      const profile = getUserProfile(payload!.sub);

      expect(profile).not.toBeNull();
      expect(profile!.email).toBe(email);
      expect(profile!.role).toBe("user");
    });

    it("should return null for non-existent user", () => {
      const profile = getUserProfile("nonexistent-uuid");
      expect(profile).toBeNull();
    });
  });
});

// ---- HTTP Route Tests ----

describe("User Auth Routes", () => {
  function createTestApp() {
    const app = new Hono();
    app.route("/api/auth", createUserAuthRouter());
    return app;
  }

  // Shared email for route tests
  const routeEmail = `route-${Date.now()}@test.example`;
  const routePass = "securepass123";

  describe("POST /api/auth/register", () => {
    it("should register a new user", async () => {
      const app = createTestApp();
      const res = await app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: routeEmail,
          password: routePass,
          displayName: "Route Tester",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.user.email).toBe(routeEmail);
    });

    it("should return 400 for missing fields", async () => {
      const app = createTestApp();
      const res = await app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: uniqueEmail() }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 409 for duplicate email", async () => {
      const app = createTestApp();
      const res = await app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: routeEmail,
          password: routePass,
        }),
      });

      expect(res.status).toBe(409);
    });
  });

  describe("POST /api/auth/login", () => {
    it("should login and return tokens", async () => {
      const app = createTestApp();
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: routeEmail,
          password: routePass,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.accessToken).toBeTruthy();
      expect(body.refreshToken).toBeTruthy();
      expect(body.user.email).toBe(routeEmail);
    });

    it("should return 401 for wrong password", async () => {
      const app = createTestApp();
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: routeEmail,
          password: "wrongpassword",
        }),
      });

      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/auth/refresh", () => {
    it("should refresh tokens", async () => {
      const app = createTestApp();

      const loginRes = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: routeEmail, password: routePass }),
      });
      const loginBody = await loginRes.json();

      const res = await app.request("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: loginBody.refreshToken }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.accessToken).toBeTruthy();
      expect(body.refreshToken).toBeTruthy();
    });

    it("should return 400 for missing refresh token", async () => {
      const app = createTestApp();
      const res = await app.request("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/auth/me", () => {
    it("should return user profile with valid access token", async () => {
      const app = createTestApp();

      const loginRes = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: routeEmail, password: routePass }),
      });
      const loginBody = await loginRes.json();

      const res = await app.request("/api/auth/me", {
        headers: { Authorization: `Bearer ${loginBody.accessToken}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user.email).toBe(routeEmail);
    });

    it("should return 401 without authorization header", async () => {
      const app = createTestApp();
      const res = await app.request("/api/auth/me");
      expect(res.status).toBe(401);
    });

    it("should return 401 with invalid token", async () => {
      const app = createTestApp();
      const res = await app.request("/api/auth/me", {
        headers: { Authorization: "Bearer invalid.jwt.token" },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/auth/logout", () => {
    it("should logout and invalidate refresh tokens", async () => {
      const app = createTestApp();

      const loginRes = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: routeEmail, password: routePass }),
      });
      const loginBody = await loginRes.json();

      const logoutRes = await app.request("/api/auth/logout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${loginBody.accessToken}`,
          "Content-Type": "application/json",
        },
      });

      expect(logoutRes.status).toBe(200);
      const logoutBody = await logoutRes.json();
      expect(logoutBody.success).toBe(true);

      const refreshRes = await app.request("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: loginBody.refreshToken }),
      });

      expect(refreshRes.status).toBe(401);
    });
  });
});

// ---- JWT Middleware Tests ----

describe("JWT Auth Middleware", () => {
  const email = `jwt-mw-${Date.now()}@test.example`;

  beforeAll(async () => {
    await registerUser({ email, password: "securepass123" });
  });

  it("should allow requests with valid JWT", async () => {
    const app = new Hono<UserAuthEnv>();
    app.use("*", jwtAuth());
    app.get("/protected", (c) => c.json({ userId: c.get("userId") }));

    const login = await loginUser({ email, password: "securepass123" });

    const res = await app.request("/protected", {
      headers: { Authorization: `Bearer ${login.accessToken}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBeTruthy();
  });

  it("should reject requests without Authorization header", async () => {
    const app = new Hono<UserAuthEnv>();
    app.use("*", jwtAuth());
    app.get("/protected", (c) => c.json({ ok: true }));

    const res = await app.request("/protected");
    expect(res.status).toBe(401);
  });

  it("should reject requests with invalid token", async () => {
    const app = new Hono<UserAuthEnv>();
    app.use("*", jwtAuth());
    app.get("/protected", (c) => c.json({ ok: true }));

    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer invalid.jwt.token" },
    });
    expect(res.status).toBe(401);
  });
});

// ---- AuthError Tests ----

describe("AuthError", () => {
  it("should have correct properties", () => {
    const err = new AuthError("Test error", 400);
    expect(err.message).toBe("Test error");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("AuthError");
    expect(err instanceof Error).toBe(true);
  });
});
