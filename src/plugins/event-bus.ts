/**
 * Plugin-scoped event bus factory.
 *
 * Creates an event bus instance scoped to a plugin, wrapping the core
 * event bus with plugin source metadata.
 */

import { eventBus } from "../core/events.js";
import type { EventHandler, WOPREventBus } from "../types.js";

/**
 * Create an event bus instance scoped to a plugin
 */
export function createPluginEventBus(pluginName: string): WOPREventBus {
  // Track original -> wrapped handler mapping so off() can find the right listener
  const handlerMap = new Map<EventHandler<unknown>, EventHandler<unknown>>();

  return {
    on<T extends keyof import("../types.js").WOPREventMap>(
      event: T,
      handler: EventHandler<import("../types.js").WOPREventMap[T]>,
    ): () => void {
      // Wrap handler to identify plugin source
      const wrappedHandler: EventHandler<import("../types.js").WOPREventMap[T]> = async (payload, evt) => {
        // Add plugin source to event metadata
        const eventWithSource = { ...evt, source: pluginName };
        await handler(payload, eventWithSource);
      };

      handlerMap.set(handler as EventHandler<unknown>, wrappedHandler as EventHandler<unknown>);
      return eventBus.on(event, wrappedHandler);
    },

    once<T extends keyof import("../types.js").WOPREventMap>(
      event: T,
      handler: EventHandler<import("../types.js").WOPREventMap[T]>,
    ): void {
      const wrappedHandler: EventHandler<import("../types.js").WOPREventMap[T]> = async (payload, evt) => {
        const eventWithSource = { ...evt, source: pluginName };
        await handler(payload, eventWithSource);
      };
      handlerMap.set(handler as EventHandler<unknown>, wrappedHandler as EventHandler<unknown>);
      eventBus.once(event, wrappedHandler);
    },

    off<T extends keyof import("../types.js").WOPREventMap>(
      event: T,
      handler: EventHandler<import("../types.js").WOPREventMap[T]>,
    ): void {
      const wrapped = handlerMap.get(handler as EventHandler<unknown>);
      if (wrapped) {
        eventBus.off(event, wrapped as EventHandler<import("../types.js").WOPREventMap[T]>);
        handlerMap.delete(handler as EventHandler<unknown>);
      }
    },

    async emit(event: string, payload: unknown): Promise<void> {
      await eventBus.emit(
        event as keyof import("../types.js").WOPREventMap,
        payload as import("../types.js").WOPREventMap[keyof import("../types.js").WOPREventMap],
        pluginName,
      );
    },

    async emitCustom(event: string, payload: unknown): Promise<void> {
      await eventBus.emitCustom(event, payload, pluginName);
    },

    listenerCount(event: string): number {
      return eventBus.listenerCount(event);
    },
  };
}
