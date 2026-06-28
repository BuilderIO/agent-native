export type CodeLayerSourceKind =
  | "design-file"
  | "inline-html"
  | "local-file"
  | "remote-url";

export interface CodeLayerSource {
  kind: CodeLayerSourceKind;
  designId?: string;
  fileId?: string;
  filename?: string;
  path?: string;
  url?: string;
  revision?: string;
}

export interface CodeLayerSourceSpan {
  start: number;
  end: number;
  openStart: number;
  openEnd: number;
  contentStart?: number;
  contentEnd?: number;
  closeStart?: number;
  closeEnd?: number;
}

export type VisualStyleProperty =
  | "width"
  | "height"
  | "color"
  | "background"
  | "background-color"
  | "padding"
  | "gap"
  | "display";

export interface StyleToken {
  property: VisualStyleProperty;
  value: string;
  token: string;
  source: "inline-style" | "class";
  confidence: number;
}

export interface LayoutContext {
  parentId?: string;
  parentSelector?: string;
  siblingIndex: number;
  nthOfType: number;
  display?: string;
  position?: string;
  width?: string;
  height?: string;
  flexDirection?: string;
  gap?: string;
  padding?: string;
  parentDisplay?: string;
  parentFlexDirection?: string;
  parentGap?: string;
  isFlexContainer: boolean;
  isGridContainer: boolean;
}

export type EditCapability =
  | {
      kind: "style";
      properties: VisualStyleProperty[];
      confidence: number;
      reason?: string;
    }
  | {
      kind: "class";
      operations: Array<"add" | "remove" | "replace" | "set">;
      confidence: number;
      reason?: string;
    }
  | {
      kind: "text";
      operations: Array<"setTextContent">;
      confidence: number;
      reason?: string;
    };

export interface CodeLayerNode {
  id: string;
  tag: string;
  selector: string;
  selectors: string[];
  path: string;
  attributes: Record<string, string | true>;
  dataAttributes: Record<string, string>;
  classes: string[];
  textSnippet: string | null;
  style: Partial<Record<VisualStyleProperty | string, string>>;
  styleTokens: StyleToken[];
  parentId?: string;
  children: string[];
  layout: LayoutContext;
  capabilities: EditCapability[];
  confidence: number;
  source: CodeLayerSourceSpan | null;
}

export interface ProjectionDiagnostic {
  severity: "info" | "warning";
  code: string;
  message: string;
  span?: { start: number; end: number };
}

export interface CodeLayerProjection {
  version: 1;
  projectionId: string;
  source: CodeLayerSource;
  rootNodeIds: string[];
  nodes: CodeLayerNode[];
  diagnostics: ProjectionDiagnostic[];
}

export interface PreviewBridgeProjectionPayload {
  type: "code-layer-projection";
  projection: CodeLayerProjection;
}

export interface PreviewBridgeSelectionPayload {
  type: "code-layer-selection";
  source: CodeLayerSource;
  nodeId?: string;
  selector?: string;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface PreviewBridgeEditPayload {
  type: "code-layer-edit-intent";
  source: CodeLayerSource;
  intent: EditIntent;
}

export type PreviewBridgePayload =
  | PreviewBridgeProjectionPayload
  | PreviewBridgeSelectionPayload
  | PreviewBridgeEditPayload;

export interface EditIntentTarget {
  nodeId?: string;
  selector?: string;
}

export interface StyleEditIntent {
  kind: "style";
  target: EditIntentTarget;
  property: VisualStyleProperty | string;
  value: string;
}

export interface ClassEditIntent {
  kind: "class";
  target: EditIntentTarget;
  operation: "add" | "remove" | "replace" | "set";
  className?: string;
  classNames?: string[];
  from?: string;
  to?: string;
}

export interface TextEditIntent {
  kind: "textContent";
  target: EditIntentTarget;
  value: string;
}

export type EditIntent = StyleEditIntent | ClassEditIntent | TextEditIntent;

export interface EditIntentResolution {
  status: "resolved" | "conflict" | "unsupported";
  node?: CodeLayerNode;
  message?: string;
}

export interface EditIntentResolver {
  resolve(
    intent: EditIntent,
    projection: CodeLayerProjection,
  ): EditIntentResolution | Promise<EditIntentResolution>;
}

export type PatchResultStatus =
  | "applied"
  | "needsAgent"
  | "conflict"
  | "unsupported";

export interface PatchNodeSummary {
  nodeId: string;
  selector: string;
  tag: string;
  classes: string[];
  style: Partial<Record<VisualStyleProperty | string, string>>;
  textSnippet: string | null;
}

export interface PatchResult {
  status: PatchResultStatus;
  source: CodeLayerSource;
  intent: EditIntent;
  target?: {
    nodeId: string;
    selector: string;
    tag: string;
  };
  capability?: EditCapability;
  before?: PatchNodeSummary;
  after?: PatchNodeSummary;
  changed: boolean;
  message?: string;
}

export interface ApplyVisualEditResult {
  content: string;
  projection: CodeLayerProjection;
  result: PatchResult;
}

interface ParsedAttribute {
  name: string;
  lowerName: string;
  value: string | true;
  start: number;
  end: number;
}

interface ParsedElement {
  index: number;
  tag: string;
  start: number;
  openEnd: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  closeStart?: number;
  closeEnd?: number;
  selfClosing: boolean;
  attributes: ParsedAttribute[];
  parentIndex?: number;
  childIndexes: number[];
  siblingIndex: number;
  nthOfType: number;
}

interface ProjectionBuild {
  projection: CodeLayerProjection;
  elementByNodeId: Map<string, ParsedElement>;
}

const STYLE_PROPERTIES = [
  "width",
  "height",
  "color",
  "background",
  "background-color",
  "padding",
  "gap",
  "display",
] as const satisfies readonly VisualStyleProperty[];

const STYLE_PROPERTY_SET = new Set<string>(STYLE_PROPERTIES);

const STYLE_PROPERTY_ALIASES: Record<string, VisualStyleProperty> = {
  backgroundColor: "background-color",
  bg: "background",
};

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const NON_VISUAL_TAGS = new Set([
  "script",
  "style",
  "meta",
  "link",
  "title",
  "template",
  "noscript",
]);

const DATA_SELECTOR_PRIORITY = [
  "data-code-layer-id",
  "data-layer-id",
  "data-testid",
  "data-test-id",
  "data-component",
  "data-name",
  "data-screen",
];

function hashStable(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function cssIdent(value: string): string | null {
  if (/^-?[A-Za-z_][A-Za-z0-9_-]*$/.test(value)) return value;
  return null;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

function getAttribute(
  element: ParsedElement,
  name: string,
): ParsedAttribute | undefined {
  const lowerName = name.toLowerCase();
  return element.attributes.find((attr) => attr.lowerName === lowerName);
}

function attributeValue(element: ParsedElement, name: string): string | null {
  const value = getAttribute(element, name)?.value;
  if (typeof value === "string") return value;
  if (value === true) return "";
  return null;
}

function attributeRecord(
  element: ParsedElement,
): Record<string, string | true> {
  const record: Record<string, string | true> = {};
  for (const attr of element.attributes) {
    record[attr.lowerName] = attr.value;
  }
  return record;
}

function dataAttributeRecord(element: ParsedElement): Record<string, string> {
  const record: Record<string, string> = {};
  for (const attr of element.attributes) {
    if (attr.lowerName.startsWith("data-") && typeof attr.value === "string") {
      record[attr.lowerName] = attr.value;
    }
  }
  return record;
}

function classList(element: ParsedElement): string[] {
  return collapseWhitespace(attributeValue(element, "class") ?? "")
    .split(" ")
    .filter(Boolean);
}

function parseStyle(value: string | null): Record<string, string> {
  const style: Record<string, string> = {};
  if (!value) return style;
  for (const part of value.split(";")) {
    const index = part.indexOf(":");
    if (index === -1) continue;
    const property = part.slice(0, index).trim().toLowerCase();
    const propertyValue = part.slice(index + 1).trim();
    if (property && propertyValue) style[property] = propertyValue;
  }
  return style;
}

function parseStyleDeclarations(value: string | null): Array<{
  property: string;
  value: string;
}> {
  if (!value) return [];
  return value
    .split(";")
    .map((part) => {
      const index = part.indexOf(":");
      if (index === -1) return null;
      const property = part.slice(0, index).trim().toLowerCase();
      const propertyValue = part.slice(index + 1).trim();
      if (!property || !propertyValue) return null;
      return { property, value: propertyValue };
    })
    .filter((part): part is { property: string; value: string } =>
      Boolean(part),
    );
}

function serializeStyleDeclarations(
  declarations: Array<{ property: string; value: string }>,
): string {
  return declarations
    .map((item) => `${item.property}: ${item.value}`)
    .join("; ");
}

function normalizeStyleProperty(property: string): VisualStyleProperty | null {
  const normalized =
    STYLE_PROPERTY_ALIASES[property] ??
    property
      .replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)
      .toLowerCase();
  if (!STYLE_PROPERTY_SET.has(normalized)) return null;
  return normalized as VisualStyleProperty;
}

function isSafeStyleValue(
  property: VisualStyleProperty,
  value: string,
): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/[<>{};]/.test(trimmed)) return false;
  if (/expression\s*\(/i.test(trimmed)) return false;
  if (/javascript\s*:/i.test(trimmed)) return false;
  if (/url\s*\(/i.test(trimmed)) return false;
  if (property === "display") {
    return [
      "block",
      "inline",
      "inline-block",
      "flex",
      "inline-flex",
      "grid",
      "inline-grid",
      "none",
      "contents",
    ].includes(trimmed);
  }
  return true;
}

function isSafeClassToken(value: string): boolean {
  return value.length > 0 && !/[\s"'<>`=]/.test(value);
}

function classTokensFromIntent(intent: ClassEditIntent): string[] {
  if (intent.classNames) return intent.classNames;
  if (intent.className) return [intent.className];
  return [];
}

function parseAttributes(rawTag: string, tagStart: number): ParsedAttribute[] {
  const nameMatch = rawTag.match(/^<\s*\/?\s*([A-Za-z][A-Za-z0-9:-]*)/);
  if (!nameMatch?.[0]) return [];
  const attrTextStart = nameMatch[0].length;
  const attrTextEnd = rawTag.endsWith(">") ? rawTag.length - 1 : rawTag.length;
  const attrText = rawTag.slice(attrTextStart, attrTextEnd);
  const attrOffset = tagStart + attrTextStart;
  const attrs: ParsedAttribute[] = [];
  const attrRe =
    /([:@A-Za-z_][A-Za-z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(attrText))) {
    const name = match[1];
    if (!name || name === "/") continue;
    const value = match[2] ?? match[3] ?? match[4] ?? true;
    attrs.push({
      name,
      lowerName: name.toLowerCase(),
      value,
      start: attrOffset + match.index,
      end: attrOffset + match.index + match[0].length,
    });
  }
  return attrs;
}

function parseHtmlElements(html: string): ParsedElement[] {
  const elements: ParsedElement[] = [];
  const stack: number[] = [];
  const sameTypeCounts = new Map<string, number>();
  const tagRe =
    /<!--[\s\S]*?-->|<![A-Za-z][^>]*>|<\/?\s*([A-Za-z][A-Za-z0-9:-]*)(?:\s[^<>]*?)?>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(html))) {
    const raw = match[0];
    const tag = match[1]?.toLowerCase();
    if (!tag || raw.startsWith("<!--") || raw.startsWith("<!")) continue;

    if (raw.startsWith("</")) {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        const element = elements[stack[i]];
        if (!element) continue;
        stack.pop();
        element.closeStart = match.index;
        element.closeEnd = match.index + raw.length;
        element.contentEnd = match.index;
        element.end = match.index + raw.length;
        if (element.tag === tag) break;
      }
      continue;
    }

    const parentIndex = stack.length > 0 ? stack[stack.length - 1] : undefined;
    const parentKey = `${parentIndex ?? "root"}:${tag}`;
    const nthOfType = (sameTypeCounts.get(parentKey) ?? 0) + 1;
    sameTypeCounts.set(parentKey, nthOfType);
    const selfClosing = raw.endsWith("/>") || VOID_TAGS.has(tag);
    const index = elements.length;
    const element: ParsedElement = {
      index,
      tag,
      start: match.index,
      openEnd: match.index + raw.length,
      end: selfClosing ? match.index + raw.length : html.length,
      contentStart: match.index + raw.length,
      contentEnd: selfClosing ? match.index + raw.length : html.length,
      selfClosing,
      attributes: parseAttributes(raw, match.index),
      parentIndex,
      childIndexes: [],
      siblingIndex:
        parentIndex === undefined
          ? elements.filter((item) => item.parentIndex === undefined).length
          : (elements[parentIndex]?.childIndexes.length ?? 0),
      nthOfType,
    };
    elements.push(element);
    if (parentIndex !== undefined) {
      elements[parentIndex]?.childIndexes.push(index);
    }
    if (!selfClosing) stack.push(index);
  }

  return elements;
}

function candidateDataSelector(
  element: ParsedElement,
): { selector: string; confidence: number } | null {
  const data = dataAttributeRecord(element);
  for (const name of DATA_SELECTOR_PRIORITY) {
    const value = data[name];
    if (value) {
      return {
        selector: `[${name}="${cssEscape(value)}"]`,
        confidence: name === "data-code-layer-id" ? 0.95 : 0.86,
      };
    }
  }
  const [firstName, firstValue] = Object.entries(data)[0] ?? [];
  if (firstName && firstValue) {
    return {
      selector: `[${firstName}="${cssEscape(firstValue)}"]`,
      confidence: 0.78,
    };
  }
  return null;
}

function selectorPart(element: ParsedElement): string {
  const id = attributeValue(element, "id");
  const escapedId = id ? cssIdent(id) : null;
  if (escapedId) return `#${escapedId}`;

  const dataSelector = candidateDataSelector(element);
  if (dataSelector) return `${element.tag}${dataSelector.selector}`;

  const safeClasses = classList(element)
    .map(cssIdent)
    .filter((value): value is string => Boolean(value))
    .slice(0, 2);
  const classes = safeClasses.map((value) => `.${value}`).join("");
  const nth = element.nthOfType > 1 ? `:nth-of-type(${element.nthOfType})` : "";
  return `${element.tag}${classes}${nth}`;
}

function pathSelector(
  element: ParsedElement,
  elements: ParsedElement[],
): string {
  const parts: string[] = [];
  let current: ParsedElement | undefined = element;
  while (current) {
    parts.unshift(selectorPart(current));
    current =
      current.parentIndex === undefined
        ? undefined
        : elements[current.parentIndex];
  }
  return parts.slice(-5).join(" > ");
}

function primarySelector(
  element: ParsedElement,
  elements: ParsedElement[],
): { selector: string; confidence: number } {
  const id = attributeValue(element, "id");
  const escapedId = id ? cssIdent(id) : null;
  if (escapedId) return { selector: `#${escapedId}`, confidence: 0.96 };

  const dataSelector = candidateDataSelector(element);
  if (dataSelector) return dataSelector;

  const safeClasses = classList(element)
    .map(cssIdent)
    .filter((value): value is string => Boolean(value))
    .slice(0, 3);
  if (safeClasses.length > 0) {
    return {
      selector: `${element.tag}${safeClasses.map((item) => `.${item}`).join("")}`,
      confidence: 0.72,
    };
  }

  return { selector: pathSelector(element, elements), confidence: 0.58 };
}

function nodeIdFor(
  element: ParsedElement,
  elements: ParsedElement[],
  source: CodeLayerSource,
): string {
  const sourceKey =
    source.fileId ??
    source.filename ??
    source.path ??
    source.url ??
    source.kind;
  const id = attributeValue(element, "id");
  if (id) return `html:${hashStable(`${sourceKey}:id:${id}`)}`;
  const codeLayerId =
    attributeValue(element, "data-code-layer-id") ??
    attributeValue(element, "data-layer-id");
  if (codeLayerId) {
    return `html:${hashStable(`${sourceKey}:data:${codeLayerId}`)}`;
  }
  const path = pathSelector(element, elements);
  return `html:${hashStable(`${sourceKey}:${path}:${element.start}`)}`;
}

function styleTokensFor(element: ParsedElement): StyleToken[] {
  const tokens: StyleToken[] = [];
  for (const declaration of parseStyleDeclarations(
    attributeValue(element, "style"),
  )) {
    const property = normalizeStyleProperty(declaration.property);
    if (!property) continue;
    tokens.push({
      property,
      value: declaration.value,
      token: `${declaration.property}: ${declaration.value}`,
      source: "inline-style",
      confidence: 0.95,
    });
  }

  for (const token of classList(element)) {
    const classStyle = classStyleToken(token);
    if (classStyle) tokens.push(classStyle);
  }

  return tokens;
}

function classStyleToken(token: string): StyleToken | null {
  const normalized = token.replace(/^[a-z]+:/, "");
  if (/^w-/.test(normalized)) {
    return {
      property: "width",
      value: token,
      token,
      source: "class",
      confidence: 0.64,
    };
  }
  if (/^h-/.test(normalized)) {
    return {
      property: "height",
      value: token,
      token,
      source: "class",
      confidence: 0.64,
    };
  }
  if (/^bg-/.test(normalized)) {
    return {
      property: "background",
      value: token,
      token,
      source: "class",
      confidence: 0.6,
    };
  }
  if (/^(p|px|py|pt|pr|pb|pl)-/.test(normalized)) {
    return {
      property: "padding",
      value: token,
      token,
      source: "class",
      confidence: 0.62,
    };
  }
  if (/^gap-/.test(normalized)) {
    return {
      property: "gap",
      value: token,
      token,
      source: "class",
      confidence: 0.62,
    };
  }
  if (
    [
      "block",
      "inline",
      "inline-block",
      "flex",
      "inline-flex",
      "grid",
      "inline-grid",
      "hidden",
    ].includes(normalized)
  ) {
    return {
      property: "display",
      value: normalized === "hidden" ? "none" : normalized,
      token,
      source: "class",
      confidence: 0.68,
    };
  }
  if (/^text-/.test(normalized)) {
    return {
      property: "color",
      value: token,
      token,
      source: "class",
      confidence: 0.45,
    };
  }
  return null;
}

function layoutFor(
  element: ParsedElement,
  parent: ParsedElement | undefined,
): Omit<LayoutContext, "parentId" | "parentSelector"> {
  const style = parseStyle(attributeValue(element, "style"));
  const parentStyle = parent
    ? parseStyle(attributeValue(parent, "style"))
    : undefined;
  const classes = new Set(classList(element));
  const parentClasses = parent ? new Set(classList(parent)) : undefined;
  const display =
    style.display ??
    (classes.has("flex")
      ? "flex"
      : classes.has("grid")
        ? "grid"
        : classes.has("hidden")
          ? "none"
          : classes.has("block")
            ? "block"
            : classes.has("inline-block")
              ? "inline-block"
              : undefined);
  const parentDisplay =
    parentStyle?.display ??
    (parentClasses?.has("flex")
      ? "flex"
      : parentClasses?.has("grid")
        ? "grid"
        : parentClasses?.has("hidden")
          ? "none"
          : undefined);
  const flexDirection =
    style["flex-direction"] ??
    (classes.has("flex-col")
      ? "column"
      : classes.has("flex-row")
        ? "row"
        : undefined);
  const parentFlexDirection =
    parentStyle?.["flex-direction"] ??
    (parentClasses?.has("flex-col")
      ? "column"
      : parentClasses?.has("flex-row")
        ? "row"
        : undefined);

  return {
    siblingIndex: element.siblingIndex,
    nthOfType: element.nthOfType,
    display,
    position: style.position,
    width: style.width,
    height: style.height,
    flexDirection,
    gap: style.gap,
    padding: style.padding,
    parentDisplay,
    parentFlexDirection,
    parentGap: parentStyle?.gap,
    isFlexContainer: display === "flex" || display === "inline-flex",
    isGridContainer: display === "grid" || display === "inline-grid",
  };
}

function textSnippetFor(html: string, element: ParsedElement): string | null {
  if (element.selfClosing) return null;
  const inner = html.slice(element.contentStart, element.contentEnd);
  const text = collapseWhitespace(decodeBasicHtmlEntities(stripTags(inner)));
  if (!text) return null;
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function capabilitiesFor(element: ParsedElement): EditCapability[] {
  const capabilities: EditCapability[] = [
    {
      kind: "style",
      properties: [...STYLE_PROPERTIES],
      confidence: 0.9,
    },
    {
      kind: "class",
      operations: ["add", "remove", "replace", "set"],
      confidence: 0.88,
    },
  ];

  if (!element.selfClosing) {
    capabilities.push({
      kind: "text",
      operations: ["setTextContent"],
      confidence: element.childIndexes.length === 0 ? 0.82 : 0.35,
      reason:
        element.childIndexes.length === 0
          ? undefined
          : "Text edits on mixed-content elements should be escalated.",
    });
  }

  return capabilities;
}

function buildProjection(
  html: string,
  source: CodeLayerSource,
): ProjectionBuild {
  const elements = parseHtmlElements(html);
  const nodeIdByElementIndex = new Map<number, string>();
  const nodes: CodeLayerNode[] = [];
  const diagnostics: ProjectionDiagnostic[] = [];

  for (const element of elements) {
    if (NON_VISUAL_TAGS.has(element.tag)) continue;
    const nodeId = nodeIdFor(element, elements, source);
    nodeIdByElementIndex.set(element.index, nodeId);
  }

  const elementByNodeId = new Map<string, ParsedElement>();

  for (const element of elements) {
    const nodeId = nodeIdByElementIndex.get(element.index);
    if (!nodeId) continue;

    const parent =
      element.parentIndex === undefined
        ? undefined
        : elements[element.parentIndex];
    const parentId =
      element.parentIndex === undefined
        ? undefined
        : nodeIdByElementIndex.get(element.parentIndex);
    const selector = primarySelector(element, elements);
    const path = pathSelector(element, elements);
    const classes = classList(element);
    const style = parseStyle(attributeValue(element, "style"));
    const dataAttributes = dataAttributeRecord(element);
    const selectors = Array.from(
      new Set([
        selector.selector,
        path,
        ...Object.entries(dataAttributes).map(
          ([name, value]) => `[${name}="${cssEscape(value)}"]`,
        ),
      ]),
    );

    nodes.push({
      id: nodeId,
      tag: element.tag,
      selector: selector.selector,
      selectors,
      path,
      attributes: attributeRecord(element),
      dataAttributes,
      classes,
      textSnippet: textSnippetFor(html, element),
      style,
      styleTokens: styleTokensFor(element),
      parentId,
      children: element.childIndexes
        .map((index) => nodeIdByElementIndex.get(index))
        .filter((id): id is string => Boolean(id)),
      layout: {
        parentId,
        parentSelector: parent
          ? primarySelector(parent, elements).selector
          : undefined,
        ...layoutFor(element, parent),
      },
      capabilities: capabilitiesFor(element),
      confidence: selector.confidence,
      source: {
        start: element.start,
        end: element.end,
        openStart: element.start,
        openEnd: element.openEnd,
        contentStart: element.selfClosing ? undefined : element.contentStart,
        contentEnd: element.selfClosing ? undefined : element.contentEnd,
        closeStart: element.closeStart,
        closeEnd: element.closeEnd,
      },
    });
    elementByNodeId.set(nodeId, element);
  }

  if (nodes.length === 0 && html.trim()) {
    diagnostics.push({
      severity: "warning",
      code: "no-projectable-elements",
      message: "No visual HTML elements were found in this source.",
    });
  }

  return {
    projection: {
      version: 1,
      projectionId: `clp_${hashStable(`${source.kind}:${source.fileId ?? ""}:${source.filename ?? ""}:${html}`)}`,
      source,
      rootNodeIds: nodes
        .filter((node) => !node.parentId)
        .map((node) => node.id),
      nodes,
      diagnostics,
    },
    elementByNodeId,
  };
}

export function buildCodeLayerProjection(
  html: string,
  options: { source?: CodeLayerSource } = {},
): CodeLayerProjection {
  return buildProjection(html, options.source ?? { kind: "inline-html" })
    .projection;
}

function selectorMatches(node: CodeLayerNode, selector: string): boolean {
  if (node.selector === selector || node.selectors.includes(selector))
    return true;
  if (selector.startsWith("#")) {
    return node.attributes.id === selector.slice(1);
  }
  if (selector.startsWith(".")) {
    const required = selector
      .split(".")
      .map((item) => item.trim())
      .filter(Boolean);
    return required.every((item) => node.classes.includes(item));
  }
  const dataMatch = selector.match(
    /^\[([A-Za-z_][A-Za-z0-9_:.-]*)=(?:"([^"]*)"|'([^']*)')\]$/,
  );
  if (dataMatch?.[1]) {
    const expected = dataMatch[2] ?? dataMatch[3] ?? "";
    return node.dataAttributes[dataMatch[1].toLowerCase()] === expected;
  }
  const tagClassMatch = selector.match(
    /^([A-Za-z][A-Za-z0-9:-]*)(\.[A-Za-z0-9_-]+)+$/,
  );
  if (tagClassMatch?.[1]) {
    const tag = tagClassMatch[1].toLowerCase();
    const required = selector.slice(tag.length).split(".").filter(Boolean);
    return (
      node.tag === tag && required.every((item) => node.classes.includes(item))
    );
  }
  return node.tag === selector.toLowerCase();
}

function resolveTarget(
  projection: CodeLayerProjection,
  target: EditIntentTarget,
): EditIntentResolution {
  if (target.nodeId) {
    const node = projection.nodes.find(
      (candidate) => candidate.id === target.nodeId,
    );
    if (node) return { status: "resolved", node };
    return {
      status: "conflict",
      message: `No code layer node exists for nodeId "${target.nodeId}".`,
    };
  }

  if (!target.selector) {
    return {
      status: "conflict",
      message:
        "Edit intent must include either target.nodeId or target.selector.",
    };
  }

  const matches = projection.nodes.filter((node) =>
    selectorMatches(node, target.selector ?? ""),
  );
  if (matches.length === 1 && matches[0]) {
    return { status: "resolved", node: matches[0] };
  }
  if (matches.length > 1) {
    return {
      status: "conflict",
      message: `Selector "${target.selector}" matched ${matches.length} code layer nodes.`,
    };
  }
  return {
    status: "conflict",
    message: `Selector "${target.selector}" did not match a code layer node.`,
  };
}

function summarizeNode(node: CodeLayerNode): PatchNodeSummary {
  return {
    nodeId: node.id,
    selector: node.selector,
    tag: node.tag,
    classes: [...node.classes],
    style: { ...node.style },
    textSnippet: node.textSnippet,
  };
}

function patchResult(
  status: PatchResultStatus,
  source: CodeLayerSource,
  intent: EditIntent,
  changed: boolean,
  message: string,
  node?: CodeLayerNode,
  capability?: EditCapability,
  before?: PatchNodeSummary,
  after?: PatchNodeSummary,
): PatchResult {
  return {
    status,
    source,
    intent,
    target: node
      ? { nodeId: node.id, selector: node.selector, tag: node.tag }
      : undefined,
    capability,
    before,
    after,
    changed,
    message,
  };
}

function replaceOrInsertAttribute(
  html: string,
  element: ParsedElement,
  name: string,
  value: string,
): string {
  const escaped = escapeHtmlAttribute(value);
  const existing = getAttribute(element, name);
  if (existing) {
    return `${html.slice(0, existing.start)}${existing.name}="${escaped}"${html.slice(existing.end)}`;
  }

  const rawOpen = html.slice(element.start, element.openEnd);
  const closeIndex = element.openEnd - 1;
  const slashIndex = rawOpen.trimEnd().endsWith("/>")
    ? html.lastIndexOf("/", closeIndex)
    : -1;
  const insertAt = slashIndex > element.start ? slashIndex : closeIndex;
  return `${html.slice(0, insertAt)} ${name}="${escaped}"${html.slice(insertAt)}`;
}

function setStyleValue(
  currentStyle: string | null,
  property: VisualStyleProperty,
  value: string,
): string {
  const declarations = parseStyleDeclarations(currentStyle);
  const existing = declarations.find((item) => item.property === property);
  if (existing) {
    existing.value = value;
  } else {
    declarations.push({ property, value });
  }
  return serializeStyleDeclarations(declarations);
}

function applyStyleEdit(
  html: string,
  element: ParsedElement,
  intent: StyleEditIntent,
): { content: string; capability: EditCapability } | PatchResultStatus {
  const property = normalizeStyleProperty(intent.property);
  if (!property || !isSafeStyleValue(property, intent.value))
    return "unsupported";
  const nextStyle = setStyleValue(
    attributeValue(element, "style"),
    property,
    intent.value.trim(),
  );
  return {
    content: replaceOrInsertAttribute(html, element, "style", nextStyle),
    capability: {
      kind: "style",
      properties: [property],
      confidence: 0.9,
    },
  };
}

function applyClassEdit(
  html: string,
  element: ParsedElement,
  intent: ClassEditIntent,
): { content: string; capability: EditCapability } | PatchResultStatus {
  const classes = classList(element);
  let nextClasses = [...classes];

  if (intent.operation === "add") {
    const additions = classTokensFromIntent(intent);
    if (
      additions.length === 0 ||
      additions.some((token) => !isSafeClassToken(token))
    ) {
      return "unsupported";
    }
    nextClasses = Array.from(new Set([...classes, ...additions]));
  } else if (intent.operation === "remove") {
    const removals = classTokensFromIntent(intent);
    if (
      removals.length === 0 ||
      removals.some((token) => !isSafeClassToken(token))
    ) {
      return "unsupported";
    }
    nextClasses = classes.filter((token) => !removals.includes(token));
  } else if (intent.operation === "replace") {
    if (
      !intent.from ||
      !intent.to ||
      !isSafeClassToken(intent.from) ||
      !isSafeClassToken(intent.to)
    ) {
      return "unsupported";
    }
    if (!classes.includes(intent.from)) return "conflict";
    nextClasses = classes.map((token) =>
      token === intent.from ? (intent.to ?? token) : token,
    );
  } else {
    const replacement = classTokensFromIntent(intent);
    if (
      replacement.length === 0 ||
      replacement.some((token) => !isSafeClassToken(token))
    ) {
      return "unsupported";
    }
    nextClasses = replacement;
  }

  return {
    content: replaceOrInsertAttribute(
      html,
      element,
      "class",
      nextClasses.join(" "),
    ),
    capability: {
      kind: "class",
      operations: [intent.operation],
      confidence: 0.88,
    },
  };
}

function applyTextEdit(
  html: string,
  element: ParsedElement,
  intent: TextEditIntent,
): { content: string; capability: EditCapability } | PatchResultStatus {
  if (element.selfClosing || element.contentStart > element.contentEnd) {
    return "unsupported";
  }
  if (element.childIndexes.length > 0) return "needsAgent";
  return {
    content: `${html.slice(0, element.contentStart)}${escapeHtmlText(intent.value)}${html.slice(element.contentEnd)}`,
    capability: {
      kind: "text",
      operations: ["setTextContent"],
      confidence: 0.82,
    },
  };
}

function findAfterNode(
  projection: CodeLayerProjection,
  before: CodeLayerNode,
): CodeLayerNode | undefined {
  return (
    projection.nodes.find((node) => node.id === before.id) ??
    projection.nodes.find(
      (node) =>
        node.tag === before.tag &&
        node.source?.openStart === before.source?.openStart,
    )
  );
}

export function applyVisualEdit(
  html: string,
  intent: EditIntent,
  options: { source?: CodeLayerSource } = {},
): ApplyVisualEditResult {
  const source = options.source ?? { kind: "inline-html" };
  if (source.kind !== "inline-html" && source.kind !== "design-file") {
    const projection = buildCodeLayerProjection(html, { source });
    return {
      content: html,
      projection,
      result: patchResult(
        "unsupported",
        source,
        intent,
        false,
        `Source kind "${source.kind}" is not supported by the deterministic HTML editor yet.`,
      ),
    };
  }

  const initial = buildProjection(html, source);
  const resolution = resolveTarget(initial.projection, intent.target);
  if (resolution.status !== "resolved" || !resolution.node) {
    return {
      content: html,
      projection: initial.projection,
      result: patchResult(
        "conflict",
        source,
        intent,
        false,
        resolution.message ?? "Could not resolve the edit target.",
      ),
    };
  }

  const beforeNode = resolution.node;
  const before = summarizeNode(beforeNode);
  const element = initial.elementByNodeId.get(beforeNode.id);
  if (!element || !beforeNode.source) {
    return {
      content: html,
      projection: initial.projection,
      result: patchResult(
        "needsAgent",
        source,
        intent,
        false,
        "The target node does not have editable source spans.",
        beforeNode,
        undefined,
        before,
      ),
    };
  }

  const edit =
    intent.kind === "style"
      ? applyStyleEdit(html, element, intent)
      : intent.kind === "class"
        ? applyClassEdit(html, element, intent)
        : applyTextEdit(html, element, intent);

  if (typeof edit === "string") {
    const status = edit;
    return {
      content: html,
      projection: initial.projection,
      result: patchResult(
        status,
        source,
        intent,
        false,
        status === "conflict"
          ? "The requested edit conflicts with the current source."
          : status === "needsAgent"
            ? "The requested edit needs agent-level source rewriting."
            : "The requested edit is not supported by the deterministic editor.",
        beforeNode,
        undefined,
        before,
      ),
    };
  }

  const nextProjection = buildCodeLayerProjection(edit.content, { source });
  const afterNode = findAfterNode(nextProjection, beforeNode);
  const after = afterNode ? summarizeNode(afterNode) : undefined;

  return {
    content: edit.content,
    projection: nextProjection,
    result: patchResult(
      "applied",
      source,
      intent,
      edit.content !== html,
      edit.content === html
        ? "No source change was needed."
        : "Visual edit applied.",
      beforeNode,
      edit.capability,
      before,
      after,
    ),
  };
}
