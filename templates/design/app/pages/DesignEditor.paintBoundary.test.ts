import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const editorSource = readFileSync("app/pages/DesignEditor.tsx", "utf8");

function findNodes<T extends ts.Node>(
  root: ts.Node,
  matches: (node: ts.Node) => node is T,
): T[] {
  const nodes: T[] = [];
  const visit = (node: ts.Node) => {
    if (matches(node)) nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return nodes;
}

function canvasViewport(source: string) {
  const file = ts.createSourceFile(
    "DesignEditor.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const viewports = findNodes(file, ts.isJsxElement).filter((element) =>
    element.openingElement.attributes.properties.some(
      (attribute) =>
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText() === "data-design-canvas-container",
    ),
  );
  expect(viewports).toHaveLength(1);
  return viewports[0]!;
}

function assertBackdropBoundary(viewport: ts.JsxElement) {
  const attributes = viewport.openingElement.attributes.properties;
  const style = attributes.find(
    (attribute) =>
      ts.isJsxAttribute(attribute) && attribute.name.getText() === "style",
  );
  if (
    !style ||
    !ts.isJsxAttribute(style) ||
    !style.initializer ||
    !ts.isJsxExpression(style.initializer) ||
    !style.initializer.expression
  ) {
    throw new Error("Canvas viewport must declare its backdrop boundary style");
  }
  const properties = findNodes(
    style.initializer.expression,
    ts.isPropertyAssignment,
  );
  const values = new Map(
    properties.map((property) => [
      ts.isStringLiteral(property.name)
        ? property.name.text
        : property.name.getText(),
      ts.isStringLiteral(property.initializer)
        ? property.initializer.text
        : property.initializer.getText(),
    ]),
  );
  expect(values.get("willChange")).toBe("opacity");
  expect(values.get("isolation")).toBe("isolate");
  expect([...values.keys()].sort()).toEqual([
    "--design-editor-canvas-bg",
    "isolation",
    "willChange",
  ]);

  const className = attributes.find(
    (attribute) =>
      ts.isJsxAttribute(attribute) && attribute.name.getText() === "className",
  );
  expect(className?.getText()).toBe(
    'className="relative min-w-0 flex-1 overflow-hidden bg-[var(--design-editor-canvas-bg)]"',
  );
}

describe("Design editor viewport backdrop boundary", () => {
  it("contains overview and single-screen canvases in the same viewport", () => {
    const viewport = canvasViewport(editorSource);
    const canvases = findNodes(viewport, ts.isJsxSelfClosingElement)
      .map((element) => element.tagName.getText())
      .filter(
        (name) => name === "MultiScreenCanvas" || name === "DesignCanvas",
      );

    expect(canvases).toEqual(["MultiScreenCanvas", "DesignCanvas"]);
  });

  it("establishes an untransformed backdrop root without opacity or filter overrides", () => {
    assertBackdropBoundary(canvasViewport(editorSource));
  });

  it.each([
    ["missing boundary", ""],
    ["transform promotion", 'willChange: "transform",'],
    ["opacity alteration", 'willChange: "opacity", opacity: 0.999,'],
    ["filter alteration", 'willChange: "opacity", filter: "blur(0)",'],
    ["backdrop removal", 'willChange: "opacity", backdropFilter: "none",'],
    ["scaled boundary", 'willChange: "opacity", transform: "scale(0.04)",'],
  ])(
    "rejects %s without changing the live editor source",
    (_name, replacement) => {
      const mutated = editorSource.replace(
        'willChange: "opacity",',
        replacement,
      );
      expect(mutated).not.toBe(editorSource);
      expect(() => assertBackdropBoundary(canvasViewport(mutated))).toThrow();
    },
  );
});
