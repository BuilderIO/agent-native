import { parse } from "@babel/parser";

import {
  SLIDES_2_CANVAS_HEIGHT,
  SLIDES_2_CANVAS_WIDTH,
} from "../slides-2-runtime/constants";
import { getDefaultComponentRootRange } from "./object-insertion";
import type {
  SourceSelection,
  SourceStructureResult,
} from "./object-insertion";
import type { ElementSnapshot, SourceEdit, SourceEditOp } from "./types";

export {
  deleteSourceElement,
  duplicateSourceElement,
} from "./object-insertion";
export type {
  SourceSelection,
  SourceStructureResult,
} from "./object-insertion";

type SourceNode = {
  type?: string;
  start?: number | null;
  end?: number | null;
  loc?: { start?: { line?: number; column?: number } };
  children?: unknown[];
  [key: string]: unknown;
};

type LocatedJsx = {
  node: SourceNode;
  jsxAncestors: SourceNode[];
};

type InlineStyleValue = string | number | boolean | null;

const JSX_TYPES = new Set(["JSXElement", "JSXFragment"]);
const SKIPPED_KEYS = new Set([
  "comments",
  "errors",
  "extra",
  "leadingComments",
  "loc",
  "start",
  "end",
  "tokens",
  "trailingComments",
]);

function parseJsx(sourceTsx: string): LocatedJsx[] | null {
  try {
    const ast = parse(sourceTsx, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    }) as unknown as SourceNode;
    const located: LocatedJsx[] = [];

    const visit = (value: unknown, ancestors: SourceNode[]) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        for (const entry of value) visit(entry, ancestors);
        return;
      }

      const node = value as SourceNode;
      if (typeof node.type !== "string") return;
      const isJsx = JSX_TYPES.has(node.type);
      if (isJsx) located.push({ node, jsxAncestors: ancestors });

      const nextAncestors = isJsx ? [...ancestors, node] : ancestors;
      for (const [key, child] of Object.entries(node)) {
        if (!SKIPPED_KEYS.has(key)) visit(child, nextAncestors);
      }
    };

    visit(ast, []);
    return located;
  } catch {
    // coercion-ok: unparseable or incomplete JSX cannot be edited safely by source offsets.
    return null;
  }
}

function nodeRange(node: SourceNode, sourceLength: number) {
  const { start, end } = node;
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    start < 0 ||
    end <= start ||
    end > sourceLength
  ) {
    return null;
  }
  return { start, end };
}

function findSelectedElement(
  sourceTsx: string,
  selection: SourceSelection,
): { located: LocatedJsx; range: { start: number; end: number } } | null {
  const nodes = parseJsx(sourceTsx);
  if (!nodes) return null;

  const matches = nodes.filter(
    ({ node }) =>
      node.type === "JSXElement" &&
      node.loc?.start?.line === selection.line &&
      node.loc?.start?.column === selection.column,
  );
  if (matches.length !== 1) return null;
  const located = matches[0];
  if (!located) return null;
  const range = nodeRange(located.node, sourceTsx.length);
  return range ? { located, range } : null;
}

function sourceLocator(node: SourceNode): SourceSelection | null {
  const line = node.loc?.start?.line;
  const column = node.loc?.start?.column;
  return Number.isInteger(line) && Number.isInteger(column)
    ? { line: line as number, column: column as number }
    : null;
}

function locatorKey(locator: SourceSelection): string {
  return `${locator.line}:${locator.column}`;
}

function readInlineStyles(
  element: SourceNode,
): Record<string, InlineStyleValue> | null {
  const openingElement = element.openingElement as SourceNode | undefined;
  const attributes = openingElement?.attributes;
  if (!Array.isArray(attributes)) return null;

  const styleAttribute = attributes.find((rawAttribute) => {
    if (!rawAttribute || typeof rawAttribute !== "object") return false;
    const attribute = rawAttribute as SourceNode;
    const name = attribute.name as SourceNode | undefined;
    return attribute.type === "JSXAttribute" && name?.name === "style";
  }) as SourceNode | undefined;
  if (!styleAttribute) return {};

  const value = styleAttribute.value as SourceNode | undefined;
  const expression = value?.expression as SourceNode | undefined;
  if (
    value?.type !== "JSXExpressionContainer" ||
    expression?.type !== "ObjectExpression"
  ) {
    return null;
  }

  const styles: Record<string, InlineStyleValue> = {};
  const properties = expression.properties;
  if (!Array.isArray(properties)) return null;
  for (const rawProperty of properties) {
    if (!rawProperty || typeof rawProperty !== "object") return null;
    const property = rawProperty as SourceNode;
    if (property.type !== "ObjectProperty" || property.computed) return null;
    const key = property.key as SourceNode | undefined;
    const propertyName =
      key?.type === "Identifier"
        ? key.name
        : key?.type === "StringLiteral"
          ? key.value
          : null;
    const rawValue = property.value as SourceNode | undefined;
    if (typeof propertyName !== "string" || !rawValue) return null;

    if (
      rawValue.type === "StringLiteral" ||
      rawValue.type === "NumericLiteral" ||
      rawValue.type === "BooleanLiteral"
    ) {
      styles[propertyName] = rawValue.value as InlineStyleValue;
    } else if (rawValue.type === "NullLiteral") {
      styles[propertyName] = null;
    } else if (
      rawValue.type === "TemplateLiteral" &&
      Array.isArray(rawValue.expressions) &&
      rawValue.expressions.length === 0 &&
      Array.isArray(rawValue.quasis)
    ) {
      const quasi = rawValue.quasis[0] as SourceNode | undefined;
      const cooked = (quasi?.value as SourceNode | undefined)?.cooked;
      if (typeof cooked !== "string") return null;
      styles[propertyName] = cooked;
    } else if (
      rawValue.type === "UnaryExpression" &&
      rawValue.operator === "-" &&
      (rawValue.argument as SourceNode | undefined)?.type === "NumericLiteral"
    ) {
      const argument = rawValue.argument as SourceNode;
      styles[propertyName] = -Number(argument.value);
    } else {
      return null;
    }
  }
  return styles;
}

function hasClassAttribute(element: SourceNode): boolean {
  const openingElement = element.openingElement as SourceNode | undefined;
  const attributes = openingElement?.attributes;
  return (
    Array.isArray(attributes) &&
    attributes.some((rawAttribute) => {
      if (!rawAttribute || typeof rawAttribute !== "object") return false;
      const attribute = rawAttribute as SourceNode;
      const name = attribute.name as SourceNode | undefined;
      return (
        attribute.type === "JSXAttribute" &&
        (name?.name === "className" || name?.name === "class")
      );
    })
  );
}

function createsContainingBlock(styles: Record<string, InlineStyleValue>) {
  const position = styles.position;
  if (typeof position === "string" && position !== "static") return true;

  const hasValue = (key: string) => {
    const value = styles[key];
    return (
      value !== undefined &&
      value !== null &&
      value !== "none" &&
      value !== "normal"
    );
  };
  if (
    hasValue("transform") ||
    hasValue("translate") ||
    hasValue("rotate") ||
    hasValue("scale") ||
    hasValue("filter") ||
    hasValue("backdropFilter") ||
    hasValue("perspective") ||
    hasValue("willChange")
  ) {
    return true;
  }

  const contain = styles.contain;
  return (
    typeof contain === "string" &&
    /(?:layout|paint|strict|content)/.test(contain)
  );
}

function hasBorderStyles(styles: Record<string, InlineStyleValue>): boolean {
  return Object.keys(styles).some((key) =>
    /^border(?:Top|Right|Bottom|Left)?(?:Width|Style|Color)?$/.test(key),
  );
}

function cssPixelValue(value: InlineStyleValue | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "0" || trimmed === "0px") return 0;
  if (!/^-?(?:\d+\.?\d*|\.\d+)px$/.test(trimmed)) return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function marginOffset(
  styles: Record<string, InlineStyleValue>,
  side: "left" | "top",
): number | null {
  if (
    styles.marginInline !== undefined ||
    styles.marginInlineStart !== undefined ||
    styles.marginInlineEnd !== undefined ||
    styles.marginBlock !== undefined ||
    styles.marginBlockStart !== undefined ||
    styles.marginBlockEnd !== undefined
  ) {
    return null;
  }

  const individual = styles[side === "left" ? "marginLeft" : "marginTop"];
  if (individual !== undefined) return cssPixelValue(individual);

  const shorthand = styles.margin;
  if (shorthand === undefined) return 0;
  if (typeof shorthand !== "string" && typeof shorthand !== "number")
    return null;
  const values = String(shorthand).trim().split(/\s+/);
  if (values.length < 1 || values.length > 4) return null;
  const index =
    side === "top" ? 0 : values.length === 1 ? 0 : values.length === 2 ? 1 : 3;
  return cssPixelValue(values[index]);
}

function clearPositionInsetOps(
  styles: Record<string, InlineStyleValue>,
  preserveKeys: ReadonlySet<string> = new Set(),
): SourceEditOp[] {
  return [
    "inset",
    "insetBlock",
    "insetBlockEnd",
    "insetBlockStart",
    "insetInline",
    "insetInlineEnd",
    "insetInlineStart",
    "left",
    "right",
    "top",
    "bottom",
  ]
    .filter((key) => styles[key] !== undefined && !preserveKeys.has(key))
    .map((key) => ({ kind: "set-style", key, value: null }));
}

function formatPx(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return `${Object.is(rounded, -0) ? 0 : rounded}px`;
}

/**
 * Changing static elements to positioned elements for z-order can change the
 * containing block of nested absolute children. Preserve their measured
 * geometry for the simple inline-style shapes the editor can safely model.
 */
export function staticPositionZOrderEdits(
  sourceTsx: string,
  selectedNodes: ElementSnapshot[],
  nodes: ElementSnapshot[],
): SourceEdit[] | null {
  const staticSelected = selectedNodes.filter(
    (node) => node.styles.position === "static",
  );
  if (!staticSelected.length) return [];

  const locatedNodes = parseJsx(sourceTsx);
  if (!locatedNodes) return null;
  const astByKey = new Map<string, LocatedJsx>();
  for (const located of locatedNodes) {
    if (located.node.type !== "JSXElement") continue;
    const locator = sourceLocator(located.node);
    if (!locator) continue;
    const key = locatorKey(locator);
    if (astByKey.has(key)) return null;
    astByKey.set(key, located);
  }

  const snapshotsByKey = new Map<string, ElementSnapshot[]>();
  for (const node of nodes) {
    const key = locatorKey(node);
    const snapshots = snapshotsByKey.get(key) ?? [];
    snapshots.push(node);
    snapshotsByKey.set(key, snapshots);
  }

  const editsByKey = new Map<string, SourceEdit>();
  const addOps = (node: ElementSnapshot, ops: SourceEditOp[]) => {
    if (!ops.length) return;
    const guardedOps = ops.map((op) =>
      node.text && op.kind === "set-style"
        ? { ...op, prevText: node.text }
        : op,
    );
    const key = locatorKey(node);
    const existing = editsByKey.get(key);
    if (existing) existing.ops.push(...guardedOps);
    else
      editsByKey.set(key, {
        line: node.line,
        column: node.column,
        ops: guardedOps,
      });
  };

  const selectedAstByKey = new Map<string, LocatedJsx>();
  for (const selected of staticSelected) {
    const key = locatorKey(selected);
    const located = astByKey.get(key);
    const snapshots = snapshotsByKey.get(key);
    if (!located || snapshots?.length !== 1 || hasClassAttribute(located.node))
      return null;
    const styles = readInlineStyles(located.node);
    if (!styles) return null;
    selectedAstByKey.set(key, located);
    const clearInsets = clearPositionInsetOps(styles);
    addOps(selected, [
      {
        kind: "set-style",
        key: "position",
        value: "relative",
      },
      ...clearInsets,
    ]);
  }

  for (const child of nodes) {
    if (child.styles.position !== "absolute") continue;
    const childKey = locatorKey(child);
    const childLocated = astByKey.get(childKey);
    if (!childLocated || snapshotsByKey.get(childKey)?.length !== 1) continue;

    const ancestors = childLocated.jsxAncestors.filter(
      (ancestor) => ancestor.type === "JSXElement",
    );
    let selectedAncestorIndex = -1;
    let selectedAncestor: ElementSnapshot | undefined;
    for (let index = ancestors.length - 1; index >= 0; index--) {
      const ancestor = ancestors[index];
      if (!ancestor) continue;
      const locator = sourceLocator(ancestor);
      if (!locator) continue;
      const snapshot = staticSelected.find(
        (candidate) => locatorKey(candidate) === locatorKey(locator),
      );
      if (snapshot) {
        selectedAncestorIndex = index;
        selectedAncestor = snapshot;
        break;
      }
    }
    if (selectedAncestorIndex < 0 || !selectedAncestor) continue;

    let alreadyContained = false;
    for (
      let index = ancestors.length - 1;
      index > selectedAncestorIndex;
      index--
    ) {
      const ancestor = ancestors[index];
      if (!ancestor) return null;
      const ancestorLocator = sourceLocator(ancestor);
      if (!ancestorLocator) return null;
      const ancestorSnapshot = snapshotsByKey.get(
        locatorKey(ancestorLocator),
      )?.[0];
      const styles = readInlineStyles(ancestor);
      if (!styles || hasClassAttribute(ancestor)) return null;
      const position =
        ancestorSnapshot?.styles.position ??
        (typeof styles.position === "string" ? styles.position : "static");
      if (position !== "static" || createsContainingBlock(styles)) {
        alreadyContained = true;
        break;
      }
    }
    if (alreadyContained) continue;

    const selectedAst = selectedAstByKey.get(locatorKey(selectedAncestor));
    if (!selectedAst) return null;
    const selectedStyles = readInlineStyles(selectedAst.node);
    if (selectedStyles && createsContainingBlock(selectedStyles)) continue;
    const childStyles = readInlineStyles(childLocated.node);
    if (
      !selectedStyles ||
      !childStyles ||
      hasClassAttribute(childLocated.node) ||
      hasBorderStyles(selectedStyles) ||
      [
        "transform",
        "rotate",
        "translate",
        "scale",
        "filter",
        "backdropFilter",
        "perspective",
        "willChange",
        "minWidth",
        "maxWidth",
        "minHeight",
        "maxHeight",
      ].some((key) => childStyles[key] !== undefined)
    ) {
      return null;
    }

    const marginLeft = marginOffset(childStyles, "left");
    const marginTop = marginOffset(childStyles, "top");
    const width = cssPixelValue(child.styles.width);
    const height = cssPixelValue(child.styles.height);
    if (
      marginLeft === null ||
      marginTop === null ||
      width === null ||
      height === null
    )
      return null;

    const insetOps = clearPositionInsetOps(
      childStyles,
      new Set(["left", "top"]),
    );
    addOps(child, [
      ...insetOps,
      {
        kind: "set-style",
        key: "left",
        value: formatPx(
          child.bounds.x - selectedAncestor.bounds.x - marginLeft,
        ),
      },
      {
        kind: "set-style",
        key: "top",
        value: formatPx(child.bounds.y - selectedAncestor.bounds.y - marginTop),
      },
      { kind: "set-style", key: "width", value: formatPx(width) },
      { kind: "set-style", key: "height", value: formatPx(height) },
    ]);
  }

  return [...editsByKey.values()];
}

function readJsxStringAttribute(
  element: SourceNode,
  attributeName: string,
): string | null {
  const openingElement = element.openingElement as SourceNode | undefined;
  const attributes = openingElement?.attributes;
  if (!Array.isArray(attributes)) return null;

  for (const rawAttribute of attributes) {
    if (!rawAttribute || typeof rawAttribute !== "object") continue;
    const attribute = rawAttribute as SourceNode;
    const name = attribute.name as SourceNode | undefined;
    if (attribute.type !== "JSXAttribute" || name?.name !== attributeName)
      continue;

    const value = attribute.value as SourceNode | undefined;
    if (value?.type === "StringLiteral" && typeof value.value === "string")
      return value.value;
    if (value?.type !== "JSXExpressionContainer") return null;

    const expression = value.expression as SourceNode | undefined;
    return expression?.type === "StringLiteral" &&
      typeof expression.value === "string"
      ? expression.value
      : null;
  }
  return null;
}

export function getSelectedAssetId(
  sourceTsx: string,
  selection: SourceSelection,
): string | null {
  const selected = findSelectedElement(sourceTsx, selection);
  if (!selected) return null;

  const openingElement = selected.located.node.openingElement as
    | SourceNode
    | undefined;
  const name = openingElement?.name as SourceNode | undefined;
  if (name?.name !== "img") return null;

  const source = readJsxStringAttribute(selected.located.node, "src");
  const match = source?.match(/^asset:\/\/([A-Za-z0-9_-]{1,200})$/);
  return match?.[1] ?? null;
}

export function getParentSourceSelection(
  sourceTsx: string,
  selection: SourceSelection,
): SourceSelection | null {
  const selected = findSelectedElement(sourceTsx, selection);
  if (!selected) return null;

  const parent = selected.located.jsxAncestors
    .slice()
    .reverse()
    .find((ancestor) => ancestor.type === "JSXElement");
  const line = parent?.loc?.start?.line;
  const column = parent?.loc?.start?.column;
  return Number.isInteger(line) && Number.isInteger(column)
    ? { line: line as number, column: column as number }
    : null;
}

function findCreatedNode(
  sourceTsx: string,
  start: number,
): SourceSelection | null {
  const node = parseJsx(sourceTsx)?.find(
    (candidate) =>
      candidate.node.type === "JSXElement" && candidate.node.start === start,
  )?.node;
  const line = node?.loc?.start?.line;
  const column = node?.loc?.start?.column;
  return Number.isInteger(line) && Number.isInteger(column)
    ? { line: line as number, column: column as number }
    : null;
}

function lineEnding(sourceTsx: string): string {
  return sourceTsx.includes("\r\n") ? "\r\n" : "\n";
}

function jsxString(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function insertAssetOnCanvas(
  sourceTsx: string,
  assetId: string,
  filename: string,
): SourceStructureResult | null {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(assetId)) return null;
  const rootRange = getDefaultComponentRootRange(sourceTsx);
  if (!rootRange) return null;

  const image = `<img src=${jsxString(`asset://${assetId}`)} alt=${jsxString(filename)} style={{ position: "absolute", left: "760px", top: "390px", width: "400px", height: "300px", objectFit: "cover" }} />`;
  const rawRoot = sourceTsx.slice(rootRange.start, rootRange.end);
  const newline = lineEnding(sourceTsx);
  const indentedRoot = rawRoot
    .split(/\r?\n/)
    .map((line) => `  ${line}`)
    .join(newline);
  const wrapper = `<div style={{ position: "relative", width: "${SLIDES_2_CANVAS_WIDTH}px", height: "${SLIDES_2_CANVAS_HEIGHT}px", boxSizing: "border-box", overflow: "hidden" }}>${newline}${indentedRoot}${newline}  ${image}${newline}</div>`;
  const nextSource =
    sourceTsx.slice(0, rootRange.start) +
    wrapper +
    sourceTsx.slice(rootRange.end);
  const imageStart = rootRange.start + wrapper.lastIndexOf(image);
  const selection = findCreatedNode(nextSource, imageStart);
  return selection ? { sourceTsx: nextSource, selection } : null;
}
