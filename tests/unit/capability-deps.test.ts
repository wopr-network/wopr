import { describe, it, expect, beforeEach } from "vitest";
import {
  CapabilityDependencyGraph,
  getCapabilityDependencyGraph,
  resetCapabilityDependencyGraph,
} from "../../src/core/capability-deps.js";

describe("CapabilityDependencyGraph", () => {
  let graph: CapabilityDependencyGraph;

  beforeEach(() => {
    graph = new CapabilityDependencyGraph();
  });

  describe("registerPlugin", () => {
    it("registers a plugin with required capabilities", () => {
      graph.registerPlugin("my-plugin", [{ capability: "tts" }]);
      const deps = graph.getPluginDependencies("my-plugin");
      expect(deps).toHaveLength(1);
      expect(deps[0]).toEqual({
        pluginName: "my-plugin",
        capability: "tts",
        optional: false,
      });
    });

    it("registers optional dependencies", () => {
      graph.registerPlugin("my-plugin", [{ capability: "tts", optional: true }]);
      const deps = graph.getPluginDependencies("my-plugin");
      expect(deps[0].optional).toBe(true);
    });

    it("registers multiple capabilities for one plugin", () => {
      graph.registerPlugin("multi", [
        { capability: "tts" },
        { capability: "stt" },
        { capability: "image-gen", optional: true },
      ]);
      const deps = graph.getPluginDependencies("multi");
      expect(deps).toHaveLength(3);
    });

    it("overwrites previous registration for same plugin", () => {
      graph.registerPlugin("plugin-a", [{ capability: "tts" }]);
      graph.registerPlugin("plugin-a", [{ capability: "stt" }]);
      const deps = graph.getPluginDependencies("plugin-a");
      expect(deps).toHaveLength(1);
      expect(deps[0].capability).toBe("stt");
    });
  });

  describe("getDependents", () => {
    it("returns plugins depending on a capability", () => {
      graph.registerPlugin("plugin-a", [{ capability: "tts" }]);
      graph.registerPlugin("plugin-b", [{ capability: "tts" }, { capability: "stt" }]);
      graph.registerPlugin("plugin-c", [{ capability: "stt" }]);

      expect(graph.getDependents("tts").sort()).toEqual(["plugin-a", "plugin-b"]);
      expect(graph.getDependents("stt").sort()).toEqual(["plugin-b", "plugin-c"]);
    });

    it("returns empty array for unknown capability", () => {
      expect(graph.getDependents("nonexistent")).toEqual([]);
    });

    it("returns empty array for capability with no registered plugins", () => {
      expect(graph.getDependents("tts")).toEqual([]);
    });
  });

  describe("unregisterPlugin", () => {
    it("removes plugin from all capability tracking", () => {
      graph.registerPlugin("my-plugin", [{ capability: "tts" }, { capability: "stt" }]);
      graph.unregisterPlugin("my-plugin");

      expect(graph.getDependents("tts")).toEqual([]);
      expect(graph.getDependents("stt")).toEqual([]);
      expect(graph.getPluginDependencies("my-plugin")).toEqual([]);
    });

    it("is a no-op for unknown plugin", () => {
      expect(() => graph.unregisterPlugin("nonexistent")).not.toThrow();
    });

    it("does not affect other plugins sharing the same capability", () => {
      graph.registerPlugin("a", [{ capability: "tts" }]);
      graph.registerPlugin("b", [{ capability: "tts" }]);
      graph.unregisterPlugin("a");

      expect(graph.getDependents("tts")).toEqual(["b"]);
    });
  });

  describe("getAffectedPlugins", () => {
    it("returns only non-optional dependents", () => {
      graph.registerPlugin("required", [{ capability: "tts" }]);
      graph.registerPlugin("optional-user", [{ capability: "tts", optional: true }]);

      const affected = graph.getAffectedPlugins("tts");
      expect(affected).toEqual(["required"]);
    });

    it("returns empty array when all dependents are optional", () => {
      graph.registerPlugin("a", [{ capability: "tts", optional: true }]);
      expect(graph.getAffectedPlugins("tts")).toEqual([]);
    });

    it("returns empty for unknown capability", () => {
      expect(graph.getAffectedPlugins("nonexistent")).toEqual([]);
    });

    it("returns multiple affected plugins", () => {
      graph.registerPlugin("plugin-a", [{ capability: "tts" }]);
      graph.registerPlugin("plugin-b", [{ capability: "tts" }]);
      graph.registerPlugin("plugin-c", [{ capability: "tts", optional: true }]);

      const affected = graph.getAffectedPlugins("tts").sort();
      expect(affected).toEqual(["plugin-a", "plugin-b"]);
    });
  });

  describe("getPluginDependencies", () => {
    it("returns empty array for unknown plugin", () => {
      expect(graph.getPluginDependencies("unknown")).toEqual([]);
    });

    it("includes pluginName, capability, and optional fields", () => {
      graph.registerPlugin("plug", [
        { capability: "tts" },
        { capability: "stt", optional: true },
      ]);
      const deps = graph.getPluginDependencies("plug");
      expect(deps[0]).toMatchObject({ pluginName: "plug", capability: "tts", optional: false });
      expect(deps[1]).toMatchObject({ pluginName: "plug", capability: "stt", optional: true });
    });
  });
});

describe("singleton management", () => {
  beforeEach(() => {
    resetCapabilityDependencyGraph();
  });

  it("returns the same instance on repeated calls", () => {
    const a = getCapabilityDependencyGraph();
    const b = getCapabilityDependencyGraph();
    expect(a).toBe(b);
  });

  it("returns a fresh instance after reset", () => {
    const a = getCapabilityDependencyGraph();
    a.registerPlugin("test", [{ capability: "tts" }]);

    resetCapabilityDependencyGraph();
    const b = getCapabilityDependencyGraph();

    expect(b).not.toBe(a);
    expect(b.getPluginDependencies("test")).toEqual([]);
  });

  it("fresh instance has no registered plugins", () => {
    const graph = getCapabilityDependencyGraph();
    expect(graph.getDependents("tts")).toEqual([]);
  });
});
