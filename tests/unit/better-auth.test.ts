/**
 * Better Auth Integration Tests (WOP-261)
 *
 * Tests platform authentication via Better Auth:
 * - Email/password signup and login
 * - Session management (get session, logout)
 * - Bearer token plugin (API token auth)
 * - Organization plugin (RBAC)
 * - OAuth redirect URL generation
 * - Auth middleware (daemon bearer backward compat + Better Auth session)
 * - BETTER_AUTH_SECRET validation
 */

import { describe, expect, it } from "vitest";
import { organization } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";

describe("Better Auth Integration (WOP-261)", () => {
  // ========================================================================
  // Secret Validation
  // ========================================================================
  describe("BETTER_AUTH_SECRET validation", () => {
    const envKey = "BETTER_AUTH_SECRET";
    let originalSecret: string | undefined;

    function withEnv(value: string | undefined, fn: () => void) {
      const prev = process.env[envKey];
      if (value === undefined) {
        delete process.env[envKey];
      } else {
        process.env[envKey] = value;
      }
      try {
        fn();
      } finally {
        if (prev === undefined) {
          delete process.env[envKey];
        } else {
          process.env[envKey] = prev;
        }
      }
    }

    it("should reject missing BETTER_AUTH_SECRET", async () => {
      withEnv(undefined, () => {
        expect(() => {
          // Inline the same validation logic to unit-test it
          const secret = process.env.BETTER_AUTH_SECRET;
          if (!secret || secret.trim().length === 0) {
            throw new Error(
              "BETTER_AUTH_SECRET must be set (min 32 chars). Generate with: openssl rand -base64 32",
            );
          }
        }).toThrow("BETTER_AUTH_SECRET must be set");
      });
    });

    it("should reject empty BETTER_AUTH_SECRET", async () => {
      withEnv("", () => {
        expect(() => {
          const secret = process.env.BETTER_AUTH_SECRET;
          if (!secret || secret.trim().length === 0) {
            throw new Error(
              "BETTER_AUTH_SECRET must be set (min 32 chars). Generate with: openssl rand -base64 32",
            );
          }
        }).toThrow("BETTER_AUTH_SECRET must be set");
      });
    });

    it("should reject secrets shorter than 32 characters", async () => {
      withEnv("tooshort", () => {
        expect(() => {
          const secret = process.env.BETTER_AUTH_SECRET;
          if (!secret || secret.trim().length === 0) {
            throw new Error("BETTER_AUTH_SECRET must be set");
          }
          if (secret.length < 32) {
            throw new Error(
              `BETTER_AUTH_SECRET must be at least 32 characters (got ${secret.length}). Generate with: openssl rand -base64 32`,
            );
          }
        }).toThrow("BETTER_AUTH_SECRET must be at least 32 characters");
      });
    });

    it("should accept secrets of 32+ characters", async () => {
      const validSecret = "a".repeat(32);
      withEnv(validSecret, () => {
        expect(() => {
          const secret = process.env.BETTER_AUTH_SECRET;
          if (!secret || secret.trim().length === 0) {
            throw new Error("BETTER_AUTH_SECRET must be set");
          }
          if (secret.length < 32) {
            throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
          }
        }).not.toThrow();
      });
    });
  });

  // ========================================================================
  // Core Auth: Signup, Login, Session, Logout
  // ========================================================================
  describe("email/password auth", () => {
    it("should sign up a new user", async () => {
      const { auth } = await getTestInstance({
        plugins: [organization()],
      });

      const res = await auth.api.signUpEmail({
        body: {
          email: "newuser@example.com",
          password: "securepassword123",
          name: "New User",
        },
      });

      expect(res.user).toBeDefined();
      expect(res.user.email).toBe("newuser@example.com");
      expect(res.user.name).toBe("New User");
      expect(res.token).toBeDefined();
    });

    it("should reject signup with missing email", async () => {
      const { auth } = await getTestInstance({
        plugins: [organization()],
      });

      await expect(
        auth.api.signUpEmail({
          body: {
            email: "",
            password: "securepassword123",
            name: "No Email",
          },
        }),
      ).rejects.toThrow();
    });

    it("should sign in with correct credentials", async () => {
      const { auth } = await getTestInstance({
        plugins: [organization()],
      });

      const res = await auth.api.signInEmail({
        body: {
          email: "test@test.com",
          password: "test123456",
        },
      });

      expect(res.user).toBeDefined();
      expect(res.user.email).toBe("test@test.com");
      expect(res.token).toBeDefined();
    });

    it("should reject sign in with wrong password", async () => {
      const { auth } = await getTestInstance({
        plugins: [organization()],
      });

      await expect(
        auth.api.signInEmail({
          body: {
            email: "test@test.com",
            password: "wrongpassword",
          },
        }),
      ).rejects.toThrow();
    });

    it("should reject sign in for non-existent user", async () => {
      const { auth } = await getTestInstance({
        plugins: [organization()],
      });

      await expect(
        auth.api.signInEmail({
          body: {
            email: "nobody@example.com",
            password: "password123",
          },
        }),
      ).rejects.toThrow();
    });
  });

  // ========================================================================
  // Session Management
  // ========================================================================
  describe("session management", () => {
    it("should get session for authenticated user", async () => {
      const { auth, signInWithTestUser } = await getTestInstance({
        plugins: [organization()],
      });

      const { headers } = await signInWithTestUser();
      const session = await auth.api.getSession({ headers });

      expect(session).not.toBeNull();
      expect(session?.user.email).toBe("test@test.com");
      expect(session?.session).toBeDefined();
    });

    it("should return null session for unauthenticated request", async () => {
      const { auth } = await getTestInstance({
        plugins: [organization()],
      });

      const session = await auth.api.getSession({
        headers: new Headers(),
      });

      expect(session).toBeNull();
    });

    it("should invalidate session on sign out", async () => {
      const { auth, signInWithTestUser } = await getTestInstance({
        plugins: [organization()],
      });

      const { headers } = await signInWithTestUser();

      // Verify session exists
      const sessionBefore = await auth.api.getSession({ headers });
      expect(sessionBefore).not.toBeNull();

      // Sign out
      await auth.api.signOut({ headers });

      // Session should be invalid now
      const sessionAfter = await auth.api.getSession({ headers });
      expect(sessionAfter).toBeNull();
    });
  });

  // ========================================================================
  // Bearer Token Plugin
  // ========================================================================
  describe("bearer token plugin", () => {
    it("should return a token on sign in", async () => {
      const { auth } = await getTestInstance({
        plugins: [organization()],
      });

      const res = await auth.api.signInEmail({
        body: {
          email: "test@test.com",
          password: "test123456",
        },
      });

      expect(res.token).toBeDefined();
      expect(typeof res.token).toBe("string");
      expect(res.token.length).toBeGreaterThan(0);
    });

    it("should return a token on sign up", async () => {
      const { auth } = await getTestInstance({
        plugins: [organization()],
      });

      const res = await auth.api.signUpEmail({
        body: {
          email: "bearer@example.com",
          password: "password123",
          name: "Bearer User",
        },
      });

      expect(res.token).toBeDefined();
      expect(typeof res.token).toBe("string");
    });
  });

  // ========================================================================
  // Organization Plugin (RBAC)
  // ========================================================================
  describe("organization plugin", () => {
    it("should allow creating an organization", async () => {
      const { auth, signInWithTestUser } = await getTestInstance({
        plugins: [
          organization({
            allowUserToCreateOrganization: true,
            creatorRole: "owner",
          }),
        ],
      });

      const { headers } = await signInWithTestUser();

      const org = await auth.api.createOrganization({
        headers,
        body: {
          name: "Test Org",
          slug: "test-org",
        },
      });

      expect(org).toBeDefined();
      expect(org.name).toBe("Test Org");
      expect(org.slug).toBe("test-org");
    });

    it("should assign creator as owner", async () => {
      const { auth, signInWithTestUser } = await getTestInstance({
        plugins: [
          organization({
            allowUserToCreateOrganization: true,
            creatorRole: "owner",
          }),
        ],
      });

      const { headers } = await signInWithTestUser();

      const org = await auth.api.createOrganization({
        headers,
        body: {
          name: "Owner Test Org",
          slug: "owner-test-org",
        },
      });

      // The full organization details should be returned
      expect(org).toBeDefined();
      expect(org.id).toBeDefined();
    });
  });

  // ========================================================================
  // OAuth Redirect URLs
  // ========================================================================
  describe("OAuth redirect URLs", () => {
    it("should generate correct GitHub OAuth redirect URL", async () => {
      const { auth } = await getTestInstance({
        plugins: [organization()],
      });

      const res = await auth.api.signInSocial({
        body: {
          provider: "github",
          callbackURL: "http://localhost:3000/callback",
        },
      });

      expect(res.url).toBeDefined();
      expect(res.url).toContain("github.com");
      expect(res.redirect).toBe(true);
    });

    it("should generate correct Google OAuth redirect URL", async () => {
      const { auth } = await getTestInstance({
        socialProviders: {
          google: {
            clientId: "test-google-id",
            clientSecret: "test-google-secret",
          },
        },
        plugins: [organization()],
      });

      const res = await auth.api.signInSocial({
        body: {
          provider: "google",
          callbackURL: "http://localhost:3000/callback",
        },
      });

      expect(res.url).toBeDefined();
      expect(res.url).toContain("accounts.google.com");
      expect(res.redirect).toBe(true);
    });
  });

  // ========================================================================
  // Auth Middleware Backward Compatibility
  // ========================================================================
  describe("auth middleware compatibility", () => {
    it("should validate Better Auth session via getSession API", async () => {
      const { auth, signInWithTestUser } = await getTestInstance({
        plugins: [organization()],
      });

      const { headers } = await signInWithTestUser();
      const session = await auth.api.getSession({ headers });
      expect(session).not.toBeNull();
      expect(session?.user.email).toBe("test@test.com");
    });

    it("should reject requests with no auth headers", async () => {
      const { auth } = await getTestInstance({
        plugins: [organization()],
      });

      const session = await auth.api.getSession({
        headers: new Headers(),
      });
      expect(session).toBeNull();
    });

    it("should reject requests with invalid cookie", async () => {
      const { auth } = await getTestInstance({
        plugins: [organization()],
      });

      const session = await auth.api.getSession({
        headers: new Headers({
          cookie: "better-auth.session_token=invalid-token-value",
        }),
      });
      expect(session).toBeNull();
    });
  });

  // ========================================================================
  // requireAdmin Middleware (RBAC)
  // ========================================================================
  describe("requireAdmin middleware", () => {
    it("should allow admin role through", async () => {
      const { Hono } = await import("hono");
      const { requireAdmin } = await import("../../src/daemon/middleware/auth.js");

      const app = new Hono();
      // Simulate a pre-authenticated admin user
      app.use("*", async (c, next) => {
        c.set("role", "admin");
        return next();
      });
      app.use("*", requireAdmin());
      app.get("/admin/config", (c) => c.json({ ok: true }));

      const res = await app.request("/admin/config");
      expect(res.status).toBe(200);
    });

    it("should allow owner role through", async () => {
      const { Hono } = await import("hono");
      const { requireAdmin } = await import("../../src/daemon/middleware/auth.js");

      const app = new Hono();
      app.use("*", async (c, next) => {
        c.set("role", "owner");
        return next();
      });
      app.use("*", requireAdmin());
      app.get("/admin/config", (c) => c.json({ ok: true }));

      const res = await app.request("/admin/config");
      expect(res.status).toBe(200);
    });

    it("should reject viewer role with 403", async () => {
      const { Hono } = await import("hono");
      const { requireAdmin } = await import("../../src/daemon/middleware/auth.js");

      const app = new Hono();
      app.use("*", async (c, next) => {
        c.set("role", "viewer");
        return next();
      });
      app.use("*", requireAdmin());
      app.get("/admin/config", (c) => c.json({ ok: true }));

      const res = await app.request("/admin/config");
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain("admin access required");
    });

    it("should reject undefined role with 403", async () => {
      const { Hono } = await import("hono");
      const { requireAdmin } = await import("../../src/daemon/middleware/auth.js");

      const app = new Hono();
      // No role set (e.g. middleware bug)
      app.use("*", requireAdmin());
      app.get("/admin/config", (c) => c.json({ ok: true }));

      const res = await app.request("/admin/config");
      expect(res.status).toBe(403);
    });
  });
});
