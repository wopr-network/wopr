import { describe, it, expect } from "vitest";
import {
  CAPABILITY_CATALOG,
  getCapabilityCatalogEntry,
  listCapabilityCatalog,
} from "../../src/core/capability-catalog.js";

describe("capability-catalog", () => {
  describe("CAPABILITY_CATALOG", () => {
    it("contains expected capability IDs", () => {
      const ids = CAPABILITY_CATALOG.map((c) => c.id);
      expect(ids).toContain("voice");
      expect(ids).toContain("image-gen");
      expect(ids).toContain("video-gen");
      expect(ids).toContain("web-search");
    });

    it("each entry has required fields", () => {
      for (const entry of CAPABILITY_CATALOG) {
        expect(entry.id).toBeTruthy();
        expect(entry.label).toBeTruthy();
        expect(entry.description).toBeTruthy();
        expect(entry.icon).toBeTruthy();
        expect(entry.plugins.length).toBeGreaterThan(0);
        expect(entry.activatedMessage).toBeTruthy();
      }
    });

    it("voice capability has two plugins (TTS + STT)", () => {
      const voice = CAPABILITY_CATALOG.find((c) => c.id === "voice");
      expect(voice?.plugins).toHaveLength(2);
      expect(voice?.plugins[0].name).toContain("chatterbox");
      expect(voice?.plugins[1].name).toContain("whisper");
    });

    it("plugins have hostedConfig with baseUrl where applicable", () => {
      const voice = CAPABILITY_CATALOG.find((c) => c.id === "voice");
      // baseUrl is env-dependent; verify it's a non-empty string without trailing slash
      const baseUrl = voice?.plugins[0].hostedConfig.baseUrl as string;
      expect(typeof baseUrl).toBe("string");
      expect(baseUrl).toBeTruthy();
      expect(baseUrl).not.toMatch(/\/$/);
    });

    it("web-search plugin has empty hostedConfig", () => {
      const webSearch = CAPABILITY_CATALOG.find((c) => c.id === "web-search");
      expect(webSearch?.plugins[0].hostedConfig).toEqual({});
    });

    it("each plugin has a source and name", () => {
      for (const entry of CAPABILITY_CATALOG) {
        for (const plugin of entry.plugins) {
          expect(plugin.source).toBeTruthy();
          expect(plugin.name).toBeTruthy();
        }
      }
    });
  });

  describe("getCapabilityCatalogEntry", () => {
    it("returns entry for known ID", () => {
      const entry = getCapabilityCatalogEntry("voice");
      expect(entry).toBeDefined();
      expect(entry!.id).toBe("voice");
      expect(entry!.label).toBe("Voice");
    });

    it("returns entry for image-gen", () => {
      const entry = getCapabilityCatalogEntry("image-gen");
      expect(entry).toBeDefined();
      expect(entry!.id).toBe("image-gen");
    });

    it("returns undefined for unknown ID", () => {
      expect(getCapabilityCatalogEntry("nonexistent")).toBeUndefined();
    });

    it("returns a frozen copy (immutable)", () => {
      const entry = getCapabilityCatalogEntry("voice");
      expect(Object.isFrozen(entry)).toBe(true);
    });

    it("returns a copy, not the same reference as catalog", () => {
      const a = getCapabilityCatalogEntry("voice");
      const b = getCapabilityCatalogEntry("voice");
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
    });
  });

  describe("listCapabilityCatalog", () => {
    it("returns all entries", () => {
      const list = listCapabilityCatalog();
      expect(list).toHaveLength(CAPABILITY_CATALOG.length);
    });

    it("returns frozen copies", () => {
      const list = listCapabilityCatalog();
      for (const entry of list) {
        expect(Object.isFrozen(entry)).toBe(true);
      }
    });

    it("returns copies, not direct references to catalog entries", () => {
      const list = listCapabilityCatalog();
      const original = CAPABILITY_CATALOG[0];
      expect(list[0]).toEqual(original);
      expect(list[0]).not.toBe(original);
    });

    it("returned list contains all expected IDs", () => {
      const ids = listCapabilityCatalog().map((e) => e.id);
      expect(ids).toContain("voice");
      expect(ids).toContain("image-gen");
      expect(ids).toContain("video-gen");
      expect(ids).toContain("web-search");
    });
  });
});
