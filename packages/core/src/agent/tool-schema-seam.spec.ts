import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineAction, stripUnsupportedSchemaKeywords } from "../action.js";

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
      if (n.items && typeof n.items === "object")
        walk(n.items, `${path}.items`);
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

// `z.string().url()` emits format:"uri", which OpenAI answers with
// "'uri' is not a valid format" and a 400 for the whole request. Seen in prod
// on `provider-api-docs` at 19:14, after the previous fix shipped.
describe("provider-rejected format and constraint keywords", () => {
  it("drops an unsupported format but keeps a supported one", () => {
    const schema = {
      type: "object" as const,
      properties: {
        url: { type: "string", format: "uri" },
        when: { type: "string", format: "date-time" },
      },
    };
    const safe = stripUnsupportedSchemaKeywords(
      JSON.parse(JSON.stringify(schema)),
    ) as any;
    expect(safe.properties.url.format).toBeUndefined();
    expect(safe.properties.url.type).toBe("string");
    expect(safe.properties.when.format).toBe("date-time");
  });

  it("drops constraint-only keywords the validator rejects", () => {
    const schema = {
      type: "object" as const,
      properties: { a: { type: "string" } },
      patternProperties: { "^x": { type: "string" } },
      not: { type: "number" },
      if: { type: "string" },
      then: { type: "string" },
      dependentRequired: { a: ["b"] },
    };
    const safe = stripUnsupportedSchemaKeywords(
      JSON.parse(JSON.stringify(schema)),
    ) as any;
    for (const k of [
      "patternProperties",
      "not",
      "if",
      "then",
      "dependentRequired",
    ]) {
      expect(safe[k]).toBeUndefined();
    }
    // The real shape survives.
    expect(safe.properties.a).toEqual({ type: "string" });
  });
});

// Zod 4's `z.string().email()` compiles to `^(?!\.)(?!.*\.\.)…` -- two negative
// lookaheads. Anthropic answers lookaround in a `pattern` with "regex
// lookaround is not supported" and 400s the whole request; a scout run dies at
// the first API call with nothing on screen to say so.
describe("regex lookaround in a pattern", () => {
  const ZOD_EMAIL =
    "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$";

  it("drops a lookaround pattern and keeps a plain one", () => {
    const schema = {
      type: "object" as const,
      properties: {
        memberEmails: {
          type: "array",
          items: { type: "string", format: "email", pattern: ZOD_EMAIL },
        },
        slug: { type: "string", pattern: "^[a-z0-9-]+$" },
      },
    };
    const safe = stripUnsupportedSchemaKeywords(
      JSON.parse(JSON.stringify(schema)),
    ) as any;
    expect(safe.properties.memberEmails.items.pattern).toBeUndefined();
    // Only the unsupported keyword goes: the type and the accepted format stay.
    expect(safe.properties.memberEmails.items.type).toBe("string");
    expect(safe.properties.memberEmails.items.format).toBe("email");
    expect(safe.properties.slug.pattern).toBe("^[a-z0-9-]+$");
  });

  it.each([
    ["lookahead", "^(?=.*a)b$"],
    ["negative lookahead", "^(?!x)y$"],
    ["lookbehind", "(?<=a)b"],
    ["negative lookbehind", "(?<!a)b"],
  ])("drops a %s", (_label, pattern) => {
    const safe = stripUnsupportedSchemaKeywords({
      type: "string",
      pattern,
    }) as any;
    expect(safe.pattern).toBeUndefined();
  });

  it("keeps a non-capturing group, which the validator accepts", () => {
    // What `z.email({ pattern: z.regexes.html5Email })` emits: `(?:` only.
    const html5 =
      "^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$";
    const safe = stripUnsupportedSchemaKeywords({
      type: "string",
      pattern: html5,
    }) as any;
    expect(safe.pattern).toBe(html5);
  });

  it("reaches a pattern nested in a union branch", () => {
    const safe = stripUnsupportedSchemaKeywords({
      type: "object",
      properties: {
        who: {
          anyOf: [{ type: "string", pattern: ZOD_EMAIL }, { type: "null" }],
        },
      },
    }) as any;
    expect(safe.properties.who.anyOf[0].pattern).toBeUndefined();
  });
});

// The seam above is only worth anything if the real path reaches it: this is
// what `.email()` in an action schema actually ships to the provider.
describe("defineAction with .email() in its schema", () => {
  it("advertises no lookaround to the provider", () => {
    const action = defineAction({
      description: "Change a group's member list.",
      schema: z.object({
        memberEmails: z.array(z.string().email()).min(1),
      }),
      run: async () => ({ ok: true }),
    });
    const advertised = JSON.stringify(action.tool.parameters);
    expect(advertised).not.toMatch(/\(\?<?[=!]/);
    // Still a real email field, and zod still validates it on the way in.
    expect(advertised).toContain('"format":"email"');
  });
});
