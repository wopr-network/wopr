import { describe, expect, it } from "vitest";
import { z } from "zod";
import { jsonSchemaToZod } from "../../src/plugins/schema-converter.js";

describe("jsonSchemaToZod", () => {
  it("returns z.unknown() for null/undefined input", () => {
    const schema = jsonSchemaToZod(null as never);
    expect(schema.safeParse("anything").success).toBe(true);
    expect(schema.safeParse(123).success).toBe(true);
  });

  it("returns z.unknown() for non-object input", () => {
    const schema = jsonSchemaToZod("not an object" as never);
    expect(schema.safeParse(42).success).toBe(true);
  });

  it("converts string type", () => {
    const schema = jsonSchemaToZod({ type: "string" });
    expect(schema.safeParse("hello").success).toBe(true);
    expect(schema.safeParse(123).success).toBe(false);
  });

  it("converts number type", () => {
    const schema = jsonSchemaToZod({ type: "number" });
    expect(schema.safeParse(42).success).toBe(true);
    expect(schema.safeParse("nope").success).toBe(false);
  });

  it("converts integer type to z.number()", () => {
    const schema = jsonSchemaToZod({ type: "integer" });
    expect(schema.safeParse(7).success).toBe(true);
    expect(schema.safeParse("nope").success).toBe(false);
  });

  it("converts boolean type", () => {
    const schema = jsonSchemaToZod({ type: "boolean" });
    expect(schema.safeParse(true).success).toBe(true);
    expect(schema.safeParse("yes").success).toBe(false);
  });

  it("converts array type with items", () => {
    const schema = jsonSchemaToZod({
      type: "array",
      items: { type: "string" },
    });
    expect(schema.safeParse(["a", "b"]).success).toBe(true);
    expect(schema.safeParse([1, 2]).success).toBe(false);
  });

  it("converts array type without items to z.array(z.unknown())", () => {
    const schema = jsonSchemaToZod({ type: "array" });
    expect(schema.safeParse([1, "mixed", true]).success).toBe(true);
  });

  it("converts object type with properties and required", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name"],
    });
    // name required, age optional
    expect(schema.safeParse({ name: "Alice" }).success).toBe(true);
    expect(schema.safeParse({ name: "Alice", age: 30 }).success).toBe(true);
    expect(schema.safeParse({ age: 30 }).success).toBe(false);
  });

  it("converts object type without properties to z.record()", () => {
    const schema = jsonSchemaToZod({ type: "object" });
    expect(schema.safeParse({ any: "value" }).success).toBe(true);
  });

  it("adds description to top-level schema", () => {
    const schema = jsonSchemaToZod({
      type: "string",
      description: "A name field",
    });
    expect(schema.description).toBe("A name field");
  });

  it("adds description to nested object properties", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        email: { type: "string", description: "User email" },
      },
      required: ["email"],
    }) as z.ZodObject<{ email: z.ZodString }>;
    expect(schema.shape.email.description).toBe("User email");
  });

  it("returns z.unknown() for unrecognized type", () => {
    const schema = jsonSchemaToZod({ type: "foobar" });
    expect(schema.safeParse("anything").success).toBe(true);
  });

  it("handles nested objects recursively", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        address: {
          type: "object",
          properties: {
            street: { type: "string" },
          },
          required: ["street"],
        },
      },
      required: ["address"],
    });
    expect(
      schema.safeParse({ address: { street: "123 Main" } }).success,
    ).toBe(true);
    expect(schema.safeParse({ address: {} }).success).toBe(false);
  });

  it("handles array of objects", () => {
    const schema = jsonSchemaToZod({
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "number" } },
        required: ["id"],
      },
    });
    expect(schema.safeParse([{ id: 1 }, { id: 2 }]).success).toBe(true);
    expect(schema.safeParse([{}]).success).toBe(false);
  });
});
