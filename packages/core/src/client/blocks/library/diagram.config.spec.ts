import type {
  BlockAttrReader,
  BlockSpec,
} from "@agent-native/core/blocks/server";
import { describe, expect, it } from "vitest";

import { parseSpecBlock, serializeSpecBlock } from "../mdx.js";
import { BlockRegistry } from "../registry.js";
import {
  diagramMdx,
  diagramSchema,
  type DiagramData,
} from "./diagram.config.js";

function reader(attrs: Record<string, unknown>): BlockAttrReader {
  const read = (name: string) => attrs[name];
  return {
    raw: read,
    string: (name) =>
      typeof read(name) === "string" ? (read(name) as string) : undefined,
    number: (name) =>
      typeof read(name) === "number" ? (read(name) as number) : undefined,
    bool: (name) =>
      typeof read(name) === "boolean" ? (read(name) as boolean) : undefined,
    array: <T = unknown>(name: string) =>
      Array.isArray(read(name)) ? (read(name) as T[]) : undefined,
    object: <T = unknown>(name: string) => {
      const value = read(name);
      return value && typeof value === "object" ? (value as T) : undefined;
    },
  };
}

function diagramSpec(): BlockSpec<DiagramData> {
  return {
    type: "diagram",
    schema: diagramSchema,
    mdx: diagramMdx,
    Read: () => null,
    placement: ["block"],
    label: "Diagram",
    description: "Diagram",
  };
}

describe("diagram block config", () => {
  it("serializes html/css as MDX child code fences", () => {
    const mdx = serializeSpecBlock(diagramSpec(), {
      id: "diagram-1",
      title: "Flow",
      data: {
        html: '<div class="flow">Hi</div>',
        css: ".flow { display: grid; }",
        caption: "A diagram caption",
        frame: "hide",
      },
    });

    expect(mdx).toContain(
      '<Diagram id="diagram-1" title="Flow" caption="A diagram caption" frame="hide">',
    );
    expect(mdx).toContain("```html\n<div");
    expect(mdx).toContain("```css\n.flow");
    expect(mdx).not.toContain("data={");
  });

  it("keeps legacy data attributes readable", () => {
    expect(
      diagramMdx.fromAttrs(
        reader({
          data: {
            html: "<div />",
            css: ".x{}",
            caption: "Legacy caption",
          },
        }),
        "",
      ),
    ).toEqual({
      html: "<div />",
      css: ".x{}",
      caption: "Legacy caption",
    });
  });

  it("parses caption attrs plus child html/css fences", () => {
    const registry = new BlockRegistry();
    registry.register(diagramSpec());
    const parsed = parseSpecBlock(
      registry,
      {
        type: "mdxJsxFlowElement",
        name: "Diagram",
        attributes: [
          { type: "mdxJsxAttribute", name: "caption", value: "Caption" },
          { type: "mdxJsxAttribute", name: "frame", value: "show" },
        ],
        children: [
          { type: "code", lang: "html", value: '<div class="flow">Hi</div>' },
          { type: "code", lang: "css", value: ".flow { color: red; }" },
        ],
      },
      { id: "diagram-1" },
      "",
      "spec",
    );

    expect(parsed).toEqual({
      type: "diagram",
      data: {
        caption: "Caption",
        frame: "show",
        html: '<div class="flow">Hi</div>',
        css: ".flow { color: red; }",
      },
    });
  });

  it("still serializes legacy node graphs as data props", () => {
    const mdx = serializeSpecBlock(diagramSpec(), {
      id: "legacy",
      data: {
        nodes: [{ id: "a", label: "A" }],
        edges: [],
      },
    });

    expect(mdx).toContain("<Diagram");
    expect(mdx).toContain("data={");
    expect(mdx).toContain('"nodes"');
  });
});
