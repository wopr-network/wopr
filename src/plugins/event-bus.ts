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
  const handlerMap = new Map<EventHandler<any>, EventHandler<any>>();

  return {
    on<T extends keyof import("../types.js").WOPREventMap>(
      event: T,
      handler: EventHandler<import("../types.js").WOPREventMap[T]>,
    ): () => void {
      // Wrap handler to identify plugin source
      const wrappedHandler: EventHandler<any> = async (payload, evt) => {
        // Add plugin source to event metadata
        const eventWithSource = { ...evt, source: pluginName };
        await handler(payload, eventWithSource);
      };

      handlerMap.set(handler, wrappedHandler);
      return eventBus.on(event, wrappedHandler);
    },

    once<T extends keyof import("../types.js").WOPREventMap>(
      event: T,
      handler: EventHandler<import("../types.js").WOPREventMap[T]>,
    ): void {
      const wrappedHandler: EventHandler<any> = async (payload, evt) => {
        const eventWithSource = { ...evt, source: pluginName };
        await handler(payload, eventWithSource);
      };
      handlerMap.set(handler, wrappedHandler);
      eventBus.once(event, wrappedHandler);
    },

    off<T extends keyof import("../types.js").WOPREventMap>(
      event: T,
      handler: EventHandler<import("../types.js").WOPREventMap[T]>,
    ): void {
      const wrapped = handlerMap.get(handler);
      if (wrapped) {
        eventBus.off(event, wrapped as EventHandler<import("../types.js").WOPREventMap[T]>);
        handlerMap.delete(handler);
      }
    },

    async emit(event: string, payload: any): Promise<void> {
      await eventBus.emit(event as any, payload, pluginName);
    },

    async emitCustom(event: string, payload: any): Promise<void> {
      await eventBus.emitCustom(event, payload, pluginName);
    },

    listenerCount(event: string): number {
      return eventBus.listenerCount(event);
    },
  };
}
