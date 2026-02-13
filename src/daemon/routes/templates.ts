/**
 * Templates API routes (WOP-200)
 *
 * Provides CRUD for instance templates:
 * - GET  /         — List all templates (built-in + custom)
 * - GET  /:name    — Get a single template by name
 * - POST /         — Create a custom template
 * - DELETE /:name  — Delete a custom template (built-in cannot be deleted)
 */

import { Hono } from "hono";
import { applyTemplate } from "../../platform/template-engine.js";
import type { InstanceTemplate } from "../../platform/templates.js";
import {
  createCustomTemplate,
  deleteCustomTemplate,
  getTemplate,
  isBuiltinTemplate,
  listTemplates,
} from "../../platform/templates.js";

export const templatesRouter = new Hono();

// List all templates
templatesRouter.get("/", (c) => {
  const templates = listTemplates();
  return c.json({
    templates: templates.map((t) => ({
      name: t.name,
      description: t.description,
      plugins: t.plugins,
      providers: t.providers,
      tags: t.tags,
      builtin: isBuiltinTemplate(t.name),
    })),
  });
});

// Get template by name
templatesRouter.get("/:name", (c) => {
  const name = c.req.param("name");
  const template = getTemplate(name);

  if (!template) {
    return c.json({ error: `Template "${name}" not found` }, 404);
  }

  return c.json({
    ...template,
    builtin: isBuiltinTemplate(template.name),
  });
});

// Create custom template
templatesRouter.post("/", async (c) => {
  const body = await c.req.json();
  const { name, description, plugins, providers, config, tags } = body as Partial<InstanceTemplate>;

  if (!name || typeof name !== "string") {
    return c.json({ error: "name is required and must be a string" }, 400);
  }

  if (!description || typeof description !== "string") {
    return c.json({ error: "description is required and must be a string" }, 400);
  }

  if (!Array.isArray(plugins)) {
    return c.json({ error: "plugins must be an array" }, 400);
  }

  if (!Array.isArray(providers)) {
    return c.json({ error: "providers must be an array" }, 400);
  }

  if (!Array.isArray(tags)) {
    return c.json({ error: "tags must be an array" }, 400);
  }

  const template: InstanceTemplate = {
    name,
    description,
    plugins,
    providers,
    config: config && typeof config === "object" && !Array.isArray(config) ? config : {},
    tags,
  };

  try {
    createCustomTemplate(template);
    return c.json({ created: true, template }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

// Apply template to an instance
templatesRouter.post("/:name/apply", async (c) => {
  const name = c.req.param("name");
  const body = await c.req.json();
  const { instanceId } = body;

  if (!instanceId || typeof instanceId !== "string") {
    return c.json({ error: "instanceId is required and must be a string" }, 400);
  }

  try {
    const result = applyTemplate(instanceId, name);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 404);
  }
});

// Delete custom template
templatesRouter.delete("/:name", (c) => {
  const name = c.req.param("name");

  try {
    const deleted = deleteCustomTemplate(name);
    if (!deleted) {
      return c.json({ error: `Template "${name}" not found` }, 404);
    }
    return c.json({ deleted: true, name });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});
