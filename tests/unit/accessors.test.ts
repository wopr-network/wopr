import { afterEach, describe, expect, it } from "vitest";
import type {
  ChannelAdapter,
  ChannelRef,
  ContextProvider,
  UiComponentExtension,
  WebUiExtension,
} from "../../src/types.js";
import {
  getChannel,
  getChannels,
  getChannelsForSession,
  getContextProvider,
  getUiComponents,
  getWebUiExtensions,
} from "../../src/plugins/accessors.js";
import {
  channelAdapters,
  channelKey,
  contextProviders,
  uiComponents,
  webUiExtensions,
} from "../../src/plugins/state.js";

afterEach(() => {
  contextProviders.clear();
  channelAdapters.clear();
  webUiExtensions.clear();
  uiComponents.clear();
});

describe("getContextProvider", () => {
  it("returns undefined for unknown session", () => {
    expect(getContextProvider("unknown")).toBeUndefined();
  });

  it("returns the provider for a known session", () => {
    const provider = {
      name: "test",
      priority: 1,
      getContext: async () => null,
    } as ContextProvider;
    contextProviders.set("sess-1", provider);
    expect(getContextProvider("sess-1")).toBe(provider);
  });
});

describe("getChannel", () => {
  const ref: ChannelRef = { type: "discord", id: "ch-1" };
  const adapter: ChannelAdapter = {
    channel: ref,
    session: "sess-1",
    getContext: async () => "",
    send: async () => {},
  };

  it("returns undefined for unknown channel", () => {
    expect(getChannel({ type: "discord", id: "nope" })).toBeUndefined();
  });

  it("returns the adapter for a known channel", () => {
    channelAdapters.set(channelKey(ref), adapter);
    expect(getChannel(ref)).toBe(adapter);
  });
});

describe("getChannels", () => {
  it("returns empty array when no channels", () => {
    expect(getChannels()).toEqual([]);
  });

  it("returns all registered channels", () => {
    const a1: ChannelAdapter = {
      channel: { type: "discord", id: "1" },
      session: "s1",
      getContext: async () => "",
      send: async () => {},
    };
    const a2: ChannelAdapter = {
      channel: { type: "p2p", id: "2" },
      session: "s2",
      getContext: async () => "",
      send: async () => {},
    };
    channelAdapters.set("discord:1", a1);
    channelAdapters.set("p2p:2", a2);
    expect(getChannels()).toEqual([a1, a2]);
  });
});

describe("getChannelsForSession", () => {
  it("returns only channels matching the session", () => {
    const a1: ChannelAdapter = {
      channel: { type: "discord", id: "1" },
      session: "sess-A",
      getContext: async () => "",
      send: async () => {},
    };
    const a2: ChannelAdapter = {
      channel: { type: "discord", id: "2" },
      session: "sess-B",
      getContext: async () => "",
      send: async () => {},
    };
    channelAdapters.set("discord:1", a1);
    channelAdapters.set("discord:2", a2);
    expect(getChannelsForSession("sess-A")).toEqual([a1]);
    expect(getChannelsForSession("sess-B")).toEqual([a2]);
    expect(getChannelsForSession("sess-C")).toEqual([]);
  });
});

describe("getWebUiExtensions", () => {
  it("returns empty array when none registered", () => {
    expect(getWebUiExtensions()).toEqual([]);
  });

  it("returns all registered extensions", () => {
    const ext: WebUiExtension = { id: "ext-1", title: "Test", url: "/test" };
    webUiExtensions.set("ext-1", ext);
    expect(getWebUiExtensions()).toEqual([ext]);
  });
});

describe("getUiComponents", () => {
  it("returns empty array when none registered", () => {
    expect(getUiComponents()).toEqual([]);
  });

  it("returns all registered components", () => {
    const comp: UiComponentExtension = {
      id: "comp-1",
      title: "Test",
      moduleUrl: "/comp.js",
      slot: "sidebar",
    };
    uiComponents.set("comp-1", comp);
    expect(getUiComponents()).toEqual([comp]);
  });
});
