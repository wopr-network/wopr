/**
 * Soul tools: soul_get, soul_update
 */

import {
  existsSync,
  join,
  readFileSync,
  resolveRootFile,
  SESSIONS_DIR,
  tool,
  withSecurityCheck,
  writeFileSync,
  z,
} from "./_base.js";

export function createSoulTools(sessionName: string): unknown[] {
  const tools: unknown[] = [];

  tools.push(
    tool(
      "soul_get",
      "Get current SOUL.md content (persona, boundaries, interaction style). Checks global identity first.",
      {},
      async () => {
        const sessionDir = join(SESSIONS_DIR, sessionName);
        const resolved = resolveRootFile(sessionDir, "SOUL.md");
        if (!resolved.exists) return { content: [{ type: "text", text: "No SOUL.md found." }] };
        const content = readFileSync(resolved.path, "utf-8");
        return {
          content: [{ type: "text", text: `[Source: ${resolved.isGlobal ? "global" : "session"}]\n\n${content}` }],
        };
      },
    ),
  );

  tools.push(
    tool(
      "soul_update",
      "Update SOUL.md content.",
      {
        content: z.string().optional().describe("Full content to replace SOUL.md"),
        section: z.string().optional().describe("Section header to add/update"),
        sectionContent: z.string().optional().describe("Content for the section"),
      },
      async (args: { content?: string; section?: string; sectionContent?: string }) => {
        return withSecurityCheck("soul_update", sessionName, async () => {
          const { content, section, sectionContent } = args;
          const sessionDir = join(SESSIONS_DIR, sessionName);
          const soulPath = join(sessionDir, "SOUL.md");
          if (content) {
            writeFileSync(soulPath, content);
            return { content: [{ type: "text", text: "SOUL.md replaced entirely" }] };
          }
          if (section && sectionContent) {
            let existing = existsSync(soulPath)
              ? readFileSync(soulPath, "utf-8")
              : "# SOUL.md - Persona & Boundaries\n\n";
            const safeSection = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const sectionRegex = new RegExp(`## ${safeSection}[\\s\\S]*?(?=\\n## |$)`, "i");
            const newSection = `## ${section}\n\n${sectionContent}\n`;
            if (existing.match(sectionRegex)) existing = existing.replace(sectionRegex, newSection);
            else existing += `\n${newSection}`;
            writeFileSync(soulPath, existing);
            return { content: [{ type: "text", text: `SOUL.md section "${section}" updated` }] };
          }
          return {
            content: [{ type: "text", text: "Provide 'content' or 'section'+'sectionContent'" }],
            isError: true,
          };
        });
      },
    ),
  );

  return tools;
}
