import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { getSecurityRegistry, resetSecurityRegistry } = await import(
	"../../../src/security/registry.js"
);

describe("SecurityRegistry", () => {
	beforeEach(() => {
		resetSecurityRegistry();
	});

	afterEach(() => {
		resetSecurityRegistry();
	});

	describe("permissions", () => {
		it("has core permissions by default", () => {
			const reg = getSecurityRegistry();
			expect(reg.hasPermission("inject")).toBe(true);
			expect(reg.hasPermission("config.read")).toBe(true);
			expect(reg.hasPermission("*")).toBe(true);
		});

		it("registers a new permission", () => {
			const reg = getSecurityRegistry();
			reg.registerPermission("webhook.send", "my-plugin");
			expect(reg.hasPermission("webhook.send")).toBe(true);
		});

		it("rejects invalid permission format", () => {
			const reg = getSecurityRegistry();
			expect(() => reg.registerPermission("INVALID", "p")).toThrow(
				/Invalid permission format/,
			);
			expect(() => reg.registerPermission("", "p")).toThrow(
				/Invalid permission format/,
			);
		});

		it("unregisters a plugin permission", () => {
			const reg = getSecurityRegistry();
			reg.registerPermission("webhook.send", "my-plugin");
			reg.unregisterPermission("webhook.send", "my-plugin");
			expect(reg.hasPermission("webhook.send")).toBe(false);
		});

		it("cannot unregister core permissions", () => {
			const reg = getSecurityRegistry();
			reg.unregisterPermission("inject", "attacker");
			expect(reg.hasPermission("inject")).toBe(true);
		});

		it("getAllPermissions includes core and registered", () => {
			const reg = getSecurityRegistry();
			reg.registerPermission("foo.bar", "test-plugin");
			const all = reg.getAllPermissions();
			expect(all).toContain("inject");
			expect(all).toContain("foo.bar");
		});

		it("same plugin can re-register its own permission", () => {
			const reg = getSecurityRegistry();
			reg.registerPermission("foo.bar", "my-plugin");
			reg.registerPermission("foo.bar", "my-plugin");
			expect(reg.hasPermission("foo.bar")).toBe(true);
		});

		it("different plugin cannot overwrite existing permission", () => {
			const reg = getSecurityRegistry();
			reg.registerPermission("foo.bar", "plugin-a");
			expect(() => reg.registerPermission("foo.bar", "plugin-b")).toThrow(
				/is already registered by plugin "plugin-a"/,
			);
		});
	});

	describe("injection sources", () => {
		it("has core sources by default", () => {
			const reg = getSecurityRegistry();
			expect(reg.getDefaultTrust("cli")).toBe("owner");
			expect(reg.getDefaultTrust("plugin")).toBe("semi-trusted");
		});

		it("registers a new injection source", () => {
			const reg = getSecurityRegistry();
			reg.registerInjectionSource("webhook", "semi-trusted", "my-plugin");
			expect(reg.getDefaultTrust("webhook")).toBe("semi-trusted");
		});

		it("unregisters a plugin injection source", () => {
			const reg = getSecurityRegistry();
			reg.registerInjectionSource("webhook", "semi-trusted", "my-plugin");
			reg.unregisterInjectionSource("webhook", "my-plugin");
			expect(reg.getDefaultTrust("webhook")).toBeUndefined();
		});

		it("cannot unregister core sources", () => {
			const reg = getSecurityRegistry();
			reg.unregisterInjectionSource("cli", "attacker");
			expect(reg.getDefaultTrust("cli")).toBe("owner");
		});

		it("same plugin can re-register its own source", () => {
			const reg = getSecurityRegistry();
			reg.registerInjectionSource("webhook", "semi-trusted", "my-plugin");
			reg.registerInjectionSource("webhook", "trusted", "my-plugin");
			expect(reg.getDefaultTrust("webhook")).toBe("trusted");
		});

		it("different plugin cannot overwrite existing source", () => {
			const reg = getSecurityRegistry();
			reg.registerInjectionSource("webhook", "semi-trusted", "plugin-a");
			expect(() =>
				reg.registerInjectionSource("webhook", "owner", "plugin-b"),
			).toThrow(/is already registered by plugin "plugin-a"/);
		});
	});

	describe("tool capabilities", () => {
		it("has core tool mappings by default", () => {
			const reg = getSecurityRegistry();
			expect(reg.getToolCapability("config_get")).toBe("config.read");
			expect(reg.getToolCapability("exec_command")).toBe("inject.exec");
		});

		it("registers a new tool mapping", () => {
			const reg = getSecurityRegistry();
			reg.registerToolCapability("my_tool", "my.perm", "my-plugin");
			expect(reg.getToolCapability("my_tool")).toBe("my.perm");
		});

		it("unregisters a plugin tool mapping", () => {
			const reg = getSecurityRegistry();
			reg.registerToolCapability("my_tool", "my.perm", "my-plugin");
			reg.unregisterToolCapability("my_tool", "my-plugin");
			expect(reg.getToolCapability("my_tool")).toBeUndefined();
		});

		it("cannot unregister core tool mappings", () => {
			const reg = getSecurityRegistry();
			reg.unregisterToolCapability("config_get", "attacker");
			expect(reg.getToolCapability("config_get")).toBe("config.read");
		});

		it("rejects empty capability", () => {
			const reg = getSecurityRegistry();
			expect(() =>
				reg.registerToolCapability("my_tool", "", "my-plugin"),
			).toThrow(/Invalid capability: cannot be empty/);
			expect(() =>
				reg.registerToolCapability("my_tool", "   ", "my-plugin"),
			).toThrow(/Invalid capability: cannot be empty/);
		});

		it("same plugin can re-register its own tool capability", () => {
			const reg = getSecurityRegistry();
			reg.registerToolCapability("my_tool", "foo.bar", "my-plugin");
			reg.registerToolCapability("my_tool", "baz.qux", "my-plugin");
			expect(reg.getToolCapability("my_tool")).toBe("baz.qux");
		});

		it("different plugin cannot overwrite existing tool capability", () => {
			const reg = getSecurityRegistry();
			reg.registerToolCapability("my_tool", "plugin-a.perm", "plugin-a");
			expect(() =>
				reg.registerToolCapability("my_tool", "plugin-b.perm", "plugin-b"),
			).toThrow(/is already registered by plugin "plugin-a"/);
		});
	});

	describe("unregisterAllForPlugin", () => {
		it("removes all registrations for a plugin", () => {
			const reg = getSecurityRegistry();
			reg.registerPermission("foo.bar", "p1");
			reg.registerInjectionSource("webhook", "trusted", "p1");
			reg.registerToolCapability("foo_tool", "foo.bar", "p1");

			reg.unregisterAllForPlugin("p1");

			expect(reg.hasPermission("foo.bar")).toBe(false);
			expect(reg.getDefaultTrust("webhook")).toBeUndefined();
			expect(reg.getToolCapability("foo_tool")).toBeUndefined();
		});
	});

	describe("dynamic expandCapabilities via registry", () => {
		it("expandCapabilities includes plugin-registered permissions when * is used", async () => {
			const reg = getSecurityRegistry();
			reg.registerPermission("custom.thing", "test-plugin");

			const { expandCapabilities } = await import("../../../src/security/types.js");
			const expanded = expandCapabilities(["*"]);
			expect(expanded).toContain("custom.thing");
			expect(expanded).toContain("inject");
		});
	});

	describe("dynamic getToolCapability via types.ts", () => {
		it("getToolCapability returns plugin-registered tool", async () => {
			const reg = getSecurityRegistry();
			reg.registerToolCapability("my_custom_tool", "custom.perm", "test-plugin");

			const { getToolCapability } = await import("../../../src/security/types.js");
			expect(getToolCapability("my_custom_tool")).toBe("custom.perm");

			reg.unregisterToolCapability("my_custom_tool", "test-plugin");
		});
	});

	describe("dynamic createInjectionSource via types.ts", () => {
		it("createInjectionSource uses registry for plugin-registered source", async () => {
			const reg = getSecurityRegistry();
			reg.registerInjectionSource("webhook", "trusted", "test-plugin");

			const { createInjectionSource } = await import("../../../src/security/types.js");
			const source = createInjectionSource("webhook");
			expect(source.trustLevel).toBe("trusted");

			reg.unregisterInjectionSource("webhook", "test-plugin");
		});
	});
});
