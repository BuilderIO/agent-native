import Ajv from "ajv";
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

// `ownProperties`: otherwise a key every object inherits, like `constructor`,
// counts as present in an instance that does not hold it.
const ajv = () =>
  new Ajv2020({ strict: false, validateFormats: false, ownProperties: true });

/**
 * Ajv skips a property named `__proto__` (`allSchemaProperties` drops it), so
 * checks rename it once the rewrite has run, in the schema and the input
 * alike. A rewrite that lost the property shows as a schema without it.
 */
function visibleToAjv<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replaceAll("__proto__", "proto_"));
}

const NUMBER_HINTS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
];

/**
 * The schema Codex sends after `sanitize_json_schema`
 * (codex-rs/tools/src/json_schema.rs): a boolean becomes `{ type: "string" }`
 * outside additionalProperties, `const` becomes a one-value enum, a typeless
 * position is typed from its keywords, and an array gets string items.
 * Keywords Codex drops only widen, so they are kept here.
 */
function codexLowered(schema: unknown, keyword?: string): unknown {
  if (typeof schema === "boolean") {
    return keyword === "additionalProperties" ? schema : { type: "string" };
  }
  if (Array.isArray(schema)) return schema.map((item) => codexLowered(item));
  if (!schema || typeof schema !== "object") return schema;
  const map: JsonSchema = { ...schema };
  const lowerMap = (value: JsonSchema) =>
    Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, codexLowered(child)]),
    );
  if (map.properties) map.properties = lowerMap(map.properties);
  if (map.items !== undefined) map.items = codexLowered(map.items);
  if (map.additionalProperties !== undefined) {
    map.additionalProperties = codexLowered(
      map.additionalProperties,
      "additionalProperties",
    );
  }
  if (map.prefixItems) map.prefixItems = codexLowered(map.prefixItems);
  for (const key of [...COMPOSITIONS, "$defs", "definitions"]) {
    if (map[key] === undefined) continue;
    map[key] = Array.isArray(map[key])
      ? codexLowered(map[key])
      : lowerMap(map[key]);
  }
  if (map.const !== undefined) {
    map.enum = [map.const];
    delete map.const;
  }
  const types: string[] = map.type === undefined ? [] : [map.type].flat();
  const composed = COMPOSITIONS.some((key) => key in map);
  if (types.length === 0 && (map.$ref !== undefined || composed)) return map;
  if (types.length === 0) {
    if (
      ["properties", "required", "additionalProperties"].some((k) => k in map)
    )
      types.push("object");
    else if ("items" in map || "prefixItems" in map) types.push("array");
    else if ("enum" in map || "format" in map) types.push("string");
    else if (NUMBER_HINTS.some((k) => k in map)) types.push("number");
    else return {};
    map.type = types[0];
  }
  if (types.includes("object") && !("properties" in map)) map.properties = {};
  if (types.includes("array") && !("items" in map)) {
    map.items = { type: "string" };
  }
  return map;
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
      const result = mcpToolInputSchema("migration", schema) as JsonSchema;
      expectNoRootComposition(result);
      const any = { $ref: "#/$defs/JsonValue" };
      expect(result.properties).toEqual({
        phase: {
          anyOf: [
            { type: "string", enum: ["validate"] },
            { type: "string", enum: ["verify"] },
          ],
        },
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

  it("refuses a missing reference that flattening would remove", () => {
    const schema = {
      type: "object",
      anyOf: [
        { $ref: "#/$defs/Missing" },
        { type: "object", properties: { ok: { type: "string" } } },
      ],
    };
    expect(() => ajv().compile(schema)).toThrow(/can't resolve reference/);
    let error: unknown;
    try {
      mcpToolInputSchema("broken-composition", schema);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(McpToolSchemaError);
    expect(error).toMatchObject({
      tool: "broken-composition",
      path: "/anyOf/0",
    });
    expect((error as Error).message).toContain('"#/$defs/Missing"');
  });

  it.each([
    [
      "a reference outside the schema",
      { type: "object", properties: { a: { $ref: "https://example.com/a" } } },
      "/properties/a",
    ],
    [
      "an $id below the root",
      {
        type: "object",
        $defs: { Inner: { $id: "inner", type: "object" } },
        properties: { inner: { $ref: "#/$defs/Inner" } },
      },
      "/$defs/Inner",
    ],
    [
      "a dynamic reference",
      { type: "object", properties: { a: { $dynamicRef: "#node" } } },
      "/properties/a",
    ],
    [
      "a duplicated anchor",
      {
        type: "object",
        properties: {
          a: { $anchor: "Thing", type: "string" },
          b: { $anchor: "Thing", type: "number" },
        },
      },
      "/properties/b",
    ],
  ])("refuses %s instead of guessing its target", (_label, schema, path) => {
    let error: unknown;
    try {
      mcpToolInputSchema("scoped-refs", schema);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(McpToolSchemaError);
    expect(error).toMatchObject({ tool: "scoped-refs", path });
  });

  it("rewrites encoded pointers and anchors to plain pointers", () => {
    const result = mcpToolInputSchema("spelled-refs", {
      type: "object",
      $defs: { "a b": { type: "string" } },
      properties: {
        spaced: { $ref: "#/$defs/a%20b" },
        encoded: { $ref: "#%2F%24defs%2Fa%20b" },
        anchored: { $ref: "#Thing" },
        thing: { $anchor: "Thing", type: "number" },
      },
    }) as JsonSchema;

    expect(result.properties.spaced).toEqual({ $ref: "#/$defs/a%20b" });
    expect(result.properties.encoded).toEqual({ $ref: "#/$defs/a%20b" });
    expect(result.properties.anchored).toEqual({
      $ref: "#/$defs/properties_thing",
    });
    expect(JSON.stringify(result)).not.toContain("$anchor");
    expect(
      ajv().validate(result, { spaced: "x", encoded: "y", anchored: 1 }),
    ).toBe(true);
  });

  it("moves maxItems into the description", () => {
    const result = mcpToolInputSchema("bounded-list", {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, maxItems: 100 },
        rows: {
          type: "array",
          items: { type: "object" },
          minItems: 1,
          maxItems: 1000,
          description: "Rows to add.",
        },
      },
    }) as JsonSchema;

    expect(result.properties.ids).toEqual({
      type: "array",
      items: { type: "string" },
      description: "At most 100 items.",
    });
    expect(result.properties.rows).toEqual({
      type: "array",
      items: { type: "object" },
      minItems: 1,
      description: "Rows to add. At most 1000 items.",
    });
  });

  it("types a typeless const and splits a mixed enum into typed branches", () => {
    const result = mcpToolInputSchema("enumerated", {
      type: "object",
      properties: {
        one: { const: 1 },
        kind: { const: "text" },
        flag: { type: "boolean", const: false },
        names: { enum: ["a", "b"], description: "Name" },
        mixed: { enum: [1, "a", null, 2.5] },
      },
    }) as JsonSchema;

    expect(result.properties).toEqual({
      one: { type: "number", const: 1 },
      kind: { type: "string", enum: ["text"] },
      flag: { type: "boolean", const: false },
      names: { type: "string", enum: ["a", "b"], description: "Name" },
      mixed: {
        anyOf: [
          { type: "number", enum: [1, 2.5] },
          { type: "string", enum: ["a"] },
          { type: "null" },
        ],
      },
    });
    const lowered = ajv().compile(codexLowered(result) as JsonSchema);
    for (const input of [
      { one: 1 },
      { kind: "text" },
      { mixed: 1 },
      { mixed: null },
    ]) {
      expect(lowered(input), JSON.stringify(input)).toBe(true);
    }
  });

  it("narrows a string const beside an enum to the one value both allow", () => {
    const result = mcpToolInputSchema("narrowed", {
      type: "object",
      properties: {
        kind: { type: "string", const: "x", enum: ["x", "y"] },
        typeless: { const: "x", enum: [1, "x"] },
        count: { type: "number", const: 1, enum: [1, 2] },
      },
    }) as JsonSchema;

    expect(result.properties).toEqual({
      kind: { type: "string", enum: ["x"] },
      typeless: { type: "string", enum: ["x"] },
      count: { type: "number", const: 1, enum: [1, 2] },
    });
    expect(
      providerSchemaViolations({ name: "narrowed", inputSchema: result }),
    ).toEqual([]);
    const lowered = ajv().compile(codexLowered(result) as JsonSchema);
    for (const input of [{ kind: "x" }, { typeless: "x" }, { count: 1 }]) {
      expect(lowered(input), JSON.stringify(input)).toBe(true);
    }
  });

  it.each([
    ["a string", { const: "z", enum: ["x", "y"] }],
    ["a number", { type: "number", const: 3, enum: [1, 2] }],
    ["an object", { const: { a: 1 }, enum: [{ a: 2 }] }],
  ])(
    "refuses %s const its enum does not list, which accepts no value",
    (_label, kind) => {
      let error: unknown;
      try {
        mcpToolInputSchema("unsatisfiable", {
          type: "object",
          properties: { kind },
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(McpToolSchemaError);
      expect(error).toMatchObject({
        tool: "unsatisfiable",
        path: "/properties/kind",
        message:
          'MCP tool "unsatisfiable" has an input schema that declares a const its enum does not list, so it accepts no value at /properties/kind.',
      });
    },
  );

  it("accepts a const its enum lists with keys in another order", () => {
    const result = mcpToolInputSchema("reordered", {
      type: "object",
      properties: { kind: { const: { a: 1, b: 2 }, enum: [{ b: 2, a: 1 }] } },
    }) as JsonSchema;

    expect(result.properties.kind).toMatchObject({ type: "object" });
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
    name: "typeless const and mixed enum",
    schema: {
      type: "object",
      properties: {
        one: { const: 1 },
        flag: { const: false },
        mixed: { enum: [1, "a", null] },
        either: { anyOf: [{ type: "object" }], enum: [{ a: 1 }, 2] },
      },
    },
    inputs: [
      { one: 1, flag: false, mixed: 1 },
      { mixed: "a" },
      { mixed: null },
      { either: { a: 1 } },
    ],
  },
  {
    name: "percent-encoded pointer into a branch",
    schema: {
      type: "object",
      properties: { copy: { $ref: "#%2FanyOf%2F0%2Fproperties%2Fa" } },
      anyOf: [
        { properties: { a: { type: "string" } } },
        { properties: { b: { type: "number" } } },
      ],
    },
    inputs: [{ copy: "x" }, { copy: "x", a: "y" }],
  },
  {
    name: "anchor inside a branch",
    schema: {
      type: "object",
      properties: { value: { $ref: "#Thing" } },
      anyOf: [
        {
          type: "object",
          $defs: { Thing: { $anchor: "Thing", type: "string" } },
        },
        { type: "object" },
      ],
    },
    inputs: [{ value: "x" }, {}],
  },
  {
    name: "boolean branch inside a nested anyOf",
    schema: {
      type: "object",
      anyOf: [
        {
          type: "object",
          properties: { value: { anyOf: [true, { type: "string" }] } },
        },
        { type: "object", properties: { value: { type: "number" } } },
      ],
    },
    inputs: [{ value: false }, { value: "x" }, { value: 1 }, { value: {} }],
    deepInputs: [{ value: [[1]] }],
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
  {
    name: "properties named __proto__ and constructor",
    schema: JSON.parse(
      '{"type":"object","additionalProperties":false,"properties":{"__proto__":{"type":"string"},"constructor":{"type":"number"}},"anyOf":[{"required":["__proto__"]},{"required":["constructor"]}]}',
    ),
    inputs: [
      JSON.parse('{"__proto__":"x"}'),
      JSON.parse('{"constructor":1}'),
      JSON.parse('{"__proto__":"x","constructor":2}'),
    ],
  },
];

describe("normalized schemas never reject an input the original accepts", () => {
  it.each(IMPLICATION_CORPUS)(
    "MCP: $name",
    ({ schema, inputs, deepInputs }) => {
      const original = ajv().compile(visibleToAjv(schema));
      const advertised = mcpToolInputSchema("corpus-tool", schema);
      const normalized = ajv().compile(visibleToAjv(advertised));
      const lowered = ajv().compile(
        visibleToAjv(codexLowered(advertised)) as JsonSchema,
      );
      for (const input of [...inputs, ...(deepInputs ?? [])].map(
        visibleToAjv,
      )) {
        expect(original(input), JSON.stringify(input)).toBe(true);
        expect(normalized(input), JSON.stringify(input)).toBe(true);
        expect(lowered(input), `Codex: ${JSON.stringify(input)}`).toBe(true);
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
    const original = ajv().compile(visibleToAjv(schema));
    const engineSchema = normalizeToolInputSchema(schema as never);
    if (!engineSchema) throw new Error("not an object-only schema");
    const inApp = flattenComposedRootSchema(engineSchema);
    const normalized = ajv().compile(visibleToAjv(inApp));
    for (const input of inputs.map(visibleToAjv)) {
      expect(original(input), JSON.stringify(input)).toBe(true);
      expect(normalized(input), JSON.stringify(input)).toBe(true);
    }
  });
});

/** A deterministic PRNG, so a failure names a schema the next run rebuilds. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SAMPLE_VALUES: unknown[] = [
  false,
  true,
  0,
  2.5,
  "",
  "x",
  null,
  [],
  [1],
  ["x", null],
  [[1]],
  [{ a: [1] }],
  {},
  { a: 1 },
  { a: "x", b: null },
  { a: [[1]] },
];

/**
 * Generated schemas name their second property `b`, or a name every plain
 * object inherits: assigning `__proto__` sets the prototype instead of a
 * property, and `constructor` reads as present on an object without it.
 */
const SECOND_KEYS = ["b", "__proto__", "constructor"] as const;

/**
 * Every object over keys `a` and `second`, each absent or one sample value,
 * and a key `c` that no generated schema declares.
 */
function sampleInstances(second: string): Record<string, unknown>[] {
  return [
    ...[undefined, ...SAMPLE_VALUES].flatMap((a) =>
      [undefined, ...SAMPLE_VALUES].map((b) => ({
        ...(a === undefined ? {} : { a }),
        ...(b === undefined ? {} : { [second]: b }),
      })),
    ),
    { c: 1 },
    { a: "x", c: null },
    { c: [[1]] },
    { a: "x", c: { a: [1] } },
  ];
}

/**
 * Whether `value` holds an array directly inside an array. The in-app copy's
 * bounded "any value" cannot admit one (see `flattenComposedRootSchema`), so
 * that is the one input the in-app check skips.
 */
function containsNestedArray(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(Array.isArray);
  if (value && typeof value === "object") {
    return Object.values(value).some(containsNestedArray);
  }
  return false;
}

/**
 * Random object-only tool schemas built from the shapes the rewrites treat
 * specially: nested anyOf/oneOf/allOf, boolean subschemas, `$ref` into root
 * and branch `$defs`, nullable types, `const`/`enum` and the object keywords
 * (`propertyNames`, `patternProperties`, property counts) the flattener
 * carries as constraints.
 */
function schemaGenerator(random: () => number) {
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(random() * items.length)]!;
  const chance = (p: number) => random() < p;
  let keys: readonly string[] = [];

  function value(depth: number, refs: readonly string[]): unknown {
    const leaves: (() => unknown)[] = [
      () => true,
      () => false,
      () => ({}),
      () => ({ type: pick(["string", "number", "boolean", "null"]) }),
      () => ({ type: [pick(["string", "number", "object"]), "null"] }),
      () => ({ const: pick(["x", "", 0, false, null]) }),
      () => ({
        enum: ["", 0, false, null].filter(() => chance(0.5)).concat("x"),
      }),
      ...(refs.length > 0 ? [() => ({ $ref: pick(refs) })] : []),
    ];
    if (depth <= 0) return pick(leaves)();
    const nested = () =>
      Array.from({ length: 1 + Math.floor(random() * 3) }, () =>
        value(depth - 1, refs),
      );
    return pick<() => unknown>([
      ...leaves,
      () => ({ anyOf: nested() }),
      () => ({ allOf: nested() }),
      () => ({ oneOf: nested() }),
      () => ({ anyOf: [value(depth - 1, refs), { type: "null" }] }),
      () => ({
        type: "array",
        items: value(depth - 1, refs),
        ...(chance(0.3) ? { maxItems: 1 } : {}),
      }),
      () => object(depth - 1, refs, ""),
    ])();
  }

  function object(
    depth: number,
    refs: readonly string[],
    pointer: string,
  ): JsonSchema {
    const schema: JsonSchema = chance(0.8) ? { type: "object" } : {};
    const localRefs = [...refs];
    if (pointer && chance(0.25)) {
      schema.$defs = { Local: value(1, []) };
      localRefs.push(`#${pointer}/$defs/Local`);
    }
    const properties = Object.fromEntries(
      keys.flatMap((key) =>
        chance(0.6) ? [[key, value(depth, localRefs)]] : [],
      ),
    );
    if (Object.keys(properties).length > 0) schema.properties = properties;
    const required = keys.filter(() => chance(0.3));
    if (required.length > 0) schema.required = required;
    if (chance(0.3)) {
      schema.additionalProperties = chance(0.5)
        ? chance(0.5)
        : value(0, localRefs);
    }
    if (chance(0.1)) schema.patternProperties = { "^a$": value(0, []) };
    if (chance(0.1)) {
      schema.propertyNames = pick([
        true,
        false,
        { pattern: `^(${keys.join("|")})$` },
      ]);
    }
    if (chance(0.1)) schema.minProperties = 1;
    if (chance(0.1)) schema.maxProperties = 1;
    return schema;
  }

  function branch(
    depth: number,
    refs: readonly string[],
    pointer: string,
  ): unknown {
    return pick<() => unknown>([
      () => true,
      () => false,
      () => ({ type: "string" }),
      () => ({ $ref: "#/$defs/Shape" }),
      () => object(depth, refs, pointer),
      () => object(depth, refs, pointer),
      () => object(depth, refs, pointer),
      () => {
        const keyword = pick(["anyOf", "allOf"]);
        return {
          [keyword]: [0, 1].map((index) =>
            branch(depth - 1, refs, `${pointer}/${keyword}/${index}`),
          ),
        };
      },
    ])();
  }

  return (second: string): JsonSchema => {
    keys = ["a", second];
    const refs = ["#/$defs/Scalar", "#/$defs/Wrapped"];
    const root = object(2, refs, "");
    root.type = "object";
    root.$defs = {
      Scalar: value(1, []),
      Wrapped: value(1, ["#/$defs/Scalar"]),
      Shape: object(1, ["#/$defs/Scalar"], "/$defs/Shape"),
    };
    for (const keyword of ["anyOf", "oneOf", "allOf"] as const) {
      if (!chance(0.5)) continue;
      root[keyword] = Array.from(
        { length: 1 + Math.floor(random() * 3) },
        (_, index) => branch(2, refs, `/${keyword}/${index}`),
      );
    }
    return root;
  };
}

/**
 * Draft-07 Ajv: Ajv2020's evaluated-property tracking throws on some
 * generated shapes (a `true` oneOf branch beside `patternProperties`),
 * and the generator uses no keyword the two drafts read differently.
 * One instance compiles all 2,000 schemas, because a new instance compiles
 * the meta-schema again to check each one, which took most of this test's
 * time. No schema has an `$id`, and `addUsedSchema: false` keeps each one
 * out of the instance's registry, so no compile can resolve into another.
 * `ownProperties` is the `ajv()` reason above.
 */
const draft07 = new Ajv({
  strict: false,
  validateFormats: false,
  addUsedSchema: false,
  ownProperties: true,
});

describe("generated schemas: whatever the original accepts, the rewrite accepts", () => {
  const generate = schemaGenerator(seededRandom(6889));
  const secondKeys = Array.from(
    { length: 400 },
    (_, index) => SECOND_KEYS[index % SECOND_KEYS.length]!,
  );
  const schemas = secondKeys.map(generate);
  const instances = new Map(
    SECOND_KEYS.map((key) => [key, sampleInstances(key).map(visibleToAjv)]),
  );

  it("holds for the MCP schema, its Codex lowering, the in-app schema and the bare flattener", () => {
    const failures: string[] = [];
    let accepted = 0;
    for (const [index, schema] of schemas.entries()) {
      const original = draft07.compile(visibleToAjv(schema));
      const advertised = mcpToolInputSchema("generated", schema);
      const engineSchema = normalizeToolInputSchema(schema as never);
      if (!engineSchema) throw new Error(`schema ${index} is not object-only`);
      const rewrites: [string, () => unknown, boolean][] = [
        ["MCP", () => advertised, false],
        ["Codex", () => codexLowered(advertised), false],
        ["in-app", () => flattenComposedRootSchema(engineSchema), true],
        [
          "flattener",
          () =>
            flattenComposedRootSchema(structuredClone(schema), {
              anyValue: () => ({}),
            }),
          false,
        ],
      ];
      const checks: [string, (input: unknown) => boolean, boolean][] = [];
      for (const [label, rewrite, bounded] of rewrites) {
        try {
          checks.push([
            label,
            draft07.compile(visibleToAjv(rewrite()) as JsonSchema),
            bounded,
          ]);
        } catch (error) {
          failures.push(`#${index} ${label}: ${String(error)}`);
        }
      }
      const violations = providerSchemaViolations({
        name: "generated",
        inputSchema: advertised,
      });
      if (violations.length > 0) {
        failures.push(`#${index} violations ${JSON.stringify(violations)}`);
      }
      for (const input of instances.get(secondKeys[index]!)!) {
        if (!original(input)) continue;
        accepted++;
        for (const [label, validate, bounded] of checks) {
          if (bounded && containsNestedArray(input)) continue;
          if (!validate(input)) {
            failures.push(
              `#${index} ${label} rejects ${JSON.stringify(input)}: ${JSON.stringify(schema)}`,
            );
          }
        }
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
    expect(failures).toHaveLength(0);
    // A generator that only builds unsatisfiable schemas would pass vacuously.
    expect(accepted).toBeGreaterThan(schemas.length * 20);
  });

  it("covers every shape the rewrites treat specially", () => {
    const text = JSON.stringify(schemas);
    for (const shape of [
      '"anyOf":[true',
      '"allOf":[false',
      '"oneOf"',
      '"$ref":"#/$defs/Wrapped"',
      '/$defs/Local"',
      '"null"]',
      '"const"',
      '"enum"',
      '"propertyNames":true',
      '"patternProperties"',
      '"maxItems"',
      '"__proto__":',
      '"constructor":',
    ]) {
      expect(text, shape).toContain(shape);
    }
  });
});
