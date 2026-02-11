/**
 * Memory tools: memory_read, memory_write, memory_search, memory_get, self_reflect
 */

import {
  canIndexSession,
  centralConfig,
  eventBus,
  existsSync,
  GLOBAL_IDENTITY_DIR,
  GLOBAL_MEMORY_DIR,
  getContext,
  getSecurityConfig,
  getSessionIndexable,
  join,
  listAllMemoryFiles,
  logger,
  MemoryIndexManager,
  mkdirSync,
  parseTemporalFilter,
  readdirSync,
  readFileSync,
  resolveMemoryFile,
  resolveRootFile,
  SESSIONS_DIR,
  statSync,
  tool,
  WOPR_HOME,
  withSecurityCheck,
  writeFileSync,
  z,
} from "./_base.js";

export function createMemoryTools(sessionName: string): any[] {
  const tools: any[] = [];

  let memoryManager: MemoryIndexManager | null = null;
  const getMemoryManager = async () => {
    if (!memoryManager) {
      const sessionDir = join(SESSIONS_DIR, sessionName);
      const mainConfig = centralConfig.get();
      const memCfg = mainConfig.memory || {};
      memoryManager = await MemoryIndexManager.create({
        globalDir: GLOBAL_IDENTITY_DIR,
        sessionDir,
        config: { ...memCfg, store: { path: join(WOPR_HOME, "memory", "index.sqlite") } },
      });
    }
    return memoryManager;
  };

  tools.push(
    tool(
      "memory_read",
      "Read a memory file. Checks global identity first, then session-specific. Supports daily logs, SELF.md, or topic files.",
      {
        file: z.string().optional().describe("Filename to read (e.g., 'SELF.md', '2026-01-24.md')"),
        from: z.number().optional().describe("Starting line number (1-indexed)"),
        lines: z.number().optional().describe("Number of lines to read"),
        days: z.number().optional().describe("For daily logs: read last N days (default: 7)"),
      },
      async (args: any) => {
        const { file, days = 7, from, lines: lineCount } = args;
        const sessionDir = join(SESSIONS_DIR, sessionName);

        if (!file) {
          const files: string[] = listAllMemoryFiles(sessionDir);
          for (const f of ["SOUL.md", "IDENTITY.md", "MEMORY.md", "USER.md"]) {
            const resolved = resolveRootFile(sessionDir, f);
            if (resolved.exists && !files.includes(f)) files.push(f);
          }
          return {
            content: [
              {
                type: "text",
                text: files.length > 0 ? `Available memory files:\n${files.join("\n")}` : "No memory files found.",
              },
            ],
          };
        }

        if (file === "recent" || file === "daily") {
          const dailyFiles: { name: string; path: string }[] = [];
          if (existsSync(GLOBAL_MEMORY_DIR)) {
            for (const f of readdirSync(GLOBAL_MEMORY_DIR).filter((f: string) => f.match(/^\d{4}-\d{2}-\d{2}\.md$/))) {
              dailyFiles.push({ name: f, path: join(GLOBAL_MEMORY_DIR, f) });
            }
          }
          const sessionMemoryDir = join(sessionDir, "memory");
          if (existsSync(sessionMemoryDir)) {
            readdirSync(sessionMemoryDir)
              .filter((f: string) => f.match(/^\d{4}-\d{2}-\d{2}\.md$/))
              .forEach((f: string) => {
                const idx = dailyFiles.findIndex((d) => d.name === f);
                if (idx >= 0) dailyFiles[idx].path = join(sessionMemoryDir, f);
                else dailyFiles.push({ name: f, path: join(sessionMemoryDir, f) });
              });
          }
          dailyFiles.sort((a, b) => a.name.localeCompare(b.name));
          const recent = dailyFiles.slice(-days);
          if (recent.length === 0) return { content: [{ type: "text", text: "No daily memory files yet." }] };
          const contents = recent
            .map(({ name, path }) => {
              const content = readFileSync(path, "utf-8");
              return `## ${name.replace(".md", "")}\n\n${content}`;
            })
            .join("\n\n---\n\n");
          return { content: [{ type: "text", text: contents }] };
        }

        const rootFiles = ["SOUL.md", "IDENTITY.md", "MEMORY.md", "USER.md", "AGENTS.md"];
        let filePath: string;
        if (rootFiles.includes(file)) {
          const resolved = resolveRootFile(sessionDir, file);
          if (!resolved.exists) return { content: [{ type: "text", text: `File not found: ${file}` }], isError: true };
          filePath = resolved.path;
        } else {
          const resolved = resolveMemoryFile(sessionDir, file);
          if (!resolved.exists) return { content: [{ type: "text", text: `File not found: ${file}` }], isError: true };
          filePath = resolved.path;
        }

        const content = readFileSync(filePath, "utf-8");
        if (from !== undefined && from > 0) {
          const allLines = content.split("\n");
          const startIdx = Math.max(0, from - 1);
          const endIdx = lineCount !== undefined ? Math.min(allLines.length, startIdx + lineCount) : allLines.length;
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    path: file,
                    from: startIdx + 1,
                    to: endIdx,
                    totalLines: allLines.length,
                    text: allLines.slice(startIdx, endIdx).join("\n"),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        return { content: [{ type: "text", text: content }] };
      },
    ),
  );

  tools.push(
    tool(
      "memory_write",
      "Write to a memory file. Creates memory/ directory if needed.",
      {
        file: z.string().describe("Filename (e.g., 'today' for today's log, 'SELF.md')"),
        content: z.string().describe("Content to write or append"),
        append: z.boolean().optional().describe("If true, append instead of replacing"),
      },
      async (args: any) => {
        return withSecurityCheck("memory_write", sessionName, async () => {
          const { file, content, append } = args;
          const sessionDir = join(SESSIONS_DIR, sessionName);
          const memoryDir = join(sessionDir, "memory");
          if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });
          let filename = file;
          if (file === "today") filename = `${new Date().toISOString().split("T")[0]}.md`;
          const rootFiles = ["SOUL.md", "IDENTITY.md", "MEMORY.md", "USER.md", "AGENTS.md"];
          const filePath = rootFiles.includes(filename) ? join(sessionDir, filename) : join(memoryDir, filename);
          const shouldAppend = append !== undefined ? append : filename.match(/^\d{4}-\d{2}-\d{2}\.md$/);
          if (shouldAppend && existsSync(filePath)) {
            const existing = readFileSync(filePath, "utf-8");
            writeFileSync(filePath, `${existing}\n\n${content}`);
          } else writeFileSync(filePath, content);
          return { content: [{ type: "text", text: `${shouldAppend ? "Appended to" : "Wrote"} ${filename}` }] };
        });
      },
    ),
  );

  tools.push(
    tool(
      "memory_search",
      "Search memory files. Uses FTS5 keyword search by default; semantic/vector search available via wopr-plugin-memory-semantic. Supports temporal filtering.",
      {
        query: z.string().describe("Search query"),
        maxResults: z.number().optional().describe("Maximum results (default: 10)"),
        minScore: z.number().optional().describe("Minimum relevance score 0-1 (default: 0.35)"),
        temporal: z
          .string()
          .optional()
          .describe('Time filter: relative ("24h", "7d") or date range ("2026-01-01", "2026-01-01 to 2026-01-05")'),
      },
      async (args: any) => {
        const { query, maxResults = 10, minScore = 0.35, temporal: temporalExpr } = args;
        const parsedTemporal = temporalExpr ? parseTemporalFilter(temporalExpr) : null;
        if (temporalExpr && !parsedTemporal)
          return {
            content: [
              {
                type: "text",
                text: `Invalid temporal filter "${temporalExpr}". Examples: "24h", "7d", "last 3 days", "2026-01-01"`,
              },
            ],
          };
        const temporal = parsedTemporal ?? undefined;

        try {
          const hookPayload = { query, maxResults, minScore, temporal, sessionName, results: null as any[] | null };
          await eventBus.emit("memory:search", hookPayload);
          logger.info(
            `[memory_search] After hook: results=${hookPayload.results ? hookPayload.results.length : "null"}, query="${query}"`,
          );
          let results =
            hookPayload.results ??
            (await (async () => {
              logger.info(`[memory_search] Falling through to core FTS5 for query: "${query}"`);
              const manager = await getMemoryManager();
              return manager.search(query, { maxResults: maxResults * 2, minScore, temporal });
            })());
          const ctx = getContext(sessionName);
          const trustLevel = ctx?.source?.trustLevel ?? "owner";
          const secConfig = getSecurityConfig();
          const indexablePatterns = getSessionIndexable(secConfig, sessionName, trustLevel);
          results = results
            .filter((r: any) => {
              if (r.source !== "sessions") return true;
              const pathMatch = r.path.match(/^sessions\/(.+?)\.conversation\.jsonl$/);
              if (!pathMatch) return true;
              return canIndexSession(sessionName, pathMatch[1], indexablePatterns);
            })
            .slice(0, maxResults);
          if (results.length === 0) {
            const temporalNote = temporalExpr ? ` within time range "${temporalExpr}"` : "";
            return { content: [{ type: "text", text: `No matches found for "${query}"${temporalNote}` }] };
          }
          const formatted = results
            .map(
              (r: any, i: number) =>
                `[${i + 1}] ${r.source}/${r.path}:${r.startLine}-${r.endLine} (score: ${r.score.toFixed(2)})\n${r.snippet}`,
            )
            .join("\n\n---\n\n");
          const temporalNote = temporalExpr ? ` (filtered by: ${temporalExpr})` : "";
          return {
            content: [{ type: "text", text: `Found ${results.length} results${temporalNote}:\n\n${formatted}` }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn(`Vector search failed, falling back to keyword search: ${message}`);
          const sessionDir = join(SESSIONS_DIR, sessionName);
          const sessionMemoryDir = join(sessionDir, "memory");
          const filesToSearch: { path: string; source: string }[] = [];
          for (const f of ["MEMORY.md", "IDENTITY.md", "SOUL.md", "USER.md", "AGENTS.md", "PRIVATE.md", "SELF.md"]) {
            const globalPath = join(GLOBAL_IDENTITY_DIR, f);
            if (existsSync(globalPath)) filesToSearch.push({ path: globalPath, source: `global/${f}` });
            const sessionPath = join(sessionDir, f);
            if (existsSync(sessionPath)) filesToSearch.push({ path: sessionPath, source: `session/${f}` });
          }
          if (existsSync(GLOBAL_MEMORY_DIR)) {
            for (const f of readdirSync(GLOBAL_MEMORY_DIR).filter((f: string) => f.endsWith(".md")))
              filesToSearch.push({ path: join(GLOBAL_MEMORY_DIR, f), source: `global/memory/${f}` });
          }
          if (existsSync(sessionMemoryDir)) {
            for (const f of readdirSync(sessionMemoryDir).filter((f: string) => f.endsWith(".md")))
              filesToSearch.push({ path: join(sessionMemoryDir, f), source: `session/memory/${f}` });
          }
          const sessionsBase = "/data/sessions";
          if (existsSync(sessionsBase)) {
            try {
              for (const entry of readdirSync(sessionsBase)) {
                const entryPath = join(sessionsBase, entry);
                try {
                  if (!statSync(entryPath).isDirectory()) continue;
                } catch {
                  continue;
                }
                const memDir = join(entryPath, "memory");
                if (memDir === sessionMemoryDir || !existsSync(memDir)) continue;
                try {
                  for (const f of readdirSync(memDir).filter((f: string) => f.endsWith(".md")))
                    filesToSearch.push({ path: join(memDir, f), source: `sessions/${entry}/memory/${f}` });
                } catch {}
              }
            } catch {}
          }
          if (filesToSearch.length === 0) return { content: [{ type: "text", text: "No memory files found." }] };
          const queryTerms = query
            .toLowerCase()
            .split(/\s+/)
            .filter((t: string) => t.length > 2);
          const searchResults: any[] = [];
          for (const { path: filePath, source } of filesToSearch) {
            const content = readFileSync(filePath, "utf-8");
            const lines = content.split("\n");
            const chunkSize = 5;
            for (let i = 0; i < lines.length; i += chunkSize) {
              const chunk = lines.slice(i, i + chunkSize).join("\n");
              const chunkLower = chunk.toLowerCase();
              let score = 0;
              for (const term of queryTerms) {
                if (chunkLower.includes(term)) {
                  score += 1;
                  if (chunkLower.includes(query.toLowerCase())) score += 2;
                }
              }
              if (score > 0)
                searchResults.push({
                  relPath: source,
                  lineStart: i + 1,
                  lineEnd: Math.min(i + chunkSize, lines.length),
                  snippet: chunk.substring(0, 300) + (chunk.length > 300 ? "..." : ""),
                  score,
                });
            }
          }
          const maxPossibleScore = queryTerms.length * 3;
          for (const r of searchResults) r.score = maxPossibleScore > 0 ? r.score / maxPossibleScore : 0;
          searchResults.sort((a, b) => b.score - a.score);
          const topResults = searchResults.filter((r) => r.score >= minScore).slice(0, maxResults);
          if (topResults.length === 0) return { content: [{ type: "text", text: `No matches found for "${query}"` }] };
          const formatted = topResults
            .map(
              (r, i) =>
                `[${i + 1}] ${r.relPath}:${r.lineStart}-${r.lineEnd} (score: ${r.score.toFixed(2)})\n${r.snippet}`,
            )
            .join("\n\n---\n\n");
          return {
            content: [{ type: "text", text: `Found ${topResults.length} results (keyword fallback):\n\n${formatted}` }],
          };
        }
      },
    ),
  );

  tools.push(
    tool(
      "memory_get",
      "Read a snippet from memory files with optional line range.",
      {
        path: z.string().describe("Relative path from search results"),
        from: z.number().optional().describe("Starting line number (1-indexed)"),
        lines: z.number().optional().describe("Number of lines to read"),
      },
      async (args: any) => {
        const { path: relPath, from, lines: lineCount } = args;
        const sessionDir = join(SESSIONS_DIR, sessionName);
        const memoryDir = join(sessionDir, "memory");
        let filePath = join(sessionDir, relPath);
        if (!existsSync(filePath)) filePath = join(memoryDir, relPath);
        if (!existsSync(filePath))
          return { content: [{ type: "text", text: `File not found: ${relPath}` }], isError: true };
        const content = readFileSync(filePath, "utf-8");
        const allLines = content.split("\n");
        if (from !== undefined && from > 0) {
          const startIdx = Math.max(0, from - 1);
          const endIdx = lineCount !== undefined ? Math.min(allLines.length, startIdx + lineCount) : allLines.length;
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    path: relPath,
                    from: startIdx + 1,
                    to: endIdx,
                    totalLines: allLines.length,
                    text: allLines.slice(startIdx, endIdx).join("\n"),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ path: relPath, totalLines: allLines.length, text: content }, null, 2),
            },
          ],
        };
      },
    ),
  );

  tools.push(
    tool(
      "self_reflect",
      "Add a reflection to SELF.md (private journal). Use for tattoos and daily reflections.",
      {
        reflection: z.string().optional().describe("The reflection to record"),
        tattoo: z.string().optional().describe("A persistent identity marker"),
        section: z.string().optional().describe("Section header (default: today's date)"),
      },
      async (args: any) => {
        return withSecurityCheck("self_reflect", sessionName, async () => {
          const { reflection, tattoo, section } = args;
          if (!reflection && !tattoo)
            return { content: [{ type: "text", text: "Provide 'reflection' or 'tattoo'" }], isError: true };
          const sessionDir = join(SESSIONS_DIR, sessionName);
          const memoryDir = join(sessionDir, "memory");
          const selfPath = join(memoryDir, "SELF.md");
          if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });
          if (!existsSync(selfPath)) writeFileSync(selfPath, "# SELF.md — Private Reflections\n\n");
          const existing = readFileSync(selfPath, "utf-8");
          const today = new Date().toISOString().split("T")[0];
          if (tattoo) {
            const lines = existing.split("\n");
            const tattooSection = lines.findIndex((l: string) => l.includes("## Tattoos"));
            if (tattooSection === -1) {
              const titleLine = lines.findIndex((l: string) => l.startsWith("# "));
              writeFileSync(
                selfPath,
                [
                  ...lines.slice(0, titleLine + 1),
                  `\n## Tattoos\n\n- "${tattoo}"\n`,
                  ...lines.slice(titleLine + 1),
                ].join("\n"),
              );
            } else {
              const beforeTattoo = lines.slice(0, tattooSection + 1);
              const afterTattoo = lines.slice(tattooSection + 1);
              const insertPoint = afterTattoo.findIndex((l: string) => l.startsWith("## "));
              if (insertPoint === -1) afterTattoo.push(`- "${tattoo}"`);
              else afterTattoo.splice(insertPoint, 0, `- "${tattoo}"`);
              writeFileSync(selfPath, [...beforeTattoo, ...afterTattoo].join("\n"));
            }
            return { content: [{ type: "text", text: `Tattoo added: "${tattoo}"` }] };
          }
          if (reflection) {
            const sectionHeader = section || today;
            writeFileSync(selfPath, `${existing}\n---\n\n## ${sectionHeader}\n\n${reflection}\n`);
            return { content: [{ type: "text", text: `Reflection added under "${sectionHeader}"` }] };
          }
          return { content: [{ type: "text", text: "Nothing to add" }] };
        });
      },
    ),
  );

  return tools;
}
