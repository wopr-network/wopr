import { z } from "zod";
import { registerA2ATool, unregisterA2ATool } from "../../../src/core/a2a-mcp.js";
import {
  discoverSkills,
  enableSkillAsync,
  disableSkillAsync,
  getSkillByName,
  readAllSkillStatesAsync,
} from "./skills.js";

const TOOL_NAMES = ["skills.list", "skills.enable", "skills.disable", "skills.info"] as const;

export function registerSkillsA2ATools(): void {
  registerA2ATool({
    name: "skills.list",
    description: "List all discovered skills and their enabled/disabled state",
    schema: z.object({
      source: z.string().optional().describe("Filter by source: managed, workspace, bundled, extra"),
    }),
    handler: async (args) => {
      const { skills, warnings } = discoverSkills();
      const states = await readAllSkillStatesAsync();
      const source = args.source as string | undefined;
      const filtered = source ? skills.filter((s) => s.source === source) : skills;
      return {
        skills: filtered.map((s) => ({
          name: s.name,
          description: s.description,
          source: s.source,
          enabled: states[s.name]?.enabled !== false,
        })),
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    },
  });

  registerA2ATool({
    name: "skills.enable",
    description: "Enable a skill by name",
    schema: z.object({
      name: z.string().describe("Skill name to enable"),
    }),
    handler: async (args) => {
      const found = await enableSkillAsync(args.name as string);
      return found ? { enabled: true, name: args.name } : { error: "Skill not found" };
    },
  });

  registerA2ATool({
    name: "skills.disable",
    description: "Disable a skill by name",
    schema: z.object({
      name: z.string().describe("Skill name to disable"),
    }),
    handler: async (args) => {
      const found = await disableSkillAsync(args.name as string);
      return found ? { disabled: true, name: args.name } : { error: "Skill not found" };
    },
  });

  registerA2ATool({
    name: "skills.info",
    description: "Get detailed info about a specific skill",
    schema: z.object({
      name: z.string().describe("Skill name to look up"),
    }),
    handler: async (args) => {
      const skill = getSkillByName(args.name as string);
      if (!skill) return { error: "Skill not found" };
      const states = await readAllSkillStatesAsync();
      return {
        name: skill.name,
        description: skill.description,
        source: skill.source,
        path: skill.path,
        baseDir: skill.baseDir,
        enabled: states[skill.name]?.enabled !== false,
        metadata: skill.metadata ?? null,
        allowedTools: skill.allowedTools ?? null,
        commandDispatch: skill.commandDispatch ?? null,
      };
    },
  });
}

export function unregisterSkillsA2ATools(): void {
  for (const name of TOOL_NAMES) {
    unregisterA2ATool(name);
  }
}
