/**
 * Config API routes
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { config } from "../../core/config.js";
import { redactSensitive } from "../../security/redact.js";

export const configRouter = new Hono();

// GET /config - Get all config
configRouter.get(
  "/",
  describeRoute({
    tags: ["Config"],
    summary: "Get all daemon configuration",
    responses: {
      200: { description: "Full configuration object (sensitive values redacted)" },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    await config.load();
    return c.json(redactSensitive(config.get()));
  },
);

// GET /config/:key - Get specific config value
configRouter.get(
  "/:key",
  describeRoute({
    tags: ["Config"],
    summary: "Get a specific config value",
    responses: {
      200: { description: "Config key and value" },
      404: { description: "Config key not found" },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    await config.load();
    const key = c.req.param("key");
    const value = config.getValue(key);

    if (value === undefined) {
      return c.json({ error: `Config key "${key}" not found` }, 404);
    }

    return c.json({ key, value: redactSensitive(value, key) });
  },
);

// PUT /config/:key - Set config value
configRouter.put(
  "/:key",
  describeRoute({
    tags: ["Config"],
    summary: "Set a config value",
    responses: {
      200: { description: "Updated config value" },
      400: { description: "Missing value" },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    await config.load();
    const key = c.req.param("key");
    const { value } = await c.req.json();

    if (value === undefined) {
      return c.json({ error: "Missing value in request body" }, 400);
    }

    config.setValue(key, value);
    await config.save();

    return c.json({ key, value: redactSensitive(value, key) });
  },
);

// DELETE /config - Reset to defaults
configRouter.delete(
  "/",
  describeRoute({
    tags: ["Config"],
    summary: "Reset config to defaults",
    responses: {
      200: { description: "Config reset successfully" },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    config.reset();
    await config.save();
    return c.json({ message: "Config reset to defaults" });
  },
);
