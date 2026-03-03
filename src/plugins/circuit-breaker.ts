import { logger } from "../logger.js";

interface CircuitBreakerState {
  consecutiveErrors: number;
  tripped: boolean;
  lastError?: Error;
  trippedAt?: number;
}

export class CircuitBreaker {
  private readonly states = new Map<string, CircuitBreakerState>();
  private readonly threshold: number;

  constructor(threshold = 5) {
    this.threshold = threshold;
  }

  isTripped(pluginName: string): boolean {
    return this.states.get(pluginName)?.tripped ?? false;
  }

  recordError(pluginName: string, error: Error): void {
    const state = this.states.get(pluginName) ?? { consecutiveErrors: 0, tripped: false };
    state.consecutiveErrors++;
    state.lastError = error;

    if (state.consecutiveErrors >= this.threshold && !state.tripped) {
      state.tripped = true;
      state.trippedAt = Date.now();
      logger.warn(
        `[plugins] Circuit breaker tripped for ${pluginName} after ${this.threshold} consecutive errors. ` +
          `Plugin hooks will be skipped. Last error: ${error.message}`,
      );
    }

    this.states.set(pluginName, state);
  }

  recordSuccess(pluginName: string): void {
    const state = this.states.get(pluginName);
    if (state) {
      state.consecutiveErrors = 0;
      // Do NOT reset tripped — once tripped, stays tripped until clear()
    }
  }

  clear(pluginName: string): void {
    this.states.delete(pluginName);
  }
}

/** Singleton circuit breaker for plugin handlers */
export const pluginCircuitBreaker = new CircuitBreaker(5);
