import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

import { insertSourceObject } from "./object-insertion";

const source = `const heading = <h1>Title</h1>;
export default function Slide() {
  return <>{heading}</>;
}`;

function jsxAtSelection(
  sourceTsx: string,
  selection: { line: number; column: number },
) {
  const ast = parse(sourceTsx, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });
  const matches: Array<{ type: string; name?: string }> = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as {
      type?: string;
      loc?: { start?: { line?: number; column?: number } };
      openingElement?: { name?: { name?: string } };
      [key: string]: unknown;
    };
    if (
      node.type === "JSXElement" &&
      node.loc?.start?.line === selection.line &&
      node.loc?.start?.column === selection.column
    ) {
      matches.push({ type: node.type, name: node.openingElement?.name?.name });
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(ast);
  return matches;
}

describe("insertSourceObject", () => {
  it("inserts editable text and bounded inline shapes into the source canvas layer", () => {
    const text = insertSourceObject(source, {
      kind: "text",
      text: `A "quoted" <title>`,
      geometry: { left: -20, top: 1200, width: 420, height: 96 },
    });
    expect(text).not.toBeNull();
    expect(text?.sourceTsx).toContain('id="slides2-text-1"');
    expect(text?.sourceTsx).toContain('{"A \\"quoted\\" \\u003ctitle>"}');
    expect(text?.sourceTsx).toContain('left: "0px"');
    expect(text?.sourceTsx).toContain('top: "984px"');
    expect(jsxAtSelection(text!.sourceTsx, text!.selection!)).toEqual([
      { type: "JSXElement", name: "div" },
    ]);

    const rectangle = insertSourceObject(text!.sourceTsx, {
      kind: "rectangle",
      geometry: { left: 1800, top: 1000, width: 400, height: 300 },
    });
    expect(rectangle?.sourceTsx).toContain('id="slides2-rectangle-1"');
    expect(rectangle?.sourceTsx).toContain('left: "1520px"');
    expect(rectangle?.sourceTsx).toContain('top: "780px"');

    const ellipse = insertSourceObject(rectangle!.sourceTsx, {
      kind: "ellipse",
    });
    expect(ellipse?.sourceTsx).toContain('id="slides2-ellipse-1"');
    expect(ellipse?.sourceTsx).toContain('borderRadius: "50%"');

    const line = insertSourceObject(ellipse!.sourceTsx, {
      kind: "line",
      geometry: { left: 200, top: 300, width: 240, height: 80 },
    });
    expect(line?.sourceTsx).toContain('id="slides2-line-1"');
    expect(line?.sourceTsx).toContain("linear-gradient(");
    expect(line?.sourceTsx).toContain("var(--deck-ink) 50%");
    expect(
      line?.sourceTsx.match(/data-slides-2-object-layer="true"/g),
    ).toHaveLength(1);
    expect(jsxAtSelection(line!.sourceTsx, line!.selection!)).toEqual([
      { type: "JSXElement", name: "div" },
    ]);
    expect(() =>
      parse(line!.sourceTsx, {
        sourceType: "module",
        plugins: ["jsx", "typescript"],
      }),
    ).not.toThrow();
  });

  it("rejects invalid source, invalid geometry, and duplicate requested ids", () => {
    expect(insertSourceObject("not a slide", { kind: "rectangle" })).toBeNull();
    expect(
      insertSourceObject(source, {
        kind: "ellipse",
        geometry: { left: Number.NaN },
      }),
    ).toBeNull();
    expect(
      insertSourceObject(source, { kind: "text", id: "fixed-id" }),
    ).not.toBeNull();
    const duplicateSource =
      'export default function Slide() { return <div id="fixed-id" />; }';
    expect(
      insertSourceObject(duplicateSource, {
        kind: "text",
        id: "fixed-id",
      }),
    ).toBeNull();
  });

  it("skips ids already used by source-backed objects", () => {
    const sourceWithExpressionId = `export default function Slide() {
  return <div id={"slides2-text-1"} />;
}`;
    const inserted = insertSourceObject(sourceWithExpressionId, {
      kind: "text",
    });

    expect(inserted?.sourceTsx).toContain('id="slides2-text-2"');
    expect(inserted?.selection).toBeDefined();
  });
});
