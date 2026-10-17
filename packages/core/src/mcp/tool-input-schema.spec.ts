import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { stripUnsupportedSchemaKeywords } from "../action.js";
import { flattenComposedRootSchema } from "../agent/engine/flatten-composed-root-schema.js";
import { normalizeToolInputSchema } from "../agent/production-agent.js";
import { providerSchemaViolations } from "./provider-schema-conformance.js";
import { McpToolSchemaError, mcpToolInputSchema } from "./tool-input-schema.js";

type JsonSchema = Record<string, any>;

const COMPOSITIONS = ["anyOf", "oneOf", "allOf"] as const;

function expectNoRootComposition(schema: Record<string, unknown>) {
  for (const keyword of COMPOSITIONS)
    expect(schema).not.toHaveProperty(keyword);
  expect(schema.type).toBe("object");
}

const ajv = () => new Ajv2020({ strict: false, validateFormats: false });

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
      const result = mcpToolInputSchema("migration", schema) as JsonSchema;
      expectNoRootComposition(result);
      const any = { $ref: "#/$defs/JsonValue" };
      expect(result.properties).toEqual({
        phase: { anyOf: [{ const: "validate" }, { const: "verify" }] },
        plan: { anyOf: [{ type: "object" }, any] },
        digest: { anyOf: [{ type: "string" }, any] },
      });
      expect(result.required).toEqual(["phase"]);
      expect(result.description).toContain('phase="verify": requires digest');
      expect(schema).not.toHaveProperty("type");
      const before = ajv().compile(schema);
      const after = ajv().compile(result);
      for (const input of [
        { phase: "validate", plan: {} },
        { phase: "verify", digest: "test-digest" },
        { phase: "verify", digest: "d", plan: 7 },
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
    const before = ajv().compile(schema);
    const after = ajv().compile(result);
    for (const [input, valid] of [
      [{ id: "row", value: null }, true],
      [{ id: "row", value: [1, { nested: true }] }, true],
      [{ id: "row", value: [[1, [2]], { deep: [[]] }] }, true],
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
    const result = mcpToolInputSchema("raw-parameters", schema) as JsonSchema;
    expect(result.properties.labels).not.toHaveProperty("propertyNames");
    expect(result.properties.target).toEqual({
      anyOf: [{ type: "string" }, { type: "number" }],
    });
    expect(result.properties.payload).toEqual({
      description: "Any JSON value",
      $ref: "#/$defs/JsonValue",
    });
    expect(result.$defs.JsonValue.anyOf).toContainEqual({
      type: "array",
      items: { $ref: "#/$defs/JsonValue" },
    });
    expect(schema.properties.labels).toHaveProperty("propertyNames");
    expect(schema.properties.target).toHaveProperty("oneOf");
    expect(schema.properties.payload).not.toHaveProperty("$ref");
  });

  it("replaces the action layer's bounded any-value with the recursive one", () => {
    const zodLike = stripUnsupportedSchemaKeywords({
      type: "object",
      properties: { value: { description: "Anything" } },
    });
    const result = mcpToolInputSchema("zod-action", zodLike) as JsonSchema;

    expect(result.properties.value).toEqual({
      description: "Anything",
      $ref: "#/$defs/JsonValue",
    });
    expect(ajv().validate(result, { value: [[[1]]] })).toBe(true);
  });

  it("does not take over a JsonValue definition the action already declares", () => {
    const result = mcpToolInputSchema("own-defs", {
      type: "object",
      $defs: { JsonValue: { type: "string" } },
      properties: {
        named: { $ref: "#/$defs/JsonValue" },
        anything: {},
      },
    }) as JsonSchema;

    expect(result.$defs.JsonValue).toEqual({ type: "string" });
    expect(result.properties.anything).toEqual({ $ref: "#/$defs/JsonValue2" });
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

    const result = mcpToolInputSchema("profiled", schema) as JsonSchema;
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

  it.each([
    ["NaN", Number.NaN, "/properties/limit/default"],
    ["Infinity", Number.POSITIVE_INFINITY, "/properties/limit/default"],
    ["a function", () => 5, "/properties/limit/default"],
    ["undefined", undefined, "/properties/limit/default"],
    ["a Date", new Date(0), "/properties/limit/default"],
  ])("refuses a %s default instead of coercing it", (_label, value, path) => {
    const schema = {
      type: "object",
      properties: { limit: { type: "number", default: value } },
    };
    let error: unknown;
    try {
      mcpToolInputSchema("paged-list", schema);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(McpToolSchemaError);
    expect(error).toMatchObject({ tool: "paged-list", path });
  });

  it("refuses a reference that does not resolve", () => {
    expect(() =>
      mcpToolInputSchema("dangling", {
        type: "object",
        properties: { a: { $ref: "#/$defs/Missing" } },
      }),
    ).toThrow(McpToolSchemaError);
  });
});

/**
 * Each schema with inputs it accepts. Normalizing must keep accepting every
 * one: a host that checks arguments against the advertised schema would
 * otherwise refuse calls the action takes. The inputs target each rewrite
 * that once tightened a schema.
 */
const IMPLICATION_CORPUS: {
  name: string;
  schema: JsonSchema;
  inputs: unknown[];
  /** Inputs the in-app path's bounded any-value cannot admit. */
  deepInputs?: unknown[];
}[] = [
  {
    name: "open anyOf branches",
    schema: {
      type: "object",
      anyOf: [
        { type: "object", properties: { x: { type: "string" } } },
        { type: "object", properties: { y: { type: "string" } } },
      ],
    },
    inputs: [{ x: 42, y: "yes" }, { x: "a", y: [1] }, {}],
  },
  {
    name: "discriminated union with open phase branches",
    schema: {
      anyOf: [
        {
          type: "object",
          properties: { phase: { const: "plan" }, plan: { type: "object" } },
          required: ["phase", "plan"],
        },
        {
          type: "object",
          properties: {
            phase: { const: "verify" },
            digest: { type: "string", minLength: 4 },
          },
          required: ["phase", "digest"],
        },
      ],
    },
    inputs: [
      { phase: "plan", plan: {}, digest: 1 },
      { phase: "verify", digest: "abcd", plan: "x" },
    ],
  },
  {
    name: "closed oneOf branches",
    schema: {
      oneOf: [
        {
          type: "object",
          properties: { kind: { const: "a" }, a: { type: "string" } },
          required: ["kind"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: { kind: { const: "b" }, b: { type: "number" } },
          required: ["kind", "b"],
          additionalProperties: false,
        },
      ],
    },
    inputs: [{ kind: "a" }, { kind: "a", a: "x" }, { kind: "b", b: 2 }],
  },
  {
    name: "open allOf branches",
    schema: {
      type: "object",
      allOf: [
        {
          properties: {
            databaseId: { type: "string" },
            itemIds: { type: "array", items: { type: "string" } },
          },
        },
        {
          properties: { propertyId: { type: "string" }, value: {} },
          required: ["propertyId", "value"],
        },
      ],
    },
    inputs: [
      { propertyId: "p", value: null, databaseId: "d" },
      { propertyId: "p", value: { a: 1 }, extra: true },
    ],
    deepInputs: [{ propertyId: "p", value: [[1, 2], [3]] }],
  },
  {
    name: "untyped value",
    schema: { type: "object", properties: { value: {} } },
    inputs: [{ value: null }, { value: "s" }, { value: [1, { a: 2 }] }],
    deepInputs: [
      { value: [[1]] },
      { value: [[[{ a: [1] }]]] },
      { value: { a: { b: [[]] } } },
    ],
  },
  {
    name: "boolean subschemas",
    schema: {
      type: "object",
      properties: {
        anything: true,
        list: { type: "array", items: true },
      },
    },
    inputs: [{ anything: 1, list: [1, "a", null] }],
    deepInputs: [{ anything: [[1]], list: [[2]] }],
  },
  {
    name: "patternProperties beside additionalProperties: false",
    schema: {
      type: "object",
      properties: { id: { type: "string" } },
      patternProperties: { "^x": { type: "string" } },
      additionalProperties: false,
    },
    inputs: [{ x: "yes" }, { id: "1", xa: "b" }],
  },
  {
    name: "patternProperties beside an additionalProperties schema",
    schema: {
      type: "object",
      properties: {
        metrics: {
          type: "object",
          patternProperties: { "^n": { type: "number" } },
          additionalProperties: { type: "string" },
        },
      },
    },
    inputs: [{ metrics: { n1: 3, label: "s" } }],
  },
  {
    name: "unevaluatedProperties fed by if/then",
    schema: {
      type: "object",
      properties: { kind: { type: "string" } },
      if: { properties: { kind: { const: "a" } } },
      then: { properties: { extra: { type: "string" } } },
      unevaluatedProperties: false,
    },
    inputs: [{ kind: "a", extra: "x" }, { kind: "b" }],
  },
  {
    name: "unevaluatedItems fed by prefixItems",
    schema: {
      type: "object",
      properties: {
        pair: {
          type: "array",
          prefixItems: [{ type: "string" }, { type: "string", format: "uri" }],
          unevaluatedItems: false,
        },
      },
    },
    inputs: [{ pair: ["a", "b"] }],
  },
  {
    name: "maxContains over a loosened contains",
    schema: {
      type: "object",
      properties: {
        list: {
          type: "array",
          items: { type: "string" },
          contains: { type: "string", pattern: "^(?=a)" },
          maxContains: 1,
        },
      },
    },
    inputs: [{ list: ["a1", "b2", "c3"] }],
  },
  {
    name: "not and dependent keywords",
    schema: {
      type: "object",
      properties: {
        card: { type: "string" },
        cvc: { type: "string" },
        v: { not: { type: "string" } },
      },
      dependentRequired: { card: ["cvc"] },
      dependentSchemas: { card: { required: ["cvc"] } },
    },
    inputs: [{ card: "4", cvc: "1", v: 2 }, {}],
  },
  {
    name: "record with propertyNames",
    schema: {
      type: "object",
      properties: {
        labels: {
          type: "object",
          propertyNames: { pattern: "^[a-z]+$" },
          additionalProperties: { type: "string" },
        },
      },
    },
    inputs: [{ labels: { abc: "x" } }],
  },
  {
    name: "nested oneOf",
    schema: {
      type: "object",
      properties: {
        shape: {
          oneOf: [
            {
              type: "object",
              properties: { kind: { const: "c" }, r: { type: "number" } },
              required: ["kind", "r"],
            },
            {
              type: "object",
              properties: { kind: { const: "s" }, w: { type: "number" } },
              required: ["kind", "w"],
            },
          ],
        },
      },
    },
    inputs: [{ shape: { kind: "c", r: 1 } }, { shape: { kind: "s", w: 2 } }],
  },
  {
    name: "unsupported format and lookaround pattern",
    schema: {
      type: "object",
      properties: {
        url: { type: "string", format: "uri" },
        code: { type: "string", pattern: "^(?!x)" },
      },
    },
    inputs: [{ url: "https://example.com", code: "abc" }],
  },
  {
    name: "definitions local to a branch",
    schema: {
      anyOf: [
        {
          type: "object",
          $defs: { Item: { type: "string" } },
          properties: { a: { $ref: "#/anyOf/0/$defs/Item" } },
          required: ["a"],
        },
        {
          type: "object",
          properties: { b: { type: "number" } },
          required: ["b"],
        },
      ],
    },
    inputs: [{ a: "x" }, { b: 1 }],
  },
  {
    name: "reference into a branch",
    schema: {
      type: "object",
      properties: { copy: { $ref: "#/anyOf/0/properties/a" } },
      anyOf: [
        { properties: { a: { type: "string" } } },
        { properties: { b: { type: "number" } } },
      ],
    },
    inputs: [{ copy: "s", a: "t" }],
  },
  {
    name: "reference into a oneOf the rewrite renumbers",
    schema: {
      type: "object",
      properties: {
        mode: { oneOf: [{ const: "slow" }, { const: "safe" }] },
        copy: { $ref: "#/properties/mode/oneOf/1" },
      },
    },
    inputs: [{ mode: "slow", copy: "safe" }],
  },
  {
    name: "recursive branch definition",
    schema: {
      anyOf: [
        {
          type: "object",
          $defs: {
            Link: {
              type: "object",
              properties: { next: { $ref: "#/anyOf/0/$defs/Link" } },
            },
          },
          properties: { head: { $ref: "#/anyOf/0/$defs/Link" } },
        },
        {
          type: "object",
          properties: { z: { type: "string" } },
          required: ["z"],
        },
      ],
    },
    inputs: [{ head: { next: { next: {} } } }, { z: "1" }],
  },
  {
    name: "root definition referenced from branches",
    schema: {
      type: "object",
      $defs: { Id: { type: "string", minLength: 1 } },
      oneOf: [
        { properties: { id: { $ref: "#/$defs/Id" } }, required: ["id"] },
        {
          properties: { ids: { type: "array", items: { $ref: "#/$defs/Id" } } },
          required: ["ids"],
        },
      ],
    },
    inputs: [{ id: "a" }, { ids: ["a", "b"] }],
  },
];

describe("normalized schemas never reject an input the original accepts", () => {
  it.each(IMPLICATION_CORPUS)(
    "MCP: $name",
    ({ schema, inputs, deepInputs }) => {
      const original = ajv().compile(schema);
      const advertised = mcpToolInputSchema("corpus-tool", schema);
      const normalized = ajv().compile(advertised);
      for (const input of [...inputs, ...(deepInputs ?? [])]) {
        expect(original(input), JSON.stringify(input)).toBe(true);
        expect(normalized(input), JSON.stringify(input)).toBe(true);
      }
      expect(
        providerSchemaViolations({
          name: "corpus-tool",
          inputSchema: advertised,
        }),
      ).toEqual([]);
    },
  );

  it.each(IMPLICATION_CORPUS)("in-app agent: $name", ({ schema, inputs }) => {
    // The in-app path keeps the bounded any-value its Gemini adapter needs,
    // so only `deepInputs` are exempt there.
    const original = ajv().compile(schema);
    const engineSchema = normalizeToolInputSchema(schema as never);
    if (!engineSchema) throw new Error("not an object-only schema");
    const inApp = flattenComposedRootSchema(engineSchema);
    const normalized = ajv().compile(inApp);
    for (const input of inputs) {
      expect(original(input), JSON.stringify(input)).toBe(true);
      expect(normalized(input), JSON.stringify(input)).toBe(true);
    }
  });
});
