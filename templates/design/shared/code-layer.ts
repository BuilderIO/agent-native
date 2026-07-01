import {
  isComponentInstance,
  instanceFromNode,
  type ComponentInstance,
} from "./component-model";
import type { TailwindBreakpointPrefix } from "./design-state.js";
import {
  parseClassGroups,
  parseClassToken,
  setPropertyClass,
  removePropertyClass,
} from "./responsive-classes.js";
import type { DesignSourceType } from "./source-mode";

export type CodeLayerSourceKind =
  | "design-file"
  | "inline-html"
  | "local-file"
  | "remote-url";

export interface CodeLayerSource {
  kind: CodeLayerSourceKind;
  sourceType?: DesignSourceType;
  designId?: string;
  fileId?: string;
  filename?: string;
  path?: string;
  url?: string;
  connectionId?: string;
  routeId?: string;
  artboardId?: string;
  bridgeUrl?: string;
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
  | "min-width"
  | "max-width"
  | "min-height"
  | "max-height"
  | "left"
  | "top"
  | "right"
  | "bottom"
  | "inset"
  | "position"
  | "display"
  | "color"
  | "background"
  | "background-color"
  | "background-image"
  | "background-blend-mode"
  | "fill"
  | "fill-opacity"
  | "opacity"
  | "mix-blend-mode"
  | "font-size"
  | "font-weight"
  | "font-family"
  | "font-style"
  | "letter-spacing"
  | "line-height"
  | "text-align"
  | "text-decoration"
  | "text-transform"
  | "white-space"
  | "overflow"
  | "overflow-x"
  | "overflow-y"
  | "text-overflow"
  | "border"
  | "border-width"
  | "border-style"
  | "border-color"
  | "border-radius"
  | "border-top-left-radius"
  | "border-top-right-radius"
  | "border-bottom-left-radius"
  | "border-bottom-right-radius"
  | "stroke"
  | "stroke-width"
  | "stroke-opacity"
  | "stroke-dasharray"
  | "stroke-linecap"
  | "stroke-linejoin"
  | "outline"
  | "outline-width"
  | "outline-style"
  | "outline-color"
  | "outline-offset"
  | "box-shadow"
  | "text-shadow"
  | "filter"
  | "backdrop-filter"
  | "transform"
  | "transform-origin"
  | "rotate"
  | "scale"
  | "translate"
  | "padding"
  | "padding-top"
  | "padding-right"
  | "padding-bottom"
  | "padding-left"
  | "margin"
  | "margin-top"
  | "margin-right"
  | "margin-bottom"
  | "margin-left"
  | "gap"
  | "row-gap"
  | "column-gap"
  | "flex"
  | "flex-direction"
  | "flex-wrap"
  | "flex-grow"
  | "flex-shrink"
  | "flex-basis"
  | "order"
  | "align-self"
  | "align-items"
  | "align-content"
  | "justify-content"
  | "justify-items"
  | "justify-self"
  | "grid-column"
  | "grid-row"
  | "grid-template-columns"
  | "grid-template-rows"
  | "grid-auto-flow"
  | "grid-auto-columns"
  | "grid-auto-rows"
  | "box-sizing"
  | "aspect-ratio"
  | "z-index";

export interface StyleToken {
  property: VisualStyleProperty;
  /**
   * The resolved value at the *base* breakpoint (unprefixed), or the inline
   * style value.  For class-sourced tokens this is the utility string of the
   * base class (e.g. `"text-sm"`).  Use `breakpointValues` to inspect how the
   * value differs across responsive prefixes.
   */
  value: string;
  token: string;
  source: "inline-style" | "class";
  confidence: number;
  /**
   * For class-sourced tokens only: the resolved utility string per responsive
   * prefix.  Only prefixes that have an explicit class token are included.
   *
   * @example
   * // className="text-sm md:text-base lg:text-lg"
   * // styleToken for "color" property would have:
   * // breakpointValues = { base: "text-sm", md: "text-base", lg: "text-lg" }
   */
  breakpointValues?: Partial<Record<TailwindBreakpointPrefix, string>>;
  /**
   * For class-sourced tokens only: the prefixes (other than `"base"`) at which
   * this property has a responsive override in the class list.  Populated when
   * `breakpointValues` has keys other than `"base"`.
   */
  overriddenAtPrefixes?: TailwindBreakpointPrefix[];
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
  alignItems?: string;
  justifyContent?: string;
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
      /**
       * Responsive-class editing — adds, replaces, or removes a Tailwind
       * utility at a specific breakpoint prefix without touching other
       * breakpoints.  Uses the helpers in `responsive-classes.ts`
       * (setPropertyClass / removePropertyClass) and the same deterministic
       * HTML-patch path as `class` edits.
       *
       * The `prefix` field indicates the active breakpoint scope for which
       * this capability was computed (derived from the canvas frame width via
       * `widthToPrefix`).  Callers may target any prefix — `prefix` is
       * informational, not a constraint.
       */
      kind: "responsive-class";
      /** Active breakpoint scope (informational). */
      prefix: TailwindBreakpointPrefix;
      operations: Array<"add" | "remove" | "replace">;
      /** Properties that currently have per-breakpoint overrides (non-empty means overrides exist). */
      overriddenProperties: string[];
      confidence: number;
      reason?: string;
    }
  | {
      kind: "text";
      operations: Array<"setTextContent">;
      confidence: number;
      reason?: string;
    }
  | {
      kind: "structure";
      operations: Array<"moveNode">;
      confidence: number;
      reason?: string;
    };

export interface CodeLayerNode {
  id: string;
  tag: string;
  layerName: string;
  layerNameSource: "attribute" | "semantic" | "text" | "selector" | "tag";
  layerNameAttribute?: string;
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
  /**
   * Present when the node is the root of a component instance — i.e. it
   * carries a `data-agent-native-component` attribute (Alpine-annotated or
   * build-time-instrumented).  The canvas uses this to draw the component
   * outline and the inspector uses it to surface component-level controls.
   *
   * `undefined` when the node is not a component root.
   */
  componentInstance?: ComponentInstance;
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

export type CodeLayerTreeNodeType =
  | "frame"
  | "group"
  | "component"
  | "shape"
  | "ellipse"
  | "vector"
  | "line"
  | "arrow"
  | "polygon"
  | "star"
  | "text"
  | "image"
  | "element";

export interface CodeLayerTreeNode {
  id: string;
  name: string;
  type: CodeLayerTreeNodeType;
  tag: string;
  selector: string;
  detail: string;
  layout?: Pick<
    LayoutContext,
    | "display"
    | "flexDirection"
    | "alignItems"
    | "justifyContent"
    | "isFlexContainer"
    | "isGridContainer"
  >;
  badge?: string;
  renamable: boolean;
  children: CodeLayerTreeNode[];
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
  html?: string;
}

export interface MoveNodeEditIntent {
  kind: "moveNode";
  target: EditIntentTarget;
  anchor: EditIntentTarget;
  placement: "before" | "after" | "inside";
}

/**
 * GROUP: wrap sibling nodes sharing a parent inside a new <div> wrapper.
 * The wrapper is inserted at the position of the first target; targets are
 * reparented into it in source order. The new wrapper gets a fresh
 * data-agent-native-node-id and data-agent-native-layer-name="Group".
 *
 * When autoLayout is true the wrapper also receives
 * `display:flex; flex-direction:column; gap:8px` and
 * position/left/top/right/bottom are stripped from each wrapped child.
 *
 * Returns "unsupported" if the targets don't share a common parent.
 */
export interface WrapNodesEditIntent {
  kind: "wrapNodes";
  targetIds: string[];
  autoLayout?: boolean;
}

/**
 * UNGROUP: replace the wrapper node with its children, spliced into the
 * wrapper's parent at the wrapper's position, then remove the wrapper.
 */
export interface UnwrapEditIntent {
  kind: "unwrap";
  targetId: string;
}

/**
 * CONVERT an existing container to/from auto-layout.
 * When enabled, sets display:flex (+ flex-direction, gap) on the target and
 * strips position:absolute/left/top/right/bottom from its DIRECT children.
 * When !enabled, sets display:block (turns auto-layout off).
 */
export interface AutoLayoutEditIntent {
  kind: "autoLayout";
  targetId: string;
  enabled: boolean;
  direction?: "row" | "column";
  gap?: string;
}

/**
 * Responsive-class edit intent — adds, replaces, or removes a single Tailwind
 * utility at the given `prefix` (breakpoint scope) without touching classes at
 * other breakpoints.
 *
 * Examples:
 * - Add `text-base` at `md:` on a node that already has `text-sm` base:
 *   `{ kind: "responsive-class", target, prefix: "md", operation: "add", utility: "text-base" }`
 *
 * - Replace whatever `text-*` class currently lives at `lg:` with `text-xl`:
 *   `{ kind: "responsive-class", target, prefix: "lg", operation: "replace", utility: "text-xl" }`
 *
 * - Remove the `md:` override for the `text` stem, falling back to the base:
 *   `{ kind: "responsive-class", target, prefix: "md", operation: "remove", stem: "text" }`
 *
 * `utility` should be the bare utility without its prefix (e.g. `"text-lg"`,
 * not `"md:text-lg"`).  The prefix is applied automatically.
 * `stem` is required only for `"remove"` operations.
 */
export interface ResponsiveClassEditIntent {
  kind: "responsive-class";
  target: EditIntentTarget;
  /** Target breakpoint prefix.  Use `"base"` to edit the unprefixed class. */
  prefix: TailwindBreakpointPrefix;
  operation: "add" | "remove" | "replace";
  /** The bare utility to add or replace (without prefix).  Required for add/replace. */
  utility?: string;
  /**
   * The CSS-property stem to remove (e.g. `"text"`, `"bg"`, `"p"`).
   * Required for `"remove"` operations; ignored for add/replace (the stem is
   * derived from `utility` instead).
   */
  stem?: string;
}

export type EditIntent =
  | StyleEditIntent
  | ClassEditIntent
  | TextEditIntent
  | MoveNodeEditIntent
  | WrapNodesEditIntent
  | UnwrapEditIntent
  | AutoLayoutEditIntent
  | ResponsiveClassEditIntent;

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
  /** For wrapNodes: the data-agent-native-node-id of the newly created wrapper. */
  wrapperNodeId?: string;
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
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "left",
  "top",
  "right",
  "bottom",
  "inset",
  "position",
  "display",
  "color",
  "background",
  "background-color",
  "background-image",
  "background-blend-mode",
  "fill",
  "fill-opacity",
  "opacity",
  "mix-blend-mode",
  "font-size",
  "font-weight",
  "font-family",
  "font-style",
  "letter-spacing",
  "line-height",
  "text-align",
  "text-decoration",
  "text-transform",
  "white-space",
  "overflow",
  "overflow-x",
  "overflow-y",
  "text-overflow",
  "border",
  "border-width",
  "border-style",
  "border-color",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "outline",
  "outline-width",
  "outline-style",
  "outline-color",
  "outline-offset",
  "box-shadow",
  "text-shadow",
  "filter",
  "backdrop-filter",
  "transform",
  "transform-origin",
  "rotate",
  "scale",
  "translate",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "gap",
  "row-gap",
  "column-gap",
  "flex",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "order",
  "align-self",
  "align-items",
  "align-content",
  "justify-content",
  "justify-items",
  "justify-self",
  "grid-column",
  "grid-row",
  "grid-template-columns",
  "grid-template-rows",
  "grid-auto-flow",
  "grid-auto-columns",
  "grid-auto-rows",
  "box-sizing",
  "aspect-ratio",
  "z-index",
] as const satisfies readonly VisualStyleProperty[];

const STYLE_PROPERTY_SET = new Set<string>(STYLE_PROPERTIES);

const STYLE_PROPERTY_ALIASES: Record<string, VisualStyleProperty> = {
  backgroundColor: "background-color",
  bg: "background",
  cornerRadius: "border-radius",
  dropShadow: "box-shadow",
  radius: "border-radius",
  rotation: "rotate",
  shadow: "box-shadow",
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
  "head",
  "script",
  "style",
  "meta",
  "link",
  "title",
  "template",
  "noscript",
]);

const RAW_TEXT_VISUAL_TAGS = new Set(["textarea"]);

// HTML5 elements that are implicitly closed when a sibling of the same (or
// related) type opens, because their closing tags are optional per the spec.
const IMPLICIT_CLOSE_TAGS: Map<string, Set<string>> = new Map([
  ["li", new Set(["li"])],
  ["p", new Set(["p"])],
  ["td", new Set(["td", "th"])],
  ["th", new Set(["td", "th"])],
  ["tr", new Set(["tr"])],
  ["dt", new Set(["dt", "dd"])],
  ["dd", new Set(["dt", "dd"])],
  ["option", new Set(["option"])],
  ["optgroup", new Set(["optgroup"])],
]);

const DATA_SELECTOR_PRIORITY = [
  "data-agent-native-node-id",
  "data-code-layer-id",
  "data-layer-id",
  "data-builder-id",
  "data-loc",
  "data-testid",
  "data-test-id",
  "data-component",
  "data-name",
  "data-screen",
];

const STABLE_NODE_ID_ATTRIBUTES = [
  "data-agent-native-node-id",
  "data-code-layer-id",
  "data-layer-id",
  "data-builder-id",
  "data-loc",
] as const;

const LAYER_NAME_ATTRIBUTE_PRIORITY = [
  "data-agent-native-layer-name",
  "data-layer-name",
] as const;

const SEMANTIC_LABEL_ATTRIBUTE_PRIORITY = [
  "aria-label",
  "title",
  "data-code-layer-id",
  "data-layer-id",
  "data-name",
  "data-component",
  "data-screen",
  "data-testid",
  "data-test-id",
] as const;

const TEXT_LAYER_TAGS = new Set([
  "a",
  "button",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "label",
  "li",
  "p",
  "span",
  "strong",
]);

const IMAGE_LAYER_TAGS = new Set(["canvas", "figure", "img", "picture"]);
const SHAPE_LAYER_TAGS = new Set([
  "circle",
  "line",
  "path",
  "polygon",
  "rect",
  "svg",
]);
const COMPONENT_LAYER_TAGS = new Set(["button", "input", "select", "textarea"]);

function hashStable(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function stableAttributeValueForNode(node: CodeLayerNode): string {
  const basis = [
    node.id,
    node.tag,
    node.path,
    node.source?.openStart ?? 0,
    node.source?.openEnd ?? 0,
  ].join(":");
  return `an-${hashStable(basis)}`;
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

function unquoteHtmlAttributeValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
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

function truncateLayerName(value: string): string {
  const normalized = collapseWhitespace(decodeBasicHtmlEntities(value));
  if (normalized.length <= 72) return normalized;
  return `${normalized.slice(0, 69)}...`;
}

function prettifyIdentifier(value: string): string {
  return collapseWhitespace(
    value
      .replace(/[_-]+/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase()),
  );
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

function explicitLayerNameFor(element: ParsedElement): {
  name: string;
  source: CodeLayerNode["layerNameSource"];
  attribute?: string;
} | null {
  for (const attribute of LAYER_NAME_ATTRIBUTE_PRIORITY) {
    const value = attributeValue(element, attribute);
    if (value) {
      const name = truncateLayerName(value);
      if (name) return { name, source: "attribute", attribute };
    }
  }
  return null;
}

function semanticLayerNameFor(element: ParsedElement): {
  name: string;
  source: CodeLayerNode["layerNameSource"];
  attribute?: string;
} | null {
  for (const attribute of SEMANTIC_LABEL_ATTRIBUTE_PRIORITY) {
    const value = attributeValue(element, attribute);
    if (value) {
      const name =
        attribute === "aria-label" || attribute === "title"
          ? truncateLayerName(value)
          : prettifyIdentifier(value);
      if (name) return { name, source: "semantic", attribute };
    }
  }

  const id = attributeValue(element, "id");
  if (id) {
    return {
      name: prettifyIdentifier(id),
      source: "selector",
      attribute: "id",
    };
  }

  const meaningfulClass = classList(element).find(
    (token) =>
      !/^(flex|grid|block|inline|hidden|relative|absolute|fixed|sticky)$/.test(
        token,
      ) &&
      !/^(sm|md|lg|xl|2xl):/.test(token) &&
      !/^(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|w|h|min|max|text|bg|border|rounded|shadow|gap)-/.test(
        token,
      ),
  );
  if (meaningfulClass) {
    return { name: prettifyIdentifier(meaningfulClass), source: "selector" };
  }

  return null;
}

function fallbackTagLayerName(tag: string): string {
  switch (tag) {
    case "article":
      return "Article";
    case "aside":
      return "Aside";
    case "body":
      return "Body";
    case "button":
      return "Button";
    case "div":
      return "Frame";
    case "footer":
      return "Footer";
    case "form":
      return "Form";
    case "header":
      return "Header";
    case "img":
    case "picture":
      return "Image";
    case "main":
      return "Main";
    case "nav":
      return "Navigation";
    case "section":
      return "Section";
    case "svg":
      return "Vector";
    case "ul":
    case "ol":
      return "List";
    case "li":
      return "List item";
    default:
      if (TEXT_LAYER_TAGS.has(tag)) return "Text";
      return tag.toUpperCase();
  }
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

function findHtmlTagEnd(html: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return index + 1;
  }
  return html.length;
}

function findClosingTag(
  html: string,
  tag: string,
  from: number,
): { closeStart: number; closeEnd: number } | null {
  const closeRe = new RegExp(`<\\/\\s*${tag}\\s*>`, "gi");
  closeRe.lastIndex = from;
  const match = closeRe.exec(html);
  if (!match) return null;
  return {
    closeStart: match.index,
    closeEnd: match.index + match[0].length,
  };
}

function parseHtmlElements(html: string): ParsedElement[] {
  const elements: ParsedElement[] = [];
  const stack: number[] = [];
  const sameTypeCounts = new Map<string, number>();
  const tagRe =
    /<!--[\s\S]*?-->|<![A-Za-z][^>]*>|<\/?\s*([A-Za-z][A-Za-z0-9:-]*)\b/g;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(html))) {
    const raw =
      match[0].startsWith("<!--") || match[0].startsWith("<!")
        ? match[0]
        : html.slice(match.index, findHtmlTagEnd(html, match.index));
    tagRe.lastIndex = match.index + raw.length;
    const tag = match[1]?.toLowerCase();
    if (!tag || raw.startsWith("<!--") || raw.startsWith("<!")) continue;

    if (raw.startsWith("</")) {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        const element = elements[stack[i]];
        if (!element) continue;
        stack.pop();
        if (element.tag === tag) {
          element.closeStart = match.index;
          element.closeEnd = match.index + raw.length;
          element.contentEnd = match.index;
          element.end = match.index + raw.length;
          break;
        } else {
          // Implicitly close optional-close-tag elements (e.g. <li>, <p>)
          // without attributing the parent's close tag to them.
          element.contentEnd = match.index;
          element.end = match.index;
        }
      }
      continue;
    }

    // Auto-close HTML5 optional-close-tag elements when a sibling of the same
    // type (or a related type) opens. This mirrors how browsers handle elements
    // like <li>, <p>, <td>, <th>, <tr>, <dt>, <dd>, <option>, <optgroup>.
    const stackTopTag =
      stack.length > 0 ? elements[stack[stack.length - 1]]?.tag : undefined;
    if (stackTopTag && IMPLICIT_CLOSE_TAGS.get(tag)?.has(stackTopTag)) {
      const popped = stack.pop()!;
      const poppedElement = elements[popped];
      if (poppedElement) {
        poppedElement.contentEnd = match.index;
        poppedElement.end = match.index;
      }
    }

    const parentIndex = stack.length > 0 ? stack[stack.length - 1] : undefined;
    const parentKey = `${parentIndex ?? "root"}:${tag}`;
    const nthOfType = (sameTypeCounts.get(parentKey) ?? 0) + 1;
    sameTypeCounts.set(parentKey, nthOfType);
    const selfClosing = raw.endsWith("/>") || VOID_TAGS.has(tag);

    if (NON_VISUAL_TAGS.has(tag)) {
      if (!selfClosing) {
        const close = findClosingTag(html, tag, match.index + raw.length);
        tagRe.lastIndex = close ? close.closeEnd : html.length;
      }
      continue;
    }

    const index = elements.length;
    const rawTextClose =
      !selfClosing && RAW_TEXT_VISUAL_TAGS.has(tag)
        ? findClosingTag(html, tag, match.index + raw.length)
        : null;
    const element: ParsedElement = {
      index,
      tag,
      start: match.index,
      openEnd: match.index + raw.length,
      end: rawTextClose
        ? rawTextClose.closeEnd
        : selfClosing
          ? match.index + raw.length
          : html.length,
      contentStart: match.index + raw.length,
      contentEnd: rawTextClose
        ? rawTextClose.closeStart
        : selfClosing
          ? match.index + raw.length
          : html.length,
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
    if (rawTextClose) {
      element.closeStart = rawTextClose.closeStart;
      element.closeEnd = rawTextClose.closeEnd;
      tagRe.lastIndex = rawTextClose.closeEnd;
      continue;
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
  const dataSelector = candidateDataSelector(element);
  if (dataSelector) return `${element.tag}${dataSelector.selector}`;

  const id = attributeValue(element, "id");
  const escapedId = id ? cssIdent(id) : null;
  if (escapedId) return `#${escapedId}`;

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
  return parts.join(" > ");
}

function primarySelector(
  element: ParsedElement,
  elements: ParsedElement[],
): { selector: string; confidence: number } {
  const dataSelector = candidateDataSelector(element);
  if (dataSelector) return dataSelector;

  const id = attributeValue(element, "id");
  const escapedId = id ? cssIdent(id) : null;
  if (escapedId) return { selector: `#${escapedId}`, confidence: 0.96 };

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
  const codeLayerId = stableSourceIdForElement(element);
  if (codeLayerId) {
    return `html:${hashStable(`${sourceKey}:data:${codeLayerId}`)}`;
  }
  const id = attributeValue(element, "id");
  if (id) return `html:${hashStable(`${sourceKey}:id:${id}`)}`;
  const path = pathSelector(element, elements);
  return `html:${hashStable(`${sourceKey}:${path}:${element.start}`)}`;
}

function stableSourceIdForElement(element: ParsedElement): string | null {
  for (const attribute of STABLE_NODE_ID_ATTRIBUTES) {
    const value = attributeValue(element, attribute);
    if (value) return value;
  }
  return null;
}

function styleTokensFor(element: ParsedElement): StyleToken[] {
  const tokens: StyleToken[] = [];

  // --- Inline styles (no breakpoint concept) ---
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

  // --- Class tokens — responsive-aware ---
  // Group all class tokens by breakpoint prefix so we can build per-property
  // breakpointValues maps and detect overrides.
  const classValue = attributeValue(element, "class") ?? "";
  const groups = parseClassGroups(classValue);

  // For each property, collect the utility value at every prefix that has one.
  // We key by property so we emit one token per property, not one per class.
  const propertyMap = new Map<
    VisualStyleProperty,
    {
      property: VisualStyleProperty;
      confidence: number;
      breakpointValues: Partial<Record<TailwindBreakpointPrefix, string>>;
      /** The raw token for the base occurrence (for backward-compat `token` field). */
      baseToken: string;
    }
  >();

  const allPrefixes: ReadonlyArray<TailwindBreakpointPrefix> = [
    "base",
    "sm",
    "md",
    "lg",
    "xl",
    "2xl",
  ];

  for (const prefix of allPrefixes) {
    for (const rawToken of groups[prefix]) {
      const parsed = parseClassToken(rawToken);
      const mapped = utilityToStyleProperty(parsed.utility);
      if (!mapped) continue;
      const { property, confidence } = mapped;

      // Resolve the display value the same way classStyleToken does.
      const resolvedValue =
        property === "display"
          ? parsed.utility === "hidden"
            ? "none"
            : parsed.utility
          : parsed.utility; // utility without prefix, e.g. "text-sm"

      const existing = propertyMap.get(property);
      if (existing) {
        existing.breakpointValues[prefix] = resolvedValue;
        if (existing.confidence < confidence) existing.confidence = confidence;
      } else {
        propertyMap.set(property, {
          property,
          confidence,
          breakpointValues: { [prefix]: resolvedValue },
          baseToken: rawToken,
        });
      }
    }
  }

  for (const entry of propertyMap.values()) {
    const baseValue = entry.breakpointValues["base"] ?? "";
    // The full original token for the base occurrence (for backward compat).
    const rawBaseToken = entry.baseToken;
    const overriddenAt = Object.keys(entry.breakpointValues).filter(
      (p) => p !== "base",
    ) as TailwindBreakpointPrefix[];

    tokens.push({
      property: entry.property,
      // `value` = the base utility string (backward-compatible).
      value: baseValue || rawBaseToken,
      token: rawBaseToken,
      source: "class",
      confidence: entry.confidence,
      breakpointValues: { ...entry.breakpointValues },
      overriddenAtPrefixes: overriddenAt.length > 0 ? overriddenAt : undefined,
    });
  }

  return tokens;
}

/**
 * Map a bare Tailwind utility (without any responsive prefix, e.g. `"text-sm"`
 * not `"md:text-sm"`) to the `VisualStyleProperty` it most likely controls.
 * Returns `null` when the utility is not recognised.
 *
 * This is called by both the legacy `classStyleToken` path and the new
 * responsive-aware `styleTokensFor` implementation.
 */
function utilityToStyleProperty(
  utility: string,
): { property: VisualStyleProperty; confidence: number } | null {
  if (/^w-/.test(utility)) return { property: "width", confidence: 0.64 };
  if (/^h-/.test(utility)) return { property: "height", confidence: 0.64 };
  if (/^bg-/.test(utility)) return { property: "background", confidence: 0.6 };
  if (/^(p|px|py|pt|pr|pb|pl)-/.test(utility))
    return { property: "padding", confidence: 0.62 };
  if (/^gap-/.test(utility)) return { property: "gap", confidence: 0.62 };
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
    ].includes(utility)
  ) {
    return { property: "display", confidence: 0.68 };
  }
  if (/^text-/.test(utility)) return { property: "color", confidence: 0.45 };
  return null;
}

function classStyleToken(token: string): StyleToken | null {
  const { utility } = parseClassToken(token);
  const mapped = utilityToStyleProperty(utility);
  if (!mapped) return null;
  const { property, confidence } = mapped;
  // The legacy value field preserves the original full token (including prefix)
  // for backward compatibility.  The responsive path uses `breakpointValues`.
  const value =
    property === "display" ? (utility === "hidden" ? "none" : utility) : token;
  return { property, value, token, source: "class", confidence };
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
      : classes.has("inline-flex")
        ? "inline-flex"
        : classes.has("grid")
          ? "grid"
          : classes.has("inline-grid")
            ? "inline-grid"
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
      : parentClasses?.has("inline-flex")
        ? "inline-flex"
        : parentClasses?.has("grid")
          ? "grid"
          : parentClasses?.has("inline-grid")
            ? "inline-grid"
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
  const alignItems =
    style["align-items"] ??
    (classes.has("items-start")
      ? "flex-start"
      : classes.has("items-center")
        ? "center"
        : classes.has("items-end")
          ? "flex-end"
          : classes.has("items-stretch")
            ? "stretch"
            : classes.has("items-baseline")
              ? "baseline"
              : undefined);
  const justifyContent =
    style["justify-content"] ??
    (classes.has("justify-start")
      ? "flex-start"
      : classes.has("justify-center")
        ? "center"
        : classes.has("justify-end")
          ? "flex-end"
          : classes.has("justify-between")
            ? "space-between"
            : classes.has("justify-around")
              ? "space-around"
              : classes.has("justify-evenly")
                ? "space-evenly"
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
    alignItems,
    justifyContent,
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

function layerNameFor(
  html: string,
  element: ParsedElement,
): {
  name: string;
  source: CodeLayerNode["layerNameSource"];
  attribute?: string;
} {
  const explicit = explicitLayerNameFor(element);
  if (explicit) return explicit;

  const semantic = semanticLayerNameFor(element);
  if (semantic) return semantic;

  if (TEXT_LAYER_TAGS.has(element.tag)) {
    const text = textSnippetFor(html, element);
    if (text) return { name: truncateLayerName(text), source: "text" };
  }

  return { name: fallbackTagLayerName(element.tag), source: "tag" };
}

function treeTypeForNode(node: CodeLayerNode): CodeLayerTreeNodeType {
  // Canvas primitives (drawn shapes / board objects) carry their kind via
  // data-an-primitive so the layers panel shows a true shape/text/frame icon
  // instead of the generic code glyph. The marker wins over tag heuristics:
  // these primitives are <div>s, which would otherwise classify as "element".
  const primitiveKind = node.dataAttributes["data-an-primitive"];
  if (primitiveKind) {
    if (primitiveKind === "text") return "text";
    if (primitiveKind === "frame") return "frame";
    if (primitiveKind === "image") return "image";
    if (
      primitiveKind === "ellipse" ||
      primitiveKind === "circle" ||
      primitiveKind === "oval"
    ) {
      return "ellipse";
    }
    // SVG-based vector primitives each get their own type so the layers panel
    // renders a true pen/line/arrow/polygon/star icon instead of falling
    // through to the rectangle ("shape") glyph.
    if (primitiveKind === "path") return "vector";
    if (primitiveKind === "line") return "line";
    if (primitiveKind === "arrow") return "arrow";
    if (primitiveKind === "polygon") return "polygon";
    if (primitiveKind === "star") return "star";
    // rectangle/rect and anything else still classify as a generic shape.
    return "shape";
  }
  if (TEXT_LAYER_TAGS.has(node.tag)) return "text";
  if (IMAGE_LAYER_TAGS.has(node.tag)) return "image";
  if (SHAPE_LAYER_TAGS.has(node.tag)) return "shape";
  // A node annotated as a component instance is always classified as "component"
  // regardless of its tag — this is the canonical detection path.
  if (node.componentInstance) return "component";
  if (
    COMPONENT_LAYER_TAGS.has(node.tag) ||
    node.classes.some((item) => /component|card|button|control/.test(item))
  ) {
    return "component";
  }
  if (node.layout.isFlexContainer || node.layout.isGridContainer) {
    return "frame";
  }
  if (node.children.length > 0) return "group";
  return "element";
}

function isCollapsibleDocumentShellNode(
  node: CodeLayerTreeNode,
  nodesById: Map<string, CodeLayerNode>,
): boolean {
  if (node.tag !== "html" && node.tag !== "body") return false;
  return nodesById.get(node.id)?.layerNameSource === "tag";
}

function compactCodeLayerTreeNodes(
  nodes: CodeLayerTreeNode[],
  nodesById: Map<string, CodeLayerNode>,
  ancestors: Set<string> = new Set(),
): CodeLayerTreeNode[] {
  const compacted: CodeLayerTreeNode[] = [];
  const siblingIds = new Set<string>();

  for (const node of nodes) {
    if (ancestors.has(node.id)) continue;

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(node.id);
    const children = compactCodeLayerTreeNodes(
      node.children,
      nodesById,
      nextAncestors,
    );
    const compactedNode: CodeLayerTreeNode = { ...node, children };
    const promotedNodes = isCollapsibleDocumentShellNode(
      compactedNode,
      nodesById,
    )
      ? children
      : [compactedNode];

    for (const promotedNode of promotedNodes) {
      if (siblingIds.has(promotedNode.id)) continue;
      siblingIds.add(promotedNode.id);
      compacted.push(promotedNode);
    }
  }

  return compacted;
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

  // Responsive-class capability — detect which properties already carry
  // breakpoint overrides so the inspector can surface override indicators.
  const classValue = attributeValue(element, "class") ?? "";
  const groups = parseClassGroups(classValue);
  const overriddenProps: string[] = [];
  const responsivePrefixes: ReadonlyArray<TailwindBreakpointPrefix> = [
    "sm",
    "md",
    "lg",
    "xl",
    "2xl",
  ];
  for (const prefix of responsivePrefixes) {
    for (const rawToken of groups[prefix]) {
      const { utility } = parseClassToken(rawToken);
      // Derive a property stem to use as the override indicator label.
      const stemPart = utility.split("-")[0];
      if (stemPart && !overriddenProps.includes(stemPart)) {
        overriddenProps.push(stemPart);
      }
    }
  }
  // The prefix here is "base" as the default; callers that know the active
  // frame width should use widthToPrefix() from responsive-classes.ts to
  // determine the appropriate editing prefix.
  capabilities.push({
    kind: "responsive-class",
    prefix: "base",
    operations: ["add", "remove", "replace"],
    overriddenProperties: overriddenProps,
    confidence: 0.87,
  });

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

// Internal nodes of an <svg> (the <path>/<polygon>/<circle>/... geometry) are
// rendering primitives, never selectable design layers. Projecting them adds a
// meaningless expandable child to every pen vector / line / arrow / polygon /
// star (and to any inline SVG icon). Treat the <svg> as a leaf: skip everything
// that has an <svg> ancestor.
function hasSvgAncestor(
  element: ParsedElement,
  elements: ParsedElement[],
): boolean {
  let parentIndex = element.parentIndex;
  while (parentIndex !== undefined) {
    const parent = elements[parentIndex];
    if (!parent) break;
    if (parent.tag === "svg") return true;
    parentIndex = parent.parentIndex;
  }
  return false;
}

function buildProjection(
  html: string,
  source: CodeLayerSource,
): ProjectionBuild {
  // Tolerate non-string input from any caller (e.g. content not yet loaded):
  // an empty projection is correct; crashing the editor is not.
  if (typeof html !== "string") html = "";
  const elements = parseHtmlElements(html);
  const nodeIdByElementIndex = new Map<number, string>();
  const nodes: CodeLayerNode[] = [];
  const diagnostics: ProjectionDiagnostic[] = [];

  for (const element of elements) {
    if (NON_VISUAL_TAGS.has(element.tag)) continue;
    if (hasSvgAncestor(element, elements)) continue;
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
    const layerName = layerNameFor(html, element);
    const selectors = Array.from(
      new Set([
        selector.selector,
        path,
        ...Object.entries(dataAttributes).map(
          ([name, value]) => `[${name}="${cssEscape(value)}"]`,
        ),
      ]),
    );

    const node: CodeLayerNode = {
      id: nodeId,
      tag: element.tag,
      layerName: layerName.name,
      layerNameSource: layerName.source,
      layerNameAttribute: layerName.attribute,
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
    };

    // Detect component instances — nodes that carry data-agent-native-component.
    // Populate the metadata so the canvas can outline component roots and the
    // inspector can surface component-level controls.
    if (isComponentInstance(node)) {
      const instance = instanceFromNode(node);
      if (instance) node.componentInstance = instance;
    }

    nodes.push(node);
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
  // Defensive: callers (memos/effects) may project before content has loaded
  // (e.g. `activeContent` is briefly undefined on first render). Projecting a
  // non-string must yield an empty projection, never crash the editor.
  const safeHtml = typeof html === "string" ? html : "";
  return buildProjection(safeHtml, options.source ?? { kind: "inline-html" })
    .projection;
}

export function ensureCodeLayerNodeIdsInHtml(
  html: string,
  options: { source?: CodeLayerSource } = {},
): { content: string; changed: boolean; stamped: number } {
  const projection = buildCodeLayerProjection(html, options);
  const usedIds = new Set<string>();
  const edits: Array<{ start: number; end: number; value: string }> = [];

  const uniqueValueFor = (base: string) => {
    let value = base;
    let suffix = 1;
    while (usedIds.has(value)) {
      value = `an-${hashStable(`${base}:${suffix}`)}`;
      suffix += 1;
    }
    usedIds.add(value);
    return value;
  };

  for (const node of projection.nodes) {
    if (
      !node.source ||
      node.source.openEnd <= node.source.openStart ||
      !node.source
    ) {
      continue;
    }
    const source = node.source;
    const existing = node.dataAttributes["data-agent-native-node-id"]?.trim();
    const openTag = html.slice(source.openStart, source.openEnd);
    const stableIdMatches = Array.from(
      openTag.matchAll(
        /\sdata-agent-native-node-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s/>]+)/gi,
      ),
    );
    const hasSingleCleanStableId =
      existing && stableIdMatches.length === 1 && !usedIds.has(existing);
    if (hasSingleCleanStableId) {
      usedIds.add(existing);
      continue;
    }

    const nextValue = uniqueValueFor(
      existing
        ? `an-${hashStable(
            `${existing}:${node.id}:${source.openStart}:${source.openEnd}`,
          )}`
        : stableAttributeValueForNode(node),
    );
    if (stableIdMatches.length > 0) {
      const [firstMatch, ...duplicateMatches] = stableIdMatches;
      if (!firstMatch || firstMatch.index === undefined) continue;
      edits.push({
        start: source.openStart + firstMatch.index,
        end: source.openStart + firstMatch.index + firstMatch[0].length,
        value: ` data-agent-native-node-id="${escapeHtmlAttribute(nextValue)}"`,
      });
      for (const duplicate of duplicateMatches) {
        if (duplicate.index === undefined) continue;
        edits.push({
          start: source.openStart + duplicate.index,
          end: source.openStart + duplicate.index + duplicate[0].length,
          value: "",
        });
      }
      continue;
    }

    const insertAt = source.openEnd - (openTag.endsWith("/>") ? 2 : 1);
    if (insertAt <= 0 || insertAt > html.length) continue;
    edits.push({
      start: insertAt,
      end: insertAt,
      value: ` data-agent-native-node-id="${escapeHtmlAttribute(nextValue)}"`,
    });
  }

  const orderedEdits = edits.sort((a, b) => b.start - a.start);

  if (orderedEdits.length === 0) {
    return { content: html, changed: false, stamped: 0 };
  }

  let content = html;
  for (const edit of orderedEdits) {
    content = `${content.slice(0, edit.start)}${edit.value}${content.slice(edit.end)}`;
  }
  return { content, changed: true, stamped: orderedEdits.length };
}

export function removeCodeLayerNodeFromHtml(
  html: string,
  node: CodeLayerNode,
): string | null {
  if (!node.source) return null;
  if (node.tag === "html" || node.tag === "body") return null;
  const start = node.source.start;
  const end = node.source.end;
  if (start < 0 || end <= start || end > html.length) return null;
  return `${html.slice(0, start)}${html.slice(end)}`;
}

export function buildCodeLayerTree(
  projection: CodeLayerProjection,
): CodeLayerTreeNode[] {
  const nodesById = new Map(projection.nodes.map((node) => [node.id, node]));
  const treeById = new Map<string, CodeLayerTreeNode>();

  for (const node of projection.nodes) {
    const componentName = node.componentInstance?.name;
    treeById.set(node.id, {
      id: node.id,
      name: componentName ?? node.layerName,
      type: treeTypeForNode(node),
      tag: node.tag,
      selector: node.selector,
      detail: `<${node.tag}>`,
      layout: {
        display: node.layout.display,
        flexDirection: node.layout.flexDirection,
        alignItems: node.layout.alignItems,
        justifyContent: node.layout.justifyContent,
        isFlexContainer: node.layout.isFlexContainer,
        isGridContainer: node.layout.isGridContainer,
      },
      badge:
        node.layerNameSource === "attribute" && node.layerNameAttribute
          ? node.layerNameAttribute
          : undefined,
      // Safe rename persistence belongs in the caller's edit action. The
      // preferred write target is data-agent-native-layer-name; projection is
      // intentionally read-only and never mutates source by itself.
      renamable: node.source != null,
      children: [],
    });
  }

  const childIdsByParentId = new Map<string, Set<string>>();
  for (const node of projection.nodes) {
    const parent =
      node.parentId && nodesById.has(node.parentId)
        ? treeById.get(node.parentId)
        : undefined;
    const treeNode = treeById.get(node.id);
    if (!parent || !treeNode || parent.id === treeNode.id) continue;
    const childIds = childIdsByParentId.get(parent.id) ?? new Set<string>();
    if (childIds.has(treeNode.id)) continue;
    childIds.add(treeNode.id);
    childIdsByParentId.set(parent.id, childIds);
    parent.children.push(treeNode);
  }

  const roots: CodeLayerTreeNode[] = [];
  const rootIds = new Set<string>();
  const appendRoot = (id: string) => {
    if (rootIds.has(id)) return;
    const treeNode = treeById.get(id);
    if (!treeNode) return;
    rootIds.add(id);
    roots.push(treeNode);
  };

  projection.rootNodeIds.forEach(appendRoot);
  for (const node of projection.nodes) {
    if (!node.parentId) appendRoot(node.id);
  }
  return compactCodeLayerTreeNodes(roots, nodesById);
}

function normalizeSelectorForMatch(selector: string): string {
  return selector
    .trim()
    .replace(/\s*>\s*/g, " > ")
    .replace(/\s+/g, " ");
}

function selectorPartTag(selectorPart: string): string | null {
  const match = selectorPart.trim().match(/^([A-Za-z][A-Za-z0-9:-]*)/);
  return match?.[1]?.toLowerCase() ?? null;
}

function isDocumentRootSelectorPart(selectorPart: string): boolean {
  const tag = selectorPartTag(selectorPart);
  return tag === "html" || tag === "body";
}

// Removes positional `:nth-of-type(n)` suffixes from a selector. Runtime
// bridge selectors fall back to `:nth-of-type` for elements without a durable
// id, and that position is computed against the live (possibly Alpine-mutated)
// DOM. When the stored source order differs, the positional index no longer
// lines up. Dropping the suffix lets resolution fall back to the element's
// stable signal (tag, classes, attributes, ancestor path).
function stripPositionalNthOfType(selector: string): string {
  return selector.replace(/:nth-of-type\(\d+\)/g, "");
}

function lastSelectorPart(selector: string): string {
  const parts = normalizeSelectorForMatch(selector).split(" > ");
  return parts[parts.length - 1] ?? selector;
}

function simpleSelectorMatches(node: CodeLayerNode, selector: string): boolean {
  if (!selector) return false;
  if (selector.startsWith("#")) {
    return node.attributes.id === selector.slice(1);
  }
  const tagIdMatch = selector.match(/^([A-Za-z][A-Za-z0-9:-]*)#(.+)$/);
  if (tagIdMatch?.[1]) {
    return (
      node.tag === tagIdMatch[1].toLowerCase() &&
      node.attributes.id === tagIdMatch[2]
    );
  }
  if (selector.startsWith(".")) {
    const required = selector
      .split(".")
      .map((item) => item.trim())
      .filter(Boolean);
    return required.every((item) => node.classes.includes(item));
  }
  const dataMatch = selector.match(
    /^(?:([A-Za-z][A-Za-z0-9:-]*)?)?\[([A-Za-z_][A-Za-z0-9_:.-]*)=(?:"([^"]*)"|'([^']*)')\]$/,
  );
  if (dataMatch?.[2]) {
    const tag = dataMatch[1]?.toLowerCase();
    const attribute = dataMatch[2].toLowerCase();
    const expected = dataMatch[3] ?? dataMatch[4] ?? "";
    const actual = attribute.startsWith("data-")
      ? node.dataAttributes[attribute]
      : node.attributes[attribute];
    return (!tag || node.tag === tag) && actual === expected;
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
  const nthMatch = selector.match(
    /^([A-Za-z][A-Za-z0-9:-]*)(?::nth-of-type\((\d+)\))$/,
  );
  if (nthMatch?.[1]) {
    return (
      node.tag === nthMatch[1].toLowerCase() &&
      lastSelectorPart(node.path).endsWith(`:nth-of-type(${nthMatch[2]})`)
    );
  }
  return node.tag === selector.toLowerCase();
}

function unescapeCssAttributeValue(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function simpleSelectorMatchesElement(
  element: ParsedElement,
  selector: string,
): boolean {
  let remaining = selector.trim();
  if (!remaining) return false;

  const nthMatch = remaining.match(/:nth-of-type\((\d+)\)$/);
  if (nthMatch?.[1]) {
    if (element.nthOfType !== Number(nthMatch[1])) return false;
    remaining = remaining.slice(0, nthMatch.index).trim();
  }

  const tagMatch = remaining.match(/^([A-Za-z][A-Za-z0-9:-]*)/);
  if (tagMatch?.[1] && element.tag !== tagMatch[1].toLowerCase()) {
    return false;
  }

  const idMatch = remaining.match(/#([A-Za-z_][A-Za-z0-9_-]*)/);
  if (idMatch?.[1] && attributeValue(element, "id") !== idMatch[1]) {
    return false;
  }

  const attributes = Array.from(
    remaining.matchAll(
      /\[([A-Za-z_][A-Za-z0-9_:.-]*)=(?:"((?:\\"|[^"])*)"|'((?:\\'|[^'])*)')\]/g,
    ),
  );
  for (const match of attributes) {
    const name = match[1];
    if (!name) return false;
    const expected = unescapeCssAttributeValue(match[2] ?? match[3] ?? "");
    if (attributeValue(element, name) !== expected) return false;
  }

  const classes = classList(element);
  const requiredClasses = Array.from(
    remaining.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g),
    (match) => match[1],
  ).filter((value): value is string => Boolean(value));
  if (requiredClasses.some((className) => !classes.includes(className))) {
    return false;
  }

  return Boolean(
    tagMatch ||
    idMatch ||
    attributes.length > 0 ||
    requiredClasses.length > 0 ||
    nthMatch,
  );
}

function selectorPathMatchesElement(
  element: ParsedElement | undefined,
  selector: string,
  elementByIndex: Map<number, ParsedElement>,
): boolean {
  const parts = normalizeSelectorForMatch(selector)
    .split(" > ")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return false;

  let current: ParsedElement | undefined = element;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const selectorPart = parts[index];
    if (!selectorPart) return false;
    if (!current) {
      if (isDocumentRootSelectorPart(selectorPart)) continue;
      return false;
    }
    if (!simpleSelectorMatchesElement(current, selectorPart)) return false;
    current =
      current.parentIndex === undefined
        ? undefined
        : elementByIndex.get(current.parentIndex);
  }
  return true;
}

function nodeMatchesStableSourceId(
  node: CodeLayerNode,
  sourceId: string,
): boolean {
  if (!sourceId) return false;
  if (node.id === sourceId) return true;
  for (const attribute of STABLE_NODE_ID_ATTRIBUTES) {
    if (node.dataAttributes[attribute] === sourceId) return true;
  }
  return node.attributes.id === sourceId;
}

function selectorMatches(
  node: CodeLayerNode,
  selector: string,
  element: ParsedElement | undefined,
  elementByIndex: Map<number, ParsedElement>,
): boolean {
  const normalizedSelector = normalizeSelectorForMatch(selector);
  const normalizedNodeSelectors = [
    node.selector,
    node.path,
    ...node.selectors,
  ].map(normalizeSelectorForMatch);
  if (normalizedNodeSelectors.includes(normalizedSelector)) return true;
  const selectorHasDirectPath = normalizedSelector.includes(" > ");
  if (
    selectorHasDirectPath &&
    normalizedNodeSelectors.some((candidate) =>
      candidate.endsWith(` > ${normalizedSelector}`),
    )
  ) {
    return true;
  }
  if (
    selectorHasDirectPath &&
    selectorPathMatchesElement(element, normalizedSelector, elementByIndex)
  ) {
    return true;
  }
  if (selectorHasDirectPath) return false;
  if (simpleSelectorMatches(node, normalizedSelector)) return true;
  const lastPart = lastSelectorPart(normalizedSelector);
  return (
    lastPart !== normalizedSelector && simpleSelectorMatches(node, lastPart)
  );
}

function resolveTarget(
  build: ProjectionBuild,
  target: EditIntentTarget,
): EditIntentResolution {
  const { projection, elementByNodeId } = build;
  const elementByIndex = new Map(
    Array.from(elementByNodeId.values()).map((element) => [
      element.index,
      element,
    ]),
  );
  if (target.nodeId) {
    const matches = projection.nodes.filter((candidate) =>
      nodeMatchesStableSourceId(candidate, target.nodeId ?? ""),
    );
    if (matches.length === 1 && matches[0]) {
      return { status: "resolved", node: matches[0] };
    }
    if (matches.length > 1) {
      return {
        status: "conflict",
        message: `Node id "${target.nodeId}" matched ${matches.length} code layer nodes.`,
      };
    }
    if (!target.selector) {
      return {
        status: "conflict",
        message: `No code layer node exists for nodeId "${target.nodeId}".`,
      };
    }
  }

  if (!target.selector) {
    return {
      status: "conflict",
      message:
        "Edit intent must include either target.nodeId or target.selector.",
    };
  }

  const selectorValue = target.selector ?? "";
  const matchesForSelector = (value: string): CodeLayerNode[] =>
    projection.nodes.filter((node) =>
      selectorMatches(
        node,
        value,
        elementByNodeId.get(node.id),
        elementByIndex,
      ),
    );

  const matches = matchesForSelector(selectorValue);
  if (matches.length === 1 && matches[0]) {
    return { status: "resolved", node: matches[0] };
  }
  if (matches.length > 1) {
    return {
      status: "conflict",
      message: `Selector "${selectorValue}" matched ${matches.length} code layer nodes.`,
    };
  }

  // Strict matching found nothing. Runtime selectors anchor unstamped elements
  // with positional `:nth-of-type(n)` parts, which drift when the live DOM
  // order differs from the stored source (reordered or runtime-inserted nodes).
  // Retry once with the positional suffixes dropped so an element that is still
  // unique by its tag/classes/attributes resolves instead of surfacing a hard
  // "did not match" error. Genuinely ambiguous results stay a conflict rather
  // than silently editing the wrong node.
  const positionTolerantSelector = stripPositionalNthOfType(selectorValue);
  if (positionTolerantSelector && positionTolerantSelector !== selectorValue) {
    const tolerantMatches = matchesForSelector(positionTolerantSelector);
    if (tolerantMatches.length === 1 && tolerantMatches[0]) {
      return { status: "resolved", node: tolerantMatches[0] };
    }
    if (tolerantMatches.length > 1) {
      return {
        status: "conflict",
        message: `Selector "${selectorValue}" matched ${tolerantMatches.length} code layer nodes after ignoring positional :nth-of-type (the element may have been reordered or added at runtime). Re-select the element to refresh its id.`,
      };
    }
  }

  return {
    status: "conflict",
    message: `Selector "${selectorValue}" did not match a code layer node.`,
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

function sanitizeTextEditHtml(html: string): string {
  return html
    .replace(
      /<\s*(script|style|iframe|object|embed|link|meta|base)\b[\s\S]*?<\s*\/\s*\1\s*>/gi,
      "",
    )
    .replace(
      /<\s*(script|style|iframe|object|embed|link|meta|base)\b[^>]*\/?\s*>/gi,
      "",
    )
    .replace(/\s+on[A-Za-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g, "")
    .replace(
      /\s+(href|src|xlink:href)\s*=\s*(?:(["'])\s*(?:javascript|vbscript|data):[\s\S]*?\2|(?:javascript|vbscript|data):[^\s>]*)/gi,
      "",
    );
}

function applyTextEdit(
  html: string,
  element: ParsedElement,
  intent: TextEditIntent,
): { content: string; capability: EditCapability } | PatchResultStatus {
  if (element.selfClosing || element.contentStart > element.contentEnd) {
    return "unsupported";
  }
  if (element.childIndexes.length > 0 && intent.html === undefined) {
    return "needsAgent";
  }
  const replacement =
    intent.html !== undefined
      ? sanitizeTextEditHtml(intent.html)
      : escapeHtmlText(intent.value);
  return {
    content: `${html.slice(0, element.contentStart)}${replacement}${html.slice(element.contentEnd)}`,
    capability: {
      kind: "text",
      operations: ["setTextContent"],
      confidence: 0.82,
    },
  };
}

/**
 * Apply a responsive-class edit intent to the HTML source.
 *
 * - `"add"`:     calls `setPropertyClass(className, prefix, utility)` — adds a
 *               new token at the target prefix (or replaces the existing one for
 *               the same stem).
 * - `"replace"`: same as `"add"` — `setPropertyClass` already handles the
 *               replace-if-same-stem semantics.
 * - `"remove"`:  calls `removePropertyClass(className, prefix, stem)` — strips
 *               all tokens with the given property stem at the target prefix,
 *               falling back to the base value (Tailwind cascade).
 *
 * Uses the helpers from `responsive-classes.ts` so the logic is shared with
 * the StatesPanel / inspector UI.
 */
function applyResponsiveClassEdit(
  html: string,
  element: ParsedElement,
  intent: ResponsiveClassEditIntent,
): { content: string; capability: EditCapability } | PatchResultStatus {
  const currentClass = attributeValue(element, "class") ?? "";

  let nextClass: string;
  if (intent.operation === "remove") {
    if (!intent.stem) {
      // stem is required for remove
      return "unsupported";
    }
    if (!isSafeClassToken(intent.stem)) return "unsupported";
    nextClass = removePropertyClass(currentClass, intent.prefix, intent.stem);
  } else {
    // "add" and "replace" both use setPropertyClass
    if (!intent.utility) return "unsupported";
    if (!isSafeClassToken(intent.utility)) return "unsupported";
    nextClass = setPropertyClass(currentClass, intent.prefix, intent.utility);
  }

  if (nextClass === currentClass) {
    // No-op — nothing to patch.
    return {
      content: html,
      capability: {
        kind: "responsive-class",
        prefix: intent.prefix,
        operations: [intent.operation],
        overriddenProperties: [],
        confidence: 0.87,
      },
    };
  }

  return {
    content: replaceOrInsertAttribute(html, element, "class", nextClass),
    capability: {
      kind: "responsive-class",
      prefix: intent.prefix,
      operations: [intent.operation],
      overriddenProperties: intent.utility
        ? [intent.utility.split("-")[0] ?? ""]
        : [],
      confidence: 0.87,
    },
  };
}

function applyMoveNodeEdit(
  html: string,
  element: ParsedElement,
  anchor: ParsedElement,
  intent: MoveNodeEditIntent,
): { content: string; capability: EditCapability } | PatchResultStatus {
  if (element.index === anchor.index) return "conflict";
  if (anchor.start >= element.start && anchor.end <= element.end) {
    return "conflict";
  }
  if (intent.placement === "inside" && anchor.selfClosing) {
    return "unsupported";
  }

  const fragment = html.slice(element.start, element.end);
  const withoutTarget = `${html.slice(0, element.start)}${html.slice(
    element.end,
  )}`;
  const removedLength = element.end - element.start;
  const rawInsertAt =
    intent.placement === "before"
      ? anchor.start
      : intent.placement === "after"
        ? anchor.end
        : anchor.contentEnd;
  const insertAt =
    element.start < rawInsertAt ? rawInsertAt - removedLength : rawInsertAt;

  if (insertAt < 0 || insertAt > withoutTarget.length) return "conflict";

  return {
    content: `${withoutTarget.slice(0, insertAt)}${fragment}${withoutTarget.slice(insertAt)}`,
    capability: {
      kind: "structure",
      operations: ["moveNode"],
      confidence: 0.78,
    },
  };
}

/** Generate a fresh unique data-agent-native-node-id value not already in the set. */
function freshNodeId(usedIds: Set<string>, basis: string): string {
  const base = `an-${hashStable(basis)}`;
  let value = base;
  let suffix = 1;
  while (usedIds.has(value)) {
    value = `an-${hashStable(`${base}:${suffix}`)}`;
    suffix += 1;
  }
  usedIds.add(value);
  return value;
}

/**
 * Strip the given CSS property names from an inline style attribute value.
 * Returns the new style string (may be empty if all declarations were removed).
 */
function stripStyleProperties(
  styleValue: string | null,
  propertiesToRemove: string[],
): string {
  if (!styleValue) return "";
  const toRemove = new Set(propertiesToRemove.map((p) => p.toLowerCase()));
  const remaining = parseStyleDeclarations(styleValue).filter(
    (decl) => !toRemove.has(decl.property),
  );
  return serializeStyleDeclarations(remaining);
}

/** Absolute-positioning properties stripped when converting a child to auto-layout flow. */
const AUTO_LAYOUT_STRIP_PROPS = [
  "position",
  "left",
  "top",
  "right",
  "bottom",
  "inset",
] as const;

/**
 * Apply display:flex + direction + gap to a raw open-tag string and return it.
 * Only touches the style attribute.
 */
function addAutoLayoutStyleToOpenTag(
  openTag: string,
  element: ParsedElement,
  html: string,
  direction: "row" | "column",
  gap: string,
): string {
  const currentStyle = attributeValue(element, "style");
  let declarations = parseStyleDeclarations(currentStyle);
  const setOrReplace = (prop: string, val: string) => {
    const existing = declarations.find((d) => d.property === prop);
    if (existing) {
      existing.value = val;
    } else {
      declarations.push({ property: prop, value: val });
    }
  };
  setOrReplace("display", "flex");
  setOrReplace("flex-direction", direction);
  setOrReplace("gap", gap);
  const nextStyle = serializeStyleDeclarations(declarations);
  // We work on a scratch copy relative to element boundaries
  const attr = getAttribute(element, "style");
  if (attr) {
    return `${openTag.slice(0, attr.start - element.start)}${attr.name}="${escapeHtmlAttribute(nextStyle)}"${openTag.slice(attr.end - element.start)}`;
  }
  // Insert before closing >
  const closeChar = openTag.endsWith("/>")
    ? openTag.length - 2
    : openTag.length - 1;
  return `${openTag.slice(0, closeChar)} style="${escapeHtmlAttribute(nextStyle)}"${openTag.slice(closeChar)}`;
}

/**
 * Strip absolute-positioning properties from a child's inline style, applying
 * the edit directly to the html string at the child element's source spans.
 * Returns the updated html string.
 */
function stripAbsolutePositioningFromChild(
  html: string,
  child: ParsedElement,
): string {
  const currentStyle = attributeValue(child, "style");
  if (!currentStyle) return html;
  const nextStyle = stripStyleProperties(currentStyle, [
    ...AUTO_LAYOUT_STRIP_PROPS,
  ]);
  return replaceOrInsertAttribute(html, child, "style", nextStyle);
}

/**
 * GROUP: wrap targetted sibling elements (sharing a common parent) in a new
 * <div> wrapper. Targets must all share the same parent element.
 */
function applyWrapNodes(
  html: string,
  build: ProjectionBuild,
  intent: WrapNodesEditIntent,
):
  | { content: string; capability: EditCapability; wrapperNodeId: string }
  | PatchResultStatus {
  const { targetIds, autoLayout = false } = intent;
  if (targetIds.length === 0) return "unsupported";

  // Resolve all target nodes via nodeId attribute matching.
  const targetElements: ParsedElement[] = [];
  for (const id of targetIds) {
    const node = build.projection.nodes.find(
      (n) =>
        n.dataAttributes["data-agent-native-node-id"] === id || n.id === id,
    );
    if (!node) return "conflict";
    const el = build.elementByNodeId.get(node.id);
    if (!el) return "conflict";
    targetElements.push(el);
  }

  // All targets must share the same parent.
  const parentIndexes = new Set(targetElements.map((el) => el.parentIndex));
  if (parentIndexes.size !== 1) return "unsupported";

  // Sort targets by their source position (ascending).
  targetElements.sort((a, b) => a.start - b.start);

  const siblingIndexes = targetElements
    .map((el) => el.siblingIndex)
    .sort((a, b) => a - b);
  const firstSiblingIndex = siblingIndexes[0];
  if (firstSiblingIndex === undefined) return "unsupported";
  const targetsAreContiguous = siblingIndexes.every(
    (siblingIndex, index) => siblingIndex === firstSiblingIndex + index,
  );
  if (!targetsAreContiguous) return "unsupported";

  // Collect existing node ids so we can generate a unique one.
  const usedIds = new Set(
    build.projection.nodes.flatMap((n) => {
      const id = n.dataAttributes["data-agent-native-node-id"];
      return id ? [id] : [];
    }),
  );

  const wrapperNodeId = freshNodeId(
    usedIds,
    `wrap:${targetElements.map((el) => el.start).join(":")}`,
  );

  // Collect the source fragments for all targets.
  const fragments = targetElements.map((el) => {
    let frag = html.slice(el.start, el.end);
    // If autoLayout, strip positioning from each wrapped child.
    if (autoLayout) {
      // We need a ParsedElement that reflects the fragment's own positions.
      // Re-parse the fragment to find the root element and strip its style.
      const fragElements = parseHtmlElements(frag);
      const root = fragElements.find((fe) => fe.parentIndex === undefined);
      if (root) {
        frag = stripAbsolutePositioningFromChild(frag, root);
      }
    }
    return frag;
  });

  const autoLayoutStyle = autoLayout
    ? ` style="display: flex; flex-direction: column; gap: 8px"`
    : "";
  const wrapperOpen = `<div data-agent-native-node-id="${escapeHtmlAttribute(wrapperNodeId)}" data-agent-native-layer-name="Group"${autoLayoutStyle}>`;
  const wrapperClose = `</div>`;
  const wrapperContent = `${wrapperOpen}${fragments.join("")}${wrapperClose}`;

  // Build the replacement: remove all targets from html (back to front) then
  // insert the wrapper at the first target's position.
  // Sort by position descending to remove safely.
  const sorted = [...targetElements].sort((a, b) => b.start - a.start);

  // Remove all targets from the html (back to front).
  let result = html;
  let firstTargetStart = targetElements[0]!.start;

  for (const el of sorted) {
    const start = el.start;
    const end = el.end;
    if (start < firstTargetStart) {
      firstTargetStart = start;
    }
    result = `${result.slice(0, start)}${result.slice(end)}`;
  }

  // Re-compute firstTargetStart relative to the modified string: all removals
  // before it shift it. Count how many bytes were removed before firstTargetStart.
  let bytesRemovedBefore = 0;
  for (const el of targetElements) {
    if (el.start < targetElements[0]!.start) {
      bytesRemovedBefore += el.end - el.start;
    }
  }
  const insertAt = firstTargetStart - bytesRemovedBefore;

  result = `${result.slice(0, insertAt)}${wrapperContent}${result.slice(insertAt)}`;

  return {
    content: result,
    capability: {
      kind: "structure",
      operations: ["moveNode"],
      confidence: 0.82,
    },
    wrapperNodeId,
  };
}

/**
 * UNGROUP: replace the wrapper node with its children, spliced into the
 * wrapper's parent at the wrapper's position, then remove the wrapper.
 */
function applyUnwrap(
  html: string,
  build: ProjectionBuild,
  intent: UnwrapEditIntent,
): { content: string; capability: EditCapability } | PatchResultStatus {
  const { targetId } = intent;
  const node = build.projection.nodes.find(
    (n) =>
      n.dataAttributes["data-agent-native-node-id"] === targetId ||
      n.id === targetId,
  );
  if (!node) return "conflict";
  if (!node.source) return "needsAgent";

  const element = build.elementByNodeId.get(node.id);
  if (!element) return "conflict";
  if (element.selfClosing || element.contentStart >= element.contentEnd) {
    // Nothing to unwrap from an empty/void element.
    return "unsupported";
  }

  // The children's source content is the element's inner HTML.
  const innerContent = html.slice(element.contentStart, element.contentEnd);

  // Replace the whole element (start..end) with its inner content.
  const result = `${html.slice(0, element.start)}${innerContent}${html.slice(element.end)}`;

  return {
    content: result,
    capability: {
      kind: "structure",
      operations: ["moveNode"],
      confidence: 0.82,
    },
  };
}

/**
 * CONVERT: toggle auto-layout (display:flex) on an existing container.
 */
function applyAutoLayout(
  html: string,
  build: ProjectionBuild,
  intent: AutoLayoutEditIntent,
): { content: string; capability: EditCapability } | PatchResultStatus {
  const { targetId, enabled, direction = "column", gap = "8px" } = intent;
  const node = build.projection.nodes.find(
    (n) =>
      n.dataAttributes["data-agent-native-node-id"] === targetId ||
      n.id === targetId,
  );
  if (!node) return "conflict";
  if (!node.source) return "needsAgent";

  const element = build.elementByNodeId.get(node.id);
  if (!element) return "conflict";

  if (!enabled) {
    // Turn off auto-layout: set display:block.
    const currentStyle = attributeValue(element, "style");
    let declarations = parseStyleDeclarations(currentStyle);
    const displayDecl = declarations.find((d) => d.property === "display");
    if (displayDecl) {
      displayDecl.value = "block";
    } else {
      declarations.push({ property: "display", value: "block" });
    }
    const nextStyle = serializeStyleDeclarations(declarations);
    return {
      content: replaceOrInsertAttribute(html, element, "style", nextStyle),
      capability: {
        kind: "style",
        properties: ["display"],
        confidence: 0.9,
      },
    };
  }

  // Enable auto-layout: set display:flex + direction + gap on the container.
  // Apply all three style properties in a single mutation against the already-
  // resolved element so that elements with no stable data attributes or HTML id
  // are handled correctly.  Re-parsing after each individual property write
  // caused a silent no-op for those elements because the re-parse-based element
  // finder could not locate them after the first write changed the style attr.
  const currentStyle = attributeValue(element, "style");
  let declarations = parseStyleDeclarations(currentStyle);
  const setOrReplace = (prop: string, val: string) => {
    const existing = declarations.find((d) => d.property === prop);
    if (existing) {
      existing.value = val;
    } else {
      declarations.push({ property: prop, value: val });
    }
  };
  setOrReplace("display", "flex");
  setOrReplace("flex-direction", direction);
  setOrReplace("gap", gap);
  let result = replaceOrInsertAttribute(
    html,
    element,
    "style",
    serializeStyleDeclarations(declarations),
  );

  // Strip absolute positioning from direct children.
  // Re-parse to get up-to-date child element positions after the style mutation.
  const updatedElements = parseHtmlElements(result);
  // Locate the target element in the updated parse.  Prefer stable data
  // attributes and HTML id; fall back to matching by original source position
  // (safe because the container open-tag length only changed by the style attr
  // rewrite, which shifts nothing before element.start).
  const stableAttrPairs: Array<[string, string]> = [];
  for (const attrName of STABLE_NODE_ID_ATTRIBUTES) {
    const v = attributeValue(element, attrName);
    if (v) stableAttrPairs.push([attrName, v]);
  }
  const htmlIdValue = attributeValue(element, "id");
  const findElementInParsed = (
    elements: ParsedElement[],
  ): ParsedElement | undefined => {
    for (const attrPair of stableAttrPairs) {
      const found = elements.find(
        (fe) => attributeValue(fe, attrPair[0]) === attrPair[1],
      );
      if (found) return found;
    }
    if (htmlIdValue) {
      return elements.find((fe) => attributeValue(fe, "id") === htmlIdValue);
    }
    // Fallback: match by original start position.  The container's start offset
    // is unchanged because only its open-tag content (style attr) was modified.
    return elements.find((fe) => fe.start === element.start);
  };
  const updatedTarget = findElementInParsed(updatedElements);

  if (updatedTarget) {
    // Process children in reverse order so offsets stay valid.
    const childIndexes = [...updatedTarget.childIndexes].reverse();
    for (const childIndex of childIndexes) {
      const child = updatedElements[childIndex];
      if (!child) continue;
      result = stripAbsolutePositioningFromChild(result, child);
    }
  }

  return {
    content: result,
    capability: {
      kind: "style",
      properties: ["display", "flex-direction", "gap"],
      confidence: 0.88,
    },
  };
}

function findAfterNode(
  projection: CodeLayerProjection,
  before: CodeLayerNode,
  insertAt?: number,
): CodeLayerNode | undefined {
  return (
    projection.nodes.find((node) => node.id === before.id) ??
    projection.nodes.find(
      (node) =>
        node.tag === before.tag &&
        node.source?.openStart === before.source?.openStart,
    ) ??
    (insertAt !== undefined
      ? projection.nodes.find(
          (node) =>
            node.tag === before.tag && node.source?.openStart === insertAt,
        )
      : undefined)
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

  // --- Structural intents that don't resolve a single target node ---

  if (intent.kind === "wrapNodes") {
    const wrapEdit = applyWrapNodes(html, initial, intent);
    if (typeof wrapEdit === "string") {
      return {
        content: html,
        projection: initial.projection,
        result: {
          ...patchResult(
            wrapEdit,
            source,
            intent,
            false,
            wrapEdit === "unsupported"
              ? "wrapNodes requires all targets to share a common parent element."
              : "Could not resolve one or more target nodes for wrapNodes.",
          ),
        },
      };
    }
    const nextProjection = buildCodeLayerProjection(wrapEdit.content, {
      source,
    });
    return {
      content: wrapEdit.content,
      projection: nextProjection,
      result: {
        ...patchResult(
          "applied",
          source,
          intent,
          wrapEdit.content !== html,
          wrapEdit.content === html
            ? "No source change was needed."
            : "Nodes wrapped.",
        ),
        wrapperNodeId: wrapEdit.wrapperNodeId,
      },
    };
  }

  if (intent.kind === "unwrap") {
    const unwrapEdit = applyUnwrap(html, initial, intent);
    if (typeof unwrapEdit === "string") {
      return {
        content: html,
        projection: initial.projection,
        result: patchResult(
          unwrapEdit,
          source,
          intent,
          false,
          unwrapEdit === "conflict"
            ? `Could not resolve unwrap target "${intent.targetId}".`
            : "Cannot unwrap a self-closing or empty element.",
        ),
      };
    }
    const nextProjection = buildCodeLayerProjection(unwrapEdit.content, {
      source,
    });
    return {
      content: unwrapEdit.content,
      projection: nextProjection,
      result: patchResult(
        "applied",
        source,
        intent,
        unwrapEdit.content !== html,
        unwrapEdit.content === html
          ? "No source change was needed."
          : "Node unwrapped.",
      ),
    };
  }

  if (intent.kind === "autoLayout") {
    const alEdit = applyAutoLayout(html, initial, intent);
    if (typeof alEdit === "string") {
      return {
        content: html,
        projection: initial.projection,
        result: patchResult(
          alEdit,
          source,
          intent,
          false,
          alEdit === "conflict"
            ? `Could not resolve autoLayout target "${intent.targetId}".`
            : "Cannot apply autoLayout to this element.",
        ),
      };
    }
    const nextProjection = buildCodeLayerProjection(alEdit.content, { source });
    return {
      content: alEdit.content,
      projection: nextProjection,
      result: patchResult(
        "applied",
        source,
        intent,
        alEdit.content !== html,
        alEdit.content === html
          ? "No source change was needed."
          : intent.enabled
            ? "Auto-layout enabled."
            : "Auto-layout disabled.",
      ),
    };
  }

  // --- Target-resolved intents (style / class / textContent / moveNode) ---

  const resolution = resolveTarget(initial, intent.target);
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

  let edit: { content: string; capability: EditCapability } | PatchResultStatus;
  let moveInsertAt: number | undefined;
  if (intent.kind === "style") {
    edit = applyStyleEdit(html, element, intent);
  } else if (intent.kind === "class") {
    edit = applyClassEdit(html, element, intent);
  } else if (intent.kind === "textContent") {
    edit = applyTextEdit(html, element, intent);
  } else if (intent.kind === "responsive-class") {
    edit = applyResponsiveClassEdit(html, element, intent);
  } else {
    const anchorResolution = resolveTarget(initial, intent.anchor);
    if (anchorResolution.status !== "resolved" || !anchorResolution.node) {
      return {
        content: html,
        projection: initial.projection,
        result: patchResult(
          "conflict",
          source,
          intent,
          false,
          anchorResolution.message ?? "Could not resolve the move anchor.",
          beforeNode,
          undefined,
          before,
        ),
      };
    }
    const anchorElement = initial.elementByNodeId.get(anchorResolution.node.id);
    if (!anchorElement || !anchorResolution.node.source) {
      return {
        content: html,
        projection: initial.projection,
        result: patchResult(
          "needsAgent",
          source,
          intent,
          false,
          "The move anchor does not have editable source spans.",
          beforeNode,
          undefined,
          before,
        ),
      };
    }
    // Compute the expected post-move openStart so findAfterNode can locate the
    // moved node even when its nodeId changes (position-based id).
    const rawInsertAt =
      intent.placement === "before"
        ? anchorElement.start
        : intent.placement === "after"
          ? anchorElement.end
          : anchorElement.contentEnd;
    const removedLength = element.end - element.start;
    moveInsertAt =
      element.start < rawInsertAt ? rawInsertAt - removedLength : rawInsertAt;
    edit = applyMoveNodeEdit(html, element, anchorElement, intent);
  }

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
  const afterNode = findAfterNode(nextProjection, beforeNode, moveInsertAt);
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

/**
 * Attributes injected by the editor at runtime that must NOT appear in
 * on-disk source files. These are stripped before any write-back so that
 * the saved file stays clean and matches what a developer would author.
 *
 * - `data-agent-native-node-id` — stable selection id stamped by the editor.
 * - `data-agent-native-layer-name` is intentionally kept: it is a
 *   developer-authored attribute (the canonical layer-name hint) and is
 *   useful in committed source.  Only ephemeral runtime stamps are removed.
 */
const EDITOR_ONLY_ATTRIBUTES: readonly string[] = ["data-agent-native-node-id"];

/**
 * Strip editor-only runtime attributes from an HTML string, returning clean
 * source suitable for writing back to disk.
 *
 * Currently removes `data-agent-native-node-id` (and any future attributes
 * listed in EDITOR_ONLY_ATTRIBUTES). The function operates on the raw HTML
 * string with a regex that handles both quoted forms and unquoted values, and
 * is safe to apply to already-clean source (idempotent).
 *
 * @param html  The raw HTML string, potentially containing editor stamps.
 * @returns     A new string with all editor-only attributes removed.
 */
export function stripEditorOnlyAttributes(html: string): string {
  if (!html || typeof html !== "string") return html ?? "";
  let result = html;
  for (const attr of EDITOR_ONLY_ATTRIBUTES) {
    // Match the attribute with optional surrounding whitespace. The value may
    // be double-quoted, single-quoted, or unquoted (no spaces / > chars).
    // A leading \s+ is required so we only strip the attribute name+value pair
    // and leave surrounding markup intact.
    const re = new RegExp(
      `\\s+${attr.replace(/-/g, "\\-")}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'=><\`]+)`,
      "gi",
    );
    result = result.replace(re, "");
  }
  return result;
}

export interface MoveNodeBetweenDocumentsOptions {
  nodeId: string;
  anchorNodeId?: string;
  placement?: "before" | "after" | "inside";
}

export interface MoveNodeBetweenDocumentsResult {
  sourceHtml: string;
  destHtml: string;
  status: "applied" | "unsupported";
  message?: string;
  /**
   * The data-agent-native-node-id of the moved node in destHtml.
   * May differ from the original nodeId when a collision caused a re-stamp.
   * Only present when status is "applied".
   */
  movedNodeId?: string;
}

/**
 * Move a node (by data-agent-native-node-id) from sourceHtml into destHtml.
 * The node's serialized subtree is removed from sourceHtml and inserted into
 * destHtml relative to anchorNodeId (default: append to <body> or end of doc).
 * Any node ids in the moved subtree that already exist in destHtml are
 * re-stamped to stay unique. No external dependencies.
 */
export function moveNodeBetweenDocuments(
  sourceHtml: string,
  destHtml: string,
  opts: MoveNodeBetweenDocumentsOptions,
): MoveNodeBetweenDocumentsResult {
  const { nodeId, anchorNodeId, placement = "inside" } = opts;

  // --- Locate the node in sourceHtml ---
  const sourceElements = parseHtmlElements(sourceHtml);
  const sourceTarget = sourceElements.find(
    (el) => attributeValue(el, "data-agent-native-node-id") === nodeId,
  );
  if (!sourceTarget) {
    return {
      sourceHtml,
      destHtml,
      status: "unsupported",
      message: `Node with data-agent-native-node-id="${nodeId}" not found in sourceHtml.`,
    };
  }

  // --- Extract the subtree fragment ---
  let fragment = sourceHtml.slice(sourceTarget.start, sourceTarget.end);

  // --- Collect all existing node ids in destHtml to avoid collisions ---
  const destElements = parseHtmlElements(destHtml);
  const destUsedIds = new Set<string>(
    destElements
      .map((el) => attributeValue(el, "data-agent-native-node-id"))
      .filter((v): v is string => v !== null),
  );

  // --- Re-stamp any colliding node ids in the fragment ---
  // We do this by parsing the fragment as its own HTML and replacing ids.
  const fragElements = parseHtmlElements(fragment);
  // Build replacement map: old id → new id
  const idRemap = new Map<string, string>();
  for (const fragEl of fragElements) {
    const existingId = attributeValue(fragEl, "data-agent-native-node-id");
    if (!existingId) continue;
    if (destUsedIds.has(existingId)) {
      const newId = freshNodeId(
        destUsedIds,
        `moved:${existingId}:${fragEl.start}`,
      );
      idRemap.set(existingId, newId);
    } else {
      destUsedIds.add(existingId);
    }
  }

  // Apply id remaps to the fragment (back to front by attribute position).
  if (idRemap.size > 0) {
    const remapEdits: Array<{ start: number; end: number; value: string }> = [];
    for (const fragEl of fragElements) {
      const attr = getAttribute(fragEl, "data-agent-native-node-id");
      if (!attr || typeof attr.value !== "string") continue;
      const newId = idRemap.get(attr.value);
      if (!newId) continue;
      remapEdits.push({
        start: attr.start,
        end: attr.end,
        value: `data-agent-native-node-id="${escapeHtmlAttribute(newId)}"`,
      });
    }
    // Apply back to front.
    remapEdits.sort((a, b) => b.start - a.start);
    for (const edit of remapEdits) {
      fragment = `${fragment.slice(0, edit.start)}${edit.value}${fragment.slice(edit.end)}`;
    }
  }

  // --- Remove node from sourceHtml ---
  const nextSourceHtml = `${sourceHtml.slice(0, sourceTarget.start)}${sourceHtml.slice(sourceTarget.end)}`;

  // --- Insert fragment into destHtml ---
  let nextDestHtml: string;

  if (anchorNodeId) {
    const anchor = destElements.find(
      (el) => attributeValue(el, "data-agent-native-node-id") === anchorNodeId,
    );
    if (!anchor) {
      return {
        sourceHtml,
        destHtml,
        status: "unsupported",
        message: `Anchor node with data-agent-native-node-id="${anchorNodeId}" not found in destHtml.`,
      };
    }
    const insertAt =
      placement === "before"
        ? anchor.start
        : placement === "after"
          ? anchor.end
          : anchor.selfClosing
            ? anchor.end
            : anchor.contentEnd;
    nextDestHtml = `${destHtml.slice(0, insertAt)}${fragment}${destHtml.slice(insertAt)}`;
  } else {
    // Default: find <body> and append inside it, or append at end of doc.
    const bodyEl = destElements.find((el) => el.tag === "body");
    const insertAt = bodyEl
      ? bodyEl.selfClosing
        ? bodyEl.end
        : bodyEl.contentEnd
      : destHtml.length;
    nextDestHtml = `${destHtml.slice(0, insertAt)}${fragment}${destHtml.slice(insertAt)}`;
  }

  // The moved node keeps its original id unless it collided and was re-stamped.
  const movedNodeId = idRemap.get(nodeId) ?? nodeId;

  return {
    sourceHtml: nextSourceHtml,
    destHtml: nextDestHtml,
    status: "applied",
    movedNodeId,
  };
}
