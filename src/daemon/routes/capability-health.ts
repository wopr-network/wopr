/**
 * Capability Health REST API
 *
 * Endpoints for querying capability provider health status.
 */

import { Hono } from "hono";
import { getCapabilityHealthProber } from "../../core/capability-health.js";
import { getCapabilityRegistry } from "../../core/capability-registry.js";

export const capabilityHealthRouter = new Hono();

// GET / — full capability health snapshot
capabilityHealthRouter.get("/", async (c) => {
  const prober = getCapabilityHealthProber();
  const snapshot = prober.getSnapshot();
  const statusCode = snapshot.overallHealthy ? 200 : 503;
  return c.json(snapshot, statusCode);
});

// POST /check — trigger an immediate probe run
capabilityHealthRouter.post("/check", async (c) => {
  const prober = getCapabilityHealthProber();
  const snapshot = await prober.check();
  const statusCode = snapshot.overallHealthy ? 200 : 503;
  return c.json(snapshot, statusCode);
});

// GET /:capability — health for a specific capability
capabilityHealthRouter.get("/:capability", (c) => {
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
});

// GET /:capability/:providerId — health for a specific provider
capabilityHealthRouter.get("/:capability/:providerId", (c) => {
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
});
