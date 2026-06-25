import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  describeBlocksForAgent,
  renderBlockVocabularyReference,
} from "./agent.js";
import {
  prop,
  serializeSpecBlock,
  createAttrReader,
  parseSpecBlock,
  attributeValue,
  type MdxAttrNode,
  type MdxJsxNode,
} from "./mdx.js";
import { BlockRegistry, registerBlocks } from "./registry.js";
import { markdown, introspect } from "./schema-form/introspect.js";
import { defineBlock, type BlockSpec } from "./types.js";

/** A callout-shaped spec mirroring the plan callout, sans React Read. */
function calloutSpec(): BlockSpec<{ tone?: "info" | "risk"; body: string }> {
  return defineBlock({
    type: "callout",
    schema: z.object({
      tone: z.enum(["info", "risk"]).optional(),
      body: markdown(z.string().min(1)),
    }) as never,
    mdx: {
      tag: "Callout",
      childrenField: "body",
      toAttrs: (data) => ({ tone: data.tone }),
      fromAttrs: (attrs, children) => ({
        tone: attrs.string("tone") as "info" | "risk" | undefined,
        body: children,
      }),
    },
    Read: () => null,
    placement: ["block"],
    label: "Callout",
    description: "An emphasized note.",
  });
}

describe("block registry", () => {
  it("registers by type and tag", () => {
    const registry = new BlockRegistry();
    registerBlocks(registry, [calloutSpec()]);
    expect(registry.has("callout")).toBe(true);
    expect(registry.hasTag("Callout")).toBe(true);
    expect(registry.get("callout")?.label).toBe("Callout");
    expect(registry.getByTag("Callout")?.type).toBe("callout");
    expect([...registry.tags()]).toEqual(["Callout"]);
  });

  it("overrides on re-registration (last wins) instead of throwing", () => {
    const registry = new BlockRegistry();
    registerBlocks(registry, [calloutSpec()]);
    // Re-registering the same type must not throw; it replaces the prior spec.
    expect(() =>
      registry.register({ ...calloutSpec(), label: "Callout v2" }),
    ).not.toThrow();
    expect(registry.get("callout")?.label).toBe("Callout v2");
    // Still a single tag entry (no orphan) after the override.
    expect([...registry.tags()]).toEqual(["Callout"]);

    // Re-registering with a changed MDX tag drops the stale tag mapping.
    registry.register({
      ...calloutSpec(),
      mdx: { ...calloutSpec().mdx, tag: "Note" },
    });
    expect(registry.getByTag("Note")?.type).toBe("callout");
    expect(registry.hasTag("Callout")).toBe(false);
  });

  it("lists only specs flagged as Notion-compatible", () => {
    const registry = new BlockRegistry();
    registerBlocks(registry, [
      {
        ...calloutSpec(),
        type: "checklist",
        mdx: { ...calloutSpec().mdx, tag: "Checklist" },
        notionCompatible: true,
      },
      {
        ...calloutSpec(),
        type: "wireframe",
        mdx: { ...calloutSpec().mdx, tag: "Wireframe" },
      },
    ]);

    expect([...registry.notionCompatibleTypes()]).toEqual(["checklist"]);
  });
});

describe("prop encoder", () => {
  it("matches the round-trip contract for the common value shapes", () => {
    expect(prop("id", "callout-1")).toBe(' id="callout-1"');
    expect(prop("tone", undefined)).toBe("");
    expect(prop("editable", true)).toBe(" editable");
    expect(prop("editable", false)).toBe(" editable={false}");
    expect(prop("count", 3)).toBe(" count={3}");
    // Strings with characters outside the safe charset become JSON expressions.
    expect(prop("body", 'has "quotes"')).toBe(' body={"has \\"quotes\\""}');
    // Arrays/objects always serialize as a pretty-printed JSON expression.
    expect(prop("items", ["a"])).toContain("items={");
  });
});

describe("schema introspection", () => {
  it("classifies fields and detects the markdown() tag", () => {
    const fields = introspect(calloutSpec().schema);
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(byKey.tone.kind).toBe("enum");
    expect(byKey.tone.optional).toBe(true);
    expect(byKey.tone.enumValues).toEqual(["info", "risk"]);
    // markdown() survives even though the field is required.
    expect(byKey.body.kind).toBe("markdown");
    expect(byKey.body.optional).toBe(false);
  });

  it("classifies scalar field kinds", () => {
    const fields = introspect(
      z.object({
        name: z.string().max(80),
        note: z.string().max(4000),
        count: z.number(),
        done: z.boolean(),
      }),
    );
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f.kind]));
    expect(byKey.name).toBe("text");
    expect(byKey.note).toBe("longtext");
    expect(byKey.count).toBe("number");
    expect(byKey.done).toBe("boolean");
  });
});

describe("registry MDX round-trip", () => {
  it("serializes a callout in the legacy <Callout tone>…body…</Callout> form", () => {
    const spec = calloutSpec();
    const mdx = serializeSpecBlock(spec, {
      id: "callout-1",
      data: { tone: "risk", body: "Be **careful**." },
    });
    expect(mdx).toBe(
      [
        '<Callout id="callout-1" tone="risk">',
        "",
        "Be **careful**.",
        "",
        "</Callout>",
      ].join("\n"),
    );
  });

  it("parses an MDX node back to data via the spec", () => {
    const registry = new BlockRegistry();
    registerBlocks(registry, [calloutSpec()]);
    const node: MdxJsxNode = {
      type: "mdxJsxFlowElement",
      name: "Callout",
      attributes: [
        { type: "mdxJsxAttribute", name: "id", value: "callout-1" },
        { type: "mdxJsxAttribute", name: "tone", value: "risk" },
      ],
      children: [],
    };
    const parsed = parseSpecBlock(
      registry,
      node,
      { id: "callout-1" },
      "Be **careful**.",
      "block",
    );
    expect(parsed?.type).toBe("callout");
    expect(parsed?.data).toEqual({ tone: "risk", body: "Be **careful**." });
  });

  // Build an `mdxJsxAttributeValueExpression` whose `data.estree` mirrors the
  // shape remark-mdx emits at runtime. The estree-walking branch of
  // `attributeValue` is what the wireframe/plan parsers rely on, so the test
  // exercises that exact path.
  function exprAttr(
    name: string,
    source: string,
    expression: Record<string, unknown>,
  ): MdxAttrNode {
    return {
      type: "mdxJsxAttribute",
      name,
      value: {
        type: "mdxJsxAttributeValueExpression",
        value: source,
        data: {
          estree: {
            type: "Program",
            body: [{ type: "ExpressionStatement", expression }],
          },
        },
      },
    } as MdxAttrNode;
  }

  it("resolves a template-literal attribute with no expressions to its cooked string", () => {
    const attr = exprAttr("html", "`<div>hi</div>`", {
      type: "TemplateLiteral",
      expressions: [],
      quasis: [
        {
          type: "TemplateElement",
          value: { cooked: "<div>hi</div>", raw: "<div>hi</div>" },
        },
      ],
    });
    expect(attributeValue(attr)).toBe("<div>hi</div>");
  });

  it("throws on a template-literal attribute that interpolates ${…}", () => {
    const attr = exprAttr("html", "`<div>${value}</div>`", {
      type: "TemplateLiteral",
      expressions: [{ type: "Identifier", name: "value" }],
      quasis: [
        { type: "TemplateElement", value: { cooked: "<div>", raw: "<div>" } },
        { type: "TemplateElement", value: { cooked: "</div>", raw: "</div>" } },
      ],
    });
    expect(() => attributeValue(attr)).toThrow(/template literal|\$\{/i);
  });

  it("still resolves plain string-literal and JSON expression attributes", () => {
    expect(
      attributeValue({
        type: "mdxJsxAttribute",
        name: "html",
        value: "<div>x</div>",
      } as MdxAttrNode),
    ).toBe("<div>x</div>");
    expect(
      attributeValue(
        exprAttr("widths", "[1, 2, 3]", {
          type: "ArrayExpression",
          elements: [
            { type: "Literal", value: 1 },
            { type: "Literal", value: 2 },
            { type: "Literal", value: 3 },
          ],
        }),
      ),
    ).toEqual([1, 2, 3]);
  });

  it("createAttrReader resolves string/array/object attributes", () => {
    const node: MdxJsxNode = {
      type: "mdxJsxFlowElement",
      name: "Demo",
      attributes: [{ type: "mdxJsxAttribute", name: "tone", value: "ok" }],
    };
    const reader = createAttrReader(node);
    expect(reader.string("tone")).toBe("ok");
    expect(reader.string("missing")).toBeUndefined();
  });
});

describe("agent schema export", () => {
  it("describes registered blocks for the agent", () => {
    const registry = new BlockRegistry();
    registerBlocks(registry, [calloutSpec()]);
    const docs = describeBlocksForAgent(registry);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      type: "callout",
      mdxTag: "Callout",
      placement: ["block"],
    });
    expect(docs[0].dataSchema).toBeDefined();
  });

  it("renders a compact markdown vocabulary reference from the registry", () => {
    const registry = new BlockRegistry();
    registerBlocks(registry, [calloutSpec()]);
    const ref = renderBlockVocabularyReference(registry, {
      heading: "## Blocks",
    });
    expect(ref).toContain("## Blocks");
    expect(ref).toContain("| type | mdx tag | placement |");
    // The callout row carries its type, MDX tag, placement, key fields, and desc.
    expect(ref).toContain("`callout`");
    expect(ref).toContain("`<Callout>`");
    expect(ref).toContain("block");
    expect(ref).toContain("`body`");
    expect(ref).toContain("An emphasized note.");
  });
});
