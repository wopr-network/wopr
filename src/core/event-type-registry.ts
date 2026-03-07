/**
 * EventTypeRegistry — runtime registration of event types.
 * Plugins register their own event types at init time via WOPRPluginContext;
 * core event types are seeded as immutable defaults.
 *
 * Follows the same singleton pattern as SecurityRegistry.
 */

export interface EventTypeRegistration {
  schema?: unknown;
  description?: string;
  /**
   * When true, handlers for this event run sequentially (one at a time) so that
   * payload mutations made by one handler are visible to the next. Use this for
   * events where handler order and mutation visibility matter (e.g. file-index
   * rebuild events). Defaults to false (concurrent execution).
   */
  sequential?: boolean;
}

interface PluginEventType {
  readonly registration: Readonly<EventTypeRegistration>;
  readonly pluginName: string;
}

/** Core event types — always present, cannot be unregistered */
const CORE_EVENT_TYPES = new Set([
  "session:create",
  "session:beforeInject",
  "session:afterInject",
  "session:responseChunk",
  "session:destroy",
  "channel:message",
  "channel:send",
  "plugin:beforeInit",
  "plugin:afterInit",
  "plugin:error",
  "plugin:draining",
  "plugin:drained",
  "plugin:activated",
  "plugin:deactivated",
  "config:change",
  "system:shutdown",
  "system:restartScheduled",
  "capability:providerHealthChange",
  "capability:providerRegistered",
  "capability:providerUnregistered",
  "provider:added",
  "provider:removed",
  "provider:status",
]);

export class EventTypeRegistry {
  private pluginEventTypes = new Map<string, PluginEventType>();

  registerEventType(name: string, registration: EventTypeRegistration, pluginName: string): void {
    if (CORE_EVENT_TYPES.has(name)) {
      throw new Error(`"${name}" is a core event type and cannot be registered by plugins.`);
    }
    const existing = this.pluginEventTypes.get(name);
    if (existing && existing.pluginName !== pluginName) {
      throw new Error(
        `Event type "${name}" is already registered by plugin "${existing.pluginName}". Cannot re-register with "${pluginName}".`,
      );
    }
    this.pluginEventTypes.set(name, { registration: { ...registration }, pluginName });
  }

  unregisterEventType(name: string, pluginName: string): void {
    if (CORE_EVENT_TYPES.has(name)) return;
    if (this.pluginEventTypes.get(name)?.pluginName === pluginName) {
      this.pluginEventTypes.delete(name);
    }
  }

  unregisterAllForPlugin(pluginName: string): void {
    for (const [name, reg] of this.pluginEventTypes) {
      if (reg.pluginName === pluginName) {
        this.pluginEventTypes.delete(name);
      }
    }
  }

  isRegistered(name: string): boolean {
    return CORE_EVENT_TYPES.has(name) || this.pluginEventTypes.has(name);
  }

  isSequential(name: string): boolean {
    return this.pluginEventTypes.get(name)?.registration.sequential === true;
  }

  getRegistration(name: string): EventTypeRegistration | undefined {
    const reg = this.pluginEventTypes.get(name)?.registration;
    return reg ? { ...reg } : undefined;
  }

  getAllEventTypes(): string[] {
    return [...CORE_EVENT_TYPES, ...this.pluginEventTypes.keys()];
  }

  getPluginEventTypes(): ReadonlyMap<string, PluginEventType> {
    return new Map(
      [...this.pluginEventTypes].map(([name, value]) => [
        name,
        { pluginName: value.pluginName, registration: { ...value.registration } },
      ]),
    );
  }
}

let instance: EventTypeRegistry | null = null;

export function getEventTypeRegistry(): EventTypeRegistry {
  if (!instance) {
    instance = new EventTypeRegistry();
  }
  return instance;
}

export function resetEventTypeRegistry(): void {
  instance = null;
}
