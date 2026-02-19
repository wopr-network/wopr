/**
 * Memory tools: memory_read, memory_write, memory_search, memory_get, self_reflect
 * WOP-556: SQL-backed via session-context-repository
 */

import {
  getSessionContext,
  initSessionContextStorage,
  listSessionContextFiles,
  setSessionContext,
} from "../session-context-repository.js";
import {
  canIndexSession,
  eventBus,
  getContext,
  getSecurityConfig,
  getSessionIndexable,
  logger,
  parseTemporalFilter,
  tool,
  withSecurityCheck,
  z,
} from "./_base.js";

export function createMemoryTools(sessionName: string): unknown[] {
  const tools: unknown[] = [];

  // Memory manager is now owned by the memory-semantic plugin
  // Core provides only fallback grep-based search

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
      async (args: { file?: string; from?: number; lines?: number; days?: number }) => {
        const { file, days = 7, from, lines: lineCount } = args;

        await initSessionContextStorage();

        if (!file) {
          // List all available memory files from SQL
          const sessionFiles = await listSessionContextFiles(sessionName);
          const globalFiles = await listSessionContextFiles("__global__");

          const allFiles = new Set<string>();
          for (const f of [...sessionFiles, ...globalFiles]) {
            allFiles.add(f);
          }

          const fileList = [...allFiles];
          return {
            content: [
              {
                type: "text",
                text:
                  fileList.length > 0 ? `Available memory files:\n${fileList.join("\n")}` : "No memory files found.",
              },
            ],
          };
        }

        if (file === "recent" || file === "daily") {
          // Get all daily memory files from SQL (global + session)
          const entries: { name: string; content: string }[] = [];
          const seen = new Set<string>();

          const addDailyFiles = async (sn: string) => {
            const files = await listSessionContextFiles(sn);
            for (const filename of files) {
              if (!filename.match(/^memory\/\d{4}-\d{2}-\d{2}\.md$/)) continue;
              const baseName = filename.slice("memory/".length);
              if (seen.has(baseName)) continue;
              const content = await getSessionContext(sn, filename);
              if (content !== null) {
                entries.push({ name: baseName, content });
                seen.add(baseName);
              }
            }
          };

          await addDailyFiles("__global__");
          await addDailyFiles(sessionName);

          entries.sort((a, b) => a.name.localeCompare(b.name));
          const recent = entries.slice(-days);

          if (recent.length === 0) return { content: [{ type: "text", text: "No daily memory files yet." }] };
          const contents = recent
            .map(({ name, content }) => `## ${name.replace(".md", "")}\n\n${content}`)
            .join("\n\n---\n\n");
          return { content: [{ type: "text", text: contents }] };
        }

        // Resolve specific file
        const rootFiles = ["IDENTITY.md", "MEMORY.md", "USER.md", "AGENTS.md"];
        let content: string | null = null;

        if (rootFiles.includes(file)) {
          // Try session first, then global
          content = await getSessionContext(sessionName, file);
          if (content === null) {
            content = await getSessionContext("__global__", file);
          }
        } else {
          // Memory file: check as "memory/{file}" in global then session
          const memoryFilename = file.includes("/") ? file : `memory/${file}`;
          content = await getSessionContext("__global__", memoryFilename);
          if (content === null) {
            content = await getSessionContext(sessionName, memoryFilename);
          }
        }

        if (content === null) {
          return { content: [{ type: "text", text: `File not found: ${file}` }], isError: true };
        }

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
      async (args: { file: string; content: string; append?: boolean }) => {
        return withSecurityCheck("memory_write", sessionName, async () => {
          const { file, content, append } = args;
          await initSessionContextStorage();

          let filename = file;
          if (file === "today") filename = `${new Date().toISOString().split("T")[0]}.md`;

          const rootFiles = ["IDENTITY.md", "MEMORY.md", "USER.md", "AGENTS.md"];
          const isRootFile = rootFiles.includes(filename);

          // For root files, store without "memory/" prefix; daily logs under "memory/"
          const storageFilename = isRootFile ? filename : `memory/${filename}`;

          const shouldAppend = append !== undefined ? append : filename.match(/^\d{4}-\d{2}-\d{2}\.md$/);

          let finalContent = content;
          if (shouldAppend) {
            const existing = await getSessionContext(sessionName, storageFilename);
            if (existing !== null) {
              finalContent = `${existing}\n\n${content}`;
            }
          }

          await setSessionContext(sessionName, storageFilename, finalContent, "session");
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
      async (args: { query: string; maxResults?: number; minScore?: number; temporal?: string }) => {
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

        const ctx = getContext(sessionName);
        if (!ctx) {
          logger.warn(
            `[memory_search] No security context for session ${sessionName}, defaulting to untrusted indexable scope`,
          );
        }
        const trustLevel = ctx?.source?.trustLevel ?? "untrusted";
        const secConfig = getSecurityConfig();
        const indexablePatterns = getSessionIndexable(secConfig, sessionName, trustLevel);

        try {
          const hookPayload = { query, maxResults, minScore, temporal, sessionName, results: null as unknown[] | null };
          await eventBus.emit("memory:search", hookPayload);
          logger.info(
            `[memory_search] After hook: results=${hookPayload.results ? hookPayload.results.length : "null"}, query="${query}"`,
          );
          let results = hookPayload.results;
          if (!results) {
            // No plugin handled memory:search — fall through to keyword fallback
            throw new Error("No memory plugin available");
          }
          results = results
            .filter((r: unknown) => {
              const result = r as Record<string, unknown>;
              if (result.source !== "sessions") return true;
              const pathMatch = String(result.path).match(/^sessions\/(.+?)\.conversation\.jsonl$/);
              if (!pathMatch) return true;
              return canIndexSession(sessionName, pathMatch[1], indexablePatterns);
            })
            .slice(0, maxResults);
          if (results.length === 0) {
            const temporalNote = temporalExpr ? ` within time range "${temporalExpr}"` : "";
            return { content: [{ type: "text", text: `No matches found for "${query}"${temporalNote}` }] };
          }
          const formatted = results
            .map((r: unknown, i: number) => {
              const result = r as Record<string, unknown>;
              return `[${i + 1}] ${result.source}/${result.path}:${result.startLine}-${result.endLine} (score: ${Number(result.score).toFixed(2)})\n${result.snippet}`;
            })
            .join("\n\n---\n\n");
          const temporalNote = temporalExpr ? ` (filtered by: ${temporalExpr})` : "";
          return {
            content: [{ type: "text", text: `Found ${results.length} results${temporalNote}:\n\n${formatted}` }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn(`Vector search failed, falling back to keyword search: ${message}`);

          // SQL-based keyword search fallback
          await initSessionContextStorage();

          const sessionNames = ["__global__", sessionName];
          const filesToSearch: { content: string; source: string }[] = [];

          for (const sn of sessionNames) {
            const files = await listSessionContextFiles(sn);
            for (const filename of files) {
              const fileContent = await getSessionContext(sn, filename);
              if (fileContent !== null) {
                const label = sn === "__global__" ? `global/${filename}` : `session/${filename}`;
                filesToSearch.push({ content: fileContent, source: label });
              }
            }
          }

          const filteredFilesToSearch = filesToSearch.filter(({ source }) => {
            const sessionMatch = source.match(/^sessions\/(.+?)\/memory\//);
            if (!sessionMatch) return true;
            return canIndexSession(sessionName, sessionMatch[1], indexablePatterns);
          });

          if (filteredFilesToSearch.length === 0)
            return { content: [{ type: "text", text: "No memory files found." }] };

          const queryTerms = query
            .toLowerCase()
            .split(/\s+/)
            .filter((t: string) => t.length > 2);

          const searchResults: Array<{
            relPath: string;
            lineStart: number;
            lineEnd: number;
            snippet: string;
            score: number;
          }> = [];

          for (const { content: fileContent, source } of filteredFilesToSearch) {
            const lines = fileContent.split("\n");
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
      async (args: { path: string; from?: number; lines?: number }) => {
        const { path: relPath, from, lines: lineCount } = args;
        await initSessionContextStorage();

        // Try to resolve: session first, then global, then as memory/ prefix
        let content: string | null = null;
        for (const sn of [sessionName, "__global__"]) {
          content = await getSessionContext(sn, relPath);
          if (content !== null) break;
          content = await getSessionContext(sn, `memory/${relPath}`);
          if (content !== null) break;
        }

        if (content === null) return { content: [{ type: "text", text: `File not found: ${relPath}` }], isError: true };

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
      async (args: { reflection?: string; tattoo?: string; section?: string }) => {
        return withSecurityCheck("self_reflect", sessionName, async () => {
          const { reflection, tattoo, section } = args;
          if (!reflection && !tattoo)
            return { content: [{ type: "text", text: "Provide 'reflection' or 'tattoo'" }], isError: true };

          await initSessionContextStorage();

          const selfFilename = "memory/SELF.md";
          let existing = await getSessionContext(sessionName, selfFilename);
          if (existing === null) {
            existing = "# SELF.md — Private Reflections\n\n";
          }

          const today = new Date().toISOString().split("T")[0];

          if (tattoo) {
            const lines = existing.split("\n");
            const tattooSection = lines.findIndex((l: string) => l.includes("## Tattoos"));
            let updated: string;
            if (tattooSection === -1) {
              const titleLine = lines.findIndex((l: string) => l.startsWith("# "));
              updated = [
                ...lines.slice(0, titleLine + 1),
                `\n## Tattoos\n\n- "${tattoo}"\n`,
                ...lines.slice(titleLine + 1),
              ].join("\n");
            } else {
              const beforeTattoo = lines.slice(0, tattooSection + 1);
              const afterTattoo = lines.slice(tattooSection + 1);
              const insertPoint = afterTattoo.findIndex((l: string) => l.startsWith("## "));
              if (insertPoint === -1) afterTattoo.push(`- "${tattoo}"`);
              else afterTattoo.splice(insertPoint, 0, `- "${tattoo}"`);
              updated = [...beforeTattoo, ...afterTattoo].join("\n");
            }
            await setSessionContext(sessionName, selfFilename, updated, "session");
            return { content: [{ type: "text", text: `Tattoo added: "${tattoo}"` }] };
          }

          if (reflection) {
            const sectionHeader = section || today;
            const updated = `${existing}\n---\n\n## ${sectionHeader}\n\n${reflection}\n`;
            await setSessionContext(sessionName, selfFilename, updated, "session");
            return { content: [{ type: "text", text: `Reflection added under "${sectionHeader}"` }] };
          }

          return { content: [{ type: "text", text: "Nothing to add" }] };
        });
      },
    ),
  );

  return tools;
}
