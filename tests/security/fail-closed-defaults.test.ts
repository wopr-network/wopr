/**
 * Fail-Closed Security Defaults Tests (WOP-610)
 *
 * Verifies that missing security context defaults to "untrusted" (least privilege)
 * rather than "owner" (maximum privilege) — fail-closed, not fail-open.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the logger to suppress output during tests
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock security context — control what getContext returns
vi.mock("../../src/security/context.js", () => ({
  getContext: vi.fn(),
  storeContext: vi.fn(),
  clearContext: vi.fn(),
}));

// Mock plugin extensions — control getSandboxExtension
vi.mock("../../src/plugins/extensions.js", () => ({
  getPluginExtension: vi.fn(),
}));

// Import after mocks
const { getContext } = await import("../../src/security/context.js");
const { getPluginExtension } = await import("../../src/plugins/extensions.js");
const { getSandboxForSession, execInSandbox } = await import("../../src/security/sandbox.js");
const { getSessionIndexable, DEFAULT_SECURITY_CONFIG } = await import("../../src/security/types.js");

describe("WOP-610: fail-closed security defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getSandboxForSession — sandbox trust level", () => {
    it("defaults to untrusted when no security context exists", async () => {
      // Arrange: no context, but sandbox plugin is installed
      vi.mocked(getContext).mockReturnValue(undefined);
      const mockResolveSandboxContext = vi.fn().mockResolvedValue({ enabled: true });
      vi.mocked(getPluginExtension).mockReturnValue({
        resolveSandboxContext: mockResolveSandboxContext,
      } as unknown as ReturnType<typeof getPluginExtension>);

      // Act
      await getSandboxForSession("test-session");

      // Assert: must NOT call with "owner" — must call with "untrusted"
      expect(mockResolveSandboxContext).toHaveBeenCalledWith({
        sessionName: "test-session",
        trustLevel: "untrusted",
      });
    });

    it("uses actual trust level from context when context exists", async () => {
      // Arrange: context present with "trusted" level
      vi.mocked(getContext).mockReturnValue({
        source: { trustLevel: "trusted" },
      } as unknown as ReturnType<typeof getContext>);
      const mockResolveSandboxContext = vi.fn().mockResolvedValue({ enabled: false });
      vi.mocked(getPluginExtension).mockReturnValue({
        resolveSandboxContext: mockResolveSandboxContext,
      } as unknown as ReturnType<typeof getPluginExtension>);

      // Act
      await getSandboxForSession("test-session");

      // Assert: uses the real trust level from context
      expect(mockResolveSandboxContext).toHaveBeenCalledWith({
        sessionName: "test-session",
        trustLevel: "trusted",
      });
    });

    it("returns null when sandbox plugin is not installed", async () => {
      // Arrange: no sandbox extension
      vi.mocked(getPluginExtension).mockReturnValue(undefined);

      // Act
      const result = await getSandboxForSession("test-session");

      // Assert
      expect(result).toBeNull();
    });

    it("logs a warning when context is missing", async () => {
      // Arrange: no context
      vi.mocked(getContext).mockReturnValue(undefined);
      vi.mocked(getPluginExtension).mockReturnValue({
        resolveSandboxContext: vi.fn().mockResolvedValue(null),
      } as unknown as ReturnType<typeof getPluginExtension>);
      const { logger } = await import("../../src/logger.js");

      // Act
      await getSandboxForSession("missing-ctx-session");

      // Assert: warning was logged
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("missing-ctx-session"),
      );
    });
  });

  describe("execInSandbox — sandbox trust level", () => {
    it("defaults to untrusted when no security context exists", async () => {
      // Arrange: no context, but sandbox plugin is installed with a sandbox ready
      vi.mocked(getContext).mockReturnValue(undefined);
      const mockExecInContainer = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
      vi.mocked(getPluginExtension).mockReturnValue({
        resolveSandboxContext: vi.fn().mockResolvedValue({ containerName: "test-container", containerWorkdir: "/workspace" }),
        execInContainer: mockExecInContainer,
      } as unknown as ReturnType<typeof getPluginExtension>);

      // Act
      await execInSandbox("test-session", "echo hello");

      // Assert: must NOT pass "owner" — must pass "untrusted"
      const { getPluginExtension: ext } = await import("../../src/plugins/extensions.js");
      const mockExt = vi.mocked(ext).mock.results[0]?.value as { resolveSandboxContext: ReturnType<typeof vi.fn> };
      expect(mockExt.resolveSandboxContext).toHaveBeenCalledWith({
        sessionName: "test-session",
        trustLevel: "untrusted",
      });
    });

    it("logs a warning when context is missing", async () => {
      // Arrange: no context
      vi.mocked(getContext).mockReturnValue(undefined);
      vi.mocked(getPluginExtension).mockReturnValue({
        resolveSandboxContext: vi.fn().mockResolvedValue(null),
        execInContainer: vi.fn(),
      } as unknown as ReturnType<typeof getPluginExtension>);
      const { logger } = await import("../../src/logger.js");

      // Act
      await execInSandbox("missing-ctx-session", "echo hello");

      // Assert: warning was logged
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("missing-ctx-session"),
      );
    });

    it("returns null when sandbox plugin is not installed", async () => {
      // Arrange: no sandbox extension
      vi.mocked(getPluginExtension).mockReturnValue(undefined);

      // Act
      const result = await execInSandbox("test-session", "echo hello");

      // Assert
      expect(result).toBeNull();
    });
  });

  describe("getSessionIndexable — default parameter", () => {
    it("defaults to untrusted indexable patterns when no trustLevel argument is provided", () => {
      // This directly tests the default parameter change in types.ts
      // Calling without trustLevel should return ["self"], NOT ["*"]
      const result = getSessionIndexable(DEFAULT_SECURITY_CONFIG, "some-session");

      // "untrusted" maps to ["self"] — can only see own transcripts
      expect(result).toEqual(["self"]);
    });

    it("returns owner patterns when trustLevel is explicitly owner", () => {
      const result = getSessionIndexable(DEFAULT_SECURITY_CONFIG, "some-session", "owner");

      // "owner" maps to ["*"] — can see all transcripts
      expect(result).toEqual(["*"]);
    });

    it("returns self-only patterns for untrusted trust level", () => {
      const result = getSessionIndexable(DEFAULT_SECURITY_CONFIG, "some-session", "untrusted");

      expect(result).toEqual(["self"]);
    });
  });
});
