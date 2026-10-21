import { parse } from "@babel/parser";
import {
  isSlideTransition,
  type SlideTransition,
} from "@shared/slides-2-transition";

export type SourceSelection = { line: number; column: number };
export type MotionPreset = "none" | "fade" | "slide";
export type TransitionScope = "module" | "page";
export type BuildSelectionAction = "add" | "remove" | "unsupported";
export type BuildDirection = "earlier" | "later";

type SourceNode = {
  type?: string;
  start?: number | null;
  end?: number | null;
  loc?: { start?: { line?: number; column?: number } };
  name?: string | { name?: string };
  value?: unknown;
  raw?: string;
  source?: { value?: unknown };
  imported?: { name?: string; value?: string };
  local?: { name?: string };
  declaration?: SourceNode | null;
  declarations?: SourceNode[];
  id?: SourceNode;
  init?: SourceNode | null;
  expression?: SourceNode;
  left?: SourceNode;
  right?: SourceNode;
  argument?: SourceNode;
  operator?: string;
  computed?: boolean;
  openingElement?: SourceNode;
  children?: SourceNode[];
  body?: SourceNode[];
  specifiers?: SourceNode[];
  attributes?: SourceNode[];
  properties?: SourceNode[];
  elements?: SourceNode[];
  key?: SourceNode;
  [key: string]: unknown;
};

type JsxLocation = { node: SourceNode; ancestors: SourceNode[] };

const CORE_PACKAGE = "@agent-native/slides-core";
function parseSource(sourceTsx: string): SourceNode | null {
  try {
    return (
      parse(sourceTsx, {
        sourceType: "module",
        plugins: ["jsx", "typescript"],
      }) as unknown as { program: SourceNode }
    ).program;
  } catch {
    return null;
  }
}

function visitNodes(
  value: unknown,
  ancestors: SourceNode[],
  visit: (node: SourceNode, ancestors: SourceNode[]) => void,
): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const child of value) visitNodes(child, ancestors, visit);
    return;
  }
  const node = value as SourceNode;
  if (typeof node.type !== "string") return;
  if (node.type === "JSXElement") visit(node, ancestors);
  const nextAncestors =
    node.type === "JSXElement" ? [...ancestors, node] : ancestors;
  for (const [key, child] of Object.entries(node)) {
    if (key === "loc" || key === "tokens" || key === "comments") continue;
    visitNodes(child, nextAncestors, visit);
  }
}

function elementName(node: SourceNode): string | null {
  const name = node.openingElement?.name as SourceNode | undefined;
  if (name?.type !== "JSXIdentifier" || typeof name.name !== "string") {
    return null;
  }
  return name.name;
}

function selectedJsx(
  ast: SourceNode,
  selection: SourceSelection,
): JsxLocation | null {
  const matches: JsxLocation[] = [];
  visitNodes(ast, [], (node, ancestors) => {
    if (
      node.loc?.start?.line === selection.line &&
      node.loc.start.column === selection.column
    ) {
      matches.push({ node, ancestors });
    }
  });
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function sourceRange(node: SourceNode, sourceLength: number) {
  const start = node.start;
  const end = node.end;
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

function nonWhitespaceChildren(node: SourceNode): SourceNode[] {
  return (node.children ?? []).filter((child) => {
    if (child.type === "JSXText") {
      return typeof child.value !== "string" || child.value.trim().length > 0;
    }
    return (
      child.type !== "JSXExpressionContainer" ||
      (child.expression as SourceNode | undefined)?.type !==
        "JSXEmptyExpression"
    );
  });
}

function selectionAtOffset(source: string, offset: number): SourceSelection {
  const prefix = source.slice(0, offset);
  const lastNewline = prefix.lastIndexOf("\n");
  return {
    line: prefix.split("\n").length,
    column: offset - lastNewline - 1,
  };
}

function importLocal(ast: SourceNode, importedName: string) {
  for (const statement of ast.body ?? []) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.source?.value !== CORE_PACKAGE
    ) {
      continue;
    }
    for (const specifier of statement.specifiers ?? []) {
      if (
        specifier.type === "ImportSpecifier" &&
        specifier.imported?.name === importedName &&
        typeof specifier.local?.name === "string"
      ) {
        return specifier.local.name;
      }
    }
  }
  return null;
}

function allIdentifiers(ast: SourceNode): Set<string> {
  const names = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    const node = value as SourceNode;
    if (node.type === "Identifier" && typeof node.name === "string") {
      names.add(node.name);
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === "loc" || key === "tokens" || key === "comments") continue;
      visit(child);
    }
  };
  visit(ast);
  return names;
}

function uniqueName(base: string, names: Set<string>): string {
  if (!names.has(base)) return base;
  let suffix = 2;
  while (names.has(base + suffix)) suffix++;
  return base + suffix;
}

function importInsertionOffset(source: string, ast: SourceNode): number {
  let offset = source.startsWith("#!")
    ? Math.max(0, source.indexOf("\n") + 1)
    : 0;
  for (const statement of ast.body ?? []) {
    const isDirective =
      statement.type === "ExpressionStatement" &&
      typeof statement.directive === "string";
    if (statement.type !== "ImportDeclaration" && !isDirective) break;
    const end = statement.end;
    if (typeof end === "number") offset = Math.max(offset, end);
  }
  if (offset > 0 && source[offset - 1] !== "\n") return offset;
  return offset;
}

function ensureNamedImports(
  ast: SourceNode,
  importedNames: readonly string[],
): { localNames: Record<string, string>; importText: string } {
  const identifiers = allIdentifiers(ast);
  const localNames: Record<string, string> = {};
  const missing: string[] = [];
  for (const importedName of importedNames) {
    const existing = importLocal(ast, importedName);
    const localName = existing ?? uniqueName(importedName, identifiers);
    localNames[importedName] = localName;
    if (existing) continue;
    identifiers.add(localName);
    missing.push(
      importedName + (localName === importedName ? "" : " as " + localName),
    );
  }
  return {
    localNames,
    importText: missing.length
      ? "import { " + missing.join(", ") + ' } from "' + CORE_PACKAGE + '";\n'
      : "",
  };
}

function withImports(
  source: string,
  importText: string,
  offset: number,
): string {
  if (!importText) return source;
  const needsLeadingNewline = offset > 0 && source[offset - 1] !== "\n";
  const insertion = (needsLeadingNewline ? "\n" : "") + importText;
  return source.slice(0, offset) + insertion + source.slice(offset);
}

function elementAttribute(
  element: SourceNode,
  name: string,
): SourceNode | null {
  const attributes = element.openingElement?.attributes ?? [];
  for (const attribute of attributes) {
    const attrName = attribute.name as SourceNode | undefined;
    if (attribute.type === "JSXAttribute" && attrName?.name === name) {
      return attribute;
    }
  }
  return null;
}

function attributeStringValue(attribute: SourceNode | null): string | null {
  const value = attribute?.value as SourceNode | undefined;
  if (value?.type === "StringLiteral" && typeof value.value === "string") {
    return value.value;
  }
  if (value?.type === "JSXExpressionContainer") {
    const expression = value.expression as SourceNode | undefined;
    if (
      expression?.type === "StringLiteral" &&
      typeof expression.value === "string"
    ) {
      return expression.value;
    }
  }
  return null;
}

function attributeNumberValue(attribute: SourceNode | null): number | null {
  const value = attribute?.value as SourceNode | undefined;
  const expression =
    value?.type === "JSXExpressionContainer"
      ? (value.expression as SourceNode | undefined)
      : value;
  if (
    (expression?.type === "NumericLiteral" ||
      expression?.type === "DecimalLiteral") &&
    typeof expression.value === "number" &&
    Number.isFinite(expression.value)
  ) {
    return expression.value;
  }
  return null;
}

function elementDescendantHasName(
  node: SourceNode,
  names: Set<string>,
): boolean {
  let found = false;
  const visit = (value: unknown) => {
    if (found || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    const current = value as SourceNode;
    if (
      current.type === "JSXElement" &&
      names.has(elementName(current) ?? "")
    ) {
      found = true;
      return;
    }
    for (const [key, child] of Object.entries(current)) {
      if (key === "loc" || key === "tokens" || key === "comments") continue;
      visit(child);
    }
  };
  visit(node);
  return found;
}

function buildContext(source: string, selection: SourceSelection) {
  const ast = parseSource(source);
  if (!ast) return null;
  const selected = selectedJsx(ast, selection);
  if (!selected) return null;
  const names = {
    step: importLocal(ast, "Step") ?? "Step",
    steps: importLocal(ast, "Steps") ?? "Steps",
  };
  const chain = [...selected.ancestors, selected.node];
  let nearestStepIndex = -1;
  for (let index = chain.length - 1; index >= 0; index--) {
    if (elementName(chain[index]!) === names.step) {
      nearestStepIndex = index;
      break;
    }
  }
  let stepsIndex = -1;
  for (let index = chain.length - 1; index >= 0; index--) {
    if (elementName(chain[index]!) === names.steps) {
      stepsIndex = index;
      break;
    }
  }
  return { ast, selected, names, chain, nearestStepIndex, stepsIndex };
}

function directStepParent(
  context: NonNullable<ReturnType<typeof buildContext>>,
  stepIndex: number,
): boolean {
  return (
    stepIndex > 0 &&
    elementName(context.chain[stepIndex - 1]!) === context.names.steps
  );
}

export function getBuildSelectionAction(
  sourceTsx: string,
  selection: SourceSelection | null,
): BuildSelectionAction {
  if (!selection) return "unsupported";
  const context = buildContext(sourceTsx, selection);
  if (!context || elementName(context.selected.node) === context.names.steps) {
    return "unsupported";
  }
  const { nearestStepIndex, stepsIndex } = context;
  if (nearestStepIndex >= 0) {
    const step = context.chain[nearestStepIndex]!;
    if (
      !directStepParent(context, nearestStepIndex) ||
      nonWhitespaceChildren(step).length !== 1
    ) {
      return "unsupported";
    }
    return "remove";
  }
  if (stepsIndex >= 0) {
    if (
      stepsIndex !== context.chain.length - 2 ||
      elementDescendantHasName(
        context.selected.node,
        new Set([context.names.step, context.names.steps]),
      )
    ) {
      return "unsupported";
    }
  } else if (
    elementDescendantHasName(
      context.selected.node,
      new Set([context.names.step, context.names.steps]),
    )
  ) {
    return "unsupported";
  }
  return "add";
}

export function setSourceBuildStep(
  sourceTsx: string,
  selection: SourceSelection,
  enabled: boolean,
): { sourceTsx: string; selection: SourceSelection } | null {
  const context = buildContext(sourceTsx, selection);
  if (!context) return null;
  const { ast, selected, names, chain, nearestStepIndex, stepsIndex } = context;
  const selectedRange = sourceRange(selected.node, sourceTsx.length);
  if (!selectedRange) return null;

  if (enabled) {
    if (getBuildSelectionAction(sourceTsx, selection) !== "add") return null;
    const importNames = stepsIndex >= 0 ? ["Step"] : ["Step", "Steps"];
    const imports = ensureNamedImports(ast, importNames);
    const stepName = imports.localNames.Step ?? names.step;
    const stepsName = imports.localNames.Steps ?? names.steps;
    const open =
      (stepsIndex >= 0 ? "" : "<" + stepsName + ">") + "<" + stepName + ">";
    const close =
      "</" + stepName + ">" + (stepsIndex >= 0 ? "" : "</" + stepsName + ">");
    let nextSource =
      sourceTsx.slice(0, selectedRange.start) +
      open +
      sourceTsx.slice(selectedRange.start, selectedRange.end) +
      close +
      sourceTsx.slice(selectedRange.end);
    const importOffset = importInsertionOffset(sourceTsx, ast);
    if (imports.importText) {
      nextSource = withImports(nextSource, imports.importText, importOffset);
    }
    let selectedOffset = selectedRange.start + open.length;
    if (imports.importText && importOffset <= selectedRange.start) {
      selectedOffset += imports.importText.length;
      if (importOffset > 0 && sourceTsx[importOffset - 1] !== "\n") {
        selectedOffset += 1;
      }
    }
    return {
      sourceTsx: nextSource,
      selection: selectionAtOffset(nextSource, selectedOffset),
    };
  }

  if (nearestStepIndex < 0 || !directStepParent(context, nearestStepIndex)) {
    return null;
  }
  const step = chain[nearestStepIndex]!;
  const stepRange = sourceRange(step, sourceTsx.length);
  const child = nonWhitespaceChildren(step)[0];
  const childRange = child ? sourceRange(child, sourceTsx.length) : null;
  if (!stepRange || !childRange || nonWhitespaceChildren(step).length !== 1) {
    return null;
  }
  const steps = chain[nearestStepIndex - 1]!;
  const removeSteps = nonWhitespaceChildren(steps).length === 1;
  const outer = removeSteps ? steps : step;
  const outerRange = sourceRange(outer, sourceTsx.length);
  if (!outerRange) return null;
  const selectedOffsetInChild =
    selectedRange.start >= childRange.start &&
    selectedRange.start <= childRange.end
      ? selectedRange.start - childRange.start
      : 0;
  const selectedOffset = outerRange.start + selectedOffsetInChild;
  const nextSource =
    sourceTsx.slice(0, outerRange.start) +
    sourceTsx.slice(childRange.start, childRange.end) +
    sourceTsx.slice(outerRange.end);
  return {
    sourceTsx: nextSource,
    selection: selectionAtOffset(nextSource, selectedOffset),
  };
}

function nearestStepContext(source: string, selection: SourceSelection) {
  const context = buildContext(source, selection);
  if (!context || context.nearestStepIndex < 0) return null;
  if (!directStepParent(context, context.nearestStepIndex)) return null;
  return context;
}

export function getSourceBuildDuration(
  sourceTsx: string,
  selection: SourceSelection | null,
): number {
  if (!selection) return 180;
  const context = nearestStepContext(sourceTsx, selection);
  if (!context) return 180;
  return (
    attributeNumberValue(
      elementAttribute(context.chain[context.nearestStepIndex]!, "duration"),
    ) ?? 180
  );
}

export function setSourceBuildDuration(
  sourceTsx: string,
  selection: SourceSelection,
  duration: number,
): string | null {
  const context = nearestStepContext(sourceTsx, selection);
  if (!context) return null;
  const step = context.chain[context.nearestStepIndex]!;
  const safeDuration = Math.max(0, Math.min(10_000, Math.round(duration)));
  const attribute = elementAttribute(step, "duration");
  if (attribute) {
    const range = sourceRange(attribute, sourceTsx.length);
    if (!range) return null;
    return (
      sourceTsx.slice(0, range.start) +
      "duration={" +
      safeDuration +
      "}" +
      sourceTsx.slice(range.end)
    );
  }
  const opening = sourceRange(step.openingElement ?? {}, sourceTsx.length);
  if (!opening) return null;
  const insertAt = opening.end - 1;
  return (
    sourceTsx.slice(0, insertAt) +
    " duration={" +
    safeDuration +
    "}" +
    sourceTsx.slice(insertAt)
  );
}

export function moveSourceBuildStep(
  sourceTsx: string,
  selection: SourceSelection,
  direction: BuildDirection,
): { sourceTsx: string; selection: SourceSelection } | null {
  const context = nearestStepContext(sourceTsx, selection);
  if (!context) return null;
  const parent = context.chain[context.nearestStepIndex - 1]!;
  const siblings = (parent.children ?? []).filter(
    (child) =>
      child.type === "JSXElement" && elementName(child) === context.names.step,
  );
  const step = context.chain[context.nearestStepIndex]!;
  const index = siblings.indexOf(step);
  const adjacent = siblings[index + (direction === "earlier" ? -1 : 1)];
  if (!adjacent) return null;
  const stepRange = sourceRange(step, sourceTsx.length);
  const adjacentRange = sourceRange(adjacent, sourceTsx.length);
  const selectedRange = sourceRange(context.selected.node, sourceTsx.length);
  if (!stepRange || !adjacentRange || !selectedRange) return null;

  let nextSource: string;
  let nextStepStart: number;
  if (direction === "earlier") {
    const between = sourceTsx.slice(adjacentRange.end, stepRange.start);
    nextSource =
      sourceTsx.slice(0, adjacentRange.start) +
      sourceTsx.slice(stepRange.start, stepRange.end) +
      between +
      sourceTsx.slice(adjacentRange.start, adjacentRange.end) +
      sourceTsx.slice(stepRange.end);
    nextStepStart = adjacentRange.start;
  } else {
    const between = sourceTsx.slice(stepRange.end, adjacentRange.start);
    nextSource =
      sourceTsx.slice(0, stepRange.start) +
      sourceTsx.slice(adjacentRange.start, adjacentRange.end) +
      between +
      sourceTsx.slice(stepRange.start, stepRange.end) +
      sourceTsx.slice(adjacentRange.end);
    nextStepStart = adjacentRange.start;
  }
  return {
    sourceTsx: nextSource,
    selection: selectionAtOffset(
      nextSource,
      nextStepStart + (selectedRange.start - stepRange.start),
    ),
  };
}

function morphContext(source: string, selection: SourceSelection) {
  const context = buildContext(source, selection);
  if (!context) return null;
  const morphName = importLocal(context.ast, "MorphElement") ?? "MorphElement";
  let morphIndex = -1;
  for (let index = context.chain.length - 1; index >= 0; index--) {
    if (elementName(context.chain[index]!) === morphName) {
      morphIndex = index;
      break;
    }
  }
  return { ...context, morphName, morphIndex };
}

export function getSourceMorphId(
  sourceTsx: string,
  selection: SourceSelection | null,
): string {
  if (!selection) return "";
  const context = morphContext(sourceTsx, selection);
  if (!context || context.morphIndex < 0) return "";
  return (
    attributeStringValue(
      elementAttribute(context.chain[context.morphIndex]!, "id"),
    ) ?? ""
  );
}

export function isSourceMorphIdUnique(
  sourceTsx: string,
  selection: SourceSelection | null,
  morphId: string,
): boolean {
  if (!selection || !/^[A-Za-z0-9._:-]{1,100}$/.test(morphId)) return false;
  const context = morphContext(sourceTsx, selection);
  if (!context) return false;
  let duplicate = false;
  visitNodes(context.ast, [], (node) => {
    if (elementName(node) !== context.morphName) return;
    if (attributeStringValue(elementAttribute(node, "id")) !== morphId) return;
    if (context.morphIndex >= 0 && node === context.chain[context.morphIndex]) {
      return;
    }
    duplicate = true;
  });
  return !duplicate;
}

function jsxString(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

export function setSourceMorphId(
  sourceTsx: string,
  selection: SourceSelection,
  morphId: string | null,
): { sourceTsx: string; selection: SourceSelection } | null {
  const context = morphContext(sourceTsx, selection);
  if (!context) return null;
  const safeId = morphId?.trim() ?? "";
  if (morphId !== null && !/^[A-Za-z0-9._:-]{1,100}$/.test(safeId)) return null;
  const selectedRange = sourceRange(context.selected.node, sourceTsx.length);
  if (!selectedRange) return null;

  if (context.morphIndex >= 0) {
    const wrapper = context.chain[context.morphIndex]!;
    const attribute = elementAttribute(wrapper, "id");
    const idValue = 'id="' + jsxString(safeId) + '"';
    let nextSource: string;
    let nextSelectionOffset = selectedRange.start;
    if (morphId === null) {
      const children = nonWhitespaceChildren(wrapper);
      const child = children[0];
      const wrapperRange = sourceRange(wrapper, sourceTsx.length);
      const childRange = child ? sourceRange(child, sourceTsx.length) : null;
      if (children.length !== 1 || !wrapperRange || !childRange) return null;
      nextSource =
        sourceTsx.slice(0, wrapperRange.start) +
        sourceTsx.slice(childRange.start, childRange.end) +
        sourceTsx.slice(wrapperRange.end);
      nextSelectionOffset =
        wrapperRange.start +
        (selectedRange.start >= childRange.start &&
        selectedRange.start <= childRange.end
          ? selectedRange.start - childRange.start
          : 0);
    } else if (attribute) {
      const range = sourceRange(attribute, sourceTsx.length);
      if (!range) return null;
      nextSource =
        sourceTsx.slice(0, range.start) + idValue + sourceTsx.slice(range.end);
      if (range.end <= selectedRange.start) {
        nextSelectionOffset += idValue.length - (range.end - range.start);
      }
    } else {
      const opening = sourceRange(
        wrapper.openingElement ?? {},
        sourceTsx.length,
      );
      if (!opening) return null;
      const insertAt = opening.end - 1;
      if (insertAt <= selectedRange.start) {
        nextSelectionOffset += 1 + idValue.length;
      }
      nextSource =
        sourceTsx.slice(0, insertAt) +
        " " +
        idValue +
        sourceTsx.slice(insertAt);
    }
    return {
      sourceTsx: nextSource,
      selection: selectionAtOffset(nextSource, nextSelectionOffset),
    };
  }

  if (
    morphId === null ||
    elementDescendantHasName(
      context.selected.node,
      new Set([context.morphName]),
    )
  ) {
    return null;
  }
  const imports = ensureNamedImports(context.ast, ["MorphElement"]);
  const morphName = imports.localNames.MorphElement ?? context.morphName;
  const open = "<" + morphName + ' id="' + jsxString(safeId) + '">';
  const close = "</" + morphName + ">";
  let nextSource =
    sourceTsx.slice(0, selectedRange.start) +
    open +
    sourceTsx.slice(selectedRange.start, selectedRange.end) +
    close +
    sourceTsx.slice(selectedRange.end);
  const importOffset = importInsertionOffset(sourceTsx, context.ast);
  if (imports.importText) {
    nextSource = withImports(nextSource, imports.importText, importOffset);
  }
  let nextSelectionOffset = selectedRange.start + open.length;
  if (imports.importText && importOffset <= selectedRange.start) {
    nextSelectionOffset += imports.importText.length;
    if (importOffset > 0 && sourceTsx[importOffset - 1] !== "\n") {
      nextSelectionOffset += 1;
    }
  }
  return {
    sourceTsx: nextSource,
    selection: selectionAtOffset(nextSource, nextSelectionOffset),
  };
}

function staticBindings(ast: SourceNode): Map<string, SourceNode> {
  const bindings = new Map<string, SourceNode>();
  for (const statement of ast.body ?? []) {
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? statement.declaration
        : statement;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const item of declaration.declarations ?? []) {
      const bindingName = item.id?.name;
      if (
        item.id?.type === "Identifier" &&
        typeof bindingName === "string" &&
        bindingName &&
        item.init
      ) {
        bindings.set(bindingName, item.init);
      }
    }
  }
  return bindings;
}

function staticValue(
  node: SourceNode | null | undefined,
  bindings: Map<string, SourceNode>,
  active = new Set<string>(),
  depth = 0,
): unknown {
  if (!node || depth > 24) return undefined;
  const next = (value: SourceNode | null | undefined) =>
    staticValue(value, bindings, active, depth + 1);
  if (
    node.type === "TSAsExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "TSTypeAssertion" ||
    node.type === "TSNonNullExpression"
  ) {
    return next(node.expression);
  }
  if (
    node.type === "StringLiteral" ||
    node.type === "NumericLiteral" ||
    node.type === "BooleanLiteral"
  ) {
    return node.value;
  }
  if (node.type === "NullLiteral") return null;
  if (node.type === "Identifier" && typeof node.name === "string") {
    const binding = bindings.get(node.name);
    if (!binding || active.has(node.name)) return undefined;
    const nextActive = new Set(active);
    nextActive.add(node.name);
    return staticValue(binding, bindings, nextActive, depth + 1);
  }
  if (
    node.type === "UnaryExpression" &&
    ["-", "+"].includes(node.operator ?? "")
  ) {
    const value = next(node.argument);
    return typeof value === "number"
      ? node.operator === "-"
        ? -value
        : value
      : undefined;
  }
  if (node.type === "ArrayExpression") {
    const elements = node.elements ?? [];
    const values = elements.map((element) => next(element));
    return values.some((value) => value === undefined) ? undefined : values;
  }
  if (node.type === "ObjectExpression") {
    const result: Record<string, unknown> = {};
    for (const property of node.properties ?? []) {
      if (property.type !== "ObjectProperty" || property.computed) {
        return undefined;
      }
      const key = property.key as SourceNode | undefined;
      const name =
        key?.type === "Identifier"
          ? key.name
          : key?.type === "StringLiteral"
            ? key.value
            : undefined;
      const value = next(property.value as SourceNode | undefined);
      if (typeof name !== "string" || value === undefined) return undefined;
      result[name] = value;
    }
    return result;
  }
  return undefined;
}

function defaultComponentName(ast: SourceNode): string | null {
  const declaration = ast.body?.find(
    (statement) => statement.type === "ExportDefaultDeclaration",
  )?.declaration;
  if (
    declaration?.type === "Identifier" &&
    typeof declaration.name === "string"
  ) {
    return declaration.name;
  }
  if (
    (declaration?.type === "FunctionDeclaration" ||
      declaration?.type === "FunctionExpression") &&
    typeof declaration.id?.name === "string"
  ) {
    return declaration.id.name;
  }
  return null;
}

function pageTransitionAssignment(
  statement: SourceNode,
  componentName: string,
): SourceNode | null {
  const expression = statement.expression;
  if (
    statement.type !== "ExpressionStatement" ||
    expression?.type !== "AssignmentExpression" ||
    expression.left?.type !== "MemberExpression" ||
    expression.left.computed === true
  ) {
    return null;
  }
  const object = expression.left.object as SourceNode | undefined;
  const property = expression.left.property as SourceNode | undefined;
  return object?.name === componentName && property?.name === "transition"
    ? (expression.right ?? null)
    : null;
}

function pageTransitionStatement(
  ast: SourceNode,
  componentName: string,
): { statement: SourceNode; right: SourceNode } | null {
  for (const statement of ast.body ?? []) {
    const right = pageTransitionAssignment(statement, componentName);
    if (right) return { statement, right };
  }
  return null;
}

function moduleTransitionDeclaration(ast: SourceNode) {
  for (const statement of ast.body ?? []) {
    const exported = statement.type === "ExportNamedDeclaration";
    const declaration = exported ? statement.declaration : statement;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const item of declaration.declarations ?? []) {
      if (
        item.id?.type === "Identifier" &&
        item.id.name === "transition" &&
        item.init
      ) {
        return { initializer: item.init, statement, declaration, exported };
      }
    }
  }
  return null;
}

function readTransitionValue(
  node: SourceNode | null | undefined,
  ast: SourceNode,
): SlideTransition | undefined {
  if (!node) return undefined;
  const value = staticValue(node, staticBindings(ast));
  return isSlideTransition(value) ? value : undefined;
}

export function readSourceTransition(
  sourceTsx: string,
  scope: TransitionScope,
): SlideTransition | undefined {
  const ast = parseSource(sourceTsx);
  if (!ast) return undefined;
  if (scope === "page") {
    const componentName = defaultComponentName(ast);
    if (!componentName) return undefined;
    const assignment = pageTransitionStatement(ast, componentName);
    return assignment ? readTransitionValue(assignment.right, ast) : undefined;
  }
  const declaration = moduleTransitionDeclaration(ast);
  if (!declaration?.exported) return undefined;
  return readTransitionValue(declaration.initializer, ast);
}

export function effectiveSourceTransition(
  sourceTsx: string,
): SlideTransition | undefined {
  return (
    readSourceTransition(sourceTsx, "page") ??
    readSourceTransition(sourceTsx, "module")
  );
}

export function canSetPageTransition(sourceTsx: string): boolean {
  const ast = parseSource(sourceTsx);
  return Boolean(ast && defaultComponentName(ast));
}

export function removeSourcePageTransition(sourceTsx: string): string | null {
  const ast = parseSource(sourceTsx);
  const componentName = ast ? defaultComponentName(ast) : null;
  const assignment =
    ast && componentName ? pageTransitionStatement(ast, componentName) : null;
  const range = assignment
    ? sourceRange(assignment.statement, sourceTsx.length)
    : null;
  if (!range) return null;
  let start = range.start;
  let end = range.end;
  if (sourceTsx[end] === "\r" && sourceTsx[end + 1] === "\n") end += 2;
  else if (sourceTsx[end] === "\n") end += 1;
  else if (sourceTsx[start - 1] === "\n") start -= 1;
  return sourceTsx.slice(0, start) + sourceTsx.slice(end);
}

export function setSourceTransition(
  sourceTsx: string,
  transition: SlideTransition,
  scope: TransitionScope,
): string | null {
  if (!isSlideTransition(transition)) return null;
  const ast = parseSource(sourceTsx);
  if (!ast) return null;
  const serialized = JSON.stringify(transition);
  if (scope === "page") {
    const defaultName = defaultComponentName(ast);
    if (!defaultName) return null;
    const assignment = pageTransitionStatement(ast, defaultName);
    const range = assignment
      ? sourceRange(assignment.right, sourceTsx.length)
      : null;
    if (assignment && range) {
      return (
        sourceTsx.slice(0, range.start) +
        serialized +
        sourceTsx.slice(range.end)
      );
    }
    const separator = sourceTsx.endsWith("\n") ? "" : "\n";
    return (
      sourceTsx +
      separator +
      defaultName +
      ".transition = " +
      serialized +
      ";\n"
    );
  }

  const declaration = moduleTransitionDeclaration(ast);
  const range = declaration
    ? sourceRange(declaration.initializer, sourceTsx.length)
    : null;
  if (declaration && range) {
    let updated =
      sourceTsx.slice(0, range.start) + serialized + sourceTsx.slice(range.end);
    if (!declaration.exported) {
      const statementRange = sourceRange(
        declaration.statement,
        sourceTsx.length,
      );
      if (!statementRange) return null;
      updated =
        updated.slice(0, statementRange.start) +
        "export " +
        updated.slice(statementRange.start);
    }
    return updated;
  }
  const separator = sourceTsx.endsWith("\n") ? "" : "\n";
  return (
    sourceTsx + separator + "export const transition = " + serialized + ";\n"
  );
}

export function transitionForPreset(
  preset: MotionPreset,
  duration: number,
): SlideTransition {
  const safeDuration = Math.max(0, Math.min(10_000, Math.round(duration)));
  if (preset === "none" || safeDuration === 0) return { duration: 0 };
  if (preset === "fade") {
    return {
      duration: safeDuration,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      enter: {
        keyframes: [{ opacity: 0 }, { opacity: 1 }],
        duration: safeDuration,
      },
      exit: {
        keyframes: [{ opacity: 1 }, { opacity: 0 }],
        duration: safeDuration,
      },
    };
  }
  return {
    duration: safeDuration,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    enter: {
      keyframes: [
        { opacity: 0, transform: "translateX(36px)" },
        { opacity: 1, transform: "translateX(0px)" },
      ],
      duration: safeDuration,
    },
    exit: {
      keyframes: [
        { opacity: 1, transform: "translateX(0px)" },
        { opacity: 0, transform: "translateX(-36px)" },
      ],
      duration: safeDuration,
    },
  };
}
