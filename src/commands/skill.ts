/**
 * `wopr skill` commands - skill management.
 */
import { join } from "node:path";
import { logger } from "../logger.js";
import { SKILLS_DIR } from "../paths.js";
import { help } from "./help.js";
import { client, requireDaemon } from "./shared.js";

export async function skillCommand(subcommand: string | undefined, args: string[]): Promise<void> {
  await requireDaemon();
  if (subcommand === "registry") {
    const registryCmd = args[0];
    switch (registryCmd) {
      case "list": {
        const registries = await client.getSkillRegistries();
        if (registries.length === 0) {
          logger.info("No registries. Add: wopr skill registry add <name> <url>");
        } else {
          logger.info("Registries:");
          for (const r of registries) logger.info(`  ${r.name}: ${r.url}`);
        }
        break;
      }
      case "add":
        if (!args[1] || !args[2]) {
          logger.error("Usage: wopr skill registry add <name> <url>");
          process.exit(1);
        }
        await client.addSkillRegistry(args[1], args[2]);
        logger.info(`Added registry: ${args[1]}`);
        break;
      case "remove":
        if (!args[1]) {
          logger.error("Usage: wopr skill registry remove <name>");
          process.exit(1);
        }
        await client.removeSkillRegistry(args[1]);
        logger.info(`Removed registry: ${args[1]}`);
        break;
      default:
        help();
    }
  } else {
    switch (subcommand) {
      case "list": {
        const skills = (await client.getSkills()) as { name: string; description: string }[];
        if (skills.length === 0) {
          logger.info(`No skills. Add to ${SKILLS_DIR}/<name>/SKILL.md`);
        } else {
          logger.info("Skills:");
          for (const s of skills) logger.info(`  ${s.name} - ${s.description}`);
        }
        break;
      }
      case "search": {
        if (!args[0]) {
          logger.error("Usage: wopr skill search <query>");
          process.exit(1);
        }
        const results = (await client.searchSkills(args.join(" "))) as {
          skill: { name: string; description?: string; source: string };
          registry: string;
        }[];
        if (results.length === 0) {
          logger.info(`No skills found matching "${args.join(" ")}"`);
        } else {
          logger.info(`Found ${results.length} skill(s):`);
          for (const result of results) {
            logger.info(`  ${result.skill.name} (${result.registry})`);
            logger.info(`    ${result.skill.description || "No description"}`);
            logger.info(`    wopr skill install ${result.skill.source}`);
          }
        }
        break;
      }
      case "install": {
        if (!args[0]) {
          logger.error("Usage: wopr skill install <source> [name]");
          process.exit(1);
        }
        logger.info(`Installing...`);
        await client.installSkill(args[0], args[1]);
        logger.info(`Installed: ${args[1] || args[0]}`);
        break;
      }
      case "create": {
        if (!args[0]) {
          logger.error("Usage: wopr skill create <name> [description]");
          process.exit(1);
        }
        await client.createSkill(args[0], args.slice(1).join(" ") || undefined);
        logger.info(`Created: ${join(SKILLS_DIR, args[0], "SKILL.md")}`);
        break;
      }
      case "remove": {
        if (!args[0]) {
          logger.error("Usage: wopr skill remove <name>");
          process.exit(1);
        }
        await client.removeSkill(args[0]);
        logger.info(`Removed: ${args[0]}`);
        break;
      }
      case "cache":
        if (args[0] === "clear") {
          await client.clearSkillCache();
          logger.info("Cache cleared");
        }
        break;
      default:
        help();
    }
  }
}
