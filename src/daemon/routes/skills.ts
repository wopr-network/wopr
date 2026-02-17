/**
 * Skills API routes
 */

import { Hono } from "hono";
import { addRegistry, getRegistries, removeRegistry, searchAllRegistries } from "../../core/registries.js";
import {
  clearSkillCache,
  createSkill,
  disableSkillAsync,
  discoverSkills,
  enableSkillAsync,
  installSkillFromGitHub,
  installSkillFromUrl,
  readAllSkillStatesAsync,
  removeSkill,
} from "../../core/skills.js";

export const skillsRouter = new Hono();

// List installed skills
skillsRouter.get("/", async (c) => {
  const { skills, warnings } = discoverSkills();
  const skillStates = await readAllSkillStatesAsync();
  return c.json({
    skills: skills.map((s) => ({
      name: s.name,
      description: s.description,
      source: s.source,
      enabled: skillStates[s.name]?.enabled !== false,
      category: s.metadata?.emoji ? "custom" : "general",
      version: null,
      metadata: s.metadata ?? null,
    })),
    warnings: warnings.length > 0 ? warnings : undefined,
  });
});

// Search registries for available skills
skillsRouter.get("/available", async (c) => {
  const query = c.req.query("q") || "";
  const results = await searchAllRegistries(query);
  return c.json({
    skills: results.map((r) => ({
      name: r.skill.name,
      description: r.skill.description,
      source: r.skill.source,
      version: r.skill.version ?? null,
      registry: r.registry,
    })),
  });
});

// Create a new skill
skillsRouter.post("/", async (c) => {
  const body = await c.req.json();
  const { name, description } = body;

  if (!name) {
    return c.json({ error: "name is required" }, 400);
  }

  try {
    const skill = createSkill(name, description);
    return c.json({ created: true, skill }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

// Install skill from source
skillsRouter.post("/install", async (c) => {
  const body = await c.req.json();
  const { source, name } = body;

  if (!source) {
    return c.json({ error: "source is required" }, 400);
  }

  try {
    let skill: ReturnType<typeof installSkillFromGitHub> | ReturnType<typeof installSkillFromUrl>;
    if (source.startsWith("github:")) {
      const parts = source.replace("github:", "").split("/");
      const [owner, repo, ...pathParts] = parts;
      const skillPath = pathParts.join("/");
      skill = installSkillFromGitHub(owner, repo, skillPath, name);
    } else {
      skill = installSkillFromUrl(source, name);
    }
    return c.json({ installed: true, skill }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

// Uninstall skill (POST-based)
skillsRouter.post("/uninstall", async (c) => {
  const body = await c.req.json();
  const { name } = body;

  if (!name) {
    return c.json({ error: "name is required" }, 400);
  }

  try {
    removeSkill(name);
    return c.json({ removed: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

// Remove skill (DELETE-based, kept for backward compatibility)
skillsRouter.delete("/:name", (c) => {
  const name = c.req.param("name");

  try {
    removeSkill(name);
    return c.json({ removed: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

// Enable a skill
skillsRouter.post("/:name/enable", async (c) => {
  const name = c.req.param("name");
  try {
    const found = await enableSkillAsync(name);

    if (!found) {
      return c.json({ error: "Skill not found" }, 404);
    }

    return c.json({ enabled: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

// Disable a skill
skillsRouter.post("/:name/disable", async (c) => {
  const name = c.req.param("name");
  try {
    const found = await disableSkillAsync(name);

    if (!found) {
      return c.json({ error: "Skill not found" }, 404);
    }

    return c.json({ disabled: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

// Search registries for skills (with required query)
skillsRouter.get("/search", async (c) => {
  const query = c.req.query("q");

  if (!query) {
    return c.json({ error: "Query parameter 'q' is required" }, 400);
  }

  const results = await searchAllRegistries(query);
  return c.json({ results });
});

// Clear skill cache
skillsRouter.post("/cache/clear", (c) => {
  clearSkillCache();
  return c.json({ cleared: true });
});

// Skill registries
skillsRouter.get("/registries", (c) => {
  const registries = getRegistries();
  return c.json({ registries });
});

skillsRouter.post("/registries", async (c) => {
  const body = await c.req.json();
  const { name, url } = body;

  if (!name || !url) {
    return c.json({ error: "name and url are required" }, 400);
  }

  addRegistry(name, url);
  return c.json({ added: true, name, url }, 201);
});

skillsRouter.delete("/registries/:name", (c) => {
  const name = c.req.param("name");
  const removed = removeRegistry(name);

  if (!removed) {
    return c.json({ error: "Registry not found" }, 404);
  }

  return c.json({ removed: true });
});
