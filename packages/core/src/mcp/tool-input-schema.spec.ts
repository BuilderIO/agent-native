import Ajv from "ajv";
import { describe, expect, it } from "vitest";

import { mcpToolInputSchema } from "./tool-input-schema.js";

describe("mcpToolInputSchema", () => {
  const validatePhase = {
    type: "object",
    properties: { phase: { const: "validate" }, plan: { type: "object" } },
    required: ["phase", "plan"],
  };
  const verifyPhase = {
    type: "object",
    properties: { phase: { const: "verify" }, digest: { type: "string" } },
    required: ["phase", "digest"],
  };

  it.each(["anyOf", "oneOf"])(
    "preserves %s branches and their accepted inputs",
    (keyword) => {
      const schema = { [keyword]: [validatePhase, verifyPhase] };
      const result = mcpToolInputSchema("migration", schema);
      expect(result).toEqual({ ...schema, type: "object" });
      expect(schema).not.toHaveProperty("type");
      const ajv = new Ajv({ strict: false });
      const before = ajv.compile(schema);
      const after = ajv.compile(result);
      for (const [input, valid] of [
        [{ phase: "validate", plan: {} }, true],
        [{ phase: "verify", digest: "test-digest" }, true],
        [{ phase: "validate" }, false],
        [{ phase: "verify", plan: {} }, false],
        [{ phase: "unknown", plan: {} }, false],
        [null, false],
        [[], false],
        ["validate", false],
      ] as const) {
        expect(before(input)).toBe(valid);
        expect(after(input)).toBe(valid);
      }
    },
  );

  it("preserves intersection constraints and nested arbitrary values", () => {
    const schema = {
      allOf: [
        {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        { properties: { value: {} }, required: ["value"] },
      ],
    };
    const result = mcpToolInputSchema("batch-update", schema);
    expect(result).toEqual({ ...schema, type: "object" });
    const ajv = new Ajv({ strict: false });
    const before = ajv.compile(schema);
    const after = ajv.compile(result);
    for (const [input, valid] of [
      [{ id: "row", value: null }, true],
      [{ id: "row", value: [1, { nested: true }] }, true],
      [{ id: "row" }, false],
      [{ value: "text" }, false],
      [[], false],
    ] as const) {
      expect(before(input)).toBe(valid);
      expect(after(input)).toBe(valid);
    }
  });

  it("preserves existing object schemas and permits absent parameters", () => {
    const schema = {
      type: "object",
      properties: { value: { anyOf: [{ type: "string" }, { type: "null" }] } },
    };
    expect(mcpToolInputSchema("object", schema)).toEqual(schema);
    expect(mcpToolInputSchema("no-args", undefined)).toEqual({
      type: "object",
      properties: {},
    });
    expect(
      mcpToolInputSchema("object-array-type", { type: ["object"] }),
    ).toEqual({ type: "object" });
  });

  it.each([
    null,
    true,
    false,
    {},
    { type: "string" },
    { type: ["object", "null"] },
    { anyOf: [validatePhase, { type: "string" }] },
    { anyOf: [] },
    { allOf: [] },
    { $ref: "#/$defs/input", $defs: { input: validatePhase } },
    { type: "string", allOf: [validatePhase] },
  ])("rejects an unproven object contract: %j", (schema) => {
    expect(() => mcpToolInputSchema("unsupported-tool", schema)).toThrow(
      /unsupported-tool.*object-only/,
    );
  });

  it("fails closed on cyclic compositions", () => {
    const schema: { anyOf: unknown[] } = { anyOf: [] };
    schema.anyOf.push(schema);
    expect(() => mcpToolInputSchema("cyclic-tool", schema)).toThrow(
      /cyclic-tool/,
    );
  });
});
