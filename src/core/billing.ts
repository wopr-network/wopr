/**
 * Generic capability billing system
 *
 * The Socket: universal billing wrapper for any hosted capability.
 * Applies one multiplier, emits meter events for downstream billing.
 */

import { config } from "./config.js";
import { eventBus } from "./events.js";

/** Default multiplier if none configured (30% margin) */
const DEFAULT_MULTIPLIER = 1.3;

/**
 * The Socket: universal billing wrapper.
 *
 * Wraps any hosted provider call. Applies one multiplier.
 * Emits meter:usage for downstream billing (Stripe, dashboards, etc.).
 *
 * BYOK calls skip this entirely — cost is 0, user pays provider directly.
 *
 * @param response Provider response with result and optional cost
 * @param ctx Billing context (tenant, capability, provider, source)
 * @returns The result from the provider response
 */
export async function withMargin<T>(
  response: { result: T; cost?: number },
  ctx: {
    /** User or organization ID */
    tenant: string;
    /** Capability type (e.g., "tts", "stt", "text-gen", "image-gen", "embeddings") */
    capability: string;
    /** Provider ID (e.g., "replicate", "modal", "elevenlabs") */
    provider: string;
    /** Provider source type */
    source: "byok" | "hosted";
    /** Additional metadata (model, tokens, etc.) */
    metadata?: Record<string, unknown>;
  },
): Promise<T> {
  // Check if billing is disabled
  const woprConfig = config.get();
  if (woprConfig.billing?.enabled === false) {
    return response.result;
  }

  // BYOK: no metering, return result directly
  if (ctx.source === "byok" || !response.cost || response.cost <= 0) {
    return response.result;
  }

  // Hosted: apply multiplier and emit meter event
  const multiplier = getMultiplier();
  const charge = response.cost * multiplier;

  await eventBus.emit("meter:usage", {
    tenant: ctx.tenant,
    capability: ctx.capability,
    provider: ctx.provider,
    cost: charge, // What we charge the user (cost * multiplier)
    timestamp: Date.now(),
    // Billing fields override caller metadata to prevent tampering
    metadata: {
      ...ctx.metadata,
      upstreamCost: response.cost, // What it cost us
      multiplier,
    },
  });

  return response.result;
}

/**
 * Get the universal multiplier from config.
 * One number. Not per-capability, not per-provider.
 * Tier discounts / volume pricing is Stripe's job.
 *
 * @returns The configured multiplier or default (1.3)
 */
function getMultiplier(): number {
  const woprConfig = config.get();
  const configured = woprConfig.billing?.multiplier;
  if (typeof configured === "number" && configured > 0) {
    return configured;
  }
  return DEFAULT_MULTIPLIER;
}
