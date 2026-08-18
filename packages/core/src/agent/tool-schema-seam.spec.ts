import { describe, expect, it } from "vitest";

import { stripUnsupportedSchemaKeywords } from "../action.js";

// `extension-data-set` shipped this exact shape: a hand-written tool schema
// whose `data` property carried a description and no `type`. OpenAI answers
// that with "schema must have a 'type' key" and 400s the WHOLE request -- every
// tool in the payload -- so one such property breaks all chat in the app.
// defineAction sanitized at construction; hand-written tools never did.
describe("hand-written tool schemas", () => {
  it("gives a description-only property a concrete type union", () => {
    const schema = {
      type: "object" as const,
      properties: {
        extensionId: { type: "string" },
        data: { description: "The data value to store." },
      },
      required: ["extensionId", "data"],
    };
    const safe = stripUnsupportedSchemaKeywords(
      JSON.parse(JSON.stringify(schema)),
    ) as any;
    expect(Array.isArray(safe.properties.data.anyOf)).toBe(true);
    expect(safe.properties.data.anyOf.map((b: any) => b.type)).toContain(
      "string",
    );
    // An already-typed sibling is untouched.
    expect(safe.properties.extensionId).toEqual({ type: "string" });
  });

  it("leaves every subschema position typed or composed", () => {
    const schema = {
      type: "object" as const,
      properties: {
        anything: {},
        nested: { type: "object", properties: { inner: {} } },
        listed: { type: "array", items: {} },
      },
    };
    const safe = stripUnsupportedSchemaKeywords(
      JSON.parse(JSON.stringify(schema)),
    ) as any;
    const TYPED = ["type", "anyOf", "oneOf", "allOf", "enum", "const", "$ref"];
    const bad: string[] = [];
    const walk = (n: any, path: string) => {
      if (!n || typeof n !== "object" || Array.isArray(n)) return;
      if (!TYPED.some((k) => n[k] !== undefined)) bad.push(path);
      if (n.items && typeof n.items === "object") walk(n.items, `${path}.items`);
      if (n.properties)
        for (const [k, v] of Object.entries(n.properties))
          walk(v, `${path}.${k}`);
      if (Array.isArray(n.anyOf))
        n.anyOf.forEach((b: any, i: number) => walk(b, `${path}.anyOf[${i}]`));
    };
    walk(safe, "$");
    expect(bad).toEqual([]);
  });
});
