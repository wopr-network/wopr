/**
 * Capability Health REST API
 *
 * Endpoints for querying capability provider health status.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { getCapabilityHealthProber } from "../../core/capability-health.js";
import { getCapabilityRegistry } from "../../core/capability-registry.js";

export const capabilityHealthRouter = new Hono();

// GET / — full capability health snapshot
capabilityHealthRouter.get(
  "/",
  describeRoute({
    tags: ["Capabilities"],
    summary: "Full capability health snapshot",
    responses: {
      200: { description: "All capabilities healthy" },
      503: { description: "One or more capabilities unhealthy" },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const prober = getCapabilityHealthProber();
    const snapshot = prober.getSnapshot();
    const statusCode = snapshot.overallHealthy ? 200 : 503;
    return c.json(snapshot, statusCode);
  },
);

// POST /check — trigger an immediate probe run
capabilityHealthRouter.post(
  "/check",
  describeRoute({
    tags: ["Capabilities"],
    summary: "Trigger immediate health probe",
    responses: {
      200: { description: "All capabilities healthy after probe" },
      503: { description: "One or more capabilities unhealthy after probe" },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const prober = getCapabilityHealthProber();
    const snapshot = await prober.check();
    const statusCode = snapshot.overallHealthy ? 200 : 503;
    return c.json(snapshot, statusCode);
  },
);

// GET /:capability — health for a specific capability
capabilityHealthRouter.get(
  "/:capability",
  describeRoute({
    tags: ["Capabilities"],
    summary: "Get health for a specific capability",
    responses: {
      200: { description: "Capability is healthy" },
      404: { description: "Unknown capability" },
      503: { description: "Capability is unhealthy" },
      401: { description: "Unauthorized" },
    },
  }),
  (c) => {
    const capability = c.req.param("capability");
    // Validate capability type against registry
    const registry = getCapabilityRegistry();
    const knownCapabilities = registry.listCapabilities().map((cap) => cap.capability);
    if (!knownCapabilities.includes(capability)) {
      return c.json({ error: "Unknown capability type" }, 404);
    }
    const prober = getCapabilityHealthProber();
    const health = prober.getCapabilityHealth(capability);
    if (!health) {
      return c.json({ error: "Capability not found" }, 404);
    }
    return c.json(health, health.healthy ? 200 : 503);
  },
);

// GET /:capability/:providerId — health for a specific provider
capabilityHealthRouter.get(
  "/:capability/:providerId",
  describeRoute({
    tags: ["Capabilities"],
    summary: "Get health for a specific capability provider",
    responses: {
      200: { description: "Provider is healthy" },
      404: { description: "Unknown capability or provider" },
      503: { description: "Provider is unhealthy" },
      401: { description: "Unauthorized" },
    },
  }),
  (c) => {
    const capability = c.req.param("capability");
    const providerId = c.req.param("providerId");
    // Validate capability type against registry
    const registry = getCapabilityRegistry();
    const knownCapabilities = registry.listCapabilities().map((cap) => cap.capability);
    if (!knownCapabilities.includes(capability)) {
      return c.json({ error: "Unknown capability type" }, 404);
    }
    const prober = getCapabilityHealthProber();
    const health = prober.getProviderHealth(capability, providerId);
    if (!health) {
      return c.json({ error: "Provider not found" }, 404);
    }
    return c.json(health, health.healthy ? 200 : 503);
  },
);
