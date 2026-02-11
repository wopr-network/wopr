/**
 * Public read-only accessors for plugin runtime state.
 *
 * These are convenience functions used by core modules that need
 * to query plugin-managed registries (channels, context providers, UI).
 */

import type { ChannelAdapter, ChannelRef, ContextProvider, UiComponentExtension, WebUiExtension } from "../types.js";
import { channelAdapters, channelKey, contextProviders, uiComponents, webUiExtensions } from "./state.js";

export function getContextProvider(session: string): ContextProvider | undefined {
  return contextProviders.get(session);
}

export function getChannel(channel: ChannelRef): ChannelAdapter | undefined {
  return channelAdapters.get(channelKey(channel));
}

export function getChannels(): ChannelAdapter[] {
  return Array.from(channelAdapters.values());
}

export function getChannelsForSession(session: string): ChannelAdapter[] {
  return Array.from(channelAdapters.values()).filter((adapter) => adapter.session === session);
}

export function getWebUiExtensions(): WebUiExtension[] {
  return Array.from(webUiExtensions.values());
}

export function getUiComponents(): UiComponentExtension[] {
  return Array.from(uiComponents.values());
}
