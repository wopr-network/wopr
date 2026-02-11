/**
 * Plugin-scoped hook manager factory.
 *
 * Creates a hook manager that provides typed, mutable access to core
 * lifecycle events with priority ordering (lower = runs first).
 */

import { eventBus } from "../core/events.js";
import type { HookOptions, MutableHookEvent, WOPRHookManager } from "../types.js";

/**
 * Hook registration entry with metadata
 */
interface HookEntry {
  handler: (...args: any[]) => any;
  priority: number;
  name?: string;
  once: boolean;
  unsubscribe: () => void;
}

/**
 * Create a hook manager scoped to a plugin.
 * Hooks provide typed, mutable access to core lifecycle events
 * with priority ordering (lower = runs first).
 */
export function createPluginHookManager(_pluginName: string): WOPRHookManager {
  // Map of event -> array of hook entries (sorted by priority)
  const hookEntries = new Map<string, HookEntry[]>();

  // One bus subscription per event (prevents N*N handler calls)
  const busSubscriptions = new Map<string, () => void>();

  // Mutable events that can transform data or block
  const mutableEvents = new Set(["message:incoming", "message:outgoing", "channel:message"]);

  // Map hook event names to underlying event bus events
  const eventMapping: Record<string, string> = {
    "message:incoming": "session:beforeInject",
    "message:outgoing": "session:afterInject",
  };

  function getEntries(event: string): HookEntry[] {
    if (!hookEntries.has(event)) {
      hookEntries.set(event, []);
    }
    return hookEntries.get(event)!;
  }

  function insertSorted(entries: HookEntry[], entry: HookEntry): void {
    // Insert in priority order (lower = first)
    const idx = entries.findIndex((e) => e.priority > entry.priority);
    if (idx === -1) {
      entries.push(entry);
    } else {
      entries.splice(idx, 0, entry);
    }
  }

  /** Ensure exactly one event bus listener exists for this hook event */
  function ensureBusSubscription(event: string): void {
    if (busSubscriptions.has(event)) return;

    const busEvent = eventMapping[event] || event;
    const isMutable = mutableEvents.has(event);

    const unsubscribe = eventBus.on(busEvent as any, async (payload, _evt) => {
      const entries = getEntries(event);

      if (isMutable) {
        let prevented = false;
        const mutableEvent: MutableHookEvent<any> = {
          data: payload,
          session: payload.session || "default",
          preventDefault() {
            prevented = true;
            if (payload && typeof payload === "object") {
              (payload as any)._prevented = true;
            }
          },
          isPrevented() {
            return prevented;
          },
        };

        for (const entry of [...entries]) {
          await entry.handler(mutableEvent);

          if (entry.once) {
            const idx = entries.indexOf(entry);
            if (idx !== -1) entries.splice(idx, 1);
          }

          if (mutableEvent.isPrevented()) break;
        }
      } else {
        for (const entry of [...entries]) {
          await entry.handler(payload);

          if (entry.once) {
            const idx = entries.indexOf(entry);
            if (idx !== -1) entries.splice(idx, 1);
          }
        }
      }

      // If all entries removed, clean up bus subscription
      if (entries.length === 0) {
        unsubscribe();
        busSubscriptions.delete(event);
      }
    });

    busSubscriptions.set(event, unsubscribe);
  }

  return {
    on(event: string, handler: (...args: any[]) => any, options?: HookOptions): () => void {
      const priority = options?.priority ?? 100;
      const name = options?.name;
      const once = options?.once ?? false;

      const entry: HookEntry = {
        handler,
        priority,
        name,
        once,
        unsubscribe: () => {}, // placeholder, removal handled below
      };

      const entries = getEntries(event);
      insertSorted(entries, entry);

      // Subscribe to event bus (only once per event)
      ensureBusSubscription(event);

      return () => {
        const entries = getEntries(event);
        const idx = entries.indexOf(entry);
        if (idx !== -1) entries.splice(idx, 1);

        // If no entries left, unsubscribe from bus
        if (entries.length === 0) {
          busSubscriptions.get(event)?.();
          busSubscriptions.delete(event);
        }
      };
    },

    off(event: string, handler: (...args: any[]) => any): void {
      const entries = getEntries(event);
      const idx = entries.findIndex((e) => e.handler === handler);
      if (idx !== -1) {
        entries.splice(idx, 1);
      }
      // If no entries left, unsubscribe from bus
      if (entries.length === 0) {
        busSubscriptions.get(event)?.();
        busSubscriptions.delete(event);
      }
    },

    offByName(name: string): void {
      for (const [event, entries] of hookEntries) {
        const toRemove = entries.filter((e) => e.name === name);
        for (const entry of toRemove) {
          const idx = entries.indexOf(entry);
          if (idx !== -1) entries.splice(idx, 1);
        }
        // If no entries left, unsubscribe from bus
        if (entries.length === 0) {
          busSubscriptions.get(event)?.();
          busSubscriptions.delete(event);
        }
      }
    },

    list(): Array<{ event: string; name?: string; priority: number }> {
      const result: Array<{ event: string; name?: string; priority: number }> = [];
      for (const [event, entries] of hookEntries) {
        for (const entry of entries) {
          result.push({
            event,
            name: entry.name,
            priority: entry.priority,
          });
        }
      }
      return result.sort((a, b) => a.priority - b.priority);
    },
  } as WOPRHookManager;
}
