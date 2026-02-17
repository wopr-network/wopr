/**
 * Minimal SKILL.md frontmatter parser used by both registries and the skills plugin.
 * Contains ONLY the parsing logic, no filesystem or state operations.
 */

// ============================================================================
// Skill Validation Constants (per Agent Skills spec)
// ============================================================================

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const NAME_PATTERN = /^[a-z0-9-]+$/;
const ALLOWED_FRONTMATTER_FIELDS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
  "command-dispatch",
  "command-tool",
  "command-arg-mode",
]);

// ============================================================================
// Types
// ============================================================================

export interface SkillValidationWarning {
  skillPath: string;
  message: string;
}

export interface ParsedFrontmatter {
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
  metadata?: string | Record<string, unknown>;
  "allowed-tools"?: string[];
  "command-dispatch"?: string;
  "command-tool"?: string;
  "command-arg-mode"?: string;
}

// ============================================================================
// Validation Functions
// ============================================================================

export function validateSkillName(name: string, parentDirName: string): string[] {
  const errors: string[] = [];

  if (name !== parentDirName) {
    errors.push(`name "${name}" does not match parent directory "${parentDirName}"`);
  }
  if (name.length > MAX_NAME_LENGTH) {
    errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`);
  }
  if (!NAME_PATTERN.test(name)) {
    errors.push(`name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)`);
  }
  if (name.startsWith("-") || name.endsWith("-")) {
    errors.push(`name must not start or end with a hyphen`);
  }
  if (name.includes("--")) {
    errors.push(`name must not contain consecutive hyphens`);
  }

  return errors;
}

export function validateSkillDescription(description?: string): string[] {
  const errors: string[] = [];

  if (!description || description.trim() === "") {
    errors.push(`description is required`);
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`);
  }

  return errors;
}

export function validateFrontmatterFields(keys: string[]): string[] {
  const errors: string[] = [];
  for (const key of keys) {
    if (!ALLOWED_FRONTMATTER_FIELDS.has(key)) {
      errors.push(`unknown frontmatter field "${key}"`);
    }
  }
  return errors;
}

// ============================================================================
// Frontmatter Parsing
// ============================================================================

export function parseSkillFrontmatter(content: string): {
  frontmatter: ParsedFrontmatter;
  body: string;
  warnings: SkillValidationWarning[];
} {
  const warnings: SkillValidationWarning[] = [];
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  if (!match) {
    return { frontmatter: {}, body: content, warnings };
  }

  const yamlContent = match[1];
  const body = match[2];
  const frontmatter: ParsedFrontmatter = {};

  // Parse YAML-like frontmatter
  for (const line of yamlContent.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value: unknown = line.slice(colonIndex + 1).trim();

    // Try to parse JSON metadata
    if (key === "metadata") {
      try {
        value = JSON.parse(value as string);
      } catch {
        // Keep as string if not valid JSON
      }
    }

    // Parse arrays
    if (key === "allowed-tools") {
      try {
        value = JSON.parse(value as string);
      } catch {
        value = (value as string).split(",").map((s: string) => s.trim());
      }
    }

    (frontmatter as Record<string, unknown>)[key] = value;
  }

  // Validate frontmatter fields
  const fieldErrors = validateFrontmatterFields(Object.keys(frontmatter));
  for (const error of fieldErrors) {
    warnings.push({ skillPath: "", message: error });
  }

  return { frontmatter, body, warnings };
}
