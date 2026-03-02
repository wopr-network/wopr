import { describe, expect, it } from "vitest";
import {
  validateSkillName,
  validateSkillDescription,
  validateFrontmatterFields,
  parseSkillFrontmatter,
} from "../../src/core/skill-frontmatter-parser.js";

describe("validateSkillName", () => {
  it("returns no errors for a valid name matching parent dir", () => {
    expect(validateSkillName("my-skill", "my-skill")).toEqual([]);
  });

  it("errors when name does not match parent directory", () => {
    const errors = validateSkillName("my-skill", "other-dir");
    expect(errors).toContainEqual(
      expect.stringContaining("does not match parent directory"),
    );
  });

  it("errors when name exceeds 64 characters", () => {
    const long = "a".repeat(65);
    const errors = validateSkillName(long, long);
    expect(errors).toContainEqual(expect.stringContaining("exceeds 64 characters"));
  });

  it("errors when name contains uppercase letters", () => {
    const errors = validateSkillName("MySkill", "MySkill");
    expect(errors).toContainEqual(expect.stringContaining("invalid characters"));
  });

  it("errors when name contains spaces", () => {
    const errors = validateSkillName("my skill", "my skill");
    expect(errors).toContainEqual(expect.stringContaining("invalid characters"));
  });

  it("errors when name starts with a hyphen", () => {
    const errors = validateSkillName("-my-skill", "-my-skill");
    expect(errors).toContainEqual(expect.stringContaining("must not start or end with a hyphen"));
  });

  it("errors when name ends with a hyphen", () => {
    const errors = validateSkillName("my-skill-", "my-skill-");
    expect(errors).toContainEqual(expect.stringContaining("must not start or end with a hyphen"));
  });

  it("errors when name contains consecutive hyphens", () => {
    const errors = validateSkillName("my--skill", "my--skill");
    expect(errors).toContainEqual(expect.stringContaining("consecutive hyphens"));
  });

  it("returns multiple errors when multiple rules are violated", () => {
    const errors = validateSkillName("-Bad--Name-", "other");
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validateSkillDescription", () => {
  it("returns no errors for a valid description", () => {
    expect(validateSkillDescription("A useful skill")).toEqual([]);
  });

  it("errors when description is undefined", () => {
    const errors = validateSkillDescription(undefined);
    expect(errors).toContainEqual(expect.stringContaining("description is required"));
  });

  it("errors when description is empty string", () => {
    const errors = validateSkillDescription("");
    expect(errors).toContainEqual(expect.stringContaining("description is required"));
  });

  it("errors when description is whitespace only", () => {
    const errors = validateSkillDescription("   ");
    expect(errors).toContainEqual(expect.stringContaining("description is required"));
  });

  it("errors when description exceeds 1024 characters", () => {
    const long = "x".repeat(1025);
    const errors = validateSkillDescription(long);
    expect(errors).toContainEqual(expect.stringContaining("exceeds 1024 characters"));
  });

  it("accepts a description at exactly 1024 characters", () => {
    expect(validateSkillDescription("x".repeat(1024))).toEqual([]);
  });
});

describe("validateFrontmatterFields", () => {
  it("returns no errors for all allowed fields", () => {
    const allowed = [
      "name",
      "description",
      "license",
      "compatibility",
      "metadata",
      "allowed-tools",
      "command-dispatch",
      "command-tool",
      "command-arg-mode",
    ];
    expect(validateFrontmatterFields(allowed)).toEqual([]);
  });

  it("returns no errors for empty keys array", () => {
    expect(validateFrontmatterFields([])).toEqual([]);
  });

  it("errors for unknown fields", () => {
    const errors = validateFrontmatterFields(["name", "bogus-field"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('unknown frontmatter field "bogus-field"');
  });

  it("errors for multiple unknown fields", () => {
    const errors = validateFrontmatterFields(["foo", "bar"]);
    expect(errors).toHaveLength(2);
  });
});

describe("parseSkillFrontmatter", () => {
  it("parses valid frontmatter with all fields", () => {
    const input = `---
name: my-skill
description: A test skill
license: MIT
compatibility: >=1.0.0
command-dispatch: direct
command-tool: bash
command-arg-mode: strict
---
Body content here`;

    const result = parseSkillFrontmatter(input);
    expect(result.frontmatter.name).toBe("my-skill");
    expect(result.frontmatter.description).toBe("A test skill");
    expect(result.frontmatter.license).toBe("MIT");
    expect(result.frontmatter.compatibility).toBe(">=1.0.0");
    expect(result.frontmatter["command-dispatch"]).toBe("direct");
    expect(result.frontmatter["command-tool"]).toBe("bash");
    expect(result.frontmatter["command-arg-mode"]).toBe("strict");
    expect(result.body).toBe("Body content here");
    expect(result.warnings).toEqual([]);
  });

  it("returns empty frontmatter and full body when no frontmatter block", () => {
    const input = "Just a body with no frontmatter";
    const result = parseSkillFrontmatter(input);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(input);
    expect(result.warnings).toEqual([]);
  });

  it("handles empty string input", () => {
    const result = parseSkillFrontmatter("");
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("");
    expect(result.warnings).toEqual([]);
  });

  it("handles frontmatter with no body", () => {
    const input = `---
name: my-skill
---
`;
    const result = parseSkillFrontmatter(input);
    expect(result.frontmatter.name).toBe("my-skill");
    expect(result.body).toBe("");
  });

  it("handles frontmatter with empty body (no trailing newline)", () => {
    const input = `---
name: my-skill
---`;
    const result = parseSkillFrontmatter(input);
    expect(result.frontmatter.name).toBe("my-skill");
    expect(result.body).toBe("");
  });

  it("skips lines without colons in YAML section", () => {
    const input = `---
name: my-skill
this line has no colon
description: hello
---
body`;

    const result = parseSkillFrontmatter(input);
    expect(result.frontmatter.name).toBe("my-skill");
    expect(result.frontmatter.description).toBe("hello");
  });

  it("parses metadata as JSON object when valid JSON", () => {
    const input = `---
metadata: {"key": "value", "num": 42}
---
body`;

    const result = parseSkillFrontmatter(input);
    expect(result.frontmatter.metadata).toEqual({ key: "value", num: 42 });
  });

  it("keeps metadata as string when not valid JSON", () => {
    const input = `---
metadata: not-json-at-all
---
body`;

    const result = parseSkillFrontmatter(input);
    expect(result.frontmatter.metadata).toBe("not-json-at-all");
  });

  it("parses allowed-tools as JSON array when valid JSON", () => {
    const input = `---
allowed-tools: ["tool-a", "tool-b"]
---
body`;

    const result = parseSkillFrontmatter(input);
    expect(result.frontmatter["allowed-tools"]).toEqual(["tool-a", "tool-b"]);
  });

  it("parses allowed-tools as comma-separated when not valid JSON", () => {
    const input = `---
allowed-tools: tool-a, tool-b, tool-c
---
body`;

    const result = parseSkillFrontmatter(input);
    expect(result.frontmatter["allowed-tools"]).toEqual(["tool-a", "tool-b", "tool-c"]);
  });

  it("produces warnings for unknown frontmatter fields", () => {
    const input = `---
name: my-skill
unknown-field: hello
another-bad: world
---
body`;

    const result = parseSkillFrontmatter(input);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0].message).toContain('unknown frontmatter field "unknown-field"');
    expect(result.warnings[1].message).toContain('unknown frontmatter field "another-bad"');
    expect(result.warnings[0].skillPath).toBe("");
  });

  it("handles unicode characters in field values", () => {
    const input = `---
name: my-skill
description: A skill with unicode: café
---
body`;

    const result = parseSkillFrontmatter(input);
    expect(result.frontmatter.description).toContain("caf");
  });

  it("handles values containing colons", () => {
    const input = `---
description: time is: 12:30:00
---
body`;

    const result = parseSkillFrontmatter(input);
    expect(result.frontmatter.description).toBe("time is: 12:30:00");
  });

  it("does not match frontmatter if --- is not at start of string", () => {
    const input = `\n---
name: my-skill
---
body`;

    const result = parseSkillFrontmatter(input);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(input);
  });

  it("handles only frontmatter delimiters with no content", () => {
    const input = `---

---
body`;

    const result = parseSkillFrontmatter(input);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("body");
  });
});
