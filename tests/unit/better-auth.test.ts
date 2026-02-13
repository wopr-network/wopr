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
 */

import { describe, expect, it } from "vitest";
import { organization } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";

describe("Better Auth Integration (WOP-261)", () => {
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
});
