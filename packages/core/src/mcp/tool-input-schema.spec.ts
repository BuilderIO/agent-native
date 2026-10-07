import Ajv from "ajv";
import { describe, expect, it } from "vitest";

import { mcpToolInputSchema } from "./tool-input-schema.js";

const COMPOSITIONS = ["anyOf", "oneOf", "allOf"] as const;

function expectNoRootComposition(schema: Record<string, unknown>) {
  for (const keyword of COMPOSITIONS)
    expect(schema).not.toHaveProperty(keyword);
  expect(schema.type).toBe("object");
}

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
    "flattens a root %s into one object that accepts every branch's inputs",
    (keyword) => {
      const schema = { [keyword]: [validatePhase, verifyPhase] };
      const result = mcpToolInputSchema("migration", schema);
      expectNoRootComposition(result);
      expect(result.properties).toEqual({
        phase: { anyOf: [{ const: "validate" }, { const: "verify" }] },
        plan: { type: "object" },
        digest: { type: "string" },
      });
      expect(result.required).toEqual(["phase"]);
      expect(schema).not.toHaveProperty("type");
      const ajv = new Ajv({ strict: false });
      const before = ajv.compile(schema);
      const after = ajv.compile(result);
      for (const input of [
        { phase: "validate", plan: {} },
        { phase: "verify", digest: "test-digest" },
      ]) {
        expect(before(input)).toBe(true);
        expect(after(input)).toBe(true);
      }
      for (const input of [null, [], "validate", { phase: "unknown" }]) {
        expect(after(input)).toBe(false);
      }
    },
  );

  it("flattens a root allOf into the union of its properties and requirements", () => {
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
    expectNoRootComposition(result);
    expect(result.required).toEqual(["id", "value"]);
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

  it("strips provider-rejected keywords from hand-written JSON schemas", () => {
    const schema = {
      type: "object",
      properties: {
        labels: {
          type: "object",
          propertyNames: { pattern: "^[a-z]+$" },
          additionalProperties: { type: "string" },
        },
        target: {
          oneOf: [{ type: "string" }, { type: "number" }],
        },
        payload: { description: "Any JSON value" },
      },
      required: ["target"],
    };
    const result = mcpToolInputSchema("raw-parameters", schema);
    const properties = result.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(properties.labels).not.toHaveProperty("propertyNames");
    expect(properties.target).toEqual({
      anyOf: [{ type: "string" }, { type: "number" }],
    });
    expect(properties.payload.anyOf).toEqual(
      expect.arrayContaining([{ type: "string" }, { type: "null" }]),
    );
    expect(schema.properties.labels).toHaveProperty("propertyNames");
    expect(schema.properties.target).toHaveProperty("oneOf");
    expect(schema.properties.payload).not.toHaveProperty("anyOf");
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

  it("does not share mutable root properties with the action schema", () => {
    const schema = {
      type: "object",
      properties: { value: { type: "string", description: "Original" } },
      required: ["value"],
    };

    const result = mcpToolInputSchema("profiled", schema);
    result.properties.value.description = "Directory profile";
    result.required?.splice(0, 1);

    expect(schema.properties.value.description).toBe("Original");
    expect(schema.required).toEqual(["value"]);
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
