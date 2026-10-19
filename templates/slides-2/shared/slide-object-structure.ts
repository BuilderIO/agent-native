import { parse } from "@babel/parser";

const OPEN_SLIDE_CANVAS_WIDTH = 1920;
const OPEN_SLIDE_CANVAS_HEIGHT = 1080;

type AstNode = {
  type?: string;
  start?: number | null;
  end?: number | null;
  loc?: { start?: { line?: number; column?: number } };
  name?: string;
  value?: unknown;
  declaration?: AstNode;
  body?: AstNode | AstNode[];
  program?: AstNode;
  id?: AstNode;
  init?: AstNode;
  argument?: AstNode | null;
  openingElement?: AstNode;
  closingElement?: AstNode | null;
  attributes?: unknown[];
  children?: unknown[];
  [key: string]: unknown;
};

type LocatedJsx = { node: AstNode; jsxAncestors: AstNode[] };

export type OpenSlideObjectKind = "text" | "rectangle" | "ellipse" | "line";

export type OpenSlideObjectGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type OpenSlideObjectInsertion = {
  kind: OpenSlideObjectKind;
  geometry?: Partial<OpenSlideObjectGeometry>;
  text?: string;
  id?: string;
};

export type SourceSelection = { line: number; column: number };

export type SourceStructureResult = {
  sourceTsx: string;
  selection?: SourceSelection;
  createdObjectId?: string;
};

const OBJECT_LAYER_ATTRIBUTE = "data-open-slide-object-layer";
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

const defaultGeometry: Record<OpenSlideObjectKind, OpenSlideObjectGeometry> = {
  text: { left: 760, top: 390, width: 400, height: 120 },
  rectangle: { left: 760, top: 390, width: 400, height: 300 },
  ellipse: { left: 760, top: 390, width: 300, height: 300 },
  line: { left: 760, top: 540, width: 400, height: 1 },
};

function parseFile(sourceTsx: string): AstNode | null {
  try {
    return parse(sourceTsx, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    }) as unknown as AstNode;
  } catch {
    return null;
  }
}

function collectJsx(sourceTsx: string): LocatedJsx[] | null {
  const ast = parseFile(sourceTsx);
  if (!ast) return null;
  const located: LocatedJsx[] = [];

  const visit = (value: unknown, ancestors: AstNode[]) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, ancestors);
      return;
    }

    const node = value as AstNode;
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
}

function getDefaultComponentRoot(sourceTsx: string): AstNode | null {
  const ast = parseFile(sourceTsx);
  const program = ast?.program;
  const statements = Array.isArray(program?.body) ? program.body : [];
  const defaultExport = statements.find(
    (statement) => (statement as AstNode)?.type === "ExportDefaultDeclaration",
  ) as AstNode | undefined;
  let declaration = defaultExport?.declaration;
  if (!declaration) return null;

  if (declaration.type === "Identifier" && declaration.name) {
    const name = declaration.name;
    const binding = statements.find((statement) => {
      const candidate = statement as AstNode;
      if (
        candidate.type === "FunctionDeclaration" &&
        (candidate.id as AstNode | undefined)?.name === name
      ) {
        return true;
      }
      if (candidate.type !== "VariableDeclaration") return false;
      const declarations = Array.isArray(candidate.declarations)
        ? candidate.declarations
        : [];
      return declarations.some(
        (entry) =>
          ((entry as AstNode).id as AstNode | undefined)?.name === name,
      );
    }) as AstNode | undefined;

    if (binding?.type === "FunctionDeclaration") declaration = binding;
    else if (binding?.type === "VariableDeclaration") {
      const declarations = Array.isArray(binding.declarations)
        ? binding.declarations
        : [];
      const local = declarations.find(
        (entry) =>
          ((entry as AstNode).id as AstNode | undefined)?.name === name,
      ) as AstNode | undefined;
      if (local?.init) declaration = local.init;
    }
  }

  const expression = componentReturnExpression(declaration);
  if (!expression) return null;
  const roots = topLevelJsx(expression);
  return roots.length === 1 ? (roots[0] ?? null) : null;
}

export function getDefaultComponentRootRange(
  sourceTsx: string,
): { start: number; end: number } | null {
  const root = getDefaultComponentRoot(sourceTsx);
  return root ? nodeRange(root, sourceTsx.length) : null;
}

function componentReturnExpression(component: AstNode): AstNode | null {
  if (
    component.type !== "FunctionDeclaration" &&
    component.type !== "FunctionExpression" &&
    component.type !== "ArrowFunctionExpression"
  ) {
    return null;
  }

  const body = component.body;
  if (!body || Array.isArray(body)) return null;
  if (body.type !== "BlockStatement") return body;

  const statements = Array.isArray(body.body) ? body.body : [];
  const returns = statements.filter(
    (statement) => (statement as AstNode)?.type === "ReturnStatement",
  ) as AstNode[];
  if (returns.length !== 1) return null;
  if (
    statements.some(
      (statement) =>
        statement !== returns[0] && hasComponentScopeReturnStatement(statement),
    )
  ) {
    return null;
  }
  const argument = returns[0]?.argument;
  if (!argument) return null;

  if (argument.type === "Identifier" && argument.name) {
    const local = statements
      .filter(
        (statement) => (statement as AstNode)?.type === "VariableDeclaration",
      )
      .flatMap((statement) => {
        const declarations = Array.isArray((statement as AstNode).declarations)
          ? ((statement as AstNode).declarations as AstNode[])
          : [];
        return declarations;
      })
      .find(
        (declaration) =>
          (declaration.id as AstNode | undefined)?.name === argument.name,
      );
    if (local?.init) return local.init;
  }

  return argument;
}

function hasComponentScopeReturnStatement(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasComponentScopeReturnStatement);

  const node = value as AstNode;
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "ObjectMethod" ||
    node.type === "ClassMethod" ||
    node.type === "ClassPrivateMethod"
  ) {
    return false;
  }
  if (node.type === "ReturnStatement") return true;

  return Object.entries(node).some(
    ([key, child]) =>
      !SKIPPED_KEYS.has(key) && hasComponentScopeReturnStatement(child),
  );
}

function topLevelJsx(value: unknown): AstNode[] {
  const roots: AstNode[] = [];
  const visit = (nodeValue: unknown) => {
    if (!nodeValue || typeof nodeValue !== "object") return;
    if (Array.isArray(nodeValue)) {
      for (const entry of nodeValue) visit(entry);
      return;
    }
    const node = nodeValue as AstNode;
    if (JSX_TYPES.has(node.type ?? "")) {
      roots.push(node);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (!SKIPPED_KEYS.has(key)) visit(child);
    }
  };
  visit(value);
  return roots;
}

function nodeRange(node: AstNode, sourceLength: number) {
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

function isObjectLayer(node: AstNode): boolean {
  if (node.type !== "JSXElement") return false;
  const opening = node.openingElement;
  if (!opening || (opening.name as AstNode | undefined)?.name !== "div") {
    return false;
  }
  const attributes = Array.isArray(opening.attributes)
    ? opening.attributes
    : [];
  return attributes.some((attributeValue) => {
    const attribute = attributeValue as AstNode;
    const name = attribute.name as AstNode | undefined;
    if (name?.name !== OBJECT_LAYER_ATTRIBUTE) return false;
    const value = attribute.value as AstNode | undefined;
    return value?.value === "true";
  });
}

function lineIndent(sourceTsx: string, start: number): string {
  const lineStart = sourceTsx.lastIndexOf("\n", start - 1) + 1;
  const prefix = sourceTsx.slice(lineStart, start);
  return /^[\t ]*$/.test(prefix) ? prefix : "";
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

function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function pixels(value: number): string {
  return `${formatNumber(value)}px`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeGeometry(
  kind: OpenSlideObjectKind,
  geometry: Partial<OpenSlideObjectGeometry> | undefined,
): OpenSlideObjectGeometry | null {
  const fallback = defaultGeometry[kind];
  const left = geometry?.left ?? fallback.left;
  const top = geometry?.top ?? fallback.top;
  const inputWidth = geometry?.width ?? fallback.width;
  const inputHeight = geometry?.height ?? fallback.height;
  if (![left, top, inputWidth, inputHeight].every(Number.isFinite)) return null;

  const normalizedLeft = inputWidth < 0 ? left + inputWidth : left;
  const normalizedTop = inputHeight < 0 ? top + inputHeight : top;
  const width = clamp(Math.abs(inputWidth), 1, OPEN_SLIDE_CANVAS_WIDTH);
  const height = clamp(Math.abs(inputHeight), 1, OPEN_SLIDE_CANVAS_HEIGHT);
  return {
    left: clamp(normalizedLeft, 0, OPEN_SLIDE_CANVAS_WIDTH - width),
    top: clamp(normalizedTop, 0, OPEN_SLIDE_CANVAS_HEIGHT - height),
    width,
    height,
  };
}

function nextObjectId(sourceTsx: string, kind: OpenSlideObjectKind): string {
  const ids = sourceIds(sourceTsx);
  if (hasDynamicSourceIdentity(sourceTsx)) {
    let id = dynamicObjectId(kind);
    while (ids.has(id)) id = dynamicObjectId(kind);
    return id;
  }

  let suffix = 1;
  let id = `slides2-${kind}-${suffix}`;
  while (ids.has(id)) {
    suffix += 1;
    id = `slides2-${kind}-${suffix}`;
  }
  return id;
}

function dynamicObjectId(kind: OpenSlideObjectKind): string {
  const nonce =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `slides2-${kind}-${nonce}`;
}

function hasDynamicSourceIdentity(sourceTsx: string): boolean {
  for (const { node } of collectJsx(sourceTsx) ?? []) {
    if (node.type !== "JSXElement") continue;
    const attributes = Array.isArray(node.openingElement?.attributes)
      ? (node.openingElement.attributes as AstNode[])
      : [];
    for (const attribute of attributes) {
      if (attribute.type === "JSXSpreadAttribute") return true;
      if (
        attribute.type === "JSXAttribute" &&
        attributeName(attribute) === "id" &&
        staticAttributeString(attribute) === null
      ) {
        return true;
      }
    }
  }
  return false;
}

function sourceIds(sourceTsx: string): Set<string> {
  const ids = new Set<string>();
  for (const { node } of collectJsx(sourceTsx) ?? []) {
    if (node.type !== "JSXElement") continue;
    const opening = node.openingElement;
    const attributes = Array.isArray(opening?.attributes)
      ? opening.attributes
      : [];
    for (const attributeValue of attributes) {
      const attribute = attributeValue as AstNode;
      const name = attribute.name as AstNode | undefined;
      if (name?.name !== "id") continue;
      const value = attribute.value as AstNode | undefined;
      const expression =
        value?.type === "JSXExpressionContainer"
          ? (value.expression as AstNode | undefined)
          : value;
      if (
        expression?.type === "StringLiteral" &&
        typeof expression.value === "string"
      ) {
        ids.add(expression.value);
      }
    }
  }
  return ids;
}

function createObjectSource(
  kind: OpenSlideObjectKind,
  geometry: OpenSlideObjectGeometry,
  id: string,
  text: string | undefined,
): string {
  const left = pixels(geometry.left);
  const top = pixels(geometry.top);
  const width = pixels(geometry.width);
  const height = pixels(geometry.height);

  if (kind === "text") {
    return `<div id=${jsxString(id)} style={{ position: "absolute", left: ${jsxString(left)}, top: ${jsxString(top)}, width: ${jsxString(width)}, minHeight: ${jsxString(height)}, boxSizing: "border-box", padding: "8px", color: "var(--deck-ink)", fontFamily: "var(--deck-body-font)", fontSize: "32px", lineHeight: "1.2", whiteSpace: "pre-wrap" }}>{${jsxString(text ?? "Text")}}</div>`;
  }

  if (kind === "rectangle" || kind === "ellipse") {
    const shapeStyle = kind === "ellipse" ? ', borderRadius: "50%"' : "";
    return `<div id=${jsxString(id)} style={{ position: "absolute", left: ${jsxString(left)}, top: ${jsxString(top)}, width: ${jsxString(width)}, height: ${jsxString(height)}, boxSizing: "border-box", background: "var(--deck-accent)"${shapeStyle} }} />`;
  }

  const gradientAngle = formatNumber(
    (Math.atan2(geometry.height, geometry.width) * 180) / Math.PI + 180,
  );
  const lineFill = `linear-gradient(${gradientAngle}deg, transparent calc(50% - 1.5px), var(--deck-ink) 50%, transparent calc(50% + 1.5px))`;
  return `<div id=${jsxString(id)} aria-hidden="true" style={{ position: "absolute", left: ${jsxString(left)}, top: ${jsxString(top)}, width: ${jsxString(width)}, height: ${jsxString(height)}, background: ${jsxString(lineFill)} }} />`;
}

function findSelectionAtStart(
  sourceTsx: string,
  start: number,
): SourceStructureResult["selection"] {
  const node = collectJsx(sourceTsx)?.find(
    (candidate) =>
      candidate.node.type === "JSXElement" && candidate.node.start === start,
  )?.node;
  const line = node?.loc?.start?.line;
  const column = node?.loc?.start?.column;
  return Number.isInteger(line) && Number.isInteger(column)
    ? { line: line as number, column: column as number }
    : undefined;
}

function createCanvasLayer(
  sourceTsx: string,
  root: AstNode,
  objectSource: string,
): SourceStructureResult | null {
  const range = nodeRange(root, sourceTsx.length);
  if (!range) return null;
  const indent = lineIndent(sourceTsx, range.start);
  const childIndent = `${indent}  `;
  const newline = lineEnding(sourceTsx);
  const rootSource = sourceTsx.slice(range.start, range.end);
  const indentedRoot = rootSource
    .split(/\r?\n/)
    .map((line) => `${childIndent}${line}`)
    .join(newline);
  const layer = `<div ${OBJECT_LAYER_ATTRIBUTE}="true" style={{ position: "relative", width: ${jsxString(pixels(OPEN_SLIDE_CANVAS_WIDTH))}, height: ${jsxString(pixels(OPEN_SLIDE_CANVAS_HEIGHT))}, boxSizing: "border-box", overflow: "hidden" }}>${newline}${indentedRoot}${newline}${childIndent}${objectSource}${newline}${indent}</div>`;
  const nextSource =
    sourceTsx.slice(0, range.start) + layer + sourceTsx.slice(range.end);
  const objectStart = range.start + layer.lastIndexOf(objectSource);
  const selection = findSelectionAtStart(nextSource, objectStart);
  return selection ? { sourceTsx: nextSource, selection } : null;
}

function appendToCanvasLayer(
  sourceTsx: string,
  layer: AstNode,
  objectSource: string,
): SourceStructureResult | null {
  const closingElement = layer.closingElement;
  const closeStart = closingElement?.start;
  if (typeof closeStart !== "number") return null;

  const newline = lineEnding(sourceTsx);
  const lineStart = sourceTsx.lastIndexOf("\n", closeStart - 1) + 1;
  const closeIndent = sourceTsx.slice(lineStart, closeStart);
  const isOwnLine = /^[\t ]*$/.test(closeIndent);
  const indent = isOwnLine
    ? closeIndent
    : lineIndent(sourceTsx, layer.start ?? 0);
  const insertionStart = isOwnLine ? lineStart : closeStart;
  const insertion = isOwnLine
    ? `${indent}  ${objectSource}${newline}`
    : `${newline}${indent}  ${objectSource}${newline}${indent}`;
  const nextSource =
    sourceTsx.slice(0, insertionStart) +
    insertion +
    sourceTsx.slice(insertionStart);
  const objectStart = insertionStart + insertion.indexOf(objectSource);
  const selection = findSelectionAtStart(nextSource, objectStart);
  return selection ? { sourceTsx: nextSource, selection } : null;
}

export function insertSourceObject(
  sourceTsx: string,
  insertion: OpenSlideObjectInsertion,
): SourceStructureResult | null {
  if (!parseFile(sourceTsx)) return null;
  if (!Object.hasOwn(defaultGeometry, insertion.kind)) return null;
  const root = getDefaultComponentRoot(sourceTsx);
  if (!root) return null;

  const geometry = normalizeGeometry(insertion.kind, insertion.geometry);
  if (!geometry) return null;
  if (insertion.id && hasDynamicSourceIdentity(sourceTsx)) return null;

  const id = insertion.id ?? nextObjectId(sourceTsx, insertion.kind);
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)) return null;
  if (sourceIds(sourceTsx).has(id)) return null;

  const objectSource = createObjectSource(
    insertion.kind,
    geometry,
    id,
    insertion.text,
  );
  const result = isObjectLayer(root)
    ? appendToCanvasLayer(sourceTsx, root, objectSource)
    : createCanvasLayer(sourceTsx, root, objectSource);
  if (!result || !parseFile(result.sourceTsx)) return null;
  return { ...result, createdObjectId: id };
}

function findSelectedElement(
  sourceTsx: string,
  selection: SourceSelection,
): { located: LocatedJsx; range: { start: number; end: number } } | null {
  const root = getDefaultComponentRoot(sourceTsx);
  const rootRange = root && nodeRange(root, sourceTsx.length);
  if (!rootRange) return null;
  const matches = (collectJsx(sourceTsx) ?? []).filter(
    ({ node }) =>
      node.type === "JSXElement" &&
      node.loc?.start?.line === selection.line &&
      node.loc.start.column === selection.column &&
      typeof node.start === "number" &&
      typeof node.end === "number" &&
      node.start >= rootRange.start &&
      node.end <= rootRange.end,
  );
  if (matches.length !== 1) return null;
  const located = matches[0];
  if (!located) return null;
  const range = nodeRange(located.node, sourceTsx.length);
  return range ? { located, range } : null;
}

function isDirectChild(located: LocatedJsx): boolean {
  const parent = located.jsxAncestors.at(-1);
  return Boolean(
    parent &&
    Array.isArray(parent.children) &&
    parent.children.includes(located.node),
  );
}

function sourceSplice(
  sourceTsx: string,
  start: number,
  end: number,
  replacement: string,
): string {
  return sourceTsx.slice(0, start) + replacement + sourceTsx.slice(end);
}

function findCreatedNode(
  sourceTsx: string,
  start: number,
): SourceSelection | undefined {
  const node = collectJsx(sourceTsx)?.find(
    (candidate) =>
      candidate.node.type === "JSXElement" && candidate.node.start === start,
  )?.node;
  const line = node?.loc?.start?.line;
  const column = node?.loc?.start?.column;
  return Number.isInteger(line) && Number.isInteger(column)
    ? { line: line as number, column: column as number }
    : undefined;
}

function collectSubtreeAttributes(node: AstNode): {
  attributes: AstNode[];
  hasSpread: boolean;
} {
  const attributes: AstNode[] = [];
  let hasSpread = false;
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    const current = value as AstNode;
    if (current.type === "JSXAttribute") attributes.push(current);
    if (current.type === "JSXSpreadAttribute") hasSpread = true;
    for (const [key, child] of Object.entries(current)) {
      if (!SKIPPED_KEYS.has(key)) visit(child);
    }
  };
  visit(node);
  return { attributes, hasSpread };
}

function attributeName(attribute: AstNode): string | null {
  const name = attribute.name as AstNode | undefined;
  return name?.type === "JSXIdentifier" && typeof name.name === "string"
    ? name.name
    : null;
}

function staticAttributeString(attribute: AstNode): string | null {
  const value = attribute.value as AstNode | undefined;
  if (value?.type === "StringLiteral" && typeof value.value === "string") {
    return value.value;
  }
  if (value?.type !== "JSXExpressionContainer") return null;
  const expression = value.expression as AstNode | undefined;
  return expression?.type === "StringLiteral" &&
    typeof expression.value === "string"
    ? expression.value
    : null;
}

function duplicateId(
  sourceTsx: string,
  selected: { node: AstNode; range: { start: number; end: number } },
): { source: string; id?: string } | null {
  const { attributes, hasSpread } = collectSubtreeAttributes(selected.node);
  if (
    hasSpread ||
    attributes.some((attribute) =>
      ["data-slide-object-id", "data-slide-group"].includes(
        attributeName(attribute) ?? "",
      ),
    )
  ) {
    return null;
  }

  const idAttributes = attributes.filter(
    (attribute) => attributeName(attribute) === "id",
  );
  if (idAttributes.length === 0) {
    return {
      source: sourceTsx.slice(selected.range.start, selected.range.end),
    };
  }
  if (idAttributes.length !== 1) return null;

  const idAttribute = idAttributes[0]!;
  const rootAttributes = Array.isArray(selected.node.openingElement?.attributes)
    ? (selected.node.openingElement.attributes as AstNode[])
    : [];
  if (!rootAttributes.includes(idAttribute)) return null;

  const currentId = staticAttributeString(idAttribute);
  if (currentId === null) return null;
  const match = currentId.match(
    /^slides2-(text|rectangle|ellipse|line)-[A-Za-z0-9_-]{1,80}$/,
  );
  const idStart = idAttribute.start;
  const idEnd = idAttribute.end;
  if (
    !match ||
    typeof idStart !== "number" ||
    typeof idEnd !== "number" ||
    idStart < selected.range.start ||
    idEnd > selected.range.end ||
    sourceTsx.slice(selected.range.start, idStart).includes(currentId) ||
    sourceTsx.slice(idEnd, selected.range.end).includes(currentId) ||
    sourceTsx.slice(0, selected.range.start).includes(currentId) ||
    sourceTsx.slice(selected.range.end).includes(currentId)
  ) {
    return null;
  }

  const id = nextObjectId(sourceTsx, match[1] as OpenSlideObjectKind);
  const relativeStart = idStart - selected.range.start;
  const relativeEnd = idEnd - selected.range.start;
  const raw = sourceTsx.slice(selected.range.start, selected.range.end);
  return {
    source:
      raw.slice(0, relativeStart) +
      `id=${jsxString(id)}` +
      raw.slice(relativeEnd),
    id,
  };
}

export function duplicateSourceElement(
  sourceTsx: string,
  selection: SourceSelection,
): SourceStructureResult | null {
  const selected = findSelectedElement(sourceTsx, selection);
  if (!selected) return null;
  const clone = duplicateId(sourceTsx, {
    node: selected.located.node,
    range: selected.range,
  });
  if (!clone) return null;

  const raw = sourceTsx.slice(selected.range.start, selected.range.end);
  if (selected.located.jsxAncestors.length === 0) {
    const clonedRoot = `<div style={{ position: "absolute", left: "24px", top: "24px" }}>${clone.source}</div>`;
    const wrapper = `<div style={{ position: "relative", width: "${OPEN_SLIDE_CANVAS_WIDTH}px", height: "${OPEN_SLIDE_CANVAS_HEIGHT}px", boxSizing: "border-box" }}>${raw}${clonedRoot}</div>`;
    const nextSource = sourceSplice(
      sourceTsx,
      selected.range.start,
      selected.range.end,
      wrapper,
    );
    const cloneOffset = wrapper.lastIndexOf(clone.source);
    const createdSelection = findCreatedNode(
      nextSource,
      selected.range.start + cloneOffset,
    );
    return createdSelection
      ? {
          sourceTsx: nextSource,
          selection: createdSelection,
          ...(clone.id ? { createdObjectId: clone.id } : {}),
        }
      : null;
  }
  if (!isDirectChild(selected.located)) return null;

  const prefix = `\n${lineIndent(sourceTsx, selected.range.start)}`;
  const nextSource = sourceSplice(
    sourceTsx,
    selected.range.end,
    selected.range.end,
    prefix + clone.source,
  );
  const createdSelection = findCreatedNode(
    nextSource,
    selected.range.end + prefix.length,
  );
  return createdSelection
    ? {
        sourceTsx: nextSource,
        selection: createdSelection,
        ...(clone.id ? { createdObjectId: clone.id } : {}),
      }
    : null;
}

export function deleteSourceElement(
  sourceTsx: string,
  selection: SourceSelection,
): SourceStructureResult | null {
  const selected = findSelectedElement(sourceTsx, selection);
  if (!selected) return null;
  if (selected.located.jsxAncestors.length === 0) {
    return {
      sourceTsx: sourceSplice(
        sourceTsx,
        selected.range.start,
        selected.range.end,
        `<div style={{ width: "${OPEN_SLIDE_CANVAS_WIDTH}px", height: "${OPEN_SLIDE_CANVAS_HEIGHT}px", boxSizing: "border-box" }} />`,
      ),
    };
  }
  if (!isDirectChild(selected.located)) return null;

  let start = selected.range.start;
  let end = selected.range.end;
  const lineStart = sourceTsx.lastIndexOf("\n", start - 1) + 1;
  if (/^[\t ]*$/.test(sourceTsx.slice(lineStart, start))) start = lineStart;
  const followingLine = /^\r?\n/.exec(sourceTsx.slice(end));
  if (followingLine) end += followingLine[0].length;
  return { sourceTsx: sourceSplice(sourceTsx, start, end, "") };
}
