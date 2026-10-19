import * as t from "@babel/types";

import { parseSource, walkJsx } from "./babel-walk.js";

export type SlideImageInsertionTarget = {
  line: number;
  column: number;
  operation: "replace-placeholder-with-image" | "insert-image-asset";
};

function expressionRoot(value: t.Node | null | undefined): t.JSXElement | null {
  if (!value) return null;
  if (t.isJSXElement(value)) return value;
  if (t.isJSXFragment(value)) {
    const elements = value.children.filter(t.isJSXElement);
    return elements.length === 1 ? (elements[0] ?? null) : null;
  }
  if (t.isParenthesizedExpression(value) || t.isTSAsExpression(value)) {
    return expressionRoot(value.expression);
  }
  return null;
}

function defaultComponent(
  ast: t.File,
): t.Function | t.ArrowFunctionExpression | null {
  const declaration = ast.program.body.find(t.isExportDefaultDeclaration);
  const value = declaration?.declaration;
  if (t.isFunction(value) || t.isArrowFunctionExpression(value)) return value;
  if (!t.isIdentifier(value)) return null;

  for (const statement of ast.program.body) {
    if (!t.isVariableDeclaration(statement)) continue;
    for (const item of statement.declarations) {
      if (!t.isIdentifier(item.id) || item.id.name !== value.name) continue;
      if (t.isFunction(item.init) || t.isArrowFunctionExpression(item.init)) {
        return item.init;
      }
    }
  }
  return null;
}

function returnedRoots(
  component: t.Function | t.ArrowFunctionExpression,
): t.JSXElement[] {
  if (
    t.isArrowFunctionExpression(component) &&
    !t.isBlockStatement(component.body)
  ) {
    const root = expressionRoot(component.body);
    return root ? [root] : [];
  }

  const roots: t.JSXElement[] = [];
  const visit = (node: t.Node): void => {
    if (
      node !== component.body &&
      (t.isFunctionDeclaration(node) ||
        t.isFunctionExpression(node) ||
        t.isArrowFunctionExpression(node))
    ) {
      return;
    }
    if (t.isReturnStatement(node)) {
      const root = expressionRoot(node.argument);
      if (root) roots.push(root);
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child === "object" && "type" in child) {
            visit(child as t.Node);
          }
        }
      } else if (value && typeof value === "object" && "type" in value) {
        visit(value as t.Node);
      }
    }
  };

  if (t.isBlockStatement(component.body)) visit(component.body);
  return roots;
}

export function findSlideImageInsertionTarget(
  source: string,
): SlideImageInsertionTarget {
  const ast = parseSource(source);
  if (!ast)
    throw new Error("Slide source could not be parsed for image insertion.");
  const component = defaultComponent(ast);
  if (!component) {
    throw new Error(
      "Slide source has no default React component for image insertion.",
    );
  }
  const roots = returnedRoots(component);
  if (roots.length !== 1 || !roots[0]?.loc) {
    throw new Error(
      "Slide source needs one unambiguous root element or an ImagePlaceholder before an image can be inserted.",
    );
  }

  const root = roots[0];
  const placeholders: t.JSXElement[] = [];
  walkJsx(root, (node) => {
    if (
      t.isJSXElement(node) &&
      t.isJSXIdentifier(node.openingElement.name, { name: "ImagePlaceholder" })
    ) {
      placeholders.push(node);
    }
  });

  const target = placeholders[0] ?? root;
  if (!target.loc) {
    throw new Error("Slide image insertion target has no source location.");
  }
  return {
    line: target.loc.start.line,
    column: target.loc.start.column,
    operation: placeholders[0]
      ? "replace-placeholder-with-image"
      : "insert-image-asset",
  };
}
