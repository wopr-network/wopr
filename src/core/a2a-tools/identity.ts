/**
 * Identity tools: identity_get, identity_update (WOP-556: SQL-backed)
 */

import { getSessionContext, initSessionContextStorage, setSessionContext } from "../session-context-repository.js";
import { tool, withSecurityCheck, z } from "./_base.js";

export function createIdentityTools(sessionName: string): unknown[] {
  const tools: unknown[] = [];

  tools.push(
    tool(
      "identity_get",
      "Get current identity from IDENTITY.md. Checks session-specific first, then global.",
      {},
      async () => {
        await initSessionContextStorage();

        // Try session-specific first
        let content = await getSessionContext(sessionName, "IDENTITY.md");
        let isGlobal = false;

        // Fall back to global
        if (content === null) {
          content = await getSessionContext("__global__", "IDENTITY.md");
          isGlobal = content !== null;
        }

        if (content === null) {
          return { content: [{ type: "text", text: "No IDENTITY.md found." }] };
        }

        const identity: Record<string, string> = {};
        const nameMatch = content.match(/[-*]\s*Name:\s*(.+)/i);
        const creatureMatch = content.match(/[-*]\s*Creature:\s*(.+)/i);
        const vibeMatch = content.match(/[-*]\s*Vibe:\s*(.+)/i);
        const emojiMatch = content.match(/[-*]\s*Emoji:\s*(.+)/i);
        if (nameMatch) identity.name = nameMatch[1].trim();
        if (creatureMatch) identity.creature = creatureMatch[1].trim();
        if (vibeMatch) identity.vibe = vibeMatch[1].trim();
        if (emojiMatch) identity.emoji = emojiMatch[1].trim();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { parsed: identity, raw: content, source: isGlobal ? "global" : "session" },
                null,
                2,
              ),
            },
          ],
        };
      },
    ),
  );

  tools.push(
    tool(
      "identity_update",
      "Update fields in IDENTITY.md.",
      {
        name: z.string().optional().describe("Agent name"),
        creature: z.string().optional().describe("Entity type"),
        vibe: z.string().optional().describe("Personality vibe"),
        emoji: z.string().optional().describe("Identity emoji"),
        section: z.string().optional().describe("Custom section name"),
        sectionContent: z.string().optional().describe("Content for custom section"),
      },
      async (args: {
        name?: string;
        creature?: string;
        vibe?: string;
        emoji?: string;
        section?: string;
        sectionContent?: string;
      }) => {
        return withSecurityCheck("identity_update", sessionName, async () => {
          await initSessionContextStorage();
          const { name, creature, vibe, emoji, section, sectionContent } = args;

          // Read current content (session-specific, not global)
          let content = await getSessionContext(sessionName, "IDENTITY.md");
          if (content === null) {
            content = "# IDENTITY.md - Agent Identity\n\n";
          }

          const updates: string[] = [];
          if (name) {
            content = content.replace(/[-*]\s*Name:\s*.+/i, `- Name: ${name}`);
            if (!content.includes("Name:")) content += `- Name: ${name}\n`;
            updates.push(`name: ${name}`);
          }
          if (creature) {
            content = content.replace(/[-*]\s*Creature:\s*.+/i, `- Creature: ${creature}`);
            if (!content.includes("Creature:")) content += `- Creature: ${creature}\n`;
            updates.push(`creature: ${creature}`);
          }
          if (vibe) {
            content = content.replace(/[-*]\s*Vibe:\s*.+/i, `- Vibe: ${vibe}`);
            if (!content.includes("Vibe:")) content += `- Vibe: ${vibe}\n`;
            updates.push(`vibe: ${vibe}`);
          }
          if (emoji) {
            content = content.replace(/[-*]\s*Emoji:\s*.+/i, `- Emoji: ${emoji}`);
            if (!content.includes("Emoji:")) content += `- Emoji: ${emoji}\n`;
            updates.push(`emoji: ${emoji}`);
          }
          if (section && sectionContent) {
            const safeSection = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const sectionRegex = new RegExp(`## ${safeSection}[\\s\\S]*?(?=\\n## |$)`, "i");
            const newSection = `## ${section}\n\n${sectionContent}\n`;
            if (content.match(sectionRegex)) content = content.replace(sectionRegex, newSection);
            else content += `\n${newSection}`;
            updates.push(`section: ${section}`);
          }

          await setSessionContext(sessionName, "IDENTITY.md", content, "session");
          return { content: [{ type: "text", text: `Identity updated: ${updates.join(", ")}` }] };
        });
      },
    ),
  );

  return tools;
}
