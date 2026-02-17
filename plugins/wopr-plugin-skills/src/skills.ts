/**
 * Skill discovery and management
 * Feature parity with Clawdbot skills system
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { logger } from "../../../src/logger.js";
import { PROJECT_SKILLS_DIR, SKILLS_DIR, WOPR_HOME } from "../../../src/paths.js";
import {
  parseSkillFrontmatter,
  validateSkillDescription,
  validateSkillName,
  type ParsedFrontmatter,
  type SkillValidationWarning,
} from "../../../src/core/skill-frontmatter-parser.js";

// ============================================================================
// Skill Interfaces
// ============================================================================

export interface SkillMetadata {
  emoji?: string;
  requires?: {
    bins?: string[];
    libs?: string[];
  };
  install?: SkillInstallStep[];
}

export interface SkillInstallStep {
  id: string;
  kind: "brew" | "apt" | "npm" | "pip" | "script";
  formula?: string;
  package?: string;
  script?: string;
  bins?: string[];
  label?: string;
}

/**
 * Consent provider for skill install steps.
 * Callers must supply an implementation that displays the proposed command(s)
 * to the user and returns true only if the user explicitly approves execution.
 *
 * SECURITY: Implementations MUST display `rawCommand` verbatim to the user.
 * Do NOT substitute step.label or any other summary — `rawCommand` contains
 * the exact shell content that will be executed.
 *
 * When no provider is supplied, installSkillDependencies refuses all steps
 * (fail-safe default).
 */
export interface InstallConsentProvider {
  /**
   * Ask the user whether they consent to running an install step.
   *
   * SECURITY: `rawCommand` is the EXACT shell command/script that will be
   * executed verbatim. Implementations MUST show this to the user, not
   * step.label or any other attacker-controlled summary field.
   *
   * @param skillName  - The skill requesting installation
   * @param step       - The install step about to be executed
   * @param rawCommand - The exact shell command or script content that will be
   *                     executed. For "script" steps this is the full bash script.
   *                     This MUST be displayed to the user for informed consent.
   * @returns true if the user approves, false to skip
   */
  requestConsent(skillName: string, step: SkillInstallStep, rawCommand: string): Promise<boolean>;
}

/**
 * Return the exact shell command or script content that a given install step
 * will execute. For package-manager steps this is the full CLI invocation;
 * for "script" steps this is the raw bash script verbatim.
 *
 * SECURITY: The return value must be shown to the user as-is for informed
 * consent — do NOT replace it with step.label or any other summary.
 */
export function describeInstallStep(step: SkillInstallStep): string {
  switch (step.kind) {
    case "brew":
      return `brew install ${step.formula ?? "(unknown)"}`;
    case "apt":
      return `sudo apt-get install -y ${step.package ?? "(unknown)"}`;
    case "npm":
      return `npm install -g ${step.package ?? "(unknown)"}`;
    case "pip":
      return `pip install ${step.package ?? "(unknown)"}`;
    case "script":
      return step.script ?? "(empty script)";
    default:
      return `(unknown kind: ${(step as SkillInstallStep).kind})`;
  }
}

export interface SkillCommandDispatch {
  kind: "tool";
  toolName: string;
  argMode: "raw";
}

export interface Skill {
  name: string;
  description: string;
  path: string;
  baseDir: string;
  source: string;
  metadata?: SkillMetadata;
  allowedTools?: string[];
  commandDispatch?: SkillCommandDispatch;
}

export interface SkillEntry {
  skill: Skill;
  frontmatter: Record<string, unknown>;
  woprMetadata?: SkillMetadata;
  invocation: {
    disableModelInvocation?: boolean;
    userInvocable?: boolean;
  };
}

// ============================================================================
// Frontmatter Resolution Helpers
// ============================================================================

function resolveWoprMetadata(frontmatter: ParsedFrontmatter): SkillMetadata | undefined {
  if (!frontmatter.metadata) return undefined;

  if (typeof frontmatter.metadata === "string") {
    try {
      const parsed = JSON.parse(frontmatter.metadata) as { wopr?: SkillMetadata; clawdbot?: SkillMetadata };
      return parsed.wopr || parsed.clawdbot;
    } catch {
      return undefined;
    }
  }

  return (
    (frontmatter.metadata as { wopr?: SkillMetadata; clawdbot?: SkillMetadata }).wopr ||
    (frontmatter.metadata as { clawdbot?: SkillMetadata }).clawdbot
  );
}

function resolveSkillInvocationPolicy(_frontmatter: ParsedFrontmatter): {
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
} {
  return {
    disableModelInvocation: false,
    userInvocable: true,
  };
}

function resolveCommandDispatch(frontmatter: ParsedFrontmatter): SkillCommandDispatch | undefined {
  const dispatch = frontmatter["command-dispatch"]?.trim().toLowerCase();
  if (dispatch !== "tool") return undefined;

  const toolName = frontmatter["command-tool"]?.trim();
  if (!toolName) {
    logger.warn(`Skill requested tool dispatch but did not provide command-tool`);
    return undefined;
  }

  const argMode = frontmatter["command-arg-mode"]?.trim().toLowerCase();
  return {
    kind: "tool",
    toolName,
    argMode: !argMode || argMode === "raw" ? "raw" : "raw",
  };
}

// ============================================================================
// Skill Discovery
// ============================================================================

export interface DiscoverOptions {
  extraDirs?: string[];
  bundledDir?: string;
  managedDir?: string;
  workspaceDir?: string;
  includeSkills?: string[];
  ignoreSkills?: string[];
}

function loadSkillsFromDir(
  dir: string,
  source: string,
): {
  entries: SkillEntry[];
  warnings: SkillValidationWarning[];
} {
  const entries: SkillEntry[] = [];
  const warnings: SkillValidationWarning[] = [];

  if (!existsSync(dir)) {
    return { entries, warnings };
  }

  try {
    const items = readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      // Skip hidden files and node_modules
      if (item.name.startsWith(".") || item.name === "node_modules") {
        continue;
      }

      let isDirectory = item.isDirectory();
      const isSymlink = item.isSymbolicLink();

      // Follow symlinks
      if (isSymlink) {
        try {
          const stats = statSync(join(dir, item.name));
          isDirectory = stats.isDirectory();
        } catch {
          continue; // Broken symlink
        }
      }

      if (isDirectory) {
        const skillFile = join(dir, item.name, "SKILL.md");
        if (!existsSync(skillFile)) {
          continue;
        }

        const result = loadSkillFromFile(skillFile, source);
        if (result.entry) {
          entries.push(result.entry);
        }
        warnings.push(...result.warnings);
      }
    }
  } catch (error) {
    logger.warn(`Failed to load skills from ${dir}:`, error);
  }

  return { entries, warnings };
}

function loadSkillFromFile(
  filePath: string,
  source: string,
): {
  entry: SkillEntry | null;
  warnings: SkillValidationWarning[];
} {
  const warnings: SkillValidationWarning[] = [];

  try {
    const content = readFileSync(filePath, "utf-8");
    const { frontmatter, warnings: fmWarnings } = parseSkillFrontmatter(content);

    // Add filepath to warnings
    for (const w of fmWarnings) {
      w.skillPath = filePath;
    }
    warnings.push(...fmWarnings);

    const skillDir = dirname(filePath);
    const parentDirName = basename(skillDir);

    // Get name from frontmatter or directory
    const name = frontmatter.name || parentDirName;

    // Validate
    const nameErrors = validateSkillName(name, parentDirName);
    for (const error of nameErrors) {
      warnings.push({ skillPath: filePath, message: error });
    }

    const descErrors = validateSkillDescription(frontmatter.description);
    for (const error of descErrors) {
      warnings.push({ skillPath: filePath, message: error });
    }

    // Must have description
    if (!frontmatter.description || frontmatter.description.trim() === "") {
      return { entry: null, warnings };
    }

    const entry: SkillEntry = {
      skill: {
        name,
        description: frontmatter.description,
        path: filePath,
        baseDir: skillDir,
        source,
        metadata: resolveWoprMetadata(frontmatter),
        allowedTools: frontmatter["allowed-tools"],
        commandDispatch: resolveCommandDispatch(frontmatter),
      },
      frontmatter: frontmatter as Record<string, unknown>,
      woprMetadata: resolveWoprMetadata(frontmatter),
      invocation: resolveSkillInvocationPolicy(frontmatter),
    };

    return { entry, warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to parse skill file";
    warnings.push({ skillPath: filePath, message });
    return { entry: null, warnings };
  }
}

function matchesPattern(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    // Escape regex metacharacters, then expand glob wildcards
    const escaped = pattern.replace(/[.+^${}()|\\[\]]/g, "\\$&");
    const regex = new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
    return regex.test(name);
  });
}

export function discoverSkills(options: DiscoverOptions = {}): {
  skills: Skill[];
  warnings: SkillValidationWarning[];
} {
  const allWarnings: SkillValidationWarning[] = [];
  const skillMap = new Map<string, Skill>();
  const realPathSet = new Set<string>();

  const {
    extraDirs = [],
    bundledDir,
    managedDir = SKILLS_DIR,
    workspaceDir = PROJECT_SKILLS_DIR,
    includeSkills = [],
    ignoreSkills = [],
  } = options;

  // Load from all sources (precedence: extra < bundled < managed < workspace)
  const sources: { dir: string; source: string }[] = [
    ...extraDirs.map((d) => ({ dir: resolve(d.replace(/^~/, homedir())), source: "extra" })),
    ...(bundledDir ? [{ dir: bundledDir, source: "bundled" }] : []),
    { dir: managedDir, source: "managed" },
    { dir: workspaceDir, source: "workspace" },
  ];

  for (const { dir, source } of sources) {
    const { entries, warnings } = loadSkillsFromDir(dir, source);
    allWarnings.push(...warnings);

    for (const entry of entries) {
      const { skill } = entry;

      // Apply filters
      if (ignoreSkills.length > 0 && matchesPattern(skill.name, ignoreSkills)) {
        continue;
      }
      if (includeSkills.length > 0 && !matchesPattern(skill.name, includeSkills)) {
        continue;
      }

      // Resolve symlinks for deduplication
      let realPath: string;
      try {
        realPath = realpathSync(skill.path);
      } catch {
        realPath = skill.path;
      }

      if (realPathSet.has(realPath)) {
        continue; // Skip duplicate
      }

      // Check for name collisions
      const existing = skillMap.get(skill.name);
      if (existing) {
        allWarnings.push({
          skillPath: skill.path,
          message: `name collision: "${skill.name}" already loaded from ${existing.path}, skipping`,
        });
        continue;
      }

      skillMap.set(skill.name, skill);
      realPathSet.add(realPath);
    }
  }

  return {
    skills: Array.from(skillMap.values()),
    warnings: allWarnings,
  };
}

// Legacy discover function for backward compatibility
export function discoverSkillsLegacy(): Skill[] {
  return discoverSkills().skills;
}

// ============================================================================
// Skill Formatting
// ============================================================================

export function formatSkillsXml(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const skillsXml = skills
    .map((s) => {
      const emoji = s.metadata?.emoji ? `${s.metadata.emoji} ` : "";
      return `  <skill>
    <name>${s.name}</name>
    <description>${emoji}${s.description}</description>
    <location>${s.path}</location>
  </skill>`;
    })
    .join("\n");

  return `
<available_skills>
${skillsXml}
</available_skills>

When you need to use a skill, read its full SKILL.md file at the location shown above.
`;
}

export function buildSkillsPrompt(skills: Skill[]): string {
  return formatSkillsXml(skills);
}

// ============================================================================
// Skill Commands (Slash Commands)
// ============================================================================

const SKILL_COMMAND_MAX_LENGTH = 32;
const SKILL_COMMAND_FALLBACK = "skill";
const SKILL_COMMAND_DESCRIPTION_MAX_LENGTH = 100;

function sanitizeSkillCommandName(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  const trimmed = normalized.slice(0, SKILL_COMMAND_MAX_LENGTH);
  return trimmed || SKILL_COMMAND_FALLBACK;
}

function resolveUniqueSkillCommandName(base: string, used: Set<string>): string {
  const normalizedBase = base.toLowerCase();
  if (!used.has(normalizedBase)) return base;

  for (let index = 2; index < 1000; index++) {
    const suffix = `_${index}`;
    const maxBaseLength = Math.max(1, SKILL_COMMAND_MAX_LENGTH - suffix.length);
    const trimmedBase = base.slice(0, maxBaseLength);
    const candidate = `${trimmedBase}${suffix}`;

    if (!used.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return `${base.slice(0, Math.max(1, SKILL_COMMAND_MAX_LENGTH - 2))}_x`;
}

export function buildSkillCommandSpecs(
  skills: Skill[],
  reservedNames: string[] = [],
): Array<{
  name: string;
  skillName: string;
  description: string;
  dispatch?: SkillCommandDispatch;
}> {
  const used = new Set<string>(reservedNames.map((r) => r.toLowerCase()));

  return skills
    .filter((s) => s.commandDispatch) // Only skills with command dispatch
    .map((skill) => {
      const base = sanitizeSkillCommandName(skill.name);
      const unique = resolveUniqueSkillCommandName(base, used);
      used.add(unique.toLowerCase());

      const rawDescription = skill.description?.trim() || skill.name;
      const description =
        rawDescription.length > SKILL_COMMAND_DESCRIPTION_MAX_LENGTH
          ? `${rawDescription.slice(0, SKILL_COMMAND_DESCRIPTION_MAX_LENGTH - 1)}…`
          : rawDescription;

      return {
        name: unique,
        skillName: skill.name,
        description,
        ...(skill.commandDispatch ? { dispatch: skill.commandDispatch } : {}),
      };
    });
}

// ============================================================================
// Dependency Checking
// ============================================================================

export function checkSkillDependencies(skill: Skill): {
  missing: string[];
  satisfied: boolean;
} {
  const missing: string[] = [];
  const requires = skill.metadata?.requires;

  if (requires?.bins) {
    for (const bin of requires.bins) {
      try {
        execFileSync("which", [bin], { stdio: "ignore" });
      } catch {
        missing.push(bin);
      }
    }
  }

  return { missing, satisfied: missing.length === 0 };
}

export async function installSkillDependencies(
  skill: Skill,
  consentProvider?: InstallConsentProvider,
): Promise<boolean> {
  const installSteps = skill.metadata?.install;
  if (!installSteps || installSteps.length === 0) return true;

  // Fail-safe: refuse all install steps when no consent provider is given.
  // This prevents silent execution of untrusted commands from SKILL.md metadata.
  if (!consentProvider) {
    logger.warn(
      `Skill "${skill.name}" requires install steps but no consent provider was supplied. ` +
        `Refusing to execute untrusted commands. Provide an InstallConsentProvider to allow installation.`,
    );
    return false;
  }

  logger.info(`Installing dependencies for skill: ${skill.name}`);

  for (const step of installSteps) {
    // SECURITY: rawCommand is the EXACT content that will be executed.
    // For "script" steps this is the full bash script verbatim — not a
    // summary, label, or description. Consent providers MUST display this.
    const rawCommand = describeInstallStep(step);

    // Request explicit user consent before executing each step
    let approved: boolean;
    try {
      approved = await consentProvider.requestConsent(skill.name, step, rawCommand);
    } catch (err) {
      logger.warn(`Consent provider threw for step "${step.id}" of skill "${skill.name}"; failing closed`, err);
      return false;
    }
    if (!approved) {
      logger.info(`User declined install step "${step.id}" for skill "${skill.name}": ${rawCommand}`);
      return false;
    }

    try {
      switch (step.kind) {
        case "brew":
          if (step.formula) {
            execFileSync("brew", ["install", step.formula], { stdio: "inherit" });
          }
          break;
        case "apt":
          if (step.package) {
            execFileSync("sudo", ["apt-get", "install", "-y", step.package], { stdio: "inherit" });
          }
          break;
        case "npm":
          if (step.package) {
            execFileSync("npm", ["install", "-g", step.package], { stdio: "inherit" });
          }
          break;
        case "pip":
          if (step.package) {
            execFileSync("pip", ["install", step.package], { stdio: "inherit" });
          }
          break;
        case "script":
          if (step.script) {
            execFileSync("/bin/bash", ["-c", step.script], { stdio: "inherit" });
          }
          break;
      }
    } catch (error) {
      logger.error(`Failed to install ${step.id}:`, error);
      return false;
    }
  }

  return true;
}

// ============================================================================
// Legacy Functions (Backward Compatibility)
// ============================================================================

export function createSkill(name: string, description?: string): Skill {
  const targetDir = join(SKILLS_DIR, name);
  if (existsSync(targetDir)) {
    throw new Error(`Skill "${name}" already exists`);
  }

  mkdirSync(targetDir, { recursive: true });
  const desc = description || `WOPR skill: ${name}`;
  const skillPath = join(targetDir, "SKILL.md");
  writeFileSync(
    skillPath,
    `---
name: ${name}
description: ${desc}
---

# ${name}
`,
  );

  return {
    name,
    description: desc,
    path: skillPath,
    baseDir: targetDir,
    source: "managed",
  };
}

export function removeSkill(name: string): void {
  const targetDir = join(SKILLS_DIR, name);
  if (!existsSync(targetDir)) {
    throw new Error(`Skill "${name}" not found`);
  }
  rmSync(targetDir, { recursive: true, force: true });

  // Clean up orphaned state entry (async cleanup - import to avoid circular dependency)
  import("./skills-repository.js").then(({ removeSkillState }) => {
    removeSkillState(name).catch((err: Error) => {
      logger.warn(`Failed to remove skill state for "${name}":`, err);
    });
  });
}

export function installSkillFromGitHub(owner: string, repo: string, skillPath: string, name?: string): Skill {
  // Validate inputs
  const validGhName = /^[a-zA-Z0-9._-]+$/;
  const validPathSegment = /^[a-zA-Z0-9._-]+$/;
  if (!validGhName.test(owner) || !validGhName.test(repo)) {
    throw new Error("Invalid GitHub owner or repo name");
  }
  // Validate each path segment to prevent traversal
  const pathSegments = skillPath.split("/").filter(Boolean);
  if (pathSegments.length === 0 || pathSegments.some((seg) => !validPathSegment.test(seg) || seg === "..")) {
    throw new Error("Invalid skill path");
  }
  const normalizedSkillPath = pathSegments.join("/");

  const skillName = name || pathSegments[pathSegments.length - 1];
  if (!validGhName.test(skillName)) {
    throw new Error("Invalid skill name");
  }
  const targetDir = join(SKILLS_DIR, skillName);

  if (existsSync(targetDir)) {
    throw new Error(`Skill "${skillName}" already exists`);
  }

  const tmpDir = join(SKILLS_DIR, `.tmp-${Date.now()}`);
  try {
    execFileSync(
      "git",
      ["clone", "--depth", "1", "--filter=blob:none", "--sparse", `https://github.com/${owner}/${repo}.git`, tmpDir],
      { stdio: "pipe" },
    );
    execFileSync("git", ["-C", tmpDir, "sparse-checkout", "set", normalizedSkillPath], { stdio: "pipe" });
    renameSync(join(tmpDir, normalizedSkillPath), targetDir);
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    rmSync(tmpDir, { recursive: true, force: true });
    throw new Error("Failed to install skill from GitHub");
  }

  const skill = discoverSkillsLegacy().find((s) => s.name === skillName);
  if (!skill) {
    throw new Error("Skill installed but not discoverable");
  }
  return skill;
}

export function installSkillFromUrl(source: string, name?: string): Skill {
  const skillName = name || basename(source).replace(/\.git$/, "");
  // Validate skillName to prevent path traversal
  const validName = /^[a-zA-Z0-9._-]+$/;
  if (!validName.test(skillName)) {
    throw new Error("Invalid skill name");
  }
  const targetDir = join(SKILLS_DIR, skillName);

  if (existsSync(targetDir)) {
    throw new Error(`Skill "${skillName}" already exists`);
  }

  // Validate source is an HTTPS URL to prevent file:// or other scheme abuse
  try {
    const parsed = new URL(source);
    if (parsed.protocol !== "https:") {
      throw new Error("Only HTTPS URLs are supported for skill installation");
    }
  } catch (e: unknown) {
    const error = e as Error;
    if (error.message.includes("HTTPS")) throw error;
    throw new Error("Invalid skill source URL");
  }

  // Use execFileSync with args array to prevent shell injection
  try {
    execFileSync("git", ["clone", source, targetDir], { stdio: "inherit" });
  } catch (error) {
    rmSync(targetDir, { recursive: true, force: true });
    throw error;
  }

  const skill = discoverSkillsLegacy().find((s) => s.name === skillName);
  if (!skill) {
    throw new Error("Skill installed but not discoverable");
  }
  return skill;
}

export function clearSkillCache(): void {
  const cacheDir = join(WOPR_HOME, ".cache");
  if (existsSync(cacheDir)) {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

// ============================================================================
// Skill State Management (Enable / Disable) - Re-export async API
// ============================================================================

// Re-export async API from skills-repository
export {
  disableSkillAsync,
  enableSkillAsync,
  getAllSkillStates,
  getSkillState,
  initSkillsStorage,
  isSkillEnabledAsync,
  readAllSkillStatesAsync,
  recordSkillUsage,
  removeSkillState,
} from "./skills-repository.js";

/**
 * Get a single skill by name, or null if not found.
 */
export function getSkillByName(name: string): Skill | null {
  const { skills } = discoverSkills();
  return skills.find((s) => s.name === name) ?? null;
}
