import ts from "typescript";

export type JsxTag = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

export type AttrValue =
  | { kind: "absent" }
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "expression"; node: ts.Expression | undefined };

export function attrName(attribute: ts.JsxAttribute): string {
  return ts.isIdentifier(attribute.name)
    ? attribute.name.text
    : `${attribute.name.namespace.text}:${attribute.name.name.text}`;
}

export function findAttr(tag: JsxTag, name: string): ts.JsxAttribute | null {
  for (const property of tag.attributes.properties) {
    if (ts.isJsxAttribute(property) && attrName(property) === name) {
      return property;
    }
  }
  return null;
}

export function hasSpread(tag: JsxTag): boolean {
  return tag.attributes.properties.some(ts.isJsxSpreadAttribute);
}

function literal(node: ts.Expression): AttrValue {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { kind: "string", value: node.text };
  }
  if (ts.isNumericLiteral(node)) {
    return { kind: "number", value: Number(node.text) };
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return { kind: "boolean", value: true };
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return { kind: "boolean", value: false };
  }
  if (ts.isParenthesizedExpression(node)) return literal(node.expression);
  return { kind: "expression", node };
}

export function readAttr(tag: JsxTag, name: string): AttrValue {
  const attribute = findAttr(tag, name);
  if (!attribute) return { kind: "absent" };
  const initializer = attribute.initializer;
  if (!initializer) return { kind: "boolean", value: true };
  if (ts.isStringLiteral(initializer)) {
    return { kind: "string", value: initializer.text };
  }
  if (ts.isJsxExpression(initializer)) {
    return initializer.expression
      ? literal(initializer.expression)
      : { kind: "expression", node: undefined };
  }
  return { kind: "expression", node: undefined };
}

export function attrValueText(
  attribute: ts.JsxAttribute,
  source: ts.SourceFile,
): string | null {
  const initializer = attribute.initializer;
  if (!initializer) return null;
  if (ts.isStringLiteral(initializer)) return initializer.getText(source);
  if (ts.isJsxExpression(initializer) && initializer.expression) {
    return initializer.expression.getText(source);
  }
  return initializer.getText(source);
}

export function containsJsx(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node) => {
    if (found) return;
    if (
      ts.isJsxElement(child) ||
      ts.isJsxSelfClosingElement(child) ||
      ts.isJsxFragment(child)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

export function insideForm(node: ts.Node): boolean {
  return (
    ts.findAncestor(
      node.parent,
      (at) =>
        ts.isJsxElement(at) && at.openingElement.tagName.getText() === "form",
    ) !== undefined
  );
}

export function elementOf(
  tag: JsxTag,
): ts.JsxElement | ts.JsxSelfClosingElement {
  return ts.isJsxOpeningElement(tag) ? tag.parent : tag;
}

export function meaningfulChildren(element: ts.JsxElement): ts.JsxChild[] {
  return element.children.filter(
    (child) => !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces),
  );
}

export function classNames(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}

export const HEIGHT_CLASS = /^(?:[a-z0-9-]+:)*(?:min-)?(?:h|size)-(?:\d|\[)/;
