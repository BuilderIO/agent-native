import Ajv from "ajv";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  compileSchemaValidator,
  resetCodeGenerationProbeForTests,
  runtimeAllowsCodeGeneration,
} from "./json-schema-validator.js";

/**
 * The two validator paths must not disagree about what they accept, and the
 * coercing one must not disagree about the value it leaves behind. Error TEXT
 * is allowed to differ — Ajv reports through `ErrorObject`s and the interpreter
 * does not — so nothing here asserts wording.
 */

function rawToolInputAjv(): Ajv {
  return new Ajv({
    strict: false,
    allErrors: true,
    coerceTypes: true,
    useDefaults: false,
    removeAdditional: false,
    verbose: true,
  });
}

function placeholderAjv(): Ajv {
  return new Ajv({
    strict: false,
    allErrors: false,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
  });
}

/** Force the interpreted path by making the probe report the restriction. */
function withCodeGenerationForbidden<T>(run: () => T): T {
  resetCodeGenerationProbeForTests();
  const RealFunction = globalThis.Function;
  const stub = function BlockedFunction(this: unknown, ...args: unknown[]) {
    throw new EvalError(
      "Code generation from strings disallowed for this context",
    );
  } as unknown as FunctionConstructor;
  stub.prototype = RealFunction.prototype;
  vi.stubGlobal("Function", stub);
  try {
    expect(runtimeAllowsCodeGeneration()).toBe(false);
    vi.unstubAllGlobals();
    // The probe is cached, so restoring the real constructor afterwards keeps
    // the rest of the test runnable while the compile seam still takes the
    // interpreted branch.
    return run();
  } finally {
    vi.unstubAllGlobals();
    resetCodeGenerationProbeForTests();
  }
}

/** Representative of what `defineAction`'s zod → JSON Schema conversion emits. */
const TOOL_SCHEMA = {
  type: "object",
  properties: {
    designId: { type: "string" },
    count: { type: "integer" },
    ratio: { type: "number" },
    draft: { type: "boolean" },
    note: { type: ["string", "null"] },
    tags: { type: "array", items: { type: "string" } },
    nested: {
      type: "object",
      properties: { depth: { type: "integer" } },
    },
  },
  required: ["designId"],
  additionalProperties: false,
} as const;

const UNION_SCHEMA = {
  type: "object",
  properties: {
    op: {
      anyOf: [
        {
          type: "object",
          properties: {
            kind: { const: "move" },
            index: { type: "integer" },
          },
          required: ["kind", "index"],
        },
        {
          type: "object",
          properties: {
            kind: { const: "rename" },
            title: { type: "string" },
          },
          required: ["kind", "title"],
        },
      ],
    },
  },
  required: ["op"],
} as const;

const REF_SCHEMA = {
  type: "object",
  $defs: { positive: { type: "integer" } },
  properties: { size: { $ref: "#/$defs/positive" } },
  required: ["size"],
} as const;

interface Case {
  name: string;
  schema: object;
  input: unknown;
}

const CASES: Case[] = [
  { name: "empty object against an empty schema", schema: {}, input: {} },
  {
    name: "valid input",
    schema: TOOL_SCHEMA,
    input: { designId: "d1", count: 3, ratio: 1.5, draft: true },
  },
  {
    name: "missing required property",
    schema: TOOL_SCHEMA,
    input: { count: 3 },
  },
  {
    name: "additional property",
    schema: TOOL_SCHEMA,
    input: { designId: "d1", nope: 1 },
  },
  {
    name: "number sent as a string",
    schema: TOOL_SCHEMA,
    input: { designId: "d1", ratio: "1.5" },
  },
  {
    name: "integer sent as a string",
    schema: TOOL_SCHEMA,
    input: { designId: "d1", count: "7" },
  },
  {
    name: "non-integral string for an integer",
    schema: TOOL_SCHEMA,
    input: { designId: "d1", count: "7.5" },
  },
  {
    name: "unparseable string for a number",
    schema: TOOL_SCHEMA,
    input: { designId: "d1", ratio: "soon" },
  },
  {
    name: "boolean sent as a string",
    schema: TOOL_SCHEMA,
    input: { designId: "d1", draft: "true" },
  },
  {
    name: "unrecognised string for a boolean",
    schema: TOOL_SCHEMA,
    input: { designId: "d1", draft: "yes" },
  },
  {
    name: "number sent for a string",
    schema: TOOL_SCHEMA,
    input: { designId: 42 },
  },
  {
    name: "object sent for a string",
    schema: TOOL_SCHEMA,
    input: { designId: { a: 1 } },
  },
  {
    name: "coercible element inside an array",
    schema: TOOL_SCHEMA,
    input: { designId: "d1", tags: [1, "two"] },
  },
  {
    name: "coercible value inside a nested object",
    schema: TOOL_SCHEMA,
    input: { designId: "d1", nested: { depth: "2" } },
  },
  {
    name: "nullable union already null",
    schema: TOOL_SCHEMA,
    input: { designId: "d1", note: null },
  },
  {
    name: "matching discriminated union branch",
    schema: UNION_SCHEMA,
    input: { op: { kind: "move", index: 2 } },
  },
  {
    name: "discriminated union branch with a coercible member",
    schema: UNION_SCHEMA,
    input: { op: { kind: "move", index: "2" } },
  },
  {
    name: "no matching union branch",
    schema: UNION_SCHEMA,
    input: { op: { kind: "delete" } },
  },
  { name: "$ref into $defs, valid", schema: REF_SCHEMA, input: { size: 4 } },
  {
    name: "$ref into $defs, coercible",
    schema: REF_SCHEMA,
    input: { size: "4" },
  },
  {
    name: "$ref into $defs, invalid",
    schema: REF_SCHEMA,
    input: { size: "big" },
  },
];

describe("compileSchemaValidator", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetCodeGenerationProbeForTests();
  });

  it("uses Ajv when the runtime allows code generation", () => {
    resetCodeGenerationProbeForTests();
    expect(runtimeAllowsCodeGeneration()).toBe(true);
    const validator = compileSchemaValidator(rawToolInputAjv(), TOOL_SCHEMA, {
      coerceTypes: true,
    });
    expect(validator({ designId: "d1" })).toBe(true);
    expect(validator({})).toBe(false);
    // Ajv's own errors survive so the caller's union-narrowing still applies.
    expect(validator.errors?.length).toBeGreaterThan(0);
    expect(validator.interpretedErrorText).toBeUndefined();
  });

  it.each(CASES)(
    "agrees with Ajv on accept/reject and on the coerced value: $name",
    ({ schema, input }) => {
      const ajvInput = structuredClone(input);
      const ajvValidator = compileSchemaValidator(rawToolInputAjv(), schema, {
        coerceTypes: true,
      });
      const ajvAccepted = ajvValidator(ajvInput);

      const interpretedInput = structuredClone(input);
      const interpretedAccepted = withCodeGenerationForbidden(() => {
        const validator = compileSchemaValidator(rawToolInputAjv(), schema, {
          coerceTypes: true,
        });
        const accepted = validator(interpretedInput);
        if (!accepted) {
          expect(validator.interpretedErrorText).toBeTruthy();
        }
        return accepted;
      });

      expect(interpretedAccepted).toBe(ajvAccepted);
      expect(interpretedInput).toEqual(ajvInput);
    },
  );

  it.each(CASES)(
    "agrees with the non-coercing Ajv instance: $name",
    ({ schema, input }) => {
      const ajvAccepted = compileSchemaValidator(placeholderAjv(), schema, {
        coerceTypes: false,
      })(structuredClone(input));

      const interpretedAccepted = withCodeGenerationForbidden(() =>
        compileSchemaValidator(placeholderAjv(), schema, {
          coerceTypes: false,
        })(structuredClone(input)),
      );

      expect(interpretedAccepted).toBe(ajvAccepted);
    },
  );

  it("leaves the input untouched when coercion is off", () => {
    const input = { designId: "d1", count: "7" };
    withCodeGenerationForbidden(() => {
      compileSchemaValidator(placeholderAjv(), TOOL_SCHEMA, {
        coerceTypes: false,
      })(input);
    });
    expect(input.count).toBe("7");
  });

  // Absent, unvalidatable, and invalid are three different facts: an unreadable
  // schema must never resolve to "this input is fine". Ajv rejects these via
  // the metaschema; the interpreted path must reject them too.
  it.each([
    { name: "unknown type", schema: { type: "nonsense" } },
    { name: "non-string type", schema: { type: 5 } },
    { name: "non-object properties", schema: { properties: "x" } },
    { name: "non-array required", schema: { required: "x" } },
    { name: "non-array anyOf", schema: { anyOf: {} } },
    {
      name: "malformed nested property schema",
      schema: { type: "object", properties: { a: { type: "nope" } } },
    },
  ])("both paths reject an invalid schema: $name", ({ schema }) => {
    expect(() =>
      compileSchemaValidator(rawToolInputAjv(), schema, { coerceTypes: true }),
    ).toThrow();
    withCodeGenerationForbidden(() => {
      expect(() =>
        compileSchemaValidator(rawToolInputAjv(), schema, {
          coerceTypes: true,
        }),
      ).toThrow();
    });
  });
});
