import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { flattenComposedRootSchema } from "./flatten-composed-root-schema.js";

type JsonSchema = Record<string, unknown>;

const ajv = new Ajv2020({ strict: false, allErrors: true });

function validates(schema: JsonSchema, input: unknown): boolean {
  return ajv.validate(schema, input) as boolean;
}

/**
 * Flattens `schema` and checks the result against the original on `inputs`:
 * everything the original admits the flattened schema must admit too, and the
 * returned map says what the flattened schema does with each input.
 */
function flatten(schema: JsonSchema, inputs: unknown[] = []) {
  const flat = flattenComposedRootSchema(schema) as Record<string, any>;
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    expect(flat).not.toHaveProperty(key);
  }
  for (const input of inputs) {
    if (validates(schema, input)) expect(validates(flat, input)).toBe(true);
  }
  return {
    flat,
    admits: (input: unknown) => validates(flat, input),
  };
}

describe("flattenComposedRootSchema", () => {
  describe("property merging", () => {
    it("keeps both bounds when allOf branches constrain one property", () => {
      const schema = {
        type: "object",
        allOf: [
          { properties: { name: { type: "string", minLength: 3 } } },
          { properties: { name: { type: "string", maxLength: 10 } } },
        ],
      };
      const inputs = [
        { name: "ab" },
        { name: "abcd" },
        { name: "a".repeat(12) },
      ];
      const { flat, admits } = flatten(schema, inputs);

      expect(flat.properties.name).toEqual({
        allOf: [
          { type: "string", minLength: 3 },
          { type: "string", maxLength: 10 },
        ],
      });
      expect(admits({ name: "abcd" })).toBe(true);
      expect(admits({ name: "ab" })).toBe(false);
      expect(admits({ name: "a".repeat(12) })).toBe(false);
    });

    it("conjoins a root property with the same property on a branch", () => {
      const schema = {
        type: "object",
        properties: { name: { type: "string", minLength: 3 } },
        anyOf: [
          { properties: { name: { maxLength: 10 } } },
          { properties: { name: { maxLength: 20 } } },
        ],
        allOf: [{ properties: { name: { pattern: "^a" } } }],
      };
      const inputs = [
        { name: "ab" },
        { name: "abcd" },
        { name: "bcde" },
        { name: "a".repeat(15) },
        { name: "a".repeat(25) },
      ];
      const { flat, admits } = flatten(schema, inputs);

      expect(flat.properties.name).toEqual({
        allOf: [
          { type: "string", minLength: 3 },
          { anyOf: [{ maxLength: 10 }, { maxLength: 20 }] },
          { pattern: "^a" },
        ],
      });
      expect(admits({ name: "abcd" })).toBe(true);
      expect(admits({ name: "a".repeat(15) })).toBe(true);
      expect(admits({ name: "ab" })).toBe(false);
      expect(admits({ name: "bcde" })).toBe(false);
      expect(admits({ name: "a".repeat(25) })).toBe(false);
    });

    it("declares an identical property once", () => {
      const name = { type: "string", minLength: 1 };
      const { flat } = flatten({
        type: "object",
        properties: { name },
        allOf: [{ properties: { name } }, { properties: { name } }],
        anyOf: [{ properties: { name } }, { properties: { name } }],
      });

      expect(flat.properties.name).toEqual(name);
    });

    it("keeps a property schema whole when it has keywords beside anyOf", () => {
      const nullableText = {
        description: "Text or nothing",
        anyOf: [{ type: "string" }, { type: "null" }],
      };
      const { flat, admits } = flatten(
        {
          type: "object",
          anyOf: [
            { properties: { value: nullableText } },
            { properties: { value: { type: "number" } } },
          ],
        },
        [{ value: "x" }, { value: null }, { value: 1 }, { value: true }],
      );

      expect(flat.properties.value).toEqual({
        anyOf: [nullableText, { type: "number" }],
      });
      expect(admits({ value: true })).toBe(false);
    });

    it("folds a sole-keyword anyOf property into the branch variants", () => {
      const { flat } = flatten({
        type: "object",
        anyOf: [
          {
            properties: {
              value: { anyOf: [{ type: "string" }, { type: "null" }] },
            },
          },
          { properties: { value: { type: "number" } } },
        ],
      });

      expect(flat.properties.value).toEqual({
        anyOf: [{ type: "string" }, { type: "null" }, { type: "number" }],
      });
    });
  });

  describe("required", () => {
    it("requires what every anyOf branch requires and every allOf key", () => {
      const { flat } = flatten({
        type: "object",
        required: ["id"],
        anyOf: [{ required: ["a", "b"] }, { required: ["b", "c"] }],
        allOf: [{ required: ["d"] }, { required: ["e"] }],
      });

      expect(flat.required).toEqual(["id", "b", "d", "e"]);
    });

    it("requires nothing from an anyOf with a non-object branch", () => {
      const { flat } = flatten({
        type: "object",
        anyOf: [{ required: ["a"] }, true],
      });

      expect(flat.required).toEqual([]);
    });
  });

  describe("additionalProperties", () => {
    const closed = (key: string) => ({
      type: "object",
      properties: { [key]: { type: "string" } },
      required: [key],
      additionalProperties: false,
    });

    it("closes the root when every anyOf branch is closed", () => {
      const inputs = [{ a: "x" }, { b: "x" }, { a: "x", extra: 1 }];
      const { flat, admits } = flatten(
        { anyOf: [closed("a"), closed("b")] },
        inputs,
      );

      expect(flat.additionalProperties).toBe(false);
      expect(admits({ a: "x", extra: 1 })).toBe(false);
    });

    it("leaves the root open when one anyOf branch is open", () => {
      const open = { properties: { b: { type: "string" } } };
      const inputs = [{ a: "x" }, { b: "x", extra: 1 }];
      const { flat, admits } = flatten({ oneOf: [closed("a"), open] }, inputs);

      expect(flat).not.toHaveProperty("additionalProperties");
      expect(admits({ b: "x", extra: 1 })).toBe(true);
    });

    it("closes the root when any allOf branch is closed", () => {
      const open = { properties: { b: { type: "string" } } };
      const { flat, admits } = flatten({ allOf: [closed("a"), open] }, [
        { a: "x" },
      ]);

      expect(flat.additionalProperties).toBe(false);
      expect(admits({ a: "x", extra: 1 })).toBe(false);
    });

    it("keeps the root's own additionalProperties: false", () => {
      const { flat } = flatten({
        type: "object",
        properties: { sql: { type: "string" } },
        additionalProperties: false,
        oneOf: [{ required: ["sql"] }, { properties: { other: {} } }],
      });

      expect(flat.additionalProperties).toBe(false);
    });

    it("does not close over patternProperties the branches disagree on", () => {
      const schema = {
        anyOf: [
          { ...closed("a"), patternProperties: { "^x-": { type: "string" } } },
          closed("b"),
        ],
      };
      const inputs = [{ a: "x", "x-trace": "t" }, { b: "x" }];
      const { flat, admits } = flatten(schema, inputs);

      expect(flat).not.toHaveProperty("additionalProperties");
      expect(flat).not.toHaveProperty("patternProperties");
      expect(admits({ a: "x", "x-trace": "t" })).toBe(true);
    });

    it("keeps shared patternProperties and closes over them", () => {
      const patternProperties = { "^x-": { type: "string" } };
      const schema = {
        anyOf: [
          { ...closed("a"), patternProperties },
          { ...closed("b"), patternProperties },
        ],
      };
      const inputs = [
        { a: "x", "x-trace": "t" },
        { b: "x", "x-trace": 1 },
      ];
      const { flat, admits } = flatten(schema, inputs);

      expect(flat.additionalProperties).toBe(false);
      expect(flat.patternProperties).toEqual(patternProperties);
      expect(admits({ a: "x", "x-trace": 1 })).toBe(false);
      expect(admits({ a: "x", other: "t" })).toBe(false);
    });
  });

  describe("allOf branch constraints", () => {
    it("takes the tightest minProperties and maxProperties", () => {
      const { flat } = flatten({
        type: "object",
        minProperties: 1,
        allOf: [{ minProperties: 2, maxProperties: 5 }, { maxProperties: 4 }],
      });

      expect(flat.minProperties).toBe(2);
      expect(flat.maxProperties).toBe(4);
    });

    it("keeps propertyNames from one branch and conjoins several", () => {
      const lower = { pattern: "^[a-z]+$" };
      const short = { maxLength: 8 };

      expect(
        flatten({ allOf: [{ propertyNames: lower }, {}] }).flat.propertyNames,
      ).toEqual(lower);

      const { flat, admits } = flatten(
        { allOf: [{ propertyNames: lower }, { propertyNames: short }] },
        [{ abc: 1 }, { ABC: 1 }, { abcdefghij: 1 }],
      );
      expect(flat.propertyNames).toEqual({ allOf: [lower, short] });
      expect(admits({ abc: 1 })).toBe(true);
      expect(admits({ ABC: 1 })).toBe(false);
      expect(admits({ abcdefghij: 1 })).toBe(false);
    });

    it("merges patternProperties by pattern", () => {
      const { flat, admits } = flatten(
        {
          allOf: [
            { patternProperties: { "^x-": { type: "string" } } },
            {
              patternProperties: {
                "^x-": { maxLength: 3 },
                "^n-": { type: "number" },
              },
            },
          ],
        },
        [{ "x-a": "ab" }, { "x-a": "abcd" }, { "n-a": "1" }],
      );

      expect(flat.patternProperties).toEqual({
        "^x-": { allOf: [{ type: "string" }, { maxLength: 3 }] },
        "^n-": { type: "number" },
      });
      expect(admits({ "x-a": "ab", "n-a": 1 })).toBe(true);
      expect(admits({ "x-a": "abcd" })).toBe(false);
      expect(admits({ "n-a": "1" })).toBe(false);
    });
  });

  describe("anyOf/oneOf branch constraints", () => {
    it("keeps a constraint every branch declares identically", () => {
      const propertyNames = { pattern: "^[a-z]+$" };
      const { flat } = flatten({
        oneOf: [
          { propertyNames, minProperties: 1, maxProperties: 3 },
          { propertyNames, minProperties: 1, maxProperties: 3 },
        ],
      });

      expect(flat).toMatchObject({
        propertyNames,
        minProperties: 1,
        maxProperties: 3,
      });
    });

    it("drops a constraint the branches disagree on", () => {
      const schema = {
        anyOf: [
          { propertyNames: { pattern: "^[a-z]+$" }, minProperties: 1 },
          { minProperties: 2, maxProperties: 3 },
        ],
      };
      const inputs = [{ ABC: 1 }, { a: 1 }, { a: 1, b: 2, c: 3, d: 4 }];
      const { flat } = flatten(schema, inputs);

      expect(flat).not.toHaveProperty("propertyNames");
      expect(flat).not.toHaveProperty("minProperties");
      expect(flat).not.toHaveProperty("maxProperties");
    });
  });

  describe("dropped keywords", () => {
    it("drops branch keywords a flat root cannot express", () => {
      const schema = {
        allOf: [
          {
            properties: { card: { type: "string" }, cvc: { type: "string" } },
            dependentRequired: { card: ["cvc"] },
            not: { required: ["legacy"] },
          },
        ],
      };
      const { flat, admits } = flatten(schema, [{ card: "4" }, { legacy: 1 }]);

      for (const key of ["dependentRequired", "not"]) {
        expect(flat).not.toHaveProperty(key);
      }
      // An over-approximation: the action's own validation still rejects it.
      expect(validates(schema, { card: "4" })).toBe(false);
      expect(admits({ card: "4" })).toBe(true);
    });
  });

  it("flattens a nested composition inside a branch first", () => {
    const schema = {
      anyOf: [
        {
          allOf: [
            {
              properties: { a: { type: "string" } },
              required: ["a"],
              additionalProperties: false,
            },
            { properties: { a: { minLength: 2 } } },
          ],
        },
        {
          properties: { b: { type: "number" } },
          required: ["b"],
          additionalProperties: false,
        },
      ],
    };
    const inputs = [{ a: "xy" }, { a: "x" }, { b: 1 }, { b: 1, c: 2 }];
    const { flat, admits } = flatten(schema, inputs);

    expect(flat.properties.a).toEqual({
      allOf: [{ type: "string" }, { minLength: 2 }],
    });
    expect(flat.additionalProperties).toBe(false);
    expect(flat.required).toEqual([]);
    expect(admits({ a: "x" })).toBe(false);
    expect(admits({ b: 1, c: 2 })).toBe(false);
  });

  it("returns a schema without a root composition as-is", () => {
    const schema = { type: "object", properties: { q: { type: "string" } } };

    expect(flattenComposedRootSchema(schema)).toBe(schema);
  });
});
