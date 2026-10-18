import { describe, expect, it } from "vitest";

import {
  canonicalLocalRefs,
  resolveLocalRef,
  SchemaReferenceError,
} from "./local-refs.js";

describe("local reference resolution", () => {
  it.each(["__proto__", "constructor", "hasOwnProperty"])(
    "refuses #/$defs/%s when $defs has no own entry by that name",
    (name) => {
      const ref = `#/$defs/${name}`;
      const schema = {
        type: "object",
        $defs: { Item: { type: "string" } },
        properties: { a: { $ref: ref } },
      };

      expect(resolveLocalRef(schema, ref)).toBeUndefined();
      expect(() => canonicalLocalRefs(schema)).toThrow(SchemaReferenceError);
      expect(() => canonicalLocalRefs(schema)).toThrow(
        `JSON schema references "${ref}", which does not resolve at /properties/a.`,
      );
    },
  );

  it.each(["00", "", "length"])('refuses "%s" as an array index', (segment) => {
    const ref = `#/anyOf/${segment}`;
    const schema = {
      type: "object",
      anyOf: [{ type: "object" }],
      properties: { a: { $ref: ref } },
    };

    expect(resolveLocalRef(schema, ref)).toBeUndefined();
    expect(() => canonicalLocalRefs(schema)).toThrow(SchemaReferenceError);
  });

  it("follows an own key named __proto__", () => {
    const schema = JSON.parse(
      '{"type":"object","$defs":{"__proto__":{"type":"string"}}}',
    );

    expect(resolveLocalRef(schema, "#/$defs/__proto__")).toEqual({
      type: "string",
    });
    expect(resolveLocalRef(schema, "#/$defs")).toBe(schema.$defs);
  });
});
