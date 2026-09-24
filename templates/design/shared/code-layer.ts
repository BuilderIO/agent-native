import type { Declaration, Root } from "postcss";
import CssSyntaxError from "postcss/lib/css-syntax-error";
import parseCss from "postcss/lib/parse";

import {
  BORDER_AREA_FALLBACK_PROPERTIES,
  borderAreaFallback,
  borderAreaLayerIndex,
  borderAreaSupportedBranch,
} from "./border-area-fallback.js";
import {
  isSafeCssUrlReference,
  removeBreakpointMediaDeclaration,
  setBreakpointMediaDeclaration,
} from "./breakpoint-media.js";
import { parseCssColorExtended } from "./color-utils";
import {
  linkedComponentRootForNode,
  COMPONENT_ID_ATTR,
  isComponentInstance,
  instanceFromNode,
  type ComponentInstance,
} from "./component-model";
import type { TailwindBreakpointPrefix } from "./design-state.js";
import {
  buildLinearGradientDef,
  buildRadialGradientDef,
  parseComputedLinearGradient,
  parseComputedRadialGradient,
  resolveRadialGradientGeometry,
  type FigmaSvgColorStop,
} from "./figma-svg-scene";
import {
  ensureGroupRuntime,
  MEASURED_FLOW_GROUP_ATTR,
} from "./group-runtime.js";
import { isStandaloneHttpUrl } from "./html-content.js";
import { resolveLayerNameAttribute } from "./layer-name.js";
import {
  parsePenNodes,
  serializePenNodes,
  serializeRoundedPenPath,
  withoutVertexRadii,
} from "./pen-path";
import {
  getPropertyClasses,
  migrateMaxWidthClassBounds,
  parseClassGroups,
  parseClassToken,
  removeMaxWidthPropertyClass,
  setMaxWidthPropertyClass,
  setPropertyClass,
  removePropertyClass,
  utilityStem,
} from "./responsive-classes.js";
import type { DesignSourceType } from "./source-mode";
import { parseSvgPathData } from "./svg-path-data";
import {
  isVectorEndpointProperty,
  isVectorEndpointStyle,
  vectorEndpointPairForPrimitive,
  vectorEndpointMarkerId,
  vectorEndpointDefsMarkup,
  VECTOR_END_ENDPOINT_PROPERTY,
  VECTOR_START_ENDPOINT_PROPERTY,
} from "./vector-endpoints.js";

/**
 * Shown when a document transform is handed a URL-backed (localhost/fusion)
 * screen's stored content. Same wording from both producers so the message
 * doesn't depend on which gesture the user happened to use.
 */
export const LINKED_COMPONENT_STRUCTURE_REFUSAL =
  "Changing linked component layer structure is not supported yet.";

export const URL_BACKED_SCREEN_EDIT_REFUSAL =
  "This screen is backed by a live route URL, not editable markup — layers cannot be moved into or out of it. Edit the running app's source instead.";

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

export interface CodeLayerSourceEdit {
  start: number;
  end: number;
  insertedLength: number;
}

export function mapCodeLayerSourceOffsetThroughEdits(
  sourceOffset: number,
  edits: readonly CodeLayerSourceEdit[],
): number | null {
  let offset = sourceOffset;
  for (const edit of edits) {
    if (edit.start <= offset && offset < edit.end) return null;
    if (edit.end <= offset) {
      offset += edit.insertedLength - (edit.end - edit.start);
    }
  }
  return offset;
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
  | "background-clip"
  | "background-color"
  | "background-image"
  | "background-size"
  | "background-repeat"
  | "background-position"
  | "background-clip"
  | "-webkit-background-clip"
  | "-webkit-box-orient"
  | "-webkit-line-clamp"
  | "background-blend-mode"
  | "-webkit-text-fill-color"
  | "fill"
  | "fill-opacity"
  | "opacity"
  | "mix-blend-mode"
  | "font-size"
  | "font-weight"
  | "font-family"
  | "font-style"
  | "object-fit"
  | "letter-spacing"
  | "word-spacing"
  | "line-height"
  | "--agent-native-truncate-original-display"
  | "--agent-native-truncate-original-overflow"
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
  | "--an-css-border-gradient"
  | "border-radius"
  | "border-top-left-radius"
  | "border-top-right-radius"
  | "border-bottom-left-radius"
  | "border-bottom-right-radius"
  | "stroke"
  | "stroke-width"
  | "stroke-opacity"
  | "stroke-dasharray"
  | "stroke-dashoffset"
  | "stroke-linecap"
  | "stroke-linejoin"
  | "stroke-miterlimit"
  | "--an-vector-stroke-position"
  | "--an-vector-start-point"
  | "--an-vector-end-point"
  | "outline"
  | "outline-width"
  | "outline-style"
  | "outline-color"
  | "outline-offset"
  | "-webkit-text-stroke-width"
  | "-webkit-text-stroke-color"
  | "box-shadow"
  | "text-shadow"
  | "filter"
  | "backdrop-filter"
  | "transform"
  | "transform-origin"
  | "transform-box"
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
  | "isolation"
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
      /**
       * Breakpoint-scoped raw style editing (§6.4) — the `@media` fallback
       * for values responsive class prefixes can't express. Writes into the
       * managed `<style data-agent-native-breakpoints>` block via
       * `breakpoint-media.ts`, targeting the node's stable
       * `data-agent-native-node-id`.
       */
      kind: "breakpoint-style";
      /** Inclusive upper viewport bound (px) the edit was applied below. */
      maxWidthPx: number;
      operations: Array<"set" | "remove">;
      properties: string[];
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
      operations: Array<"moveNode" | "deleteNode">;
      confidence: number;
      reason?: string;
    }
  | {
      /** Single plain-attribute writes (see AttributeEditIntent). */
      kind: "attribute";
      operations: Array<"set">;
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
  /** Text this element holds directly, not text a child holds. */
  paintsOwnText: boolean;
  /** The entire element is an inline text-edit/style root. */
  wholeTextStyleRoot?: boolean;
  /** The `x-for` this node is rendered by, when it sits inside a repeat. */
  repeatXFor: string | null;
  style: Partial<Record<VisualStyleProperty | (string & {}), string>>;
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
  isNativeTextPrimitive?: boolean;
  /** Identity, not shape: a button is a frame that is *also* a component. */
  isComponent?: boolean;
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
  operation?: "set";
  target: EditIntentTarget;
  property: VisualStyleProperty | (string & {});
  value: string;
  opacity?: string;
  stroke?: string;
  strokeWidth?: string;
  strokeOpacity?: string;
  strokeDasharray?: string;
  strokeDashoffset?: string;
  strokeLinecap?: string;
  strokeLinejoin?: string;
  strokeMiterlimit?: string;
  transform?: string;
  transformOrigin?: string;
  transformBox?: string;
}

export interface StyleRemoveEditIntent {
  kind: "style";
  operation: "remove";
  target: EditIntentTarget;
  property: VisualStyleProperty | (string & {});
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

/**
 * Node-id integrity (id-on-demand): sets or replaces a single plain HTML
 * attribute on the target element. Introduced so the host can persist the
 * bridge's minted `pendingNodeId` (see ElementInfo.pendingNodeId) as the
 * element's real `data-agent-native-node-id` the moment an id-less node is
 * selected — every subsequent id-keyed operation (move/reorder, style
 * commits, motion tracks, scrub) then resolves normally. Not limited to that
 * attribute name; kept general so other single-attribute host writes can
 * reuse the same deterministic path instead of a full-document
 * find/replace-and-resave.
 */
export interface AttributeEditIntent {
  kind: "attribute";
  target: EditIntentTarget;
  name: string;
  value: string;
}

export interface DeleteNodeEditIntent {
  kind: "deleteNode";
  target: EditIntentTarget;
}

export interface MoveNodeEditIntent {
  kind: "moveNode";
  target: EditIntentTarget;
  anchor: EditIntentTarget;
  placement: "before" | "after" | "inside";
}

/**
 * GROUP: wrap sibling nodes sharing a parent inside a new <div> wrapper.
 * Targets are reparented in source order, and the wrapper takes the stacking
 * position of the topmost selected target. The new wrapper gets a fresh
 * data-agent-native-node-id, a sequential layer name, and the
 * `data-agent-native-group-wrapper="true"` marker. Group wrappers also carry
 * the group marker unless the caller requests a frame wrapper or auto-layout.
 *
 * When autoLayout is true the wrapper also receives
 * `display:flex; flex-direction:column; gap:8px` and
 * position/left/top/right/bottom are stripped from each wrapped child.
 *
 * Returns "unsupported" if the targets don't share a common parent.
 */
export interface WrapNodeSizeHint {
  width: number;
  height: number;
  /** Parent-content-relative border-box position for an in-flow target. */
  left?: number;
  top?: number;
  /** Live layout found authored CSS that removes this target from flow. */
  outOfFlow?: true;
}

export interface WrapNodesEditIntent {
  kind: "wrapNodes";
  targetIds: string[];
  autoLayout?: boolean;
  /** Defaults to a Group; auto-layout always creates a Frame. */
  wrapperKind?: "group" | "frame";
  /**
   * Live-rendered dimensions per projected target node id. Width/height are
   * used as a fallback when an absolutely positioned target omits its own
   * dimensions. left/top are parent-content-relative positions used to keep
   * an in-flow group at its measured size while rebasing its direct children.
   * Callers without live DOM measurements simply omit the hint and retain the
   * source-only behavior. A unique authored node id is also accepted for
   * direct API callers; ambiguous authored ids are never hint aliases.
   */
  sizeHints?: Record<string, WrapNodeSizeHint>;
}

/** Create an editable SVG-backed Boolean Subtract from supported shape siblings. */
export interface BooleanSubtractEditIntent {
  kind: "booleanSubtract";
  targetIds: string[];
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
  /**
   * Container declarations to write instead of the flex trio, so a grid flow
   * also reaches the child reflow below — without it the children stay
   * pinned where they were drawn and the new layout renders as a no-op.
   */
  containerStyles?: Record<string, string>;
  direction?: "row" | "column";
  gap?: string;
  /**
   * Measured child geometry, container-relative, keyed by stable node id.
   * Supplied when disabling so children keep their rendered positions and
   * become freely draggable; without it they re-stack in block flow.
   */
  childRects?: Record<
    string,
    { x: number; y: number; width: number; height: number }
  >;
  /** Rendered size of the container, so it cannot collapse once flow empties. */
  containerRect?: { width: number; height: number };
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
 * `from` is an optional guard for `"replace"`: when present, the replace only
 * applies if the utility EFFECTIVE at `prefix` equals `from` (bare, without
 * prefix). "Effective" follows the Tailwind mobile-first cascade — an explicit
 * override at `prefix` wins, otherwise the nearest smaller breakpoint's
 * utility (down to base) is what renders there. If the guard fails (a stale
 * selection targeting a different element/state than the caller expected) the
 * edit reports `"conflict"` instead of silently overwriting whatever is there.
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
  /**
   * Guard for `"replace"` (honoured for `"add"` too when provided): the bare
   * utility (without prefix) the caller expects to be EFFECTIVE at `prefix`,
   * following the Tailwind mobile-first cascade. On mismatch the edit is
   * rejected as `"conflict"` rather than applied. Ignored for `"remove"`.
   */
  from?: string;
  /**
   * Framer-style desktop-down scope (§6.4 breakpoint bar). When set, the
   * edit writes a `max-[<maxWidthPx>px]:` scoped token instead of a
   * min-width `prefix` token, and `prefix` is ignored. The bound comes from
   * `breakpointUpperBoundPx` (just below the next-wider frame). `from`
   * guards are not applied to max-width scopes.
   */
  maxWidthPx?: number;
}

/**
 * Breakpoint-scoped raw style edit — the `@media` fallback for values that
 * responsive class prefixes can't express (exact px positions from canvas
 * drags, rgb()/calc() values, …). Persists into the managed
 * `<style data-agent-native-breakpoints>` block as a
 * `@media (max-width: <maxWidthPx>px)` rule targeting the element's
 * `data-agent-native-node-id` (stamped automatically when missing).
 *
 * - `operation: "set"` (default) writes/overwrites the declaration.
 * - `operation: "remove"` deletes it, falling back to the base value.
 */
export interface BreakpointStyleEditIntent {
  kind: "breakpoint-style";
  target: EditIntentTarget;
  /** Inclusive upper viewport bound (px) the override applies below. */
  maxWidthPx: number;
  /** CSS property (camelCase or kebab-case). */
  property: string;
  /** CSS value. Required for `"set"`; ignored for `"remove"`. */
  value?: string;
  operation?: "set" | "remove";
}

export type EditIntent =
  | StyleEditIntent
  | StyleRemoveEditIntent
  | ClassEditIntent
  | TextEditIntent
  | AttributeEditIntent
  | DeleteNodeEditIntent
  | MoveNodeEditIntent
  | WrapNodesEditIntent
  | BooleanSubtractEditIntent
  | UnwrapEditIntent
  | AutoLayoutEditIntent
  | ResponsiveClassEditIntent
  | BreakpointStyleEditIntent;

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
  style: Partial<Record<VisualStyleProperty | (string & {}), string>>;
  textSnippet: string | null;
  /** Text this element holds directly, not text a child holds. */
  paintsOwnText: boolean;
  /** The `x-for` this node is rendered by, when it sits inside a repeat. */
  repeatXFor: string | null;
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
  /** The data-agent-native-node-id of a newly created structural wrapper. */
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
  elements: ParsedElement[];
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
  "background-clip",
  "background-color",
  "background-image",
  "background-size",
  "background-repeat",
  "background-position",
  "background-clip",
  "-webkit-background-clip",
  "-webkit-box-orient",
  "-webkit-line-clamp",
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
  "word-spacing",
  "line-height",
  "--agent-native-truncate-original-display",
  "--agent-native-truncate-original-overflow",
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
  "--an-css-border-gradient",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "--an-vector-stroke-position",
  "--an-vector-start-point",
  "--an-vector-end-point",
  "outline",
  "outline-width",
  "outline-style",
  "outline-color",
  "outline-offset",
  "-webkit-text-stroke-width",
  "-webkit-text-stroke-color",
  "-webkit-text-fill-color",
  "box-shadow",
  "text-shadow",
  "filter",
  "backdrop-filter",
  "transform",
  "transform-origin",
  "transform-box",
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
  "object-fit",
  "isolation",
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
  // Vendor-prefixed longhands need explicit aliases: the generic camel→kebab
  // pass in normalizeStyleProperty yields "webkit-text-stroke-*" WITHOUT the
  // required leading dash, which would miss the allow-list entirely.
  webkitTextStrokeColor: "-webkit-text-stroke-color",
  webkitTextStrokeWidth: "-webkit-text-stroke-width",
  webkitBoxOrient: "-webkit-box-orient",
  webkitLineClamp: "-webkit-line-clamp",
};

// Matches url(...) in double-quoted, single-quoted, or unquoted form so each
// reference inside a (possibly multi-layer) background-image value can be
// checked individually against isSafeCssUrlReference.
const URL_IN_VALUE_RE =
  /\burl\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*?))\s*\)/gi;

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

// Interiors that are not markup at all, plus boxless void metadata both
// bridges already strip from the runtime snapshot. Descendants are never
// parsed, so nothing here can ever be addressed.
const NON_VISUAL_TAGS = new Set([
  "head",
  "script",
  "style",
  "meta",
  "link",
  "source",
  "track",
  "title",
  "noscript",
]);

const SVG_RESOURCE_TAGS = new Set([
  "clippath",
  "defs",
  "filter",
  "lineargradient",
  "mask",
  "pattern",
  "radialgradient",
  "stop",
]);

// Parsed and descended into, but not a layer of its own: a `<template>`
// measures 0x0 and both bridges refuse to select it, so a row for one is a
// layer the canvas can never show. Its children re-parent to its own parent.
const TRANSPARENT_TAGS = new Set(["template"]);

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

/**
 * Tags that format text *inside* a text layer instead of becoming their own
 * layer. A heading with one coloured `<span>` is a single Text layer with
 * runs; splitting it into three is what makes an imported page unreadable.
 */
const INLINE_TEXT_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "br",
  "cite",
  "code",
  "data",
  "dfn",
  "em",
  "i",
  "kbd",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
  "wbr",
]);

// Keep this source-projection allowlist aligned with the bridge's
// isInlineEditableDescendant; a single checkbox or layout child makes its
// parent a container instead of one whole text style root.
const INLINE_TEXT_STYLE_ROOT_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "br",
  "cite",
  "code",
  "em",
  "i",
  "mark",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "wbr",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ul",
  "ol",
  "dl",
  "dt",
  "dd",
  "label",
  "caption",
  "td",
  "th",
]);

/**
 * First segments of Tailwind utilities. Tailwind's stem vocabulary is closed,
 * so this is a table; the deny-list it replaces was a guess and lost — it let
 * `flex-col`, `opacity-90`, and `top-0` become layer names.
 */
const UTILITY_CLASS_STEMS = new Set([
  "absolute",
  "accent",
  "align",
  "animate",
  "antialiased",
  "appearance",
  "aspect",
  "auto",
  "backdrop",
  "backface",
  "basis",
  "before",
  "after",
  "bg",
  "blend",
  "block",
  "blur",
  "border",
  "bottom",
  "box",
  "break",
  "brightness",
  "capitalize",
  "caption",
  "caret",
  "clear",
  "col",
  "collapse",
  "columns",
  "contain",
  "container",
  "content",
  "contents",
  "contrast",
  "cursor",
  "dark",
  "data",
  "decoration",
  "delay",
  "diagonal",
  "divide",
  "drop",
  "duration",
  "ease",
  "empty",
  "end",
  "even",
  "fill",
  "filter",
  "first",
  "fixed",
  "flex",
  "float",
  "flow",
  "font",
  "forced",
  "from",
  "gap",
  "gradient",
  "grayscale",
  "grid",
  "group",
  "grow",
  "h",
  "hidden",
  "hue",
  "hyphens",
  "indent",
  "inline",
  "inset",
  "invert",
  "invisible",
  "isolate",
  "isolation",
  "italic",
  "items",
  "justify",
  "last",
  "leading",
  "left",
  "light",
  "line",
  "lining",
  "list",
  "lowercase",
  "ltr",
  "m",
  "marker",
  "max",
  "mb",
  "me",
  "min",
  "mix",
  "ml",
  "motion",
  "mr",
  "ms",
  "mt",
  "mx",
  "my",
  "no",
  "normal",
  "not",
  "object",
  "odd",
  "oldstyle",
  "only",
  "opacity",
  "open",
  "order",
  "ordinal",
  "origin",
  "outline",
  "overflow",
  "overline",
  "overscroll",
  "p",
  "pb",
  "pe",
  "peer",
  "perspective",
  "pl",
  "place",
  "placeholder",
  "pointer",
  "pr",
  "print",
  "proportional",
  "ps",
  "pt",
  "px",
  "py",
  "relative",
  "resize",
  "right",
  "ring",
  "rotate",
  "rounded",
  "row",
  "rtl",
  "s",
  "saturate",
  "scale",
  "scroll",
  "select",
  "selection",
  "self",
  "sepia",
  "shadow",
  "shrink",
  "size",
  "skew",
  "slashed",
  "snap",
  "space",
  "sr",
  "stacked",
  "start",
  "static",
  "sticky",
  "stroke",
  "subpixel",
  "table",
  "tabular",
  "text",
  "to",
  "top",
  "touch",
  "tracking",
  "transform",
  "transition",
  "translate",
  "truncate",
  "underline",
  "uppercase",
  "via",
  "visible",
  "visited",
  "w",
  "whitespace",
  "will",
  "z",
]);

function bareClassToken(token: string): string {
  return token.slice(token.lastIndexOf(":") + 1).replace(/^-/, "");
}

function looksLikeUtilityClass(token: string): boolean {
  const bare = bareClassToken(token);
  if (!bare) return true;
  if (bare.includes("[") || bare.includes("/")) return true;
  return UTILITY_CLASS_STEMS.has(bare.split("-")[0] ?? "");
}

/**
 * The four facts that decide a design node's type. Read from the class list
 * and inline style because a source projection has no layout engine — a live
 * screen can upgrade these through the bridge's computed style.
 */
interface NodeVisualFacts {
  painted: boolean;
  padded: boolean;
  sized: boolean;
  circular: boolean;
}

function classDimension(
  classes: readonly string[],
  axis: "w" | "h",
): string | null {
  for (const token of classes) {
    const bare = bareClassToken(token);
    if (bare.startsWith(`${axis}-`)) return bare.slice(axis.length + 1);
  }
  return null;
}

/**
 * `rounded-full` alone does not mean a circle — on a wide box it is a pill,
 * which is a rounded rectangle. Equal extents are what separate the two.
 */
function isSquare(
  classes: readonly string[],
  style: Record<string, string | undefined>,
): boolean {
  if (
    classes.some((token) => {
      const bare = bareClassToken(token);
      return bare.startsWith("size-") || bare === "aspect-square";
    })
  ) {
    return true;
  }
  const width = classDimension(classes, "w") ?? style["width"]?.trim();
  const height = classDimension(classes, "h") ?? style["height"]?.trim();
  return Boolean(width && height && width === height);
}

function classPaints(token: string): boolean {
  const bare = bareClassToken(token);
  if (/^bg-/.test(bare)) {
    return !/^bg-(transparent|none|inherit|current|clip-|origin-|fixed|local|scroll|bottom|center|left|right|top|repeat|no-repeat|auto|cover|contain|blend-)/.test(
      bare,
    );
  }
  if (/^border(-[xytrbles])?(-\d+)?$/.test(bare)) return !/-0$/.test(bare);
  if (/^ring(-\d+)?$/.test(bare)) return bare !== "ring-0";
  if (/^outline(-\d+)?$/.test(bare)) return bare !== "outline-0";
  if (/^shadow(-(sm|md|lg|xl|2xl|inner))?$/.test(bare)) return true;
  return false;
}

function classPads(token: string): boolean {
  const match = /^(p|px|py|pt|pr|pb|pl|ps|pe)-(.+)$/.exec(
    bareClassToken(token),
  );
  return Boolean(match) && match![2] !== "0";
}

function classSizes(token: string): boolean {
  const bare = bareClassToken(token);
  // `inset-0` on an absolute overlay is a size even though it names no axis.
  if (/^inset(-[xy])?-/.test(bare)) return !bare.endsWith("-auto");
  const match = /^(w|h|size|min-w|min-h)-(.+)$/.exec(bare);
  if (!match) return false;
  return !["auto", "fit", "min", "max"].includes(match[2]!);
}

function styleValueIsPresent(
  value: string | undefined,
  empties: RegExp,
): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && !empties.test(trimmed);
}

function visualFactsFor(node: CodeLayerNode): NodeVisualFacts {
  return visualFactsOf(node.classes, node.style);
}

function visualFactsOfElement(element: ParsedElement): NodeVisualFacts {
  return visualFactsOf(
    classList(element),
    parseStyle(attributeValue(element, "style")),
  );
}

function visualFactsOf(
  classes: readonly string[],
  rawStyle: Record<string, string | undefined> | object,
): NodeVisualFacts {
  const style = rawStyle as Record<string, string | undefined>;
  const emptyPaint = /^(none|transparent|initial|inherit|unset|0|0px)$/i;
  const emptyLength = /^(0|0px|0rem|auto|initial|inherit|unset)$/i;

  const painted =
    classes.some(classPaints) ||
    styleValueIsPresent(style["background"], emptyPaint) ||
    styleValueIsPresent(style["background-color"], emptyPaint) ||
    styleValueIsPresent(style["background-image"], emptyPaint) ||
    styleValueIsPresent(style["border"], emptyPaint) ||
    styleValueIsPresent(style["border-width"], emptyPaint) ||
    styleValueIsPresent(style["box-shadow"], emptyPaint) ||
    styleValueIsPresent(style["outline"], emptyPaint);

  const padded =
    classes.some(classPads) ||
    styleValueIsPresent(style["padding"], emptyLength) ||
    styleValueIsPresent(style["padding-top"], emptyLength) ||
    styleValueIsPresent(style["padding-right"], emptyLength) ||
    styleValueIsPresent(style["padding-bottom"], emptyLength) ||
    styleValueIsPresent(style["padding-left"], emptyLength);

  const sized =
    classes.some(classSizes) ||
    styleValueIsPresent(style["width"], emptyLength) ||
    styleValueIsPresent(style["height"], emptyLength);

  const roundedFull =
    classes.some((token) => bareClassToken(token) === "rounded-full") ||
    /^(50%|9999px|9999rem)$/.test((style["border-radius"] ?? "").trim());

  return {
    painted,
    padded,
    sized,
    circular: roundedFull && isSquare(classes, style),
  };
}

/**
 * Identity, orthogonal to shape: a form control is a Frame that is also a
 * component. Class and layer-name guessing is deliberately NOT here — it
 * painted `product-card-wrapper` violet, and the canvas copy carried no
 * utility-class guard, so one element got two colours in two panels.
 */
function treeNodeIsComponent(node: CodeLayerNode): boolean {
  return Boolean(node.componentInstance) || COMPONENT_LAYER_TAGS.has(node.tag);
}

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
  if (!value.includes("&")) return value;
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : _;
    })
    .replace(/&#([0-9]+);?/g, (_, decimal: string) => {
      const codePoint = Number.parseInt(decimal, 10);
      return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : _;
    })
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

function getAttribute(
  element: ParsedElement,
  name: string,
): ParsedAttribute | undefined {
  const lowerName = name.toLowerCase();
  return element.attributes.find((attr) => attr.lowerName === lowerName);
}

function attributeValue(element: ParsedElement, name: string): string | null {
  const value = getAttribute(element, name)?.value;
  // Parsed attributes contain source text, so quoted values may still carry
  // entities emitted by an earlier deterministic patch. Decode before using
  // them semantically or reserializing; otherwise sequential style edits turn
  // `&quot;` into `&amp;quot;` on every pass and corrupt quoted CSS url() values.
  if (typeof value === "string") return decodeBasicHtmlEntities(value);
  if (value === true) return "";
  return null;
}

function explicitLayerNameFor(element: ParsedElement): {
  name: string;
  source: CodeLayerNode["layerNameSource"];
  attribute?: string;
} | null {
  const explicit = resolveLayerNameAttribute((attribute) =>
    attributeValue(element, attribute),
  );
  return explicit
    ? {
        name: truncateLayerName(explicit.value),
        source: "attribute",
        attribute: explicit.attribute,
      }
    : null;
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

  return null;
}

function identifierLayerNameFor(element: ParsedElement): {
  name: string;
  source: CodeLayerNode["layerNameSource"];
  attribute?: string;
} | null {
  const id = attributeValue(element, "id");
  if (id) {
    return {
      name: prettifyIdentifier(id),
      source: "selector",
      attribute: "id",
    };
  }

  const meaningfulClass = classList(element).find(
    (token) => !looksLikeUtilityClass(token),
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
    case "a":
      return "Link";
    case "img":
    case "picture":
      return "Image";
    case "input":
      return "Input";
    case "label":
      return "Label";
    case "main":
      return "Main";
    case "select":
      return "Select";
    case "textarea":
      return "Text area";
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
  const parsed = readStyleDeclarations(value);
  if ("invalid" in parsed) return style;
  const importantByProperty = new Map<string, boolean>();
  for (const declaration of parsed.declarations) {
    const property = cssPropertyKey(declaration.prop);
    if (importantByProperty.get(property) && !declaration.important) continue;
    style[property] = styleDeclarationValue(declaration);
    importantByProperty.set(property, declaration.important);
  }
  return style;
}

interface ParsedStyleDeclarations {
  root: Root;
  declarations: Declaration[];
}

class InvalidInlineStyleError extends Error {
  constructor(
    readonly offset: number | undefined,
    reason: string,
  ) {
    super(`The existing inline style is malformed: ${reason}`);
    this.name = "InvalidInlineStyleError";
  }
}

function parseStyleDeclarations(value: string | null): ParsedStyleDeclarations {
  try {
    const parsedCss = parseCss(value ?? "", { map: false });
    if (parsedCss.type !== "root") {
      throw new Error("Expected an inline style root");
    }
    const root = parsedCss;
    const unsupportedNode = (root.nodes ?? []).find(
      (node) => node.type !== "decl" && node.type !== "comment",
    );
    if (unsupportedNode) {
      throw new InvalidInlineStyleError(
        unsupportedNode.source?.start?.offset,
        `unexpected ${unsupportedNode.type} in inline styles`,
      );
    }
    return {
      root,
      declarations: (root.nodes ?? []).filter(
        (node): node is Declaration => node.type === "decl",
      ),
    };
  } catch (error) {
    if (!(error instanceof CssSyntaxError)) throw error;
    throw new InvalidInlineStyleError(error.input?.offset, error.reason);
  }
}

type StyleDeclarationRead = Pick<Declaration, "prop" | "value" | "important">;

type StyleDeclarationsRead =
  | { declarations: readonly StyleDeclarationRead[] }
  | { invalid: string };

/**
 * Read-only parses, keyed by the decoded style text. One projection reads each
 * element's style (and its parent's) several times, and a failed parse costs
 * two exception constructions — dominant on a cold open of a large import.
 * Holds plain declarations and messages, not postcss nodes or Error instances
 * (whose captured stack frames keep their callers' closures alive); edits use
 * `parseStyleDeclarations` for a root they can mutate.
 */
const STYLE_READ_CACHE_MAX_CHARS = 4_000_000;
const styleReadCache = new Map<string, StyleDeclarationsRead>();
let styleReadCacheChars = 0;

function readStyleDeclarations(value: string): StyleDeclarationsRead {
  const cached = styleReadCache.get(value);
  if (cached) return cached;
  // `value` is usually a V8 sliced string that pins the whole document it was
  // cut from, and postcss slices its values from it in turn. Key and parse a
  // flat copy so the cache retains only the style text.
  value = (" " + value).slice(1);
  let parsed: StyleDeclarationsRead;
  try {
    parsed = {
      declarations: parseStyleDeclarations(value).declarations.map(
        (declaration) => ({
          prop: declaration.prop,
          value: declaration.value,
          important: declaration.important,
        }),
      ),
    };
  } catch (error) {
    if (!(error instanceof InvalidInlineStyleError)) throw error;
    parsed = { invalid: error.message };
  }
  if (styleReadCacheChars + value.length > STYLE_READ_CACHE_MAX_CHARS) {
    styleReadCache.clear();
    styleReadCacheChars = 0;
  }
  styleReadCache.set(value, parsed);
  styleReadCacheChars += value.length;
  return parsed;
}

function cssPropertyKey(property: string): string {
  return property.startsWith("--") ? property : property.toLowerCase();
}

function styleDeclarationValue(declaration: StyleDeclarationRead): string {
  return declaration.important
    ? `${declaration.value} !important`
    : declaration.value;
}

function effectiveStyleDeclarations<T extends StyleDeclarationRead>(parsed: {
  declarations: readonly T[];
}): T[] {
  const winners = new Map<string, T>();
  for (const declaration of parsed.declarations) {
    const key = cssPropertyKey(declaration.prop);
    const current = winners.get(key);
    if (!current || declaration.important || !current.important) {
      winners.set(key, declaration);
    }
  }
  return Array.from(winners.values());
}

function serializeStyleDeclarations(
  parsed: ParsedStyleDeclarations | Array<{ property: string; value: string }>,
): string {
  return Array.isArray(parsed)
    ? createStyleDeclarations(parsed).root.toString()
    : parsed.root.toString();
}

function createStyleDeclarations(
  declarations: Array<{ property: string; value: string }>,
): ParsedStyleDeclarations {
  const parsed = parseStyleDeclarations(null);
  for (const [index, declaration] of declarations.entries()) {
    parsed.root.append({
      prop: declaration.property,
      value: declaration.value,
    });
    const appended = parsed.root.nodes?.[parsed.root.nodes.length - 1];
    if (appended?.type === "decl") {
      appended.raws.before = index === 0 ? "" : " ";
      appended.raws.between = ": ";
    }
  }
  parsed.declarations = (parsed.root.nodes ?? []).filter(
    (node): node is Declaration => node.type === "decl",
  );
  return parsed;
}

function setStyleDeclaration(
  parsed: ParsedStyleDeclarations,
  property: string,
  value: string,
): void {
  const requestedDeclarations = parseStyleDeclarations(
    `${property}: ${value}`,
  ).declarations;
  const requested = requestedDeclarations[0];
  if (
    requestedDeclarations.length !== 1 ||
    !requested ||
    cssPropertyKey(requested.prop) !== cssPropertyKey(property)
  ) {
    throw new InvalidInlineStyleError(
      0,
      `expected one declaration for ${property}`,
    );
  }
  const key = cssPropertyKey(property);
  if (key === "grid-column") {
    removeStyleDeclarations(parsed, ["grid-column-start", "grid-column-end"]);
  } else if (key === "grid-row") {
    removeStyleDeclarations(parsed, ["grid-row-start", "grid-row-end"]);
  }
  const matches = parsed.declarations.filter(
    (declaration) => cssPropertyKey(declaration.prop) === key,
  );
  const existing = matches.reduce<Declaration | undefined>(
    (winner, declaration) =>
      !winner || declaration.important || !winner.important
        ? declaration
        : winner,
    undefined,
  );
  if (existing) {
    existing.value = requested.value;
    existing.important = existing.important || requested.important;
    existing.raws.value = undefined;
    existing.raws.between = ": ";
    if (existing.important) existing.raws.important = " !important";
    return;
  }
  parsed.root.append({
    prop: property,
    value: requested.value,
    important: requested.important,
  });
  const appended = parsed.root.nodes?.[parsed.root.nodes.length - 1];
  if (appended?.type === "decl") {
    appended.raws.before = parsed.declarations.length === 0 ? "" : " ";
    appended.raws.between = ": ";
    if (appended.important) appended.raws.important = " !important";
    parsed.declarations.push(appended);
  }
}

function removeStyleDeclarations(
  parsed: ParsedStyleDeclarations,
  properties: readonly string[],
): void {
  const toRemove = new Set(properties.map(cssPropertyKey));
  parsed.declarations = parsed.declarations.filter((declaration) => {
    if (!toRemove.has(cssPropertyKey(declaration.prop))) return true;
    declaration.remove();
    return false;
  });
}

function normalizeStyleProperty(property: string): VisualStyleProperty | null {
  const normalized =
    STYLE_PROPERTY_ALIASES[property] ??
    (property.startsWith("--")
      ? property
      : property
          .replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)
          .toLowerCase());
  if (!STYLE_PROPERTY_SET.has(normalized)) return null;
  return normalized as VisualStyleProperty;
}

/**
 * `background-image` is the one property where `url(...)` is a legitimate,
 * expected value (image fills — see `ImageFillControls`/
 * `imageFillToBackgroundStyles`). Every `url(...)` reference in the value is
 * checked with the same scheme allowlist the breakpoint-scoped media-block
 * path uses (`isSafeCssUrlReference`, which itself rejects control
 * characters and `<>"'`): http(s), protocol-relative, relative/root paths,
 * and `data:image/...` are allowed; `javascript:` and other non-image
 * schemes are not. The `background` shorthand is deliberately NOT included
 * here — keep it on the strict no-url path below.
 *
 * A `data:image/...` URI legitimately contains a `;` before `base64,`, so a
 * validated `url(...)` is excised before the generic `<>{};` breakout check
 * below runs — that check only ever sees the CSS around the reference.
 */
function isSafeBackgroundImageValue(value: string): string | false {
  URL_IN_VALUE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let withoutValidatedParts = "";
  while ((match = URL_IN_VALUE_RE.exec(value))) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    if (!isSafeCssUrlReference(raw)) return false;
    withoutValidatedParts += value.slice(lastIndex, match.index);
    lastIndex = URL_IN_VALUE_RE.lastIndex;
  }
  withoutValidatedParts += value.slice(lastIndex);
  // Anything left that still looks like "url(" wasn't matched by the
  // well-formed pattern above (malformed/unterminated) — reject.
  if (/url\s*\(/i.test(withoutValidatedParts)) return false;
  return withoutValidatedParts;
}

function isSafeStyleValue(
  property: VisualStyleProperty,
  value: string,
): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (property === "--an-vector-stroke-position") {
    return ["inside", "center", "outside"].includes(trimmed);
  }
  if (isVectorEndpointProperty(property)) {
    return isVectorEndpointStyle(trimmed);
  }
  if (/expression\s*\(/i.test(trimmed)) return false;
  if (/javascript\s*:/i.test(trimmed)) return false;
  if (/url\s*\(/i.test(trimmed)) {
    if (property !== "background-image") return false;
    const withoutValidatedUrls = isSafeBackgroundImageValue(trimmed);
    if (withoutValidatedUrls === false) return false;
    if (/[<>{};]/.test(withoutValidatedUrls)) return false;
  } else if (/[<>{};]/.test(trimmed)) {
    return false;
  }
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
      "-webkit-box",
      "-webkit-inline-box",
      "initial",
      "inherit",
      "unset",
      "revert",
      "revert-layer",
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

/** Index just past the `>` ending the tag at `start`, or -1 if none precedes
 *  `end`. A `>` inside a quoted attribute (`filter(a => b)`, `x-show="n > 0"`)
 *  does not end the tag. */
function findHtmlTagEnd(
  html: string,
  start: number,
  end = html.length,
): number {
  let quote: '"' | "'" | null = null;
  for (let index = start; index < end; index += 1) {
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
  return -1;
}

// Depth-aware closing-tag scan: used for NON_VISUAL_TAGS (script/style/
// template/etc) whose interiors are skipped wholesale rather than descended
// into by the main parser loop. A naive "first </tag> after `from`" search
// (the previous implementation) breaks the moment the same tag nests inside
// itself — e.g. `<template x-if><ul><template x-for>…</template></ul>
// </template>` (a completely ordinary Alpine x-if-wrapping-x-for pattern) —
// because it matches the INNER `</template>` and resumes the main loop right
// after it, leaving the outer element's true `</ul></template>` closes to be
// mis-parsed as stray/unmatched tags against whatever unrelated element is
// on the stack. That corrupted contentEnd tracking for enclosing elements
// (observed: body-append/insertion offsets computed from the wrong node,
// splicing moved content into template interiors). Track same-tag open/close
// depth so only the tag that actually balances the ORIGINAL opening tag is
// returned, matching real nested-template documents correctly.
function findClosingTag(
  html: string,
  tag: string,
  from: number,
): { closeStart: number; closeEnd: number } | null {
  const tagRe = new RegExp(`<(\\/?)\\s*${tag}\\b[^>]*>`, "gi");
  tagRe.lastIndex = from;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html))) {
    const isClose = match[1] === "/";
    const selfClosing = !isClose && /\/\s*>$/.test(match[0]);
    if (isClose) {
      if (depth === 0) {
        return {
          closeStart: match.index,
          closeEnd: match.index + match[0].length,
        };
      }
      depth -= 1;
    } else if (!selfClosing) {
      depth += 1;
    }
    // Guard against zero-length matches causing an infinite loop (not
    // expected given the tag-name-anchored pattern, but cheap to keep safe).
    if (tagRe.lastIndex === match.index) {
      tagRe.lastIndex += 1;
    }
  }
  return null;
}

// Defense-in-depth safety net for moveNodeBetweenDocuments: `<template>`
// interiors (x-if/x-for/x-show templates and friends) are opaque to
// parseHtmlElements (NON_VISUAL_TAGS) and, per the DOM spec, live in a
// detached DocumentFragment (`template.content`) — a node inserted into a
// template's raw markup range renders nowhere, can't be selected/queried by
// the runtime DOM, and is invisible to every downstream querySelector-based
// pass (getElementInfo, setAbsolutePositioningForNodeInHtml, etc). A correct
// findClosingTag (see above) prevents the offset MISCALCULATION that used to
// cause this, but this function is kept as an independent second guard —
// even if some other insertion-point calculation ever computes an offset
// that lands inside a real `<template>` block, this catches it and callers
// redirect to a real DOM slot instead of silently splicing into markup that
// will never render or be selectable again.
//
// Finding 8: when it fires, callers used to always redirect to the end of
// <body> (or end of document) — a silent teleport that can land an anchored
// insert far from where the user was working. `findEnclosingTemplateClose`
// below returns the ENCLOSING outer template's closeEnd position (the
// offset immediately after its `</template>`) when `offset` is inside a
// template interior, so callers can redirect there instead: still a
// guaranteed-safe real-DOM slot (immediately after a closing tag, a sibling
// of the template rather than jumping to doc end), just much closer to the
// anchor the caller actually asked for.
function isOffsetInsideTemplateInterior(html: string, offset: number): boolean {
  return findEnclosingTemplateClose(html, offset) !== null;
}

// Exported ONLY for the finding-8 redirect-target unit test below: with
// findClosingTag's offset-miscalculation bug fixed (see the doc comment
// above), every insertAt this module's own callers compute through
// parseHtmlElements-derived positions (anchor.start/end/contentEnd,
// bodyEl.contentEnd) already lands OUTSIDE template interiors in practice —
// NON_VISUAL_TAGS like <template> are skipped wholesale, so a template can
// never itself become part of another element's registered content range.
// That makes this guard a true defense-in-depth backstop with no reachable
// integration-level repro through moveNodeBetweenDocuments today; testing
// the redirect target directly against a synthetic offset is the honest way
// to pin its behavior instead of contriving a fragile call into the guard.
export function findEnclosingTemplateClose(
  html: string,
  offset: number,
): { closeEnd: number } | null {
  const templateOpenRe = /<template\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = templateOpenRe.exec(html))) {
    const openEnd = match.index + match[0].length;
    if (openEnd > offset) break;
    const close = findClosingTag(html, "template", openEnd);
    const contentEnd = close ? close.closeStart : html.length;
    // `openEnd` IS the first content position, so a strict `>` missed the
    // most likely insertion point of all: before the template's first child.
    if (offset >= openEnd && offset <= contentEnd) {
      return { closeEnd: close ? close.closeEnd : html.length };
    }
    templateOpenRe.lastIndex = close ? close.closeEnd : html.length;
  }
  return null;
}

function parseHtmlElements(html: string): ParsedElement[] {
  const elements: ParsedElement[] = [];
  const stack: number[] = [];
  const sameTypeCounts = new Map<string, number>();
  const tagRe =
    /<!--[\s\S]*?-->|<![A-Za-z][^>]*>|<\/?\s*([A-Za-z][A-Za-z0-9:-]*)\b/g;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(html))) {
    let raw = match[0];
    if (!raw.startsWith("<!")) {
      const tagEnd = findHtmlTagEnd(html, match.index);
      raw = html.slice(match.index, tagEnd === -1 ? html.length : tagEnd);
    }
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

function selectorPart(
  element: ParsedElement,
  elements: ParsedElement[],
): string {
  const dataSelector = candidateDataSelector(element);
  if (dataSelector) {
    const sameTypeSibling = elements.some(
      (sibling) =>
        sibling.index !== element.index &&
        sibling.parentIndex === element.parentIndex &&
        sibling.tag === element.tag,
    );
    const nth = sameTypeSibling ? `:nth-of-type(${element.nthOfType})` : "";
    return `${element.tag}${dataSelector.selector}${nth}`;
  }

  const id = attributeValue(element, "id");
  const escapedId = id ? cssIdent(id) : null;
  if (escapedId) {
    const duplicateId = elements.some(
      (candidate) =>
        candidate.index !== element.index &&
        attributeValue(candidate, "id") === id,
    );
    return duplicateId
      ? `${element.tag}#${escapedId}:nth-of-type(${element.nthOfType})`
      : `#${escapedId}`;
  }

  const safeClasses = classList(element)
    .map(cssIdent)
    .filter((value): value is string => Boolean(value))
    .slice(0, 2);
  const classes = safeClasses.map((value) => `.${value}`).join("");
  const nth = element.nthOfType > 1 ? `:nth-of-type(${element.nthOfType})` : "";
  return `${element.tag}${classes}${nth}`;
}

const pathSelectors = new WeakMap<ParsedElement, string>();

// Extends the nearest ancestor's path: every node's id and path read it, and
// rebuilding it from the root each time is quadratic in depth.
function pathSelector(
  element: ParsedElement,
  elements: ParsedElement[],
): string {
  const uncached: ParsedElement[] = [];
  let path = "";
  let current: ParsedElement | undefined = element;
  while (current) {
    const cached = pathSelectors.get(current);
    if (cached !== undefined) {
      path = cached;
      break;
    }
    uncached.push(current);
    current =
      current.parentIndex === undefined
        ? undefined
        : elements[current.parentIndex];
  }
  for (let index = uncached.length - 1; index >= 0; index -= 1) {
    const part = selectorPart(uncached[index]!, elements);
    path = path ? `${path} > ${part}` : part;
    pathSelectors.set(uncached[index]!, path);
  }
  return path;
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
  return `html:${hashStable(`${sourceKey}:${path}`)}`;
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
  const parsedInlineStyle = readStyleDeclarations(
    attributeValue(element, "style") ?? "",
  );
  for (const declaration of "invalid" in parsedInlineStyle
    ? []
    : effectiveStyleDeclarations(parsedInlineStyle)) {
    const property = normalizeStyleProperty(declaration.prop);
    if (!property) continue;
    const value = styleDeclarationValue(declaration);
    tokens.push({
      property,
      value,
      token: `${declaration.prop}: ${value}`,
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

interface ElementTextRead {
  /** Collapsed text, cut short once past the 160 characters a snippet keeps. */
  text: string;
  pendingSpace: boolean;
  /** False when a tag ran past the content end, so an ancestor reading the
   *  same bytes would split them differently and cannot reuse this read. */
  reusable: boolean;
}

const elementTextReads = new WeakMap<ParsedElement, ElementTextRead>();

// Equals collapseWhitespace(decodeBasicHtmlEntities(<content with every tag
// replaced by a space>)). Decoding run by run is equivalent because no entity
// spans the space a tag leaves. A child's read is reused rather than re-read:
// every ancestor's content contains its descendants', so re-reading is
// quadratic in nesting depth.
function readElementText(
  html: string,
  element: ParsedElement,
  elements: readonly ParsedElement[],
): ElementTextRead {
  const cached = elementTextReads.get(element);
  if (cached) return cached;
  let text = "";
  let pendingSpace = false;
  let reusable = true;
  const append = (run: string) => {
    const collapsed = decodeBasicHtmlEntities(run).replace(/\s+/g, " ");
    const trimmed = collapsed.trim();
    if (!trimmed) {
      if (collapsed) pendingSpace = true;
      return;
    }
    if (text && (pendingSpace || collapsed.startsWith(" "))) text += " ";
    text += trimmed;
    pendingSpace = collapsed.endsWith(" ");
  };
  const end = element.contentEnd;
  let index = element.contentStart;
  let childAt = 0;
  while (index < end && text.length <= 160) {
    const open = html.indexOf("<", index);
    if (open === -1 || open >= end) {
      append(html.slice(index, end));
      break;
    }
    append(html.slice(index, open));
    pendingSpace = true;
    let child: ParsedElement | undefined;
    while (childAt < element.childIndexes.length) {
      child = elements[element.childIndexes[childAt]!];
      if (!child || child.start >= open) break;
      childAt += 1;
    }
    if (child?.start === open && child.openEnd < end) {
      childAt += 1;
      const inner = child.selfClosing
        ? null
        : readElementText(html, child, elements);
      if (inner?.reusable && child.contentEnd <= end) {
        if (inner.text) {
          text = text ? `${text} ${inner.text}` : inner.text;
          pendingSpace = inner.pendingSpace;
        }
        index = child.contentEnd;
      } else {
        index = child.openEnd;
      }
      continue;
    }
    const tagEnd = findHtmlTagEnd(html, open, end);
    if (tagEnd === -1) {
      reusable = false;
      break;
    }
    index = tagEnd;
  }
  const read = { text, pendingSpace, reusable };
  elementTextReads.set(element, read);
  return read;
}

function textSnippetFor(
  html: string,
  element: ParsedElement,
  elements: readonly ParsedElement[],
): string | null {
  if (element.selfClosing) return null;
  const { text } = readElementText(html, element, elements);
  if (!text) return null;
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

/**
 * Text this element paints itself, ignoring anything a child holds. A row of
 * dot + label + checkbox paints nothing, so it is a container even though its
 * tag is one that usually carries text.
 */
function paintsOwnTextFor(
  html: string,
  element: ParsedElement,
  elements: readonly ParsedElement[],
): boolean {
  if (element.selfClosing) return false;
  let at = element.contentStart;
  for (const childIndex of element.childIndexes) {
    const child = elements[childIndex];
    if (!child) continue;
    if (html.slice(at, child.start).trim()) return true;
    at = Math.max(at, child.end);
  }
  return Boolean(html.slice(at, element.contentEnd).trim());
}

function wholeTextStyleRootFor(
  html: string,
  element: ParsedElement,
  elements: readonly ParsedElement[],
): boolean {
  if (
    element.tag === "html" ||
    element.tag === "body" ||
    attributeValue(element, "data-agent-native-group") === "true" ||
    attributeValue(element, "data-an-primitive") === "frame"
  ) {
    return false;
  }
  if (attributeValue(element, "data-an-primitive") === "text") {
    return Boolean(textSnippetFor(html, element, elements));
  }
  if (
    !paintsOwnTextFor(html, element, elements) &&
    !INLINE_TEXT_STYLE_ROOT_TAGS.has(element.tag)
  ) {
    return false;
  }
  if (!textSnippetFor(html, element, elements)) return false;

  const stack = [...element.childIndexes];
  while (stack.length > 0) {
    const child = elements[stack.pop()!];
    if (!child || !INLINE_TEXT_STYLE_ROOT_TAGS.has(child.tag)) return false;
    stack.push(...child.childIndexes);
  }
  return true;
}

/** The `x-for` of the nearest enclosing template, for a node inside a repeat. */
function repeatXForFor(
  element: ParsedElement,
  elements: readonly ParsedElement[],
): string | null {
  let at = element.parentIndex;
  while (at !== undefined) {
    const ancestor = elements[at];
    if (!ancestor) return null;
    if (ancestor.tag === "template") {
      const xFor = ancestor.attributes.find(
        (attribute) => attribute.name === "x-for",
      );
      if (xFor && typeof xFor.value === "string") return xFor.value;
    }
    at = ancestor.parentIndex;
  }
  return null;
}

function layerNameFor(
  html: string,
  element: ParsedElement,
  elements: readonly ParsedElement[],
): {
  name: string;
  source: CodeLayerNode["layerNameSource"];
  attribute?: string;
} {
  const explicit = explicitLayerNameFor(element);
  if (explicit) return explicit;

  const semantic = semanticLayerNameFor(element);
  if (semantic) return semantic;

  const textName = () => {
    const text = textSnippetFor(html, element, elements);
    return text
      ? { name: truncateLayerName(text), source: "text" as const }
      : null;
  };

  // A leaf is named by what it says; a container by what it is. Reversing this
  // is how a wrapper ends up named after its entire subtree's text.
  if (element.childIndexes.length === 0) {
    const leafName = textName();
    if (leafName) return leafName;
  }

  const identifier = identifierLayerNameFor(element);
  if (identifier) return identifier;

  const inlineOnly = element.childIndexes.every((index) => {
    const child = elements[index];
    return Boolean(
      child &&
      INLINE_TEXT_TAGS.has(child.tag) &&
      child.childIndexes.length === 0,
    );
  });
  const facts = visualFactsOfElement(element);
  if (
    TEXT_LAYER_TAGS.has(element.tag) &&
    inlineOnly &&
    !facts.painted &&
    !facts.padded
  ) {
    const richTextName = textName();
    if (richTextName) return richTextName;
  }

  return { name: fallbackTagLayerName(element.tag), source: "tag" };
}

function treeTypeForNode(
  node: CodeLayerNode,
  nodesById: ReadonlyMap<string, CodeLayerNode>,
): CodeLayerTreeNodeType {
  if (node.dataAttributes["data-agent-native-group"] === "true") {
    return "group";
  }
  // Canvas primitives (drawn shapes / board objects) carry their kind via
  // data-an-primitive so the layers panel shows a true shape/text/frame icon
  // instead of the generic code glyph. The marker wins over tag heuristics:
  // these primitives are <div>s, which would otherwise classify as "element".
  const primitiveKind = node.dataAttributes["data-an-primitive"];
  if (primitiveKind) {
    if (primitiveKind === "text") return "text";
    if (primitiveKind === "frame") return "frame";
    if (primitiveKind === "image") return "image";
    if (primitiveKind === "boolean") return "group";
    if (primitiveKind === "boolean-operand") {
      return node.dataAttributes["data-an-boolean-shape"] === "ellipse"
        ? "ellipse"
        : "shape";
    }
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
  if (IMAGE_LAYER_TAGS.has(node.tag)) return "image";
  if (SHAPE_LAYER_TAGS.has(node.tag)) return "shape";
  // A node annotated as a component instance is always classified as "component"
  // regardless of its tag — this is the canonical detection path.
  if (node.componentInstance) return "component";
  // Form controls are leaf widgets with no design primitive to decompose into.
  if (COMPONENT_LAYER_TAGS.has(node.tag) && node.tag !== "button") {
    return "component";
  }

  const facts = visualFactsFor(node);
  const childNodes = node.children
    .map((id) => nodesById.get(id))
    .filter((child): child is CodeLayerNode => Boolean(child));

  if (childNodes.length === 0) {
    // A Text node's fill colours glyphs, not a background, so a painted or
    // padded text leaf must be a frame or it loses its box (see buildSpec).
    if (node.textSnippet) {
      return facts.painted || facts.padded ? "frame" : "text";
    }
    if (facts.painted && facts.sized)
      return facts.circular ? "ellipse" : "shape";
    return "element";
  }

  if (
    TEXT_LAYER_TAGS.has(node.tag) &&
    !facts.painted &&
    !facts.padded &&
    childNodes.every(
      (child) => INLINE_TEXT_TAGS.has(child.tag) && child.children.length === 0,
    )
  ) {
    return "text";
  }

  if (node.layout.isFlexContainer || node.layout.isGridContainer) {
    return "frame";
  }
  if (facts.painted || facts.padded) return "frame";
  return "group";
}

const GENERIC_TAG_LAYER_NAMES = new Set(["Frame", "Text"]);

const TYPE_DISPLAY_NAMES: Partial<Record<CodeLayerTreeNodeType, string>> = {
  ellipse: "Ellipse",
  frame: "Frame",
  group: "Group",
  shape: "Rectangle",
  text: "Text",
};

/**
 * An element carrying only utility classes has no name of its own, and the tag
 * fallback describes the tag rather than what the element resolved to — every
 * bare `<div>` reads "Frame" whether it became a frame, a dot, or a divider.
 */
function unnamedLayerName(
  node: CodeLayerNode,
  type: CodeLayerTreeNodeType,
): string | null {
  if (node.layerNameSource !== "tag") return null;
  if (!GENERIC_TAG_LAYER_NAMES.has(node.layerName)) return null;
  return TYPE_DISPLAY_NAMES[type] ?? null;
}

function isCollapsibleDocumentShellNode(node: CodeLayerTreeNode): boolean {
  // A screen IS its document: the frame's box comes from the board and its
  // paint from this <body>, and the inspector now shows both on the screen's
  // own selection. Older screens stamped the screen title onto <body>, which
  // exempted them here and listed the same object twice under one name.
  return node.tag === "html" || node.tag === "body";
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
    const promotedNodes = isCollapsibleDocumentShellNode(compactedNode)
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
  let insideSvgResource = SVG_RESOURCE_TAGS.has(element.tag);
  const isBooleanOperand =
    element.tag === "svg" &&
    attributeValue(element, "data-an-primitive") === "boolean-operand";
  let insideBoolean = false;
  let parentIndex = element.parentIndex;
  while (parentIndex !== undefined) {
    const parent = elements[parentIndex];
    if (!parent) break;
    if (SVG_RESOURCE_TAGS.has(parent.tag)) insideSvgResource = true;
    if (parent.tag === "svg") {
      if (attributeValue(parent, "data-an-primitive") === "pasted-svg") {
        return insideSvgResource;
      }
      if (
        isBooleanOperand &&
        attributeValue(parent, "data-an-primitive") === "boolean"
      ) {
        insideBoolean = true;
      } else {
        return true;
      }
    }
    parentIndex = parent.parentIndex;
  }
  return isBooleanOperand ? !insideBoolean : false;
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
    const styleAttribute = getAttribute(element, "style");
    if (!styleAttribute || typeof styleAttribute.value !== "string") continue;
    // Decoded like every edit path reads it: the raw `&quot;SF Pro&quot;` a
    // serializer writes for a quoted font family is not malformed CSS.
    const parsed = readStyleDeclarations(
      decodeBasicHtmlEntities(styleAttribute.value),
    );
    if ("invalid" in parsed) {
      diagnostics.push({
        severity: "warning",
        code: "invalid-inline-style",
        message: parsed.invalid,
        span: { start: styleAttribute.start, end: styleAttribute.end },
      });
    }
  }
  const candidateNodeIdByElementIndex = new Map<number, string>();
  const candidateNodeIdCounts = new Map<string, number>();

  for (const element of elements) {
    if (NON_VISUAL_TAGS.has(element.tag)) continue;
    if (TRANSPARENT_TAGS.has(element.tag)) continue;
    if (hasSvgAncestor(element, elements)) continue;
    const nodeId = nodeIdFor(element, elements, source);
    candidateNodeIdByElementIndex.set(element.index, nodeId);
    candidateNodeIdCounts.set(
      nodeId,
      (candidateNodeIdCounts.get(nodeId) ?? 0) + 1,
    );
  }

  const usedNodeIds = new Set(
    Array.from(candidateNodeIdCounts)
      .filter(([, count]) => count === 1)
      .map(([nodeId]) => nodeId),
  );
  for (const element of elements) {
    const candidateId = candidateNodeIdByElementIndex.get(element.index);
    if (!candidateId) continue;
    if (candidateNodeIdCounts.get(candidateId) === 1) {
      nodeIdByElementIndex.set(element.index, candidateId);
      continue;
    }

    const disambiguator = pathSelector(element, elements);
    const baseId = `html:${hashStable(`${candidateId}:duplicate:${disambiguator}`)}`;
    let nodeId = baseId;
    let suffix = 1;
    while (usedNodeIds.has(nodeId)) {
      nodeId = `${baseId}:${suffix}`;
      suffix += 1;
    }
    usedNodeIds.add(nodeId);
    nodeIdByElementIndex.set(element.index, nodeId);
  }

  // A transparent ancestor has no id, so its children would come back as
  // roots. Re-parent them to the nearest ancestor that IS projected.
  const projectedParentIndex = (element: ParsedElement): number | undefined => {
    let at = element.parentIndex;
    while (at !== undefined && !nodeIdByElementIndex.has(at)) {
      at = elements[at]?.parentIndex;
    }
    return at;
  };

  const elementByNodeId = new Map<string, ParsedElement>();

  for (const element of elements) {
    const nodeId = nodeIdByElementIndex.get(element.index);
    if (!nodeId) continue;

    const parentIndex = projectedParentIndex(element);
    const parent =
      parentIndex === undefined ? undefined : elements[parentIndex];
    const parentId =
      parentIndex === undefined
        ? undefined
        : nodeIdByElementIndex.get(parentIndex);
    const selector = primarySelector(element, elements);
    const path = pathSelector(element, elements);
    const classes = classList(element);
    const style = withVectorPaintStyle(
      element,
      elements,
      parseStyle(attributeValue(element, "style")),
    );
    const dataAttributes = dataAttributeRecord(element);
    const layerName = layerNameFor(html, element, elements);
    // Only alias attribute selectors that are actually STABLE, UNIQUE node
    // identifiers (data-agent-native-node-id, data-code-layer-id, etc). Every
    // other data-* attribute (e.g. data-an-primitive="frame", or the boolean
    // data-agent-native-locked/hidden state flags) is shared by many/most
    // nodes of the same kind, not a per-node identity marker. Aliasing those
    // here previously let a single hidden/locked layer's `hiddenSelectors`/
    // `lockedSelectors` (built from these aliases — see
    // codeLayerSelectorAliases in design-editor/code-layer-state.ts) resolve
    // to `[data-an-primitive="frame"]` and silently hide/lock EVERY frame-kind
    // container in the document via applyHiddenSelectors' document-wide
    // querySelectorAll, instead of only the one node the user actually hid or
    // locked.
    const selectors = Array.from(
      new Set([
        selector.selector,
        path,
        ...STABLE_NODE_ID_ATTRIBUTES.filter((name) => dataAttributes[name]).map(
          (name) => `[${name}="${cssEscape(dataAttributes[name]!)}"]`,
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
      textSnippet: textSnippetFor(html, element, elements),
      paintsOwnText: paintsOwnTextFor(html, element, elements),
      wholeTextStyleRoot: wholeTextStyleRootFor(html, element, elements),
      repeatXFor: repeatXForFor(element, elements),
      style,
      styleTokens: styleTokensFor(element),
      parentId,
      children: [],
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

  const childIdsByParentId = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const childIds = childIdsByParentId.get(node.parentId) ?? [];
    childIds.push(node.id);
    childIdsByParentId.set(node.parentId, childIds);
  }
  for (const node of nodes) {
    node.children = childIdsByParentId.get(node.id) ?? [];
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
    elements,
  };
}

/**
 * Most-recently-used projections, keyed by the exact document they came from.
 *
 * Projecting means a full HTML parse plus a tree walk, and the editor calls
 * this on nearly every selection and content change from dozens of call sites —
 * repeatedly, synchronously, on the main thread, for documents that have not
 * changed. That is the canvas "freezing while just clicking" and the sluggish
 * cursor.
 *
 * Keyed on the whole HTML string rather than a hash on purpose: a 32-bit hash
 * collision would hand a caller a confidently wrong layer tree, and every
 * id-keyed edit downstream would target the wrong node. The string is already
 * retained by the file/query cache, so the key costs a reference, not a copy.
 *
 * Bounded by source size, not entry count: the editor projects every screen of
 * a design in one pass, so any count below the screen count misses on every
 * screen of the next pass. A projection retains about 6 bytes per source char,
 * plus a few KB however small its document, so each entry is also charged a
 * floor — an empty document would otherwise cost nothing and never evict.
 *
 * Callers must treat the result as read-only — it is shared now. Every consumer
 * only reads (`find`/`filter`/`map`); `applyCodeLayer*`-style writers build new
 * HTML and re-project rather than editing a projection in place.
 */
const PROJECTION_CACHE_MAX_CHARS = 16_000_000;
const PROJECTION_CACHE_ENTRY_FLOOR_CHARS = 2_048;
const projectionCache = new Map<string, Map<string, CodeLayerProjection>>();
let projectionCacheChars = 0;

function projectionCacheEntryChars(html: string, sourceKey: string): number {
  return html.length + sourceKey.length + PROJECTION_CACHE_ENTRY_FLOOR_CHARS;
}

/** Every own field of the source, sorted, so adding a field to
 *  CodeLayerSource later cannot silently start returning a projection whose
 *  `.source` came from a different call. */
function projectionSourceKey(source: CodeLayerSource): string {
  const record = source as unknown as Record<string, unknown>;
  return Object.keys(source)
    .sort()
    .map((field) => {
      const value = record[field];
      const serialized =
        typeof value === "string" ? value : (JSON.stringify(value) ?? "");
      return `${field}=${serialized}`;
    })
    .join("\u0000");
}

export function buildCodeLayerProjection(
  html: string,
  options: { source?: CodeLayerSource } = {},
): CodeLayerProjection {
  // Defensive: callers (memos/effects) may project before content has loaded
  // (e.g. `activeContent` is briefly undefined on first render). Projecting a
  // non-string must yield an empty projection, never crash the editor.
  const safeHtml = typeof html === "string" ? html : "";
  const source = options.source ?? { kind: "inline-html" };
  const sourceKey = projectionSourceKey(source);
  const bySource = projectionCache.get(safeHtml);
  if (bySource) {
    // Re-insert so both Maps' insertion order stays least-recently-used first.
    projectionCache.delete(safeHtml);
    projectionCache.set(safeHtml, bySource);
    const cached = bySource.get(sourceKey);
    if (cached) {
      bySource.delete(sourceKey);
      bySource.set(sourceKey, cached);
      return cached;
    }
  }
  const projection = buildProjection(safeHtml, source).projection;
  projectionCache.set(
    safeHtml,
    (bySource ?? new Map<string, CodeLayerProjection>()).set(
      sourceKey,
      projection,
    ),
  );
  projectionCacheChars += projectionCacheEntryChars(safeHtml, sourceKey);
  evict: for (const [oldestHtml, oldestBySource] of projectionCache) {
    for (const oldestSourceKey of oldestBySource.keys()) {
      if (
        projectionCacheChars <= PROJECTION_CACHE_MAX_CHARS ||
        (oldestHtml === safeHtml && oldestSourceKey === sourceKey)
      ) {
        break evict;
      }
      oldestBySource.delete(oldestSourceKey);
      projectionCacheChars -= projectionCacheEntryChars(
        oldestHtml,
        oldestSourceKey,
      );
    }
    projectionCache.delete(oldestHtml);
  }
  return projection;
}

/** Drops every cached projection. Exists for tests that assert projection
 *  identity/eviction; production has no reason to call it. */
export function clearCodeLayerProjectionCache(): void {
  projectionCache.clear();
  projectionCacheChars = 0;
}

const TEXT_WRAP_SKIP_TAGS = new Set([
  "option",
  "optgroup",
  "pre",
  "textarea",
  "title",
]);

/**
 * Give every painted or padded text leaf a real `<span>` child so a button
 * projects as a frame wrapping Text. Idempotent: a wrapped element is no
 * longer a leaf. Mixed content is skipped — wrapping the loose runs of
 * `<p>Hi <b>there</b></p>` would turn one sentence into three layers.
 */
export function wrapBareTextLeavesInHtml(
  html: string,
  options: {
    source?: CodeLayerSource;
    targetNodeIds?: readonly string[];
    onSourceEdit?: (edit: CodeLayerSourceEdit) => void;
  } = {},
): { content: string; changed: boolean; wrapped: number } {
  const projection = buildCodeLayerProjection(html, options);
  const targetNodeIds = options.targetNodeIds
    ? new Set(options.targetNodeIds)
    : null;
  const edits: Array<{ start: number; end: number }> = [];

  for (const node of projection.nodes) {
    if (targetNodeIds && !targetNodeIds.has(node.id)) continue;
    if (node.children.length > 0) continue;
    if (Object.prototype.hasOwnProperty.call(node.attributes, "data-an-text"))
      continue;
    if (!node.textSnippet) continue;
    if (TEXT_WRAP_SKIP_TAGS.has(node.tag)) continue;
    const span = node.source;
    if (
      !span ||
      span.contentStart === undefined ||
      span.contentEnd === undefined ||
      span.contentEnd <= span.contentStart
    ) {
      continue;
    }
    if (!targetNodeIds) {
      const facts = visualFactsFor(node);
      if (!facts.painted && !facts.padded) continue;
    }
    if (/[<>]/.test(html.slice(span.contentStart, span.contentEnd))) continue;
    edits.push({ start: span.contentStart, end: span.contentEnd });
  }

  if (edits.length === 0) return { content: html, changed: false, wrapped: 0 };

  let content = html;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    const replacement = `<span data-an-text>${content.slice(
      edit.start,
      edit.end,
    )}</span>`;
    content = `${content.slice(0, edit.start)}${replacement}${content.slice(
      edit.end,
    )}`;
    options.onSourceEdit?.({
      start: edit.start,
      end: edit.end,
      insertedLength: replacement.length,
    });
  }
  return { content, changed: true, wrapped: edits.length };
}

const STABLE_NODE_ID_ATTRIBUTE_RE =
  /\sdata-agent-native-node-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s/>]+)/gi;

/**
 * True exactly when ensureCodeLayerNodeIdsInHtml would leave `html` unchanged,
 * decided from the parse alone. Building a projection costs several times the
 * parse, and a design already carrying its ids needs no projection to prove it.
 * Must select the same elements as buildProjection and apply the same
 * clean-id test as the loop below; the parity test holds the two together.
 */
export function hasCanonicalCodeLayerNodeIds(html: string): boolean {
  const elements = parseHtmlElements(typeof html === "string" ? html : "");
  const usedIds = new Set<string>();
  for (const element of elements) {
    if (NON_VISUAL_TAGS.has(element.tag)) continue;
    if (TRANSPARENT_TAGS.has(element.tag)) continue;
    if (hasSvgAncestor(element, elements)) continue;
    let existing: string | undefined;
    for (const attr of element.attributes) {
      if (
        attr.lowerName === "data-agent-native-node-id" &&
        typeof attr.value === "string"
      ) {
        existing = attr.value;
      }
    }
    existing = existing?.trim();
    if (!existing || usedIds.has(existing)) return false;
    const openTag = html.slice(element.start, element.openEnd);
    STABLE_NODE_ID_ATTRIBUTE_RE.lastIndex = 0;
    if (!STABLE_NODE_ID_ATTRIBUTE_RE.test(openTag)) return false;
    if (STABLE_NODE_ID_ATTRIBUTE_RE.test(openTag)) return false;
    usedIds.add(existing);
  }
  return true;
}

export function ensureCodeLayerNodeIdsInHtml(
  html: string,
  options: {
    source?: CodeLayerSource;
    onSourceEdit?: (edit: CodeLayerSourceEdit) => void;
  } = {},
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
    options.onSourceEdit?.({
      start: edit.start,
      end: edit.end,
      insertedLength: edit.value.length,
    });
  }
  return { content, changed: true, stamped: orderedEdits.length };
}

export function ensureCodeLayerNodeIdInHtml(
  html: string,
  targetNodeId: string,
  options: {
    source?: CodeLayerSource;
    preferredId?: string;
    selector?: string;
  } = {},
): { content: string; changed: boolean; nodeId?: string } {
  const build = buildProjection(
    html,
    options.source ?? { kind: "inline-html" },
  );
  const resolution = resolveTarget(build, {
    nodeId: targetNodeId,
    ...(options.selector ? { selector: options.selector } : {}),
  });
  const node = resolution.status === "resolved" ? resolution.node : undefined;
  if (!node) return { content: html, changed: false };
  const element = node.source
    ? build.elements.find((candidate) => candidate.start === node.source?.start)
    : undefined;
  if (!element) return { content: html, changed: false };

  const existingId = attributeValue(
    element,
    "data-agent-native-node-id",
  )?.trim();
  const allElements = parseHtmlElements(html);
  const idElements = existingId
    ? allElements.filter(
        (candidate) =>
          attributeValue(candidate, "data-agent-native-node-id") === existingId,
      )
    : [];
  const openTag = html.slice(element.start, element.openEnd);
  const idAttributes = Array.from(
    openTag.matchAll(
      /\sdata-agent-native-node-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s/>]+)/gi,
    ),
  );
  if (existingId && idElements.length === 1 && idAttributes.length === 1) {
    return { content: html, changed: false, nodeId: existingId };
  }

  const usedIds = new Set(
    allElements
      .map((candidate) =>
        attributeValue(candidate, "data-agent-native-node-id")?.trim(),
      )
      .filter((value): value is string => Boolean(value)),
  );
  const baseId =
    options.preferredId?.trim() || stableAttributeValueForNode(node);
  let nodeId = baseId;
  let suffix = 1;
  while (usedIds.has(nodeId)) {
    nodeId = `an-${hashStable(`${baseId}:${suffix}`)}`;
    suffix += 1;
  }

  let nextOpenTag = openTag;
  if (idAttributes.length === 0) {
    const closeIndex = nextOpenTag.trimEnd().endsWith("/>")
      ? nextOpenTag.lastIndexOf("/")
      : nextOpenTag.length - 1;
    nextOpenTag = `${nextOpenTag.slice(0, closeIndex)} data-agent-native-node-id="${escapeHtmlAttribute(nodeId)}"${nextOpenTag.slice(closeIndex)}`;
  } else {
    for (let index = idAttributes.length - 1; index >= 0; index -= 1) {
      const match = idAttributes[index];
      if (!match || match.index === undefined) continue;
      const value =
        index === 0
          ? ` data-agent-native-node-id="${escapeHtmlAttribute(nodeId)}"`
          : "";
      nextOpenTag = `${nextOpenTag.slice(0, match.index)}${value}${nextOpenTag.slice(match.index + match[0].length)}`;
    }
  }

  return {
    content: `${html.slice(0, element.start)}${nextOpenTag}${html.slice(element.openEnd)}`,
    changed: true,
    nodeId,
  };
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
    const explicitLayerName =
      node.layerNameSource === "attribute" ? node.layerName : undefined;
    const type = treeTypeForNode(node, nodesById);
    treeById.set(node.id, {
      id: node.id,
      name:
        explicitLayerName ??
        componentName ??
        unnamedLayerName(node, type) ??
        node.layerName,
      type,
      isNativeTextPrimitive:
        node.dataAttributes["data-an-primitive"] === "text",
      isComponent: treeNodeIsComponent(node),
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
    // Inline runs inside a Text layer are formatting, not layers of their own.
    if (parent.type === "text" && INLINE_TEXT_TAGS.has(node.tag)) continue;
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
/**
 * True when every selector part that loses a `:nth-of-type` still carries a
 * class, id, or attribute qualifier of its own.
 */
function positionStripKeepsEvidence(selector: string): boolean {
  return selector
    .split(">")
    .map((part) => part.trim())
    .filter((part) => /:nth-of-type\(\d+\)/.test(part))
    .every((part) => /[.#[]/.test(part.replace(/:nth-of-type\(\d+\)/g, "")));
}

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
    build.elements.map((element) => [element.index, element]),
  );
  const matchesForSelector = (value: string): CodeLayerNode[] =>
    projection.nodes.filter((node) => {
      return selectorMatches(
        node,
        value,
        elementByNodeId.get(node.id),
        elementByIndex,
      );
    });
  if (target.nodeId) {
    const matches = projection.nodes.filter((candidate) =>
      nodeMatchesStableSourceId(candidate, target.nodeId ?? ""),
    );
    if (matches.length === 1 && matches[0]) {
      return { status: "resolved", node: matches[0] };
    }
    if (matches.length > 1) {
      const selectorMatchesById = target.selector
        ? matchesForSelector(target.selector).filter((candidate) =>
            matches.includes(candidate),
          )
        : [];
      if (selectorMatchesById.length === 1 && selectorMatchesById[0]) {
        return { status: "resolved", node: selectorMatchesById[0] };
      }
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
      // One match is not proof it is the right element. Dropping a position
      // is only safe while the part keeps evidence of its own; a part that
      // degrades to a bare tag was identified by position alone, so its
      // "unique" match is a different sibling — a runtime clone resolving
      // onto the one static row is the reachable case.
      if (!positionStripKeepsEvidence(selectorValue)) {
        return {
          status: "conflict",
          message: `Selector "${selectorValue}" identifies its target only by position, and this source has no such position. Re-select the element to refresh its id.`,
        };
      }
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

export function resolveCodeLayerTarget(
  html: string,
  target: EditIntentTarget,
  options: { source?: CodeLayerSource } = {},
): { projection: CodeLayerProjection; resolution: EditIntentResolution } {
  const build = buildProjection(
    html,
    options.source ?? { kind: "inline-html" },
  );
  return {
    projection: build.projection,
    resolution: resolveTarget(build, target),
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
    paintsOwnText: node.paintsOwnText,
    repeatXFor: node.repeatXFor,
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

/**
 * Migrate generated max-width class tokens in HTML without serializing the
 * document. The existing source parser skips opaque head/script/style text;
 * reverse attribute splices keep every other byte unchanged.
 */
export function migrateMaxWidthClassBoundsInHtml(
  html: string,
  boundMap: ReadonlyMap<number, number | null>,
): string | null {
  if (boundMap.size === 0) return html;
  const updates: Array<{ element: ParsedElement; className: string }> = [];

  for (const element of parseHtmlElements(html)) {
    const currentClass = attributeValue(element, "class");
    if (currentClass === null) continue;
    const nextClass = migrateMaxWidthClassBounds(currentClass, boundMap);
    if (nextClass === null) {
      // coercion-ok: callers treat null as a typed migration refusal.
      return null;
    }
    if (nextClass !== currentClass) {
      updates.push({ element, className: nextClass });
    }
  }

  let nextHtml = html;
  for (let index = updates.length - 1; index >= 0; index -= 1) {
    const update = updates[index];
    if (!update) continue;
    nextHtml = replaceOrInsertAttribute(
      nextHtml,
      update.element,
      "class",
      update.className,
    );
  }
  return nextHtml;
}

function removeAttributeFromHtml(
  html: string,
  element: ParsedElement,
  name: string,
): string {
  const attribute = getAttribute(element, name);
  return attribute
    ? `${html.slice(0, attribute.start)}${html.slice(attribute.end)}`
    : html;
}

function setStyleValue(
  currentStyle: string | null,
  property: VisualStyleProperty,
  value: string,
): string {
  const declarations = parseStyleDeclarations(currentStyle);
  setStyleDeclaration(declarations, property, value);
  return serializeStyleDeclarations(declarations);
}

function lastDeclarationValue(
  parsed: ParsedStyleDeclarations,
  property: string,
): string | undefined {
  const key = cssPropertyKey(property);
  const matches = parsed.declarations.filter(
    (declaration) => cssPropertyKey(declaration.prop) === key,
  );
  return matches[matches.length - 1]?.value;
}

function withBorderAreaFallback(style: string, editedProperty: string): string {
  const parsed = parseStyleDeclarations(style);
  const clip = lastDeclarationValue(parsed, "background-clip") ?? "";
  const plainSize = lastDeclarationValue(parsed, "background-size");
  const aliasSize = lastDeclarationValue(parsed, "-webkit-background-size");
  const hasFallback = aliasSize !== undefined;
  const realSize =
    editedProperty === "background-size"
      ? plainSize
      : (borderAreaSupportedBranch(aliasSize) ?? plainSize);
  const index = borderAreaLayerIndex(clip);
  if (index < 0 && !hasFallback) return style;
  removeStyleDeclarations(parsed, [...BORDER_AREA_FALLBACK_PROPERTIES]);
  if (index < 0) {
    if (realSize) setStyleDeclaration(parsed, "background-size", realSize);
    return serializeStyleDeclarations(parsed);
  }
  const fallback = borderAreaFallback(
    lastDeclarationValue(parsed, "background-image") ?? "",
    realSize ?? "auto",
    index,
  );
  for (const [property, value] of Object.entries(fallback)) {
    setStyleDeclaration(parsed, property, value);
  }
  return serializeStyleDeclarations(parsed);
}

const VECTOR_PAINT_PRIMITIVES = new Set([
  "pasted-svg",
  "path",
  "line",
  "arrow",
  "polygon",
  "star",
  "rect",
  "rectangle",
  "ellipse",
  "circle",
]);

const VECTOR_SHAPE_TAGS = new Set([
  "path",
  "polygon",
  "ellipse",
  "circle",
  "rect",
  "line",
  "polyline",
  "use",
]);

function vectorShapeDescendants(
  element: ParsedElement,
  elements: ParsedElement[],
): ParsedElement[] {
  const pending = [...element.childIndexes].reverse();
  const shapes: ParsedElement[] = [];
  while (pending.length) {
    const childIndex = pending.pop();
    const child = childIndex === undefined ? undefined : elements[childIndex];
    if (!child) continue;
    if (VECTOR_SHAPE_TAGS.has(child.tag)) {
      shapes.push(child);
    } else if (child.tag === "g") {
      for (let index = child.childIndexes.length - 1; index >= 0; index -= 1) {
        const nestedIndex = child.childIndexes[index];
        if (nestedIndex !== undefined) pending.push(nestedIndex);
      }
    }
  }
  return shapes;
}

function uniqueVectorShapeDescendant(
  element: ParsedElement,
  elements: ParsedElement[],
): ParsedElement | null {
  const shapes = vectorShapeDescendants(element, elements);
  return shapes.length === 1 ? (shapes[0] ?? null) : null;
}

function vectorShapeOwnerSvg(
  shape: ParsedElement,
  elements: ParsedElement[],
): ParsedElement | null {
  let parentIndex = shape.parentIndex;
  let nearestSvg: ParsedElement | null = null;
  while (parentIndex !== undefined) {
    const parent = elements[parentIndex];
    if (!parent) return null;
    if (parent.tag === "svg") {
      if (attributeValue(parent, "data-an-primitive") === "pasted-svg") {
        return parent;
      }
      nearestSvg ??= parent;
    }
    parentIndex = parent.parentIndex;
  }
  return nearestSvg;
}

const VECTOR_PAINT_PROPERTIES = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
] as const;

const VECTOR_STROKE_POSITION = "data-an-vector-stroke-position";
export const PEN_CORNER_RADIUS_ATTRIBUTE = "data-an-corner-radius";
const VECTOR_STROKE_GRADIENT_PROPERTY = "--an-vector-stroke-gradient";
const CSS_BORDER_GRADIENT_PROPERTY = "--an-css-border-gradient";
const CSS_BORDER_SOLID_COLOR_PROPERTY = "--an-css-border-solid-color";

function cssBorderShorthandParts(value: string | undefined) {
  if (!value) return null;
  const width = value.match(
    /(?:^|\s)((?:thin|medium|thick|(?:\d*\.)?\d+(?:px|em|rem|pt|pc|in|cm|mm|q|ex|ch|vw|vh|vmin|vmax)?))(?=\s|$)/i,
  )?.[1];
  const style = value.match(/(?:^|\s)(solid)(?=\s|$)/i)?.[1];
  if (!width || !style) return null;
  const color = value
    .replace(new RegExp(`(?:^|\\s)${width}(?=\\s|$)`, "i"), " ")
    .replace(/(?:^|\s)solid(?=\s|$)/i, " ")
    .trim();
  return color ? { width, style, color } : null;
}
const VECTOR_STROKE_GRADIENT_MARKER = "data-an-vector-stroke-gradient";
const VECTOR_FILL_GRADIENT_PROPERTY = "--an-vector-fill-gradient";
const VECTOR_FILL_GRADIENT_MARKER = "data-an-vector-fill-gradient";
const VECTOR_STROKE_OVERLAY = "data-an-vector-stroke-overlay";
const VECTOR_STROKE_LOGICAL_WIDTH = "data-an-vector-logical-width";
const VECTOR_STROKE_GENERATED_DEFS = "data-an-vector-stroke-defs";
const VECTOR_STROKE_GEOMETRY = "data-an-vector-stroke-geometry";
const VECTOR_STROKE_ORIGINAL_OVERFLOW =
  "data-an-vector-stroke-original-overflow";
const VECTOR_STROKE_ORIGINAL_OVERFLOW_PRIORITY =
  "data-an-vector-stroke-original-overflow-priority";

function vectorStrokeOverlay(
  element: ParsedElement,
  elements: ParsedElement[],
): ParsedElement | null {
  if (element.tag !== "svg") return null;
  for (const childIndex of element.childIndexes) {
    const child = elements[childIndex];
    if (child?.tag === "use" && getAttribute(child, VECTOR_STROKE_OVERLAY)) {
      return child;
    }
  }
  return null;
}

function vectorStyleValue(
  element: ParsedElement,
  property: string,
): string | null {
  return (
    parseStyle(attributeValue(element, "style"))[property] ??
    attributeValue(element, property)
  );
}

function scaledSvgLength(value: string, scale: number): string | null {
  const match = value
    .trim()
    .match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))([a-z%]*)$/i);
  if (!match) return scale === 1 ? value : null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  return `${number * scale}${match[2]}`;
}

function vectorStrokeGeometryMarkup(
  shape: ParsedElement,
  id: string,
  transform?: Pick<
    StyleEditIntent,
    "transform" | "transformOrigin" | "transformBox"
  >,
): string {
  const attributes = [
    `id="${escapeHtmlAttribute(id)}"`,
    `${VECTOR_STROKE_GEOMETRY}=""`,
  ];
  const hasComputedTransform = Boolean(
    transform?.transform ||
    transform?.transformOrigin ||
    transform?.transformBox,
  );
  for (const attribute of shape.attributes) {
    if (
      ![
        "d",
        "points",
        "x",
        "y",
        "width",
        "height",
        "rx",
        "ry",
        "cx",
        "cy",
        "r",
        "transform",
        "fill-rule",
        "clip-rule",
      ].includes(attribute.lowerName)
    ) {
      continue;
    }
    if (hasComputedTransform && attribute.lowerName === "transform") continue;
    const value = attribute.value === true ? "" : attribute.value;
    attributes.push(`${attribute.name}="${escapeHtmlAttribute(value)}"`);
  }
  const transformStyle = [
    ["transform", transform?.transform],
    ["transform-origin", transform?.transformOrigin],
    ["transform-box", transform?.transformBox],
  ]
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ");
  return `<${shape.tag} ${attributes.join(" ")}${
    transformStyle ? ` style="${escapeHtmlAttribute(transformStyle)}"` : ""
  }/>`;
}

function uniqueVectorStrokeId(elements: ParsedElement[], base: string): string {
  const used = new Set(
    elements
      .map((element) => attributeValue(element, "id"))
      .filter((value): value is string => Boolean(value)),
  );
  const safeBase = base.replace(/[^A-Za-z0-9_-]/g, "-") || "vector";
  let candidate = `an-vector-stroke-${safeBase}`;
  let suffix = 2;
  while (
    used.has(candidate) ||
    used.has(`${candidate}-inside`) ||
    used.has(`${candidate}-outside`)
  ) {
    candidate = `an-vector-stroke-${safeBase}-${suffix++}`;
  }
  return candidate;
}

function removeVectorStrokeGeneratedMarkup(
  html: string,
  wrapper: ParsedElement,
): string {
  const elements = parseHtmlElements(html);
  const currentWrapper = elements[wrapper.index];
  if (!currentWrapper || currentWrapper.start !== wrapper.start) return html;
  const spans = currentWrapper.childIndexes
    .map((index) => elements[index])
    .filter((child): child is ParsedElement =>
      Boolean(
        child &&
        ((child.tag === "defs" &&
          getAttribute(child, VECTOR_STROKE_GENERATED_DEFS)) ||
          (child.tag === "use" && getAttribute(child, VECTOR_STROKE_OVERLAY))),
      ),
    )
    .map(({ start, end }) => ({ start, end }))
    .sort((a, b) => b.start - a.start);
  let result = html;
  for (const { start, end } of spans) {
    result = `${result.slice(0, start)}${result.slice(end)}`;
  }
  return result;
}

function applyVectorStrokePositionEdit(
  html: string,
  wrapper: ParsedElement,
  position: string,
  intent: StyleEditIntent,
): string | PatchResultStatus {
  if (!["inside", "center", "outside"].includes(position)) {
    return "unsupported";
  }
  const computedStyles = [
    ["opacity", intent.opacity],
    ["stroke", intent.stroke],
    ["stroke-width", intent.strokeWidth],
    ["stroke-opacity", intent.strokeOpacity],
    ["stroke-dasharray", intent.strokeDasharray],
    ["stroke-dashoffset", intent.strokeDashoffset],
    ["stroke-linecap", intent.strokeLinecap],
    ["stroke-linejoin", intent.strokeLinejoin],
    ["stroke-miterlimit", intent.strokeMiterlimit],
    ["transform", intent.transform],
    ["transform-origin", intent.transformOrigin],
    ["transform-box", intent.transformBox],
  ] as const;
  if (
    computedStyles.some(([property, value]) => {
      const normalized = normalizeStyleProperty(property);
      return Boolean(
        value && (!normalized || !isSafeStyleValue(normalized, value)),
      );
    })
  ) {
    return "unsupported";
  }
  const elements = parseHtmlElements(html);
  const currentWrapper = elements[wrapper.index];
  if (
    !currentWrapper ||
    currentWrapper.start !== wrapper.start ||
    currentWrapper.tag !== "svg"
  ) {
    return "unsupported";
  }
  const shape = vectorShapeChild(currentWrapper, elements);
  const kind = attributeValue(currentWrapper, "data-an-primitive");
  if (!shape || !vectorStrokeCanAlign(kind, shape)) return "unsupported";

  const previousOverlay = vectorStrokeOverlay(currentWrapper, elements);
  const previousDefs = currentWrapper.childIndexes
    .map((childIndex) => elements[childIndex])
    .find(
      (child) =>
        child?.tag === "defs" &&
        getAttribute(child, VECTOR_STROKE_GENERATED_DEFS) !== undefined,
    );
  const previousGeometry = previousDefs?.childIndexes
    .map((childIndex) => elements[childIndex])
    .find((child) => getAttribute(child, VECTOR_STROKE_GEOMETRY) !== undefined);
  const previousGeometryStyle = previousGeometry
    ? parseStyle(attributeValue(previousGeometry, "style"))
    : {};
  const paint = previousOverlay ?? shape;
  const stroke = intent.stroke ?? vectorStyleValue(paint, "stroke") ?? "none";
  const shapeOpacity =
    intent.opacity ??
    vectorStyleValue(paint, "opacity") ??
    (previousOverlay ? vectorStyleValue(shape, "opacity") : null) ??
    undefined;
  const logicalWidth =
    intent.strokeWidth ??
    (previousOverlay
      ? attributeValue(previousOverlay, VECTOR_STROKE_LOGICAL_WIDTH)
      : null) ??
    vectorStyleValue(paint, "stroke-width") ??
    "1px";
  const strokeExtras = Object.fromEntries(
    (
      [
        ["stroke-opacity", intent.strokeOpacity],
        ["stroke-dasharray", intent.strokeDasharray],
        ["stroke-dashoffset", intent.strokeDashoffset],
        ["stroke-linecap", intent.strokeLinecap],
        ["stroke-linejoin", intent.strokeLinejoin],
        ["stroke-miterlimit", intent.strokeMiterlimit],
      ] as const
    )
      .map(([property, value]) => [
        property,
        value ?? vectorStyleValue(paint, property),
      ])
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  const actualWidth = scaledSvgLength(
    logicalWidth,
    position === "center" ? 1 : 2,
  );
  if (!actualWidth) return "unsupported";

  let result = removeVectorStrokeGeneratedMarkup(html, currentWrapper);
  let freshElements = parseHtmlElements(result);
  let freshWrapper = freshElements[wrapper.index];
  if (!freshWrapper || freshWrapper.tag !== "svg") return "unsupported";
  result = replaceOrInsertAttribute(
    result,
    freshWrapper,
    VECTOR_STROKE_POSITION,
    position,
  );
  freshElements = parseHtmlElements(result);
  freshWrapper = freshElements[wrapper.index];
  if (!freshWrapper || freshWrapper.tag !== "svg") return "unsupported";
  const savedOverflow = getAttribute(
    freshWrapper,
    VECTOR_STROKE_ORIGINAL_OVERFLOW,
  );
  if (position === "outside") {
    if (savedOverflow === undefined) {
      const overflow = effectiveStyleDeclarations(
        parseStyleDeclarations(attributeValue(freshWrapper, "style")),
      ).find((declaration) => cssPropertyKey(declaration.prop) === "overflow");
      const value = overflow?.value ?? "";
      result = replaceOrInsertAttribute(
        result,
        freshWrapper,
        VECTOR_STROKE_ORIGINAL_OVERFLOW,
        value,
      );
      freshElements = parseHtmlElements(result);
      freshWrapper = freshElements[wrapper.index];
      if (!freshWrapper || freshWrapper.tag !== "svg") return "unsupported";
      result = replaceOrInsertAttribute(
        result,
        freshWrapper,
        VECTOR_STROKE_ORIGINAL_OVERFLOW_PRIORITY,
        overflow?.important ? "important" : "",
      );
      freshElements = parseHtmlElements(result);
      freshWrapper = freshElements[wrapper.index];
      if (!freshWrapper || freshWrapper.tag !== "svg") return "unsupported";
    }
    result = replaceOrInsertAttribute(
      result,
      freshWrapper,
      "style",
      setStyleValue(
        attributeValue(freshWrapper, "style"),
        "overflow",
        "visible !important",
      ),
    );
  } else if (savedOverflow !== undefined) {
    const value = attributeValue(freshWrapper, VECTOR_STROKE_ORIGINAL_OVERFLOW);
    const priority = attributeValue(
      freshWrapper,
      VECTOR_STROKE_ORIGINAL_OVERFLOW_PRIORITY,
    );
    const declarations = parseStyleDeclarations(
      attributeValue(freshWrapper, "style"),
    );
    removeStyleDeclarations(declarations, ["overflow"]);
    if (value) {
      setStyleDeclaration(
        declarations,
        "overflow",
        `${value}${priority === "important" ? " !important" : ""}`,
      );
    }
    result = replaceOrInsertAttribute(
      result,
      freshWrapper,
      "style",
      serializeStyleDeclarations(declarations),
    );
    freshElements = parseHtmlElements(result);
    freshWrapper = freshElements[wrapper.index];
    if (!freshWrapper || freshWrapper.tag !== "svg") return "unsupported";
    result = removeAttributeFromHtml(
      result,
      freshWrapper,
      VECTOR_STROKE_ORIGINAL_OVERFLOW,
    );
    freshElements = parseHtmlElements(result);
    freshWrapper = freshElements[wrapper.index];
    if (!freshWrapper || freshWrapper.tag !== "svg") return "unsupported";
    result = removeAttributeFromHtml(
      result,
      freshWrapper,
      VECTOR_STROKE_ORIGINAL_OVERFLOW_PRIORITY,
    );
  }
  freshElements = parseHtmlElements(result);
  freshWrapper = freshElements[wrapper.index];
  if (!freshWrapper || freshWrapper.tag !== "svg") return "unsupported";
  const freshShape = freshWrapper
    ? vectorShapeChild(freshWrapper, freshElements)
    : null;
  if (!freshWrapper || !freshShape) return "unsupported";
  const shapeStyle = setStyleValue(
    attributeValue(freshShape, "style"),
    "stroke",
    "none",
  );
  result = replaceOrInsertAttribute(result, freshShape, "style", shapeStyle);
  freshElements = parseHtmlElements(result);
  freshWrapper = freshElements[wrapper.index];
  const geometry = freshWrapper
    ? vectorShapeChild(freshWrapper, freshElements)
    : null;
  if (!freshWrapper || !geometry) return "unsupported";

  const nodeId =
    attributeValue(freshWrapper, "data-agent-native-node-id") ??
    attributeValue(freshWrapper, "id") ??
    String(freshWrapper.siblingIndex);
  const geometryId = uniqueVectorStrokeId(freshElements, nodeId);
  const clipId = `${geometryId}-inside`;
  const maskId = `${geometryId}-outside`;
  const geometryMarkup = vectorStrokeGeometryMarkup(geometry, geometryId, {
    transform: intent.transform ?? previousGeometryStyle.transform,
    transformOrigin:
      intent.transformOrigin ?? previousGeometryStyle["transform-origin"],
    transformBox: intent.transformBox ?? previousGeometryStyle["transform-box"],
  });
  const viewBoxValues = (
    attributeValue(freshWrapper, "viewBox") ?? "0 0 300 150"
  )
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const [viewX, viewY, viewWidth, viewHeight] = viewBoxValues;
  if (
    viewBoxValues.length !== 4 ||
    ![viewX, viewY, viewWidth, viewHeight].every(Number.isFinite) ||
    viewWidth! <= 0 ||
    viewHeight! <= 0
  ) {
    return "unsupported";
  }
  const miterLimit = Number.parseFloat(
    strokeExtras["stroke-miterlimit"] ?? "4",
  );
  const maskPad = Math.max(
    ((Number.parseFloat(actualWidth) || 0) *
      Math.max(Number.isFinite(miterLimit) ? miterLimit : 4, 1)) /
      2,
    1,
  );
  const defs =
    `<defs ${VECTOR_STROKE_GENERATED_DEFS}="">${geometryMarkup}` +
    `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><use href="#${geometryId}"/></clipPath>` +
    `<mask id="${maskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" mask-type="luminance" x="${viewX! - maskPad}" y="${viewY! - maskPad}" width="${viewWidth! + maskPad * 2}" height="${viewHeight! + maskPad * 2}">` +
    `<rect x="${viewX! - maskPad}" y="${viewY! - maskPad}" width="${viewWidth! + maskPad * 2}" height="${viewHeight! + maskPad * 2}" fill="white"/>` +
    `<use href="#${geometryId}" fill="black"/></mask></defs>`;
  const overlayStyle = serializeStyleDeclarations([
    { property: "fill", value: "none" },
    { property: "stroke", value: stroke },
    { property: "stroke-width", value: actualWidth },
    ...(shapeOpacity ? [{ property: "opacity", value: shapeOpacity }] : []),
    ...Object.entries(strokeExtras).map(([property, value]) => ({
      property,
      value,
    })),
    ...(position === "inside"
      ? [{ property: "clip-path", value: `url(#${clipId})` }]
      : position === "outside"
        ? [{ property: "mask", value: `url(#${maskId})` }]
        : []),
  ]);
  const overlay =
    `<use href="#${geometryId}" ${VECTOR_STROKE_OVERLAY}="" ` +
    `${VECTOR_STROKE_LOGICAL_WIDTH}="${escapeHtmlAttribute(logicalWidth)}" ` +
    `pointer-events="none" aria-hidden="true" style="${escapeHtmlAttribute(overlayStyle)}"/>`;
  const insertAt = geometry.end;
  return `${result.slice(0, insertAt)}${defs}${overlay}${result.slice(insertAt)}`;
}

/**
 * A drawn vector primitive's `<svg>` carries the geometry and its shape child
 * carries the paint, so fill/stroke aimed at the wrapper tints the bounding
 * box instead. Mirrored by `vectorPaintTarget` in editor-chrome.bridge.ts.
 */
function vectorShapeChild(
  element: ParsedElement,
  elements: ParsedElement[],
): ParsedElement | null {
  if (element.tag !== "svg") return null;
  const kind = attributeValue(element, "data-an-primitive");
  if (!kind) {
    const directShapes = element.childIndexes
      .map((index) => elements[index])
      .filter((child): child is ParsedElement =>
        Boolean(child && VECTOR_SHAPE_TAGS.has(child.tag)),
      );
    return directShapes.length === 1 ? (directShapes[0] ?? null) : null;
  }
  if (
    !VECTOR_PAINT_PRIMITIVES.has(kind) &&
    kind !== "boolean" &&
    kind !== "boolean-operand"
  ) {
    return null;
  }
  if (kind === "pasted-svg") {
    return uniqueVectorShapeDescendant(element, elements);
  }
  for (const childIndex of element.childIndexes) {
    const child = elements[childIndex];
    if (child && VECTOR_SHAPE_TAGS.has(child.tag)) {
      if (
        kind === "boolean" &&
        attributeValue(child, "data-an-boolean-result") !== "true"
      ) {
        continue;
      }
      return child;
    }
  }
  return null;
}

function vectorStrokeCanAlign(
  kind: string | null,
  shape: ParsedElement,
): boolean {
  if (kind === "polygon" || kind === "star") {
    return (
      shape.tag === "polygon" ||
      (shape.tag === "path" && /z/i.test(attributeValue(shape, "d") ?? ""))
    );
  }
  if (kind === "rect" || kind === "rectangle") return shape.tag === "rect";
  if (kind === "ellipse" || kind === "circle") {
    return shape.tag === "ellipse" || shape.tag === "circle";
  }
  return (
    kind === "path" &&
    shape.tag === "path" &&
    /z/i.test(attributeValue(shape, "d") ?? "")
  );
}

/**
 * Folds the shape child's paint onto the wrapper node. The child is skipped by
 * `hasSvgAncestor`, so the wrapper is the only layer a reader can address —
 * without this the inspector sees no fill and offers to add a `background`.
 */
function withVectorPaintStyle(
  element: ParsedElement,
  elements: ParsedElement[],
  style: Record<string, string>,
): Record<string, string> {
  if (
    element.tag === "path" ||
    element.tag === "polygon" ||
    element.tag === "polyline" ||
    element.tag === "ellipse" ||
    element.tag === "circle" ||
    element.tag === "rect" ||
    element.tag === "line" ||
    element.tag === "use"
  ) {
    const merged = { ...style };
    for (const property of VECTOR_PAINT_PROPERTIES) {
      const value = style[property] ?? attributeValue(element, property);
      if (value) merged[property] = value;
    }
    return merged;
  }
  const kind = attributeValue(element, "data-an-primitive");
  const child = vectorShapeChild(element, elements);
  if (!child) return style;
  if (kind === "boolean-operand" || kind === "boolean") {
    const merged = { ...style };
    for (const [property, customProperty] of Object.entries(
      BOOLEAN_OPERAND_PAINT_PROPERTIES,
    )) {
      if (!customProperty) continue;
      const value = style[customProperty];
      if (value) merged[property] = value;
    }
    if (kind === "boolean") {
      for (const [property, customProperty] of Object.entries(
        BOOLEAN_RESULT_PAINT_PROPERTIES,
      )) {
        if (!customProperty) continue;
        const value = style[customProperty];
        if (value) merged[property] = value;
      }
    }
    return merged;
  }
  const overlay = vectorStrokeOverlay(element, elements);
  const childStyle = parseStyle(attributeValue(child, "style"));
  const overlayStyle = overlay
    ? parseStyle(attributeValue(overlay, "style"))
    : null;
  const merged = { ...style };
  for (const property of VECTOR_PAINT_PROPERTIES) {
    // An inline declaration on the child outranks its presentation
    // attribute, the same order the cascade resolves them when painting.
    const value =
      property.startsWith("stroke") && overlayStyle
        ? (overlayStyle[property] ?? attributeValue(overlay!, property))
        : (childStyle[property] ?? attributeValue(child, property));
    if (value) {
      merged[property] = value;
    } else if (
      property === "fill" &&
      child.tag !== "line" &&
      child.tag !== "polyline"
    ) {
      merged[property] = "black";
    }
  }
  const vectorOpacity =
    overlayStyle?.opacity ??
    childStyle.opacity ??
    attributeValue(child, "opacity");
  if (vectorOpacity) merged.vectorOpacity = vectorOpacity;
  if (overlay) {
    merged["stroke-width"] =
      attributeValue(overlay, VECTOR_STROKE_LOGICAL_WIDTH) ??
      merged["stroke-width"] ??
      "1px";
  }
  const position = attributeValue(element, VECTOR_STROKE_POSITION);
  if (position) merged["--an-vector-stroke-position"] = position;
  if (
    vectorStrokeCanAlign(attributeValue(element, "data-an-primitive"), child)
  ) {
    merged["--an-vector-stroke-can-align"] = "true";
  }
  return merged;
}

/**
 * Box paint that a vector wrapper must never carry: it paints the bounding
 * rectangle, and the inspector no longer edits these for a vector, so a value
 * left here is unreachable from the UI.
 */
const VECTOR_WRAPPER_BOX_PAINT = new Set([
  "background",
  "background-color",
  "background-image",
  "border",
  "border-width",
  "border-style",
  "border-color",
]);

function clearVectorWrapperPaint(html: string, wrapper: ParsedElement): string {
  const current = parseHtmlElements(html)[wrapper.index];
  if (!current || current.start !== wrapper.start) return html;
  const style = attributeValue(current, "style");
  if (!style) return html;
  const kept = parseStyleDeclarations(style);
  removeStyleDeclarations(kept, [...VECTOR_WRAPPER_BOX_PAINT]);
  const next = serializeStyleDeclarations(kept);
  if (next === style) return html;
  // Safe against the child edit that just ran: the wrapper's open tag, and so
  // its style attribute offsets, precede every child byte.
  return replaceOrInsertAttribute(html, current, "style", next);
}

function vectorPaintChild(
  html: string,
  element: ParsedElement,
  property: string,
  parsedElements?: ParsedElement[],
): ParsedElement | null {
  if (!property.startsWith("fill") && !property.startsWith("stroke")) {
    return null;
  }
  const elements = parsedElements ?? parseHtmlElements(html);
  // childIndexes only address this array if it is the same parse the caller's
  // element came from; a shifted index would repaint an unrelated element.
  const parsed = elements[element.index];
  if (!parsed || parsed.start !== element.start) return null;
  if (property.startsWith("stroke")) {
    return (
      vectorStrokeOverlay(parsed, elements) ??
      vectorShapeChild(parsed, elements)
    );
  }
  return vectorShapeChild(parsed, elements);
}

function splitGradientArguments(value: string): string[] | null {
  const body = value.slice(value.indexOf("(") + 1, -1);
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      parts.push(body.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(body.slice(start).trim());
  return parts.every(Boolean) ? parts : null;
}

function vectorStrokeGradientStops(value: string): FigmaSvgColorStop[] | null {
  const normalized = value.trim();
  const gradient = normalizeVectorStrokeGradient(normalized);
  const parts = gradient ? splitGradientArguments(gradient.value) : null;
  if (!gradient || !parts || parts.length < 2) return null;
  if (gradient.kind === "radial") {
    if (/^ellipse\s+closest-side\b/i.test(parts[0] ?? "")) return null;
    return parseComputedRadialGradient(gradient.value)?.stops ?? null;
  }

  const first = parts[0] ?? "";
  const hasHeader =
    /^(?:to\s+(?:left|right|top|bottom)(?:\s+(?:left|right|top|bottom))?|[-+]?\d*\.?\d+deg)$/i.test(
      first,
    );
  const stopParts = hasHeader ? parts.slice(1) : parts;
  if (stopParts.length < 2) return null;
  // Use the shared CSS stop parser so omitted positions interpolate between
  // their explicit neighbours exactly as CSS does.
  return (
    parseComputedLinearGradient(
      `linear-gradient(180deg, ${stopParts.join(", ")})`,
    )?.stops ?? null
  );
}

function vectorGradientBox(wrapper: ParsedElement) {
  const style = parseStyle(attributeValue(wrapper, "style"));
  const dimension = (value: string | null | undefined) => {
    const match = value
      ?.trim()
      .match(/^([+]?(?:\d+(?:\.\d*)?|\.\d+))(?:px)?$/i);
    const parsed = match ? Number(match[1]) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const cssWidth =
    dimension(style.width) ?? dimension(attributeValue(wrapper, "width"));
  const cssHeight =
    dimension(style.height) ?? dimension(attributeValue(wrapper, "height"));
  if (!cssWidth || !cssHeight) return null;

  const rawViewBox = attributeValue(wrapper, "viewBox");
  const viewBox = rawViewBox
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    viewBox?.length === 4 &&
    viewBox.every(Number.isFinite) &&
    viewBox[2]! > 0 &&
    viewBox[3]! > 0
  ) {
    const scaleX = viewBox[2]! / cssWidth;
    const scaleY = viewBox[3]! / cssHeight;
    if (Math.abs(scaleX - scaleY) > Math.max(scaleX, scaleY) * 0.001)
      return null;
    return {
      x: viewBox[0]!,
      y: viewBox[1]!,
      width: viewBox[2]!,
      height: viewBox[3]!,
      cssWidth,
      cssHeight,
      scale: (scaleX + scaleY) / 2,
    };
  }
  if (rawViewBox) return null;
  return {
    x: 0,
    y: 0,
    width: cssWidth,
    height: cssHeight,
    cssWidth,
    cssHeight,
    scale: 1,
  };
}

function vectorStrokeGradientStopsForSvg(
  stops: FigmaSvgColorStop[],
): FigmaSvgColorStop[] | null {
  if (
    stops.some((stop) => {
      return (
        !parseCssColorExtended(stop.color) ||
        !Number.isFinite(stop.offset) ||
        stop.offset < 0 ||
        stop.offset > 1
      );
    })
  ) {
    return null;
  }
  return stops;
}

function vectorLinearGradientAngle(
  value: string,
  width: number,
  height: number,
): number | null {
  const first =
    splitGradientArguments(value)?.[0]
      ?.replace(/\bin\s+srgb\b/i, "")
      .trim()
      .toLowerCase() ?? "";
  if (!first) return 180;
  const sides = first.match(
    /^to\s+(top|bottom|left|right)(?:\s+(top|bottom|left|right))?$/,
  );
  if (sides) {
    const vertical = [sides[1], sides[2]].find(
      (side) => side === "top" || side === "bottom",
    );
    const horizontal = [sides[1], sides[2]].find(
      (side) => side === "left" || side === "right",
    );
    if (sides[2] && (!vertical || !horizontal)) return null;
    if (!sides[2] && vertical && horizontal) return null;
    if (vertical && horizontal) {
      const dx = (horizontal === "right" ? 1 : -1) * width;
      const dy = (vertical === "top" ? -1 : 1) * height;
      return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    }
    if (first === "to top") return 0;
    if (first === "to right") return 90;
    if (first === "to bottom") return 180;
    if (first === "to left") return 270;
  }
  const angle = first.match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+))(?:deg)?$/);
  if (angle) return Number(angle[1]);
  const firstStop = first.replace(/\s+[-+]?(?:\d+(?:\.\d*)?|\.\d+)%$/, "");
  return parseCssColorExtended(firstStop) ? 180 : null;
}

function normalizeVectorStrokeGradient(value: string) {
  const match = value.trim().match(/^(linear|radial)-gradient\((.*)\)$/is);
  const parts = match ? splitGradientArguments(value.trim()) : null;
  if (!match || !parts || parts.length < 2) return null;
  const kind = match[1]!.toLowerCase();
  const first = parts[0] ?? "";
  const interpolation = first.match(/\bin\s+([a-z][a-z0-9-]*)\b/i);
  if (interpolation && interpolation[1]?.toLowerCase() !== "srgb") {
    return null;
  }
  const header = first.replace(/\bin\s+srgb\b/i, "").trim();
  const normalizedParts = header ? [header, ...parts.slice(1)] : parts.slice(1);
  return normalizedParts.length >= 2
    ? { kind, value: `${kind}-gradient(${normalizedParts.join(", ")})` }
    : null;
}

function vectorStrokeGradientId(
  wrapper: ParsedElement,
  elements: ParsedElement[],
): string {
  const nodeId = attributeValue(wrapper, "data-agent-native-node-id");
  const baseId = `${nodeId || `vector-${wrapper.index}`}-stroke-gradient`;
  const existingIds = new Set(
    elements
      .map((element) => attributeValue(element, "id"))
      .filter((id): id is string => Boolean(id)),
  );
  if (!existingIds.has(baseId)) return baseId;
  let suffix = 2;
  while (existingIds.has(`${baseId}-${suffix}`)) suffix += 1;
  return `${baseId}-${suffix}`;
}

function removeVectorStrokeGradientMarkup(
  html: string,
  wrapper: ParsedElement,
  strokeValue: string | null,
): string {
  const elements = parseHtmlElements(html);
  const current = elements[wrapper.index];
  if (!current || current.start !== wrapper.start) return html;
  const gradientId = strokeValue?.match(
    /^url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)$/i,
  )?.[2];
  if (!gradientId) return html;
  const spans = current.childIndexes
    .map((index) => elements[index])
    .filter((child): child is ParsedElement => {
      if (
        !child ||
        child.tag !== "defs" ||
        getAttribute(child, VECTOR_STROKE_GRADIENT_MARKER) === undefined
      ) {
        return false;
      }
      return child.childIndexes.some((childIndex) => {
        const definition = elements[childIndex];
        return definition && attributeValue(definition, "id") === gradientId;
      });
    })
    .map((child) => ({ start: child.start, end: child.end }));
  let result = html;
  for (const span of spans.sort((a, b) => b.start - a.start)) {
    result = `${result.slice(0, span.start)}${result.slice(span.end)}`;
  }
  return result;
}

function applyVectorStrokeGradient(
  html: string,
  shape: ParsedElement,
  value: string,
): string | PatchResultStatus {
  const elements = parseHtmlElements(html);
  const currentShape = elements[shape.index];
  const wrapper = currentShape
    ? vectorShapeOwnerSvg(currentShape, elements)
    : null;
  const gradient = normalizeVectorStrokeGradient(value);
  const stops = gradient ? vectorStrokeGradientStops(gradient.value) : null;
  const svgStops = stops ? vectorStrokeGradientStopsForSvg(stops) : null;
  if (
    !currentShape ||
    currentShape.start !== shape.start ||
    !wrapper ||
    wrapper.tag !== "svg" ||
    !gradient ||
    !svgStops
  ) {
    return "unsupported";
  }
  const initialShapes = vectorShapeDescendants(wrapper, elements);
  const shapeIndex = initialShapes.indexOf(currentShape);
  const isOverlay =
    getAttribute(currentShape, VECTOR_STROKE_OVERLAY) !== undefined;
  if (shapeIndex < 0) return "unsupported";
  const nodeId = attributeValue(wrapper, "data-agent-native-node-id");
  const kind = attributeValue(wrapper, "data-an-primitive");
  if (!nodeId || (!kind && !vectorShapeChild(wrapper, elements))) {
    return "unsupported";
  }
  let content = removeVectorStrokeGradientMarkup(
    html,
    wrapper,
    vectorStyleValue(currentShape, "stroke"),
  );
  const refreshed = parseHtmlElements(content);
  const nextWrapper = refreshed.find(
    (candidate) => candidate.start === wrapper.start,
  );
  const nextShapes = nextWrapper
    ? vectorShapeDescendants(nextWrapper, refreshed)
    : [];
  const target = nextWrapper
    ? isOverlay
      ? vectorStrokeOverlay(nextWrapper, refreshed)
      : (nextShapes[shapeIndex] ?? null)
    : null;
  if (!nextWrapper || !target) return "unsupported";
  const id = vectorStrokeGradientId(nextWrapper, refreshed);
  const box = vectorGradientBox(nextWrapper);
  if (!box) return "unsupported";
  let gradientMarkup: string | null = null;
  if (gradient.kind === "linear") {
    const angle = vectorLinearGradientAngle(
      gradient.value,
      box.cssWidth,
      box.cssHeight,
    );
    if (angle === null) return "unsupported";
    gradientMarkup = buildLinearGradientDef(
      escapeHtmlAttribute(id),
      angle,
      svgStops,
      {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      },
    );
  } else {
    const radial = parseComputedRadialGradient(gradient.value);
    if (!radial) return "unsupported";
    const geometry = resolveRadialGradientGeometry(
      radial,
      box.cssWidth,
      box.cssHeight,
    );
    const cx = box.x + geometry.cx * box.scale;
    const cy = box.y + geometry.cy * box.scale;
    const rx = geometry.rx * box.scale;
    const ry = geometry.ry * box.scale;
    gradientMarkup =
      Math.abs(rx - ry) < 0.01
        ? buildRadialGradientDef(escapeHtmlAttribute(id), svgStops, {
            cx,
            cy,
            r: rx,
          })
        : buildRadialGradientDef(escapeHtmlAttribute(id), svgStops, {
            cx,
            cy,
            rx,
            ry,
          });
  }
  if (!gradientMarkup) return "unsupported";
  const defs = `<defs ${VECTOR_STROKE_GRADIENT_MARKER}="">${gradientMarkup}</defs>`;
  content = `${content.slice(0, nextWrapper.openEnd)}${defs}${content.slice(nextWrapper.openEnd)}`;
  const finalElements = parseHtmlElements(content);
  const finalWrapper = finalElements.find(
    (candidate) => candidate.start === wrapper.start,
  );
  const finalShapes = finalWrapper
    ? vectorShapeDescendants(finalWrapper, finalElements)
    : [];
  const finalTarget = finalWrapper
    ? isOverlay
      ? vectorStrokeOverlay(finalWrapper, finalElements)
      : (finalShapes[shapeIndex] ?? null)
    : null;
  if (!finalWrapper || !finalTarget) return "unsupported";
  const authoredShapes = finalShapes.filter(
    (candidate) => getAttribute(candidate, VECTOR_STROKE_OVERLAY) === undefined,
  );
  const gradientMetadataElement =
    authoredShapes.length === 1 ? finalWrapper : finalTarget;
  const strokeStyle = setStyleValue(
    attributeValue(finalTarget, "style"),
    "stroke",
    `url(#${id})`,
  );
  const metadataStyle = setStyleValue(
    gradientMetadataElement === finalTarget
      ? strokeStyle
      : attributeValue(gradientMetadataElement, "style"),
    VECTOR_STROKE_GRADIENT_PROPERTY as VisualStyleProperty,
    value.trim(),
  );
  if (gradientMetadataElement === finalTarget) {
    return patchElementAttributes(content, [
      {
        element: finalTarget,
        attributes: { style: metadataStyle },
      },
    ]);
  }
  return patchElementAttributes(content, [
    {
      element: finalTarget,
      attributes: {
        style: strokeStyle,
      },
    },
    {
      element: gradientMetadataElement,
      attributes: { style: metadataStyle },
    },
  ]);
}

function removeVectorFillGradientMarkup(
  html: string,
  wrapper: ParsedElement,
  fillValue: string | null,
): string {
  const elements = parseHtmlElements(html);
  const current = elements[wrapper.index];
  if (!current || current.start !== wrapper.start) return html;
  const gradientId = fillValue?.match(
    /^url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)$/i,
  )?.[2];
  if (!gradientId) return html;
  const spans = current.childIndexes
    .map((index) => elements[index])
    .filter((child): child is ParsedElement => {
      if (
        !child ||
        child.tag !== "defs" ||
        getAttribute(child, VECTOR_FILL_GRADIENT_MARKER) === undefined
      ) {
        return false;
      }
      return child.childIndexes.some((childIndex) => {
        const definition = elements[childIndex];
        return definition && attributeValue(definition, "id") === gradientId;
      });
    })
    .map((child) => ({ start: child.start, end: child.end }));
  let result = html;
  for (const span of spans.sort((a, b) => b.start - a.start)) {
    result = `${result.slice(0, span.start)}${result.slice(span.end)}`;
  }
  return result;
}

function vectorFillGradientId(
  wrapper: ParsedElement,
  elements: ParsedElement[],
): string {
  const nodeId = attributeValue(wrapper, "data-agent-native-node-id");
  const baseId = `${nodeId || `vector-${wrapper.index}`}-fill-gradient`;
  const existingIds = new Set(
    elements
      .map((element) => attributeValue(element, "id"))
      .filter((id): id is string => Boolean(id)),
  );
  if (!existingIds.has(baseId)) return baseId;
  let suffix = 2;
  while (existingIds.has(`${baseId}-${suffix}`)) suffix += 1;
  return `${baseId}-${suffix}`;
}

function applyVectorFillGradient(
  html: string,
  shape: ParsedElement,
  value: string,
): string | PatchResultStatus {
  const elements = parseHtmlElements(html);
  const currentShape = elements[shape.index];
  const wrapper = currentShape
    ? vectorShapeOwnerSvg(currentShape, elements)
    : null;
  const gradient = normalizeVectorStrokeGradient(value);
  const stops = gradient ? vectorStrokeGradientStops(gradient.value) : null;
  const svgStops = stops ? vectorStrokeGradientStopsForSvg(stops) : null;
  if (
    !currentShape ||
    currentShape.start !== shape.start ||
    !wrapper ||
    wrapper.tag !== "svg" ||
    !gradient ||
    !svgStops
  ) {
    return "unsupported";
  }
  const shapes = vectorShapeDescendants(wrapper, elements);
  const shapeIndex = shapes.indexOf(currentShape);
  const nodeId = attributeValue(wrapper, "data-agent-native-node-id");
  const kind = attributeValue(wrapper, "data-an-primitive");
  if (
    shapeIndex < 0 ||
    !nodeId ||
    (!kind && !vectorShapeChild(wrapper, elements))
  ) {
    return "unsupported";
  }

  let content = clearVectorFillGradientState(
    html,
    currentShape,
    vectorStyleValue(currentShape, "fill"),
  );
  const refreshed = parseHtmlElements(content);
  const nextWrapper = refreshed.find(
    (candidate) => candidate.start === wrapper.start,
  );
  const nextShapes = nextWrapper
    ? vectorShapeDescendants(nextWrapper, refreshed)
    : [];
  const target = nextShapes[shapeIndex] ?? null;
  if (!nextWrapper || !target) return "unsupported";
  const id = vectorFillGradientId(nextWrapper, refreshed);
  const box = vectorGradientBox(nextWrapper);
  if (!box) return "unsupported";
  let gradientMarkup: string | null = null;
  if (gradient.kind === "linear") {
    const angle = vectorLinearGradientAngle(
      gradient.value,
      box.cssWidth,
      box.cssHeight,
    );
    if (angle === null) return "unsupported";
    gradientMarkup = buildLinearGradientDef(
      escapeHtmlAttribute(id),
      angle,
      svgStops,
      {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      },
    );
  } else {
    const radial = parseComputedRadialGradient(gradient.value);
    if (!radial) return "unsupported";
    const geometry = resolveRadialGradientGeometry(
      radial,
      box.cssWidth,
      box.cssHeight,
    );
    const cx = box.x + geometry.cx * box.scale;
    const cy = box.y + geometry.cy * box.scale;
    const rx = geometry.rx * box.scale;
    const ry = geometry.ry * box.scale;
    gradientMarkup =
      Math.abs(rx - ry) < 0.01
        ? buildRadialGradientDef(escapeHtmlAttribute(id), svgStops, {
            cx,
            cy,
            r: rx,
          })
        : buildRadialGradientDef(escapeHtmlAttribute(id), svgStops, {
            cx,
            cy,
            rx,
            ry,
          });
  }
  if (!gradientMarkup) return "unsupported";
  const fillDefs = nextWrapper.childIndexes
    .map((index) => refreshed[index])
    .find(
      (child) =>
        child?.tag === "defs" &&
        getAttribute(child, VECTOR_FILL_GRADIENT_MARKER) !== undefined,
    );
  if (fillDefs?.closeStart !== undefined) {
    content = `${content.slice(0, fillDefs.closeStart)}${gradientMarkup}${content.slice(fillDefs.closeStart)}`;
  } else {
    const defs = `<defs ${VECTOR_FILL_GRADIENT_MARKER}="">${gradientMarkup}</defs>`;
    content = `${content.slice(0, nextWrapper.openEnd)}${defs}${content.slice(nextWrapper.openEnd)}`;
  }
  const finalElements = parseHtmlElements(content);
  const finalWrapper = finalElements.find(
    (candidate) => candidate.start === wrapper.start,
  );
  const finalTarget = finalWrapper
    ? (vectorShapeDescendants(finalWrapper, finalElements)[shapeIndex] ?? null)
    : null;
  if (!finalWrapper || !finalTarget) return "unsupported";
  const authoredShapes = vectorShapeDescendants(finalWrapper, finalElements);
  const metadataElement =
    authoredShapes.length === 1 ? finalWrapper : finalTarget;
  const fillStyle = setStyleValue(
    attributeValue(finalTarget, "style"),
    "fill",
    `url(#${id})`,
  );
  const metadataStyle = setStyleValue(
    metadataElement === finalTarget
      ? fillStyle
      : attributeValue(metadataElement, "style"),
    VECTOR_FILL_GRADIENT_PROPERTY as VisualStyleProperty,
    value.trim(),
  );
  return patchElementAttributes(content, [
    {
      element: finalTarget,
      attributes: { style: fillStyle },
    },
    {
      element: metadataElement,
      attributes: { style: metadataStyle },
    },
  ]);
}

function clearVectorFillGradientState(
  html: string,
  shape: ParsedElement,
  previousFill: string | null,
): string {
  const elements = parseHtmlElements(html);
  const currentShape = elements[shape.index];
  const wrapper = currentShape
    ? vectorShapeOwnerSvg(currentShape, elements)
    : null;
  if (!currentShape || currentShape.start !== shape.start || !wrapper) {
    return html;
  }
  const shapes = vectorShapeDescendants(wrapper, elements);
  const shapeIndex = shapes.indexOf(currentShape);
  if (shapeIndex < 0) return html;
  const withoutDefs = removeVectorFillGradientMarkup(
    html,
    wrapper,
    previousFill,
  );
  const refreshed = parseHtmlElements(withoutDefs);
  const nextWrapper = refreshed.find(
    (candidate) => candidate.start === wrapper.start,
  );
  const nextShapes = nextWrapper
    ? vectorShapeDescendants(nextWrapper, refreshed)
    : [];
  const selectedShape = nextShapes[shapeIndex];
  if (!nextWrapper || !selectedShape) return withoutDefs;
  const gradientId = previousFill?.match(
    /^url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)$/i,
  )?.[2];
  const metadataOwners = [nextWrapper, selectedShape];
  if (gradientId) {
    for (const candidate of nextShapes) {
      if (
        vectorStyleValue(candidate, "fill") === `url(#${gradientId})` &&
        !metadataOwners.includes(candidate)
      ) {
        metadataOwners.push(candidate);
      }
    }
  }
  return patchElementAttributes(
    withoutDefs,
    metadataOwners.map((owner) => {
      const style = parseStyle(attributeValue(owner, "style"));
      delete style[VECTOR_FILL_GRADIENT_PROPERTY];
      const nextStyle = serializeStyleDeclarations(
        Object.entries(style).map(([property, value]) => ({ property, value })),
      );
      return {
        element: owner,
        attributes: { style: nextStyle || null },
      };
    }),
  );
}

function clearVectorStrokeGradientState(
  html: string,
  shape: ParsedElement,
  previousStroke: string | null,
): string {
  const elements = parseHtmlElements(html);
  const currentShape = elements[shape.index];
  const wrapper = currentShape
    ? vectorShapeOwnerSvg(currentShape, elements)
    : null;
  if (!currentShape || currentShape.start !== shape.start || !wrapper) {
    return html;
  }
  const shapes = vectorShapeDescendants(wrapper, elements);
  const authoredShapes = shapes.filter(
    (candidate) => getAttribute(candidate, VECTOR_STROKE_OVERLAY) === undefined,
  );
  const metadataOnWrapper = authoredShapes.length === 1;
  const shapeIndex = shapes.indexOf(currentShape);
  if (shapeIndex < 0) return html;
  const withoutDefs = removeVectorStrokeGradientMarkup(
    html,
    wrapper,
    previousStroke,
  );
  const refreshed = parseHtmlElements(withoutDefs);
  const nextWrapper = refreshed.find(
    (candidate) => candidate.start === wrapper.start,
  );
  const nextShapes = nextWrapper
    ? vectorShapeDescendants(nextWrapper, refreshed)
    : [];
  const nextMetadataElement = metadataOnWrapper
    ? nextWrapper
    : (nextShapes[shapeIndex] ?? null);
  if (!nextWrapper || !nextMetadataElement) return withoutDefs;
  const style = parseStyle(attributeValue(nextMetadataElement, "style"));
  delete style[VECTOR_STROKE_GRADIENT_PROPERTY];
  const nextStyle = serializeStyleDeclarations(
    Object.entries(style).map(([property, value]) => ({ property, value })),
  );
  return nextStyle
    ? replaceOrInsertAttribute(
        withoutDefs,
        nextMetadataElement,
        "style",
        nextStyle,
      )
    : removeAttributeFromHtml(withoutDefs, nextMetadataElement, "style");
}

type StyleEditTargetRoute =
  | { kind: "unsupported" }
  | { kind: "boolean-operand" }
  | { kind: "boolean-result" }
  | { kind: "released-svg" }
  | { kind: "vector-paint"; element: ParsedElement }
  | { kind: "ordinary"; element: ParsedElement };

type StyleEditTargetIntent = Pick<
  StyleEditIntent | StyleRemoveEditIntent,
  "property" | "operation"
>;

function resolveStyleEditTargetRoute(
  html: string,
  node: CodeLayerNode,
  element: ParsedElement,
  intent: StyleEditTargetIntent,
  elements: ParsedElement[],
): StyleEditTargetRoute {
  if (booleanOperandFor(element)) return { kind: "boolean-operand" };
  if (node.dataAttributes["data-an-primitive"] === "boolean") {
    return { kind: "boolean-result" };
  }
  if (
    element.tag === "svg" &&
    ["rectangle", "ellipse"].includes(
      node.dataAttributes["data-an-primitive"] ?? "",
    )
  ) {
    return { kind: "released-svg" };
  }
  const paintChild = vectorPaintChild(html, element, intent.property, elements);
  const useTarget =
    element.tag === "use"
      ? element
      : paintChild?.tag === "use"
        ? paintChild
        : null;
  const isGeneratedStrokeOverlay =
    intent.property.startsWith("stroke") &&
    paintChild?.tag === "use" &&
    getAttribute(paintChild, VECTOR_STROKE_OVERLAY) !== undefined;
  if (useTarget && !isGeneratedStrokeOverlay) {
    return { kind: "unsupported" };
  }
  if (
    node.dataAttributes["data-an-primitive"] === "pasted-svg" &&
    !paintChild
  ) {
    return { kind: "unsupported" };
  }
  return paintChild
    ? { kind: "vector-paint", element: paintChild }
    : { kind: "ordinary", element };
}

function removeVectorEndpointMarkup(
  html: string,
  wrapper: ParsedElement,
  nodeId: string,
): string {
  const elements = parseHtmlElements(html);
  const currentWrapper = elements[wrapper.index];
  if (!currentWrapper || currentWrapper.start !== wrapper.start) return html;
  const markerIds = new Set([
    vectorEndpointMarkerId(nodeId, "start"),
    vectorEndpointMarkerId(nodeId, "end"),
    `${nodeId}-arrow`,
  ]);
  const spans: Array<{ start: number; end: number }> = [];
  for (const childIndex of currentWrapper.childIndexes) {
    const child = elements[childIndex];
    if (!child || child.tag !== "defs") continue;
    if (getAttribute(child, "data-an-vector-endpoints")) {
      spans.push({ start: child.start, end: child.end });
      continue;
    }
    for (const markerIndex of child.childIndexes) {
      const marker = elements[markerIndex];
      const markerId = marker ? attributeValue(marker, "id") : null;
      if (marker?.tag === "marker" && markerId && markerIds.has(markerId)) {
        spans.push({ start: marker.start, end: marker.end });
      }
    }
  }
  let result = html;
  for (const span of spans.sort((a, b) => b.start - a.start)) {
    result = `${result.slice(0, span.start)}${result.slice(span.end)}`;
  }
  return result;
}

function applyVectorEndpointEdit(
  html: string,
  wrapper: ParsedElement,
  property: string,
  value: string,
): string | PatchResultStatus {
  if (!isVectorEndpointProperty(property) || !isVectorEndpointStyle(value)) {
    return "unsupported";
  }
  const elements = parseHtmlElements(html);
  const currentWrapper = elements[wrapper.index];
  if (
    !currentWrapper ||
    currentWrapper.start !== wrapper.start ||
    currentWrapper.tag !== "svg"
  ) {
    return "unsupported";
  }
  const kind = attributeValue(currentWrapper, "data-an-primitive");
  if (!VECTOR_PAINT_PRIMITIVES.has(kind ?? "")) return "unsupported";
  const nodeId = attributeValue(currentWrapper, "data-agent-native-node-id");
  const shape = vectorShapeChild(currentWrapper, elements);
  if (!nodeId || !shape) return "unsupported";

  const currentStyle = parseStyle(attributeValue(currentWrapper, "style"));
  const endpoints = vectorEndpointPairForPrimitive(
    kind ?? undefined,
    currentStyle[VECTOR_START_ENDPOINT_PROPERTY],
    currentStyle[VECTOR_END_ENDPOINT_PROPERTY],
  );
  const nextEndpoints =
    property === VECTOR_START_ENDPOINT_PROPERTY
      ? { ...endpoints, startPoint: value }
      : { ...endpoints, endPoint: value };

  // Remove generated/legacy marker definitions first. Reparse after this
  // structural splice so every later attribute write uses fresh source spans.
  let content = removeVectorEndpointMarkup(html, currentWrapper, nodeId);
  const afterRemoval = parseHtmlElements(content);
  const nextWrapper = afterRemoval.find(
    (candidate) =>
      candidate.tag === "svg" &&
      attributeValue(candidate, "data-agent-native-node-id") === nodeId,
  );
  if (!nextWrapper) return "unsupported";
  const nextShape = vectorShapeChild(nextWrapper, afterRemoval);
  if (!nextShape) return "unsupported";
  const defsMarkup = vectorEndpointDefsMarkup(nodeId, nextEndpoints);
  if (defsMarkup) {
    content = `${content.slice(0, nextShape.start)}${defsMarkup}${content.slice(nextShape.start)}`;
  }

  const finalElements = parseHtmlElements(content);
  const finalWrapper = finalElements.find(
    (candidate) =>
      candidate.tag === "svg" &&
      attributeValue(candidate, "data-agent-native-node-id") === nodeId,
  );
  if (!finalWrapper) return "unsupported";
  const finalShape = vectorShapeChild(finalWrapper, finalElements);
  if (!finalShape) return "unsupported";
  const finalStyle = setStyleValue(
    setStyleValue(
      attributeValue(finalWrapper, "style"),
      VECTOR_START_ENDPOINT_PROPERTY,
      nextEndpoints.startPoint,
    ),
    VECTOR_END_ENDPOINT_PROPERTY,
    nextEndpoints.endPoint,
  );
  return patchElementAttributes(content, [
    {
      element: finalWrapper,
      attributes: { style: finalStyle },
    },
    {
      element: finalShape,
      attributes: {
        "marker-start":
          nextEndpoints.startPoint === "none"
            ? null
            : `url(#${vectorEndpointMarkerId(nodeId, "start")})`,
        "marker-end":
          nextEndpoints.endPoint === "none"
            ? null
            : `url(#${vectorEndpointMarkerId(nodeId, "end")})`,
      },
    },
  ]);
}

function applyStyleEdit(
  html: string,
  element: ParsedElement,
  intent: StyleEditIntent,
): { content: string; capability: EditCapability } | PatchResultStatus {
  const normalized = normalizedSafeStyleValue(intent.property, intent.value);
  if (!normalized) return "unsupported";
  const { property, value } = normalized;
  if (property === "fill-opacity") {
    const opacityUpdate = updateOpenPenPathFillOpacity(html, element, value);
    if (opacityUpdate.kind === "invalid") return "unsupported";
    if (opacityUpdate.kind === "updated") {
      return {
        content: opacityUpdate.content,
        capability: { kind: "style", properties: [property], confidence: 0.9 },
      };
    }
  }
  if (property === "border-color") {
    const isGradient =
      /^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i.test(value);
    if (isGradient) {
      const gradient = normalizeVectorStrokeGradient(value);
      const stops =
        gradient?.kind === "linear"
          ? vectorStrokeGradientStops(gradient.value)
          : null;
      const style = parseStyle(attributeValue(element, "style"));
      const shorthand = cssBorderShorthandParts(style.border);
      const radiusProperties = [
        "border-radius",
        "border-top-left-radius",
        "border-top-right-radius",
        "border-bottom-right-radius",
        "border-bottom-left-radius",
      ];
      const hasSquareCorners = radiusProperties.every(
        (property) =>
          !style[property] ||
          style[property] === "0" ||
          style[property] === "0px",
      );
      const hasExistingGradient = Boolean(style[CSS_BORDER_GRADIENT_PROPERTY]);
      const hasUniformBorder =
        (style["border-width"] ?? shorthand?.width) &&
        (style["border-style"] ?? shorthand?.style) === "solid" &&
        (style[CSS_BORDER_SOLID_COLOR_PROPERTY] ||
          style["border-color"] ||
          shorthand?.color) &&
        !Object.keys(style).some((name) =>
          /^border-(?:top|right|bottom|left)(?:-(?:width|style|color))?$/.test(
            name,
          ),
        );
      if (
        element.tag !== "div" ||
        classList(element).length > 0 ||
        !hasSquareCorners ||
        !hasUniformBorder ||
        !gradient ||
        !stops ||
        (style["border-image"] && !hasExistingGradient) ||
        (style["border-image-source"] && !hasExistingGradient)
      ) {
        return "unsupported";
      }
      const originalColor =
        style[CSS_BORDER_SOLID_COLOR_PROPERTY] ??
        style["border-color"] ??
        shorthand?.color;
      let nextStyle = setStyleValue(
        attributeValue(element, "style"),
        CSS_BORDER_GRADIENT_PROPERTY as VisualStyleProperty,
        gradient.value,
      );
      nextStyle = setStyleValue(
        nextStyle,
        CSS_BORDER_SOLID_COLOR_PROPERTY as VisualStyleProperty,
        originalColor,
      );
      nextStyle = setStyleValue(
        nextStyle,
        "border-image-source" as VisualStyleProperty,
        `var(${CSS_BORDER_GRADIENT_PROPERTY})`,
      );
      nextStyle = setStyleValue(
        nextStyle,
        "border-image-slice" as VisualStyleProperty,
        "1",
      );
      nextStyle = setStyleValue(nextStyle, "border-color", "transparent");
      return {
        content: replaceOrInsertAttribute(html, element, "style", nextStyle),
        capability: { kind: "style", properties: [property], confidence: 0.9 },
      };
    }
    const style = parseStyle(attributeValue(element, "style"));
    if (style[CSS_BORDER_GRADIENT_PROPERTY]) {
      if (value.trim().toLowerCase() === "transparent") {
        const nextStyle = setStyleValue(
          attributeValue(element, "style"),
          "border-image-source" as VisualStyleProperty,
          "none",
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
      if (/^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i.test(value)) {
        return "unsupported";
      }
      const declarations = parseStyleDeclarations(
        attributeValue(element, "style"),
      );
      removeStyleDeclarations(declarations, [
        CSS_BORDER_GRADIENT_PROPERTY,
        "border-image-source",
        "border-image-slice",
      ]);
      let nextStyle = serializeStyleDeclarations(declarations);
      const solidColor =
        value.trim().toLowerCase() !== "transparent" &&
        parseCssColorExtended(value)
          ? value
          : (style[CSS_BORDER_SOLID_COLOR_PROPERTY] ?? value);
      nextStyle = setStyleValue(nextStyle, "border-color", solidColor);
      const cleaned = parseStyleDeclarations(nextStyle);
      removeStyleDeclarations(cleaned, [CSS_BORDER_SOLID_COLOR_PROPERTY]);
      nextStyle = serializeStyleDeclarations(cleaned);
      return {
        content: replaceOrInsertAttribute(html, element, "style", nextStyle),
        capability: { kind: "style", properties: [property], confidence: 0.9 },
      };
    }
  }
  if (property === "stroke") {
    const gradient = applyVectorStrokeGradient(html, element, value);
    if (gradient !== "unsupported") {
      return {
        content: gradient,
        capability: { kind: "style", properties: [property], confidence: 0.9 },
      };
    }
    if (/^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i.test(value)) {
      return "unsupported";
    }
  }
  if (property === "fill") {
    const gradient = applyVectorFillGradient(html, element, value);
    if (gradient !== "unsupported") {
      return {
        content: gradient,
        capability: { kind: "style", properties: [property], confidence: 0.9 },
      };
    }
    if (/^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i.test(value)) {
      return "unsupported";
    }
  }
  if (isVectorEndpointProperty(property)) {
    const content = applyVectorEndpointEdit(html, element, property, value);
    if (content === "unsupported") return content;
    return {
      content,
      capability: {
        kind: "style",
        properties: [property],
        confidence: 0.9,
      },
    };
  }
  if (property === "--an-vector-stroke-position") {
    const content = applyVectorStrokePositionEdit(html, element, value, intent);
    if (content === "unsupported") return content;
    return {
      content,
      capability: {
        kind: "style",
        properties: [property],
        confidence: 0.9,
      },
    };
  }
  if (
    element.tag === "svg" &&
    (property === "width" || property === "height") &&
    importedVectorLetterboxes(element)
  ) {
    const stretched = replaceOrInsertAttribute(
      html,
      element,
      "preserveAspectRatio",
      "none",
    );
    const resized = applyStyleEdit(
      stretched,
      parseHtmlElements(stretched)[element.index]!,
      intent,
    );
    return resized;
  }
  if (element.tag === "svg" && BORDER_RADIUS_PROPERTY.test(property)) {
    const content = roundSvgVectorCorners(
      html,
      element.index,
      property === "border-radius" ? value : null,
    );
    if (content === "unsupported") return content;
    return {
      content,
      capability: { kind: "style", properties: [property], confidence: 0.9 },
    };
  }
  const alignedOverlay =
    getAttribute(element, VECTOR_STROKE_OVERLAY) !== undefined;
  const parent =
    element.parentIndex === undefined
      ? undefined
      : parseHtmlElements(html)[element.parentIndex];
  const position = parent
    ? (attributeValue(parent, VECTOR_STROKE_POSITION) ?? "center")
    : "center";
  const logicalWidth = value;
  const storedValue =
    alignedOverlay && property === "stroke-width"
      ? scaledSvgLength(logicalWidth, position === "center" ? 1 : 2)
      : logicalWidth;
  if (storedValue === null) return "unsupported";
  const previousStroke =
    property === "stroke" ? vectorStyleValue(element, "stroke") : null;
  const previousFill =
    property === "fill" ? vectorStyleValue(element, "fill") : null;
  const nextStyle = withBorderAreaFallback(
    setStyleValue(attributeValue(element, "style"), property, storedValue),
    property,
  );
  let content = replaceOrInsertAttribute(html, element, "style", nextStyle);
  if (property === "stroke" && value.trim().toLowerCase() !== "transparent") {
    content = clearVectorStrokeGradientState(content, element, previousStroke);
  }
  if (property === "fill") {
    content = clearVectorFillGradientState(content, element, previousFill);
  }
  if (alignedOverlay && property === "stroke-width") {
    const current = parseHtmlElements(content)[element.index];
    if (!current) return "unsupported";
    content = replaceOrInsertAttribute(
      content,
      current,
      VECTOR_STROKE_LOGICAL_WIDTH,
      logicalWidth,
    );
  }
  if (
    alignedOverlay &&
    (property === "stroke-width" || property === "stroke-miterlimit")
  ) {
    const updatedElements = parseHtmlElements(content);
    const updatedOverlay = updatedElements[element.index];
    const wrapper =
      updatedOverlay?.parentIndex === undefined
        ? undefined
        : updatedElements[updatedOverlay.parentIndex];
    const updatedPosition = wrapper
      ? attributeValue(wrapper, VECTOR_STROKE_POSITION)
      : null;
    if (!wrapper || !updatedPosition) return "unsupported";
    const rebuilt = applyVectorStrokePositionEdit(
      content,
      wrapper,
      updatedPosition,
      {
        kind: "style",
        target: intent.target,
        property: "--an-vector-stroke-position",
        value: updatedPosition,
      },
    );
    if (rebuilt === "unsupported") return rebuilt;
    content = rebuilt;
  }
  return {
    content,
    capability: {
      kind: "style",
      properties: [property],
      confidence: 0.9,
    },
  };
}

const OPEN_PEN_PATH_FILL_OPACITY = "data-an-open-fill-opacity";

type OpenPenPathFillOpacitySnapshot = {
  version: 2;
  attributeValue: string | null;
  restoreAttribute: boolean;
  styleValue: string | null;
  stylePriority: string;
};

type OpenPenPathFillOpacityUpdate =
  | { kind: "unmarked" }
  | { kind: "invalid" }
  | { kind: "updated"; content: string };

function readOpenPenPathFillOpacitySnapshot(
  marker: string,
  element: ParsedElement,
): OpenPenPathFillOpacitySnapshot | null {
  if (marker === "absent" || marker.startsWith("value:")) {
    const opacity = parseStyleDeclarations(
      attributeValue(element, "style") ?? "",
    ).declarations.find(
      (declaration) => cssPropertyKey(declaration.prop) === "fill-opacity",
    );
    return {
      version: 2,
      attributeValue:
        marker === "absent" ? null : marker.slice("value:".length),
      restoreAttribute: true,
      styleValue: opacity?.value ?? null,
      stylePriority: opacity?.important ? "important" : "",
    };
  }

  let snapshot: unknown;
  try {
    snapshot = JSON.parse(marker);
  } catch {
    // coercion-ok: malformed persisted metadata is returned as invalid and rejected by the caller.
    return null;
  }
  if (
    typeof snapshot === "object" &&
    snapshot !== null &&
    "version" in snapshot &&
    snapshot.version === 2 &&
    "restoreAttribute" in snapshot &&
    typeof snapshot.restoreAttribute === "boolean" &&
    "attributeValue" in snapshot &&
    (snapshot.attributeValue === null ||
      typeof snapshot.attributeValue === "string") &&
    "styleValue" in snapshot &&
    (snapshot.styleValue === null || typeof snapshot.styleValue === "string") &&
    "stylePriority" in snapshot &&
    typeof snapshot.stylePriority === "string"
  ) {
    return snapshot as OpenPenPathFillOpacitySnapshot;
  }
  return null;
}

function updateOpenPenPathFillOpacity(
  html: string,
  element: ParsedElement,
  value: string | null,
): OpenPenPathFillOpacityUpdate {
  if (element.tag !== "path") return { kind: "unmarked" };
  const marker = attributeValue(element, OPEN_PEN_PATH_FILL_OPACITY);
  if (marker === null) return { kind: "unmarked" };

  const snapshot = readOpenPenPathFillOpacitySnapshot(marker, element);
  if (!snapshot) return { kind: "invalid" };

  const declaration = value
    ? parseStyleDeclarations(`fill-opacity: ${value}`).declarations[0]
    : undefined;
  if (value && !declaration) return { kind: "invalid" };
  return {
    kind: "updated",
    content: replaceOrInsertAttribute(
      html,
      element,
      OPEN_PEN_PATH_FILL_OPACITY,
      JSON.stringify({
        ...snapshot,
        styleValue: declaration?.value ?? null,
        stylePriority: declaration?.important ? "important" : "",
      }),
    ),
  };
}

function updateOpenPenPathFillOpacityAttribute(
  element: ParsedElement,
  value: string,
): string | null | undefined {
  if (element.tag !== "path") return undefined;
  const marker = attributeValue(element, OPEN_PEN_PATH_FILL_OPACITY);
  if (marker === null) return undefined;
  const snapshot = readOpenPenPathFillOpacitySnapshot(marker, element);
  if (!snapshot) return null;
  return JSON.stringify({
    ...snapshot,
    attributeValue: value,
    restoreAttribute: false,
  });
}

const BORDER_RADIUS_PROPERTY = /^border(-[a-z]+)*-radius$/;
const SOURCE_PATH_DATA_ATTRIBUTE = "data-an-source-d";

/**
 * A Figma-imported vector without `preserveAspectRatio` would letterbox on a
 * non-uniform resize, where Figma stretches it. Icons authored elsewhere keep
 * the SVG default.
 */
function importedVectorLetterboxes(element: ParsedElement): boolean {
  const has = (name: string) =>
    element.attributes.some((attribute) => attribute.lowerName === name);
  return (
    has("data-figma-node-id") && has("viewbox") && !has("preserveaspectratio")
  );
}

/**
 * An SVG vector's corner radius rounds its path vertices (Figma); CSS
 * border-radius on the `<svg>` would only round its box. A corner longhand
 * has no per-vertex meaning here and just clears any stale box radius.
 */
function roundSvgVectorCorners(
  html: string,
  svgIndex: number,
  radiusValue: string | null,
): string | "unsupported" {
  const svg = parseHtmlElements(html)[svgIndex];
  if (!svg) return "unsupported";
  const style = parseStyleDeclarations(attributeValue(svg, "style"));
  removeStyleDeclarations(style, [
    "border-radius",
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
  ]);
  let content = replaceOrInsertAttribute(
    html,
    svg,
    "style",
    serializeStyleDeclarations(style),
  );
  if (radiusValue === null) return content;
  const radius = /^\d+(\.\d+)?(px)?$/.test(radiusValue.trim())
    ? Number.parseFloat(radiusValue)
    : Number.NaN;
  if (!Number.isFinite(radius)) return "unsupported";
  const rounded =
    attributeValue(
      parseHtmlElements(content)[svgIndex]!,
      "data-an-pen-nodes",
    ) !== null
      ? roundPenVectorPath(content, svgIndex, radius)
      : roundImportedSvgPaths(content, svgIndex, radius);
  if (rounded === "unsupported") return rounded;
  return replaceOrInsertAttribute(
    rounded,
    parseHtmlElements(rounded)[svgIndex]!,
    PEN_CORNER_RADIUS_ATTRIBUTE,
    String(radius),
  );
}

/** The vector's radius replaces every per-vertex radius, as in Figma. */
function roundPenVectorPath(
  html: string,
  svgIndex: number,
  radius: number,
): string | "unsupported" {
  const elements = parseHtmlElements(html);
  const svg = elements[svgIndex]!;
  const penPath = parsePenNodes(attributeValue(svg, "data-an-pen-nodes")!);
  const pathElement = svg.childIndexes
    .map((index) => elements[index])
    .find((child) => child?.tag === "path");
  if (!penPath || !pathElement) return "unsupported";
  const uniform = withoutVertexRadii(penPath);
  const withPath = replaceOrInsertAttribute(
    html,
    pathElement,
    "d",
    serializeRoundedPenPath(uniform, radius),
  );
  return replaceOrInsertAttribute(
    withPath,
    parseHtmlElements(withPath)[svgIndex]!,
    "data-an-pen-nodes",
    serializePenNodes(uniform),
  );
}

/**
 * Pasted or imported vectors keep their own coordinates: each path's original
 * `d` is kept aside, and the radius is converted into path units through the
 * viewBox and any `<g>` scale between the `<svg>` and the path.
 */
function roundImportedSvgPaths(
  html: string,
  svgIndex: number,
  radius: number,
): string | "unsupported" {
  const elements = parseHtmlElements(html);
  const svg = elements[svgIndex]!;
  const viewBox = attributeValue(svg, "viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const style = parseStyleDeclarations(attributeValue(svg, "style"));
  const cssSize = (prop: string) => {
    const value = style.declarations.find(
      (declaration) => cssPropertyKey(declaration.prop) === prop,
    )?.value;
    return value && /^[\d.]+px$/.test(value.trim())
      ? Number.parseFloat(value)
      : null;
  };
  let viewBoxScale = 1;
  if (viewBox?.length === 4 && viewBox[2]! > 0 && viewBox[3]! > 0) {
    const width = cssSize("width");
    const height = cssSize("height");
    if (width === null || height === null) return "unsupported";
    viewBoxScale = Math.sqrt((width / viewBox[2]!) * (height / viewBox[3]!));
  }
  const paths: ParsedElement[] = [];
  const collect = (element: ParsedElement) => {
    for (const childIndex of element.childIndexes) {
      const child = elements[childIndex]!;
      if (child.tag === "path") paths.push(child);
      else if (child.tag === "g") collect(child);
    }
  };
  collect(svg);
  if (paths.length === 0) return "unsupported";

  let content = html;
  for (const { index } of paths) {
    const current = parseHtmlElements(content);
    const path = current[index]!;
    let scale = viewBoxScale;
    for (
      let node: ParsedElement | undefined = path;
      node && node.index !== svgIndex;
      node =
        node.parentIndex === undefined ? undefined : current[node.parentIndex]
    ) {
      const transformScale = svgTransformScale(
        attributeValue(node, "transform"),
      );
      if (transformScale === null) return "unsupported";
      scale *= transformScale;
    }
    const sourceD =
      attributeValue(path, SOURCE_PATH_DATA_ATTRIBUTE) ??
      attributeValue(path, "d");
    const subpaths = sourceD ? parseSvgPathData(sourceD) : null;
    if (!sourceD || !subpaths || !(scale > 0)) return "unsupported";
    const d =
      radius > 0
        ? subpaths
            .map((subpath) =>
              serializeRoundedPenPath(subpath, radius / scale, 3),
            )
            .join(" ")
        : sourceD;
    content = replaceOrInsertAttribute(content, path, "d", d);
    content = replaceOrInsertAttribute(
      content,
      parseHtmlElements(content)[index]!,
      SOURCE_PATH_DATA_ATTRIBUTE,
      sourceD,
    );
  }
  return content;
}

/** Uniform scale of an SVG `transform`; `null` when it skews. */
function svgTransformScale(transform: string | null): number | null {
  if (!transform?.trim()) return 1;
  let scale = 1;
  const functions = transform.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g);
  for (const [, name, rawArgs] of functions) {
    const args = rawArgs!
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (args.some((arg) => !Number.isFinite(arg))) return null;
    if (name === "scale") {
      scale *= Math.sqrt(Math.abs(args[0]! * (args[1] ?? args[0]!)));
    } else if (name === "matrix" && args.length === 6) {
      scale *= Math.sqrt(Math.abs(args[0]! * args[3]! - args[1]! * args[2]!));
    } else if (name !== "translate" && name !== "rotate") {
      return null;
    }
  }
  return scale;
}

function applyStyleRemoveEdit(
  html: string,
  element: ParsedElement,
  intent: StyleRemoveEditIntent,
  route: StyleEditTargetRoute,
): { content: string; capability: EditCapability } | PatchResultStatus {
  const property = normalizeStyleProperty(intent.property);
  if (!property || property === "--an-vector-stroke-position") {
    return "unsupported";
  }
  if (isVectorEndpointProperty(property)) {
    const content = applyVectorEndpointEdit(html, element, property, "none");
    if (content === "unsupported") return content;
    return {
      content,
      capability: {
        kind: "style",
        properties: [property],
        confidence: 0.9,
      },
    };
  }
  if (route.kind !== "ordinary" && route.kind !== "vector-paint") {
    return "unsupported";
  }

  const styleElement = route.kind === "vector-paint" ? route.element : element;
  if (
    attributeValue(styleElement, VECTOR_STROKE_OVERLAY) !== null ||
    attributeValue(styleElement, VECTOR_STROKE_GEOMETRY) !== null
  ) {
    return "unsupported";
  }
  const currentStyle = attributeValue(styleElement, "style");
  if (property === "fill-opacity") {
    const opacityUpdate = updateOpenPenPathFillOpacity(
      html,
      styleElement,
      null,
    );
    if (opacityUpdate.kind === "invalid") return "unsupported";
    if (opacityUpdate.kind === "updated") {
      return {
        content: opacityUpdate.content,
        capability: { kind: "style", properties: [property], confidence: 0.9 },
      };
    }
  }
  const previousStroke =
    property === "stroke" ? vectorStyleValue(styleElement, "stroke") : null;
  const previousFill =
    property === "fill" ? vectorStyleValue(styleElement, "fill") : null;
  if (currentStyle === null) {
    return {
      content: html,
      capability: { kind: "style", properties: [property], confidence: 0.9 },
    };
  }

  const declarations = parseStyleDeclarations(currentStyle);
  removeStyleDeclarations(declarations, [property]);
  const nextStyle = serializeStyleDeclarations(declarations);
  if (nextStyle === currentStyle) {
    return {
      content: html,
      capability: { kind: "style", properties: [property], confidence: 0.9 },
    };
  }
  let content = nextStyle.trim()
    ? replaceOrInsertAttribute(html, styleElement, "style", nextStyle)
    : removeAttributeFromHtml(html, styleElement, "style");
  if (route.kind === "vector-paint") {
    if (property === "stroke") {
      content = clearVectorStrokeGradientState(
        content,
        styleElement,
        previousStroke,
      );
    }
    if (property === "fill") {
      content = clearVectorFillGradientState(
        content,
        styleElement,
        previousFill,
      );
    }
    content = clearVectorWrapperPaint(content, element);
  }
  return {
    content,
    capability: { kind: "style", properties: [property], confidence: 0.9 },
  };
}

function normalizedSafeStyleValue(
  property: string,
  value: string,
): { property: VisualStyleProperty; value: string } | null {
  const normalizedProperty = normalizeStyleProperty(property);
  if (!normalizedProperty || !isSafeStyleValue(normalizedProperty, value)) {
    return null;
  }
  return { property: normalizedProperty, value: value.trim() };
}

function booleanOperandFor(element: ParsedElement): boolean {
  return (
    element.tag === "svg" &&
    attributeValue(element, "data-an-primitive") === "boolean-operand"
  );
}

const BOOLEAN_OPERAND_PAINT_PROPERTIES: Partial<Record<string, string>> = {
  fill: "--operand-fill",
  "fill-opacity": "--operand-fill-opacity",
  opacity: "--operand-opacity",
  stroke: "--operand-stroke",
  "stroke-width": "--operand-stroke-width",
  "stroke-opacity": "--operand-stroke-opacity",
};

const BOOLEAN_RESULT_PAINT_PROPERTIES: Partial<Record<string, string>> = {
  fill: "--boolean-mask-fill",
  "fill-opacity": "--boolean-mask-fill-opacity",
  stroke: "--boolean-mask-stroke",
  "stroke-width": "--boolean-mask-stroke-width",
  "stroke-opacity": "--boolean-mask-stroke-opacity",
};

function applyReleasedSvgShapeStyleEdit(
  html: string,
  element: ParsedElement,
  intent: StyleEditIntent,
  elements: ParsedElement[],
): { content: string; capability: EditCapability } | PatchResultStatus {
  const property = normalizeStyleProperty(intent.property);
  if (property !== "border-radius") {
    const paintChild = vectorPaintChild(
      html,
      element,
      intent.property,
      elements,
    );
    return applyStyleEdit(html, paintChild ?? element, intent);
  }
  if (!isSafeStyleValue(property, intent.value)) return "unsupported";
  if (attributeValue(element, "data-an-primitive") !== "rectangle") {
    return "unsupported";
  }
  const rect = vectorShapeChild(element, elements);
  const width = Number(attributeValue(element, "width"));
  const height = Number(attributeValue(element, "height"));
  const radius = booleanShapeRadius(intent.value, width, height);
  if (
    !rect ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !radius
  ) {
    return "unsupported";
  }
  let rectStyle = setStyleValue(
    attributeValue(rect, "style"),
    "rx" as VisualStyleProperty,
    `${radius.x}px`,
  );
  rectStyle = setStyleValue(
    rectStyle,
    "ry" as VisualStyleProperty,
    `${radius.y}px`,
  );
  return {
    content: patchElementAttributes(html, [
      {
        element,
        attributes: {
          style: setStyleValue(
            attributeValue(element, "style"),
            "border-radius",
            intent.value.trim(),
          ),
        },
      },
      {
        element: rect,
        attributes: {
          rx: String(radius.x),
          ry: String(radius.y),
          style: rectStyle,
        },
      },
    ]),
    capability: { kind: "style", properties: [property], confidence: 0.9 },
  };
}

function patchElementAttributes(
  html: string,
  updates: Array<{
    element: ParsedElement;
    attributes: Record<string, string | null>;
  }>,
): string {
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const insertions = new Map<number, string[]>();
  for (const { element, attributes } of updates) {
    const missing: string[] = [];
    for (const [name, value] of Object.entries(attributes)) {
      if (value === null) {
        for (const attribute of element.attributes.filter(
          (candidate) => candidate.lowerName === name.toLowerCase(),
        )) {
          replacements.push({
            start: attribute.start,
            end: attribute.end,
            value: "",
          });
        }
        continue;
      }
      const existing = getAttribute(element, name);
      const serialized = `${name}="${escapeHtmlAttribute(value)}"`;
      if (existing) {
        replacements.push({
          start: existing.start,
          end: existing.end,
          value: serialized,
        });
      } else {
        missing.push(serialized);
      }
    }
    if (missing.length > 0) {
      const rawOpen = html.slice(element.start, element.openEnd);
      const closeIndex = element.openEnd - 1;
      const slashIndex = rawOpen.trimEnd().endsWith("/>")
        ? html.lastIndexOf("/", closeIndex)
        : -1;
      const insertAt = slashIndex > element.start ? slashIndex : closeIndex;
      insertions.set(insertAt, [
        ...(insertions.get(insertAt) ?? []),
        ...missing,
      ]);
    }
  }
  for (const [start, attributes] of insertions) {
    replacements.push({
      start,
      end: start,
      value: ` ${attributes.join(" ")}`,
    });
  }
  let result = html;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    result = `${result.slice(0, replacement.start)}${replacement.value}${result.slice(replacement.end)}`;
  }
  return result;
}

/** Patch attributes on projected nodes using the parser's exact attribute spans. */
export function patchCodeLayerNodeAttributes(
  html: string,
  updates: Array<{
    node: CodeLayerNode;
    attributes: Record<string, string | null>;
  }>,
): string | null {
  const elementsByStart = new Map(
    parseHtmlElements(html).map((element) => [element.start, element] as const),
  );
  const parsedUpdates: Array<{
    element: ParsedElement;
    attributes: Record<string, string | null>;
  }> = [];
  for (const update of updates) {
    const openStart = update.node.source?.openStart;
    const element =
      openStart === undefined ? undefined : elementsByStart.get(openStart);
    if (!element) return null;
    parsedUpdates.push({ element, attributes: update.attributes });
  }
  return patchElementAttributes(html, parsedUpdates);
}

/** Read an exact leaf text value through the parser spans used by edit intents. */
export function readCodeLayerNodeTextContent(
  html: string,
  node: CodeLayerNode,
): string | null {
  const openStart = node.source?.openStart;
  const element =
    openStart === undefined
      ? undefined
      : parseHtmlElements(html).find(
          (candidate) => candidate.start === openStart,
        );
  if (
    !element ||
    element.selfClosing ||
    element.childIndexes.length > 0 ||
    element.contentStart > element.contentEnd
  ) {
    return null;
  }
  return decodeBasicHtmlEntities(
    html.slice(element.contentStart, element.contentEnd),
  );
}

function isWithinParsedElement(
  element: ParsedElement,
  ancestor: ParsedElement,
  elements: readonly ParsedElement[],
): boolean {
  let current: ParsedElement | undefined = element;
  while (current) {
    if (current.index === ancestor.index) return true;
    current =
      current.parentIndex === undefined
        ? undefined
        : elements[current.parentIndex];
  }
  return false;
}

function applyBooleanOperandStyleEdit(
  html: string,
  element: ParsedElement,
  intent: StyleEditIntent,
  elements: ParsedElement[],
): { content: string; capability: EditCapability } | PatchResultStatus {
  const property = normalizeStyleProperty(intent.property);
  if (!property || !isSafeStyleValue(property, intent.value)) {
    return "unsupported";
  }
  if (
    [
      "border-top-left-radius",
      "border-top-right-radius",
      "border-bottom-right-radius",
      "border-bottom-left-radius",
    ].includes(property)
  ) {
    return "unsupported";
  }
  if (
    !BOOLEAN_OPERAND_PAINT_PROPERTIES[property] &&
    ![
      "left",
      "top",
      "width",
      "height",
      "border-radius",
      "transform",
      "position",
    ].includes(property)
  ) {
    return "unsupported";
  }
  // The inspector can include this companion edit before left/top because
  // SVG operands under <defs> report a non-positioned computed style.
  if (property === "position" && intent.value.trim() !== "absolute") {
    return "unsupported";
  }
  const svg = elements[element.index];
  const rect = svg?.childIndexes
    .map((index) => elements[index])
    .find((child) => child?.tag === "rect");
  if (!svg || !rect) return "conflict";
  const nextStyle = setStyleValue(
    attributeValue(svg, "style"),
    (BOOLEAN_OPERAND_PAINT_PROPERTIES[property] ??
      property) as VisualStyleProperty,
    intent.value.trim(),
  );
  const svgAttributes: Record<string, string> = { style: nextStyle };
  const rectAttributes: Record<string, string> = {};
  const changesGeometry = [
    "left",
    "top",
    "width",
    "height",
    "border-radius",
    "stroke-width",
  ].includes(property);
  if (!changesGeometry) {
    return {
      content: patchElementAttributes(html, [
        { element: svg, attributes: svgAttributes },
      ]),
      capability: { kind: "style", properties: [property], confidence: 0.9 },
    };
  }
  const currentWidth = Number(attributeValue(svg, "width"));
  const currentHeight = Number(attributeValue(svg, "height"));
  const width =
    property === "width" ? parsePixelLength(intent.value) : currentWidth;
  const height =
    property === "height" ? parsePixelLength(intent.value) : currentHeight;
  if (
    (property === "width" || property === "height") &&
    (width === null || height === null || width <= 0 || height <= 0)
  ) {
    return "unsupported";
  }
  if (property === "left" || property === "top") {
    const position = parsePixelLength(intent.value);
    if (position === null) return "unsupported";
    svgAttributes[property === "left" ? "x" : "y"] = String(position);
  }
  if (width !== null && height !== null) {
    const shape = attributeValue(svg, "data-an-boolean-shape");
    const oldStrokeWidthValue =
      parseStyle(attributeValue(svg, "style"))["--operand-stroke-width"] ?? "0";
    const oldStrokeWidth =
      parsePixelLength(oldStrokeWidthValue) ?? Number(oldStrokeWidthValue);
    const strokeWidth =
      property === "stroke-width"
        ? (parsePixelLength(intent.value) ?? Number(intent.value))
        : oldStrokeWidth;
    if (!Number.isFinite(strokeWidth) || strokeWidth < 0) return "unsupported";
    const inset = strokeWidth / 2;
    const innerWidth = Math.max(0, width - strokeWidth);
    const innerHeight = Math.max(0, height - strokeWidth);
    const radius = booleanShapeRadius(
      property === "border-radius"
        ? intent.value
        : parseStyle(attributeValue(svg, "style"))["border-radius"],
      width,
      height,
    );
    if (!radius) return "unsupported";
    rectAttributes.x = String(inset);
    rectAttributes.y = String(inset);
    rectAttributes.width = String(innerWidth);
    rectAttributes.height = String(innerHeight);
    rectAttributes.rx = String(
      shape === "ellipse" ? innerWidth / 2 : Math.max(0, radius.x - inset),
    );
    rectAttributes.ry = String(
      shape === "ellipse" ? innerHeight / 2 : Math.max(0, radius.y - inset),
    );
    svgAttributes.width = String(width);
    svgAttributes.height = String(height);
    svgAttributes.viewBox = `0 0 ${width} ${height}`;
  }
  const content = patchElementAttributes(html, [
    { element: svg, attributes: svgAttributes },
    { element: rect, attributes: rectAttributes },
  ]);
  return {
    content,
    capability: { kind: "style", properties: [property], confidence: 0.9 },
  };
}

function applyBooleanResultStyleEdit(
  html: string,
  element: ParsedElement,
  intent: StyleEditIntent,
  elements: ParsedElement[],
): { content: string; capability: EditCapability } | PatchResultStatus {
  const property = normalizeStyleProperty(intent.property);
  const customProperty = property && BOOLEAN_RESULT_PAINT_PROPERTIES[property];
  const use = vectorShapeChild(element, elements);
  if (!property) return "unsupported";
  if (
    property === "border-radius" ||
    [
      "border-top-left-radius",
      "border-top-right-radius",
      "border-bottom-right-radius",
      "border-bottom-left-radius",
    ].includes(property)
  ) {
    if (!use || !isSafeStyleValue(property, intent.value)) return "unsupported";
    const rootStyle = parseStyle(attributeValue(element, "style"));
    const dimensions = attributeValue(element, "viewBox")
      ?.trim()
      .split(/\s+/)
      .slice(2)
      .map(Number);
    const [width, height] = dimensions ?? [];
    const requestedRadius =
      width && height ? booleanShapeRadius(intent.value, width, height) : null;
    if (!requestedRadius) return "unsupported";
    if (property !== "border-radius") {
      const existingRadius =
        width && height
          ? booleanShapeRadius(rootStyle["border-radius"], width, height)
          : null;
      if (
        !existingRadius ||
        existingRadius.x !== requestedRadius.x ||
        existingRadius.y !== requestedRadius.y
      ) {
        return "unsupported";
      }
      return {
        content: html,
        capability: { kind: "style", properties: [property], confidence: 0.9 },
      };
    }

    const baseHref = attributeValue(use, "href");
    const baseGeometryId = baseHref?.startsWith("#")
      ? baseHref.slice(1)
      : undefined;
    const baseGeometry = elements.find(
      (candidate) =>
        candidate.tag === "svg" &&
        attributeValue(candidate, "id") === baseGeometryId &&
        attributeValue(candidate, "data-an-boolean-operand") === "base",
    );
    if (
      !baseGeometry ||
      attributeValue(baseGeometry, "data-an-boolean-shape") !== "rectangle"
    ) {
      return "unsupported";
    }
    const maskId = attributeValue(use, "mask")?.match(
      /^url\(#([^\s)]+)\)$/,
    )?.[1];
    const mask = elements.find(
      (candidate) =>
        candidate.tag === "mask" && attributeValue(candidate, "id") === maskId,
    );
    const whiteMaskUse = mask?.childIndexes
      .map((index) => elements[index])
      .find(
        (candidate) =>
          candidate?.tag === "use" &&
          attributeValue(candidate, "href") === baseHref,
      );
    if (!mask || !whiteMaskUse) return "conflict";

    const radiusProperties = [
      ["--boolean-result-radius-x", `${requestedRadius.x}px`],
      ["--boolean-result-radius-y", `${requestedRadius.y}px`],
    ] as const;
    const setRadiusProperties = (style: string | null) => {
      let nextStyle = style ?? "";
      for (const [name, value] of radiusProperties) {
        nextStyle = setStyleValue(
          nextStyle,
          name as VisualStyleProperty,
          value,
        );
      }
      return nextStyle;
    };
    return {
      content: patchElementAttributes(html, [
        {
          element,
          attributes: {
            style: setStyleValue(
              attributeValue(element, "style"),
              "border-radius",
              intent.value.trim(),
            ),
          },
        },
        {
          element: use,
          attributes: {
            style: setRadiusProperties(attributeValue(use, "style")),
          },
        },
        {
          element: whiteMaskUse,
          attributes: {
            style: setRadiusProperties(attributeValue(whiteMaskUse, "style")),
          },
        },
      ]),
      capability: { kind: "style", properties: [property], confidence: 0.9 },
    };
  }
  if (!customProperty) {
    if (
      VECTOR_WRAPPER_BOX_PAINT.has(property) ||
      property.startsWith("border-")
    ) {
      return "unsupported";
    }
    return applyStyleEdit(html, element, intent);
  }
  if (!use) return "conflict";
  if (!isSafeStyleValue(property, intent.value)) return "unsupported";
  const nextStyle = setStyleValue(
    attributeValue(element, "style"),
    customProperty as VisualStyleProperty,
    intent.value.trim(),
  );
  const styleUpdates = [
    { element, attributes: { style: nextStyle } },
    {
      element: use,
      attributes: {
        style: setStyleValue(
          attributeValue(use, "style"),
          customProperty as VisualStyleProperty,
          intent.value.trim(),
        ),
      },
    },
  ];
  if (property.startsWith("stroke")) {
    for (const cutterStrokeUse of elements.filter(
      (candidate) =>
        candidate.tag === "use" &&
        attributeValue(candidate, "data-an-boolean-cutter-stroke") === "true" &&
        isWithinParsedElement(candidate, element, elements),
    )) {
      styleUpdates.push({
        element: cutterStrokeUse,
        attributes: {
          style: setStyleValue(
            attributeValue(cutterStrokeUse, "style"),
            customProperty as VisualStyleProperty,
            intent.value.trim(),
          ),
        },
      });
    }
  }
  return {
    content: patchElementAttributes(html, styleUpdates),
    capability: { kind: "style", properties: [property], confidence: 0.9 },
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

// Same shape as the bridge's own attributeOverrides guard (editor-chrome.bridge.ts)
// — alphanumeric/dash/colon/dot/underscore, must start with a letter, never an
// `on*` event handler. URL-bearing values get a second scheme check below so a
// general attribute edit cannot persist executable markup.
const SAFE_ATTRIBUTE_NAME = /^(?!on)[a-zA-Z][a-zA-Z0-9:_.-]*$/;
const URL_ATTRIBUTE_NAMES = new Set([
  "action",
  "background",
  "cite",
  "data",
  "formaction",
  "href",
  "poster",
  "src",
  "srcset",
  "xlink:href",
]);

function isSafeAttributeValue(name: string, value: string): boolean {
  const lowerName = name.toLowerCase();
  if (lowerName === "style" || lowerName === "srcdoc") return false;
  if (!URL_ATTRIBUTE_NAMES.has(lowerName)) return true;

  const decoded = decodeBasicHtmlEntities(value);
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return false;
  const candidates =
    lowerName === "srcset"
      ? decoded
          .split(",")
          .map((candidate) => candidate.trim().split(/\s+/, 1)[0] ?? "")
      : [decoded.trim()];
  return candidates.every((candidate) => {
    if (!candidate) return true;
    const compact = candidate.replace(/[\u0000-\u0020]+/g, "");
    if (/^(?:javascript|vbscript):/i.test(compact)) return false;
    if (/^data:/i.test(compact)) {
      return /^data:image\/(?:png|jpe?g|gif|webp);/i.test(compact);
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(compact)) {
      return /^(?:https?|mailto|tel):/i.test(compact);
    }
    return true;
  });
}

function applyAttributeEdit(
  html: string,
  element: ParsedElement,
  intent: AttributeEditIntent,
): { content: string; capability: EditCapability } | PatchResultStatus {
  if (!intent.name || !SAFE_ATTRIBUTE_NAME.test(intent.name)) {
    return "unsupported";
  }
  if (!isSafeAttributeValue(intent.name, intent.value)) return "unsupported";
  const attributes: Record<string, string | null> = {
    [intent.name]: intent.value,
  };
  if (intent.name.toLowerCase() === "fill-opacity") {
    const marker = updateOpenPenPathFillOpacityAttribute(element, intent.value);
    if (marker === null) return "unsupported";
    if (marker !== undefined) attributes[OPEN_PEN_PATH_FILL_OPACITY] = marker;
  }
  return {
    content: patchElementAttributes(html, [{ element, attributes }]),
    capability: {
      kind: "attribute",
      operations: ["set"],
      confidence: 0.95,
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
 *               replace-if-same-stem semantics. When `intent.from` is set, the
 *               EFFECTIVE utility at `prefix` must match it exactly or the edit
 *               is rejected as `"conflict"` (guards against a stale selection
 *               silently rewriting the wrong element/breakpoint). "Effective"
 *               follows the Tailwind mobile-first cascade: an explicit override
 *               at `prefix` wins; otherwise the nearest smaller breakpoint's
 *               utility (down to base) is what the caller would have seen.
 * - `"remove"`:  calls `removePropertyClass(className, prefix, stem)` — strips
 *               all tokens with the given property stem at the target prefix,
 *               falling back to the base value (Tailwind cascade).
 *
 * Uses the helpers from `responsive-classes.ts` so the logic is shared with
 * the StatesPanel / inspector UI.
 */
/** Mobile-first breakpoint order used to resolve the effective utility at a prefix. */
const BREAKPOINT_CASCADE: ReadonlyArray<TailwindBreakpointPrefix> = [
  "base",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
];

/**
 * Resolve the utilities EFFECTIVE at `prefix` for the given property `stem`,
 * following the Tailwind mobile-first cascade: an explicit override at
 * `prefix` wins; otherwise the nearest smaller breakpoint (down to base) with
 * a token for that stem is what actually renders there.
 */
function effectivePropertyUtilities(
  className: string,
  prefix: TailwindBreakpointPrefix,
  stem: string,
): string[] {
  for (let i = BREAKPOINT_CASCADE.indexOf(prefix); i >= 0; i--) {
    const tokens = getPropertyClasses(className, BREAKPOINT_CASCADE[i], stem);
    if (tokens.length > 0) {
      return tokens.map((token) => parseClassToken(token).utility);
    }
  }
  return [];
}

function applyResponsiveClassEdit(
  html: string,
  element: ParsedElement,
  intent: ResponsiveClassEditIntent,
): { content: string; capability: EditCapability } | PatchResultStatus {
  const currentClass = attributeValue(element, "class") ?? "";
  const maxWidthPx =
    intent.maxWidthPx !== undefined &&
    Number.isFinite(intent.maxWidthPx) &&
    intent.maxWidthPx > 0
      ? Math.round(intent.maxWidthPx)
      : undefined;

  let nextClass: string;
  if (intent.operation === "remove") {
    if (!intent.stem) {
      // stem is required for remove
      return "unsupported";
    }
    if (!isSafeClassToken(intent.stem)) return "unsupported";
    nextClass =
      maxWidthPx !== undefined
        ? removeMaxWidthPropertyClass(currentClass, maxWidthPx, intent.stem)
        : removePropertyClass(currentClass, intent.prefix, intent.stem);
  } else {
    // "add" and "replace" both use the same replace-if-same-stem setter.
    if (!intent.utility) return "unsupported";
    if (!isSafeClassToken(intent.utility)) return "unsupported";
    if (intent.from && maxWidthPx === undefined) {
      // `from` guard: the utility the caller expects to be effective at this
      // prefix. On mismatch (stale selection / wrong element) reject instead
      // of silently overwriting whatever is actually there. Max-width scopes
      // skip the guard — the desktop-down cascade has no prefix analog.
      if (!isSafeClassToken(intent.from)) return "unsupported";
      const effective = effectivePropertyUtilities(
        currentClass,
        intent.prefix,
        utilityStem(intent.from),
      );
      if (!effective.includes(intent.from)) return "conflict";
    }
    nextClass =
      maxWidthPx !== undefined
        ? setMaxWidthPropertyClass(currentClass, maxWidthPx, intent.utility)
        : setPropertyClass(currentClass, intent.prefix, intent.utility);
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

/**
 * Apply a breakpoint-style edit intent: persist (or remove) one raw CSS
 * declaration for the element inside the managed
 * `<style data-agent-native-breakpoints>` block, scoped to
 * `@media (max-width: <maxWidthPx>px)`.
 *
 * The rule targets the element's `data-agent-native-node-id`; when the
 * element doesn't carry one yet it is stamped first (stable hash of the
 * node's identity, mirroring `ensureCodeLayerNodeIdsInHtml`), so the media
 * rule and the element stay linked across future edits.
 */
function applyBreakpointStyleEdit(
  html: string,
  element: ParsedElement,
  node: CodeLayerNode,
  intent: BreakpointStyleEditIntent,
): { content: string; capability: EditCapability } | PatchResultStatus {
  const property = normalizeStyleProperty(intent.property);
  if (!property) return "unsupported";
  // Endpoint choices change SVG marker definitions and shape attributes as a
  // unit. A media-scoped custom property cannot express that structural
  // rewrite, so reject the write instead of persisting a value that renders
  // without its marker DOM.
  if (isVectorEndpointProperty(property)) return "unsupported";
  if (element.tag === "svg" && BORDER_RADIUS_PROPERTY.test(property)) {
    return "unsupported";
  }
  if (!Number.isFinite(intent.maxWidthPx) || intent.maxWidthPx <= 0) {
    return "unsupported";
  }
  const maxWidthPx = Math.round(intent.maxWidthPx);
  const operation = intent.operation ?? "set";

  // Resolve the stable node id, stamping one when missing so the managed
  // rule has a durable anchor.
  const existingId = attributeValue(
    element,
    "data-agent-native-node-id",
  )?.trim();
  let nodeId = existingId || stableAttributeValueForNode(node);
  let content = html;
  if (!existingId) {
    if (content.includes(`data-agent-native-node-id="${nodeId}"`)) {
      // Extremely unlikely hash collision with another stamped node — derive
      // a distinct id from the element's source span.
      nodeId = `an-${hashStable(`${nodeId}:${element.start}:${element.end}`)}`;
    }
    content = replaceOrInsertAttribute(
      content,
      element,
      "data-agent-native-node-id",
      nodeId,
    );
  }

  if (operation === "remove") {
    const next = removeBreakpointMediaDeclaration(content, {
      nodeId,
      maxWidthPx,
      property,
    });
    return {
      content: next,
      capability: {
        kind: "breakpoint-style",
        maxWidthPx,
        operations: ["remove"],
        properties: [property],
        confidence: 0.9,
      },
    };
  }

  if (intent.value === undefined || !isSafeStyleValue(property, intent.value)) {
    return "unsupported";
  }
  try {
    const next = setBreakpointMediaDeclaration(content, {
      nodeId,
      maxWidthPx,
      property,
      value: intent.value.trim(),
    });
    return {
      content: next,
      capability: {
        kind: "breakpoint-style",
        maxWidthPx,
        operations: ["set"],
        properties: [property],
        confidence: 0.9,
      },
    };
  } catch {
    // setBreakpointMediaDeclaration throws on unsafe property/value.
    return "unsupported";
  }
}

function applyMoveNodeEdit(
  html: string,
  element: ParsedElement,
  anchor: ParsedElement,
  intent: MoveNodeEditIntent,
  destinationParent?: ParsedElement,
  moveLayout?: {
    destinationIsFlow?: boolean;
    sourceWasIgnoredInFlow?: boolean;
    forceRootIntoFlow?: boolean;
  },
): { content: string; capability: EditCapability } | PatchResultStatus {
  if (
    booleanOperandFor(element) ||
    (intent.placement === "inside" &&
      (attributeValue(anchor, "data-an-primitive") === "boolean" ||
        booleanOperandFor(anchor) ||
        (destinationParent !== undefined &&
          (attributeValue(destinationParent, "data-an-primitive") ===
            "boolean" ||
            booleanOperandFor(destinationParent)))))
  ) {
    return "unsupported";
  }
  if (element.index === anchor.index) return "conflict";
  if (anchor.start >= element.start && anchor.end <= element.end) {
    return "conflict";
  }
  if (intent.placement === "inside" && anchor.selfClosing) {
    return "unsupported";
  }

  const sourceParentIndex = element.parentIndex;
  const entersNewParent =
    destinationParent !== undefined &&
    sourceParentIndex !== destinationParent.index;
  const rawFragment = html.slice(element.start, element.end);
  const fragment = entersNewParent
    ? prepareMovedFragmentForParent(rawFragment, destinationParent, moveLayout)
    : rawFragment;
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
  // A node spliced into a template's markup range lands in a detached
  // fragment: it renders nowhere and no querySelector pass can reach it
  // again. moveNodeBetweenDocuments redirects past the template for the same
  // reason; here there is no destination to fall back to.
  if (isOffsetInsideTemplateInterior(withoutTarget, insertAt)) {
    return "unsupported";
  }

  return {
    content: `${withoutTarget.slice(0, insertAt)}${fragment}${withoutTarget.slice(insertAt)}`,
    capability: {
      kind: "structure",
      operations: ["moveNode"],
      confidence: 0.78,
    },
  };
}

/**
 * Whether children of this element participate in normal flex/grid flow.
 * Inline style is authoritative for inspector-created auto layout; the class
 * checks cover authored Tailwind/utility layouts in standalone Alpine files.
 */
function isFlowLayoutContainer(element: ParsedElement | undefined): boolean {
  if (!element) return false;
  const display = parseStyle(attributeValue(element, "style")).display;
  if (display !== undefined) {
    return ["flex", "inline-flex", "grid", "inline-grid"].includes(display);
  }
  const classes = new Set(classList(element));
  return (
    classes.has("flex") ||
    classes.has("inline-flex") ||
    classes.has("grid") ||
    classes.has("inline-grid")
  );
}

function isOutOfFlowElement(element: ParsedElement): boolean {
  const position = parseStyle(attributeValue(element, "style")).position;
  if (position !== undefined) {
    return position === "absolute" || position === "fixed";
  }
  return classList(element).some((token) => {
    const variants = token.split(":");
    const utility = variants[variants.length - 1]?.replace(/^!/, "");
    return utility === "absolute" || utility === "fixed";
  });
}

/**
 * A Figma auto-layout drop makes the moved layer a flow child. Carrying its
 * former `position:absolute` offsets into the new flex/grid parent leaves it
 * visually detached from ordering, gap, and alignment even though the layer
 * tree says it was reparented. Normalize only the moved fragment's root; its
 * descendants keep their own positioning contexts unchanged.
 */
function prepareMovedFragmentForParent(
  fragment: string,
  destinationParent: ParsedElement | undefined,
  moveLayout?: {
    destinationIsFlow?: boolean;
    sourceWasIgnoredInFlow?: boolean;
    forceRootIntoFlow?: boolean;
  },
): string {
  const fragmentRoot = parseHtmlElements(fragment).find(
    (element) => element.parentIndex === undefined,
  );
  if (!fragmentRoot) return fragment;
  const destinationIsFlow =
    moveLayout?.destinationIsFlow ?? isFlowLayoutContainer(destinationParent);
  if (destinationIsFlow) {
    if (moveLayout?.sourceWasIgnoredInFlow) return fragment;
    return stripAbsolutePositioningFromChild(
      fragment,
      fragmentRoot,
      moveLayout?.forceRootIntoFlow ?? false,
    );
  }
  // Mirror image: entering a non-flow (absolute/freeform) parent, or the
  // document root, strips any leftover flex/grid-item-only styling instead —
  // see stripFlexItemStylingFromChild's doc comment.
  return stripFlexItemStylingFromChild(fragment, fragmentRoot);
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
  const parsed = parseStyleDeclarations(styleValue);
  removeStyleDeclarations(parsed, propertiesToRemove);
  return serializeStyleDeclarations(parsed);
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
 * Flex/grid-item-only properties stripped when a fragment leaves auto-layout
 * flow for a non-flow (absolute/freeform) destination parent — the mirror
 * image of AUTO_LAYOUT_STRIP_PROPS. Mirrors FLEX_ITEM_INLINE_PROPS in
 * editor-chrome.bridge.ts's prepareFlowMembersForAbsoluteDrop and
 * FLEX_ITEM_PROPS in DesignEditor.tsx's setAbsolutePositioningForNodeInHtml
 * (the same-document/canvas-drag persistence paths for this exact leak);
 * this is the moveNodeBetweenDocuments seam other reparent flows (e.g. a
 * Layers-panel cross-screen move) go through instead.
 */
const FLEX_ITEM_STRIP_PROPS = [
  "flex",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "align-self",
  "order",
] as const;

/**
 * Properties whose old flow placement would be counted twice after a direct
 * child is pinned to its measured position inside a new relative wrapper.
 */
const MEASURED_FLOW_REBASE_STRIP_PROPS = [
  "position",
  "left",
  "top",
  "right",
  "bottom",
  "inset",
  "inset-block",
  "inset-block-start",
  "inset-block-end",
  "inset-inline",
  "inset-inline-start",
  "inset-inline-end",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "margin-block",
  "margin-block-start",
  "margin-block-end",
  "margin-inline",
  "margin-inline-start",
  "margin-inline-end",
] as const;

/**
 * Strip absolute-positioning properties from a child's inline style, applying
 * the edit directly to the html string at the child element's source spans.
 * Returns the updated html string.
 */
function stripAbsolutePositioningFromChild(
  html: string,
  child: ParsedElement,
  forceRootIntoFlow = false,
): string {
  const currentStyle = attributeValue(child, "style");
  const isFrame =
    (
      attributeValue(child, "data-an-primitive") ||
      attributeValue(child, "data-agent-native-primitive")
    )?.toLowerCase() === "frame";
  const strippedStyle = currentStyle
    ? stripStyleProperties(currentStyle, [...AUTO_LAYOUT_STRIP_PROPS])
    : "";
  let nextStyle = strippedStyle;
  if (isFrame || forceRootIntoFlow) {
    const declarations = parseStyleDeclarations(strippedStyle);
    for (const [property, value] of [
      ["position", "relative !important"],
      ["left", "auto !important"],
      ["top", "auto !important"],
      ["right", "auto !important"],
      ["bottom", "auto !important"],
    ]) {
      setStyleDeclaration(declarations, property, value);
    }
    nextStyle = serializeStyleDeclarations(declarations);
  }
  let nextHtml =
    currentStyle || isFrame || forceRootIntoFlow
      ? replaceOrInsertAttribute(html, child, "style", nextStyle)
      : html;

  // Source-backed Alpine/Tailwind designs commonly express positioning as
  // utility classes instead of inline CSS. Once the layer moves into a new
  // flex/grid parent, those utilities would keep it out of flow even though
  // the Layers tree shows it as a child. Remove only position-mode utilities;
  // inset utilities can remain because they are inert for a statically
  // positioned flex/grid item, and preserving them avoids needless source
  // churn if the user later makes the layer absolute again.
  // Re-find THE CHILD: this also runs against whole documents (see
  // applyAutoLayout), where the reparse's root is the container, not the child.
  const reparsed = parseHtmlElements(nextHtml);
  const childNodeId = attributeValue(child, "data-agent-native-node-id");
  const reparsedChild =
    (childNodeId
      ? reparsed.find(
          (element) =>
            attributeValue(element, "data-agent-native-node-id") ===
            childNodeId,
        )
      : undefined) ?? reparsed.find((element) => element.start === child.start);
  if (!reparsedChild) return nextHtml;
  const classes = classList(reparsedChild);
  const flowClasses = classes.filter((token) => {
    const variants = token.split(":");
    const utility = variants[variants.length - 1]?.replace(/^!/, "");
    return (
      utility !== "absolute" && utility !== "fixed" && utility !== "sticky"
    );
  });
  if (flowClasses.length === classes.length) return nextHtml;
  nextHtml = replaceOrInsertAttribute(
    nextHtml,
    reparsedChild,
    "class",
    flowClasses.join(" "),
  );
  return nextHtml;
}

/**
 * Strip flex/grid-item-only inline properties (flex-grow/shrink/basis,
 * align-self, order, the flex shorthand) from a child's inline style. Called
 * when a fragment leaves auto-layout flow for a non-flow destination parent —
 * these properties only mean anything inside a flex/grid container, so
 * leaving them on an absolute/freeform element is dead (and misleading)
 * source clutter that would silently reactivate with a stale value if the
 * element were ever reparented back into flow. No-ops harmlessly when the
 * child never had any of these set.
 */
function stripFlexItemStylingFromChild(
  html: string,
  child: ParsedElement,
): string {
  const currentStyle = attributeValue(child, "style");
  if (!currentStyle) return html;
  // Cheap presence check before touching anything: stripStyleProperties round
  // -trips through parseStyleDeclarations/serializeStyleDeclarations, which
  // normalizes formatting (adds "; " separators and a space after each
  // colon) even when nothing actually needs removing. The overwhelming
  // majority of moves into a non-flow destination involve a fragment that
  // was never a flex/grid item, so unconditionally rewriting its style
  // attribute would silently reformat unrelated, untouched authored CSS on
  // every such move — exactly the kind of source churn this substrate is
  // supposed to avoid. Only rewrite when there's actually something to strip.
  const declarations = parseStyleDeclarations(currentStyle);
  const hasFlexItemProp = declarations.declarations.some((decl) =>
    (FLEX_ITEM_STRIP_PROPS as readonly string[]).includes(
      cssPropertyKey(decl.prop),
    ),
  );
  if (!hasFlexItemProp) return html;
  return replaceOrInsertAttribute(
    html,
    child,
    "style",
    stripStyleProperties(currentStyle, [...FLEX_ITEM_STRIP_PROPS]),
  );
}

/**
 * Pin a flow child to its measured border-box position inside a relative
 * wrapper. Margins and inset values contributed to the measured position in
 * the old parent, so retaining them would offset the child a second time.
 */
function rebaseMeasuredFlowChild(
  html: string,
  child: ParsedElement,
  left: number,
  top: number,
): string {
  const declarations = parseStyleDeclarations(attributeValue(child, "style"));
  removeStyleDeclarations(declarations, MEASURED_FLOW_REBASE_STRIP_PROPS);
  setStyleDeclaration(declarations, "position", "absolute");
  setStyleDeclaration(declarations, "left", formatMeasuredPixel(left));
  setStyleDeclaration(declarations, "top", formatMeasuredPixel(top));
  return replaceOrInsertAttribute(
    html,
    child,
    "style",
    serializeStyleDeclarations(declarations),
  );
}

/**
 * L7: sequential "<baseName> N" naming. Counts existing layer names already
 * matching "<baseName>" or "<baseName> <number>" in the projection (via
 * data-agent-native-layer-name / layerName) and returns the next unused
 * name in that sequence, so repeated grouping doesn't leave multiple
 * ambiguous same-named layers. Figma names a plain ⌘G group "Group" but an
 * auto-layout wrap (Shift+A) "Frame" — same wrapper mechanics, different
 * default name — so the base name is threaded in by the caller rather than
 * hardcoded here.
 */
function nextSequentialWrapperName(
  nodes: CodeLayerNode[],
  baseName: string,
): string {
  const namePattern = new RegExp(`^${baseName}(?: (\\d+))?$`);
  let highestNumbered = 0;
  let hasBareName = false;
  for (const node of nodes) {
    const match = namePattern.exec(node.layerName.trim());
    if (!match) continue;
    if (match[1]) {
      highestNumbered = Math.max(highestNumbered, Number(match[1]));
    } else {
      hasBareName = true;
    }
  }
  if (!hasBareName && highestNumbered === 0) return baseName;
  return `${baseName} ${Math.max(highestNumbered, hasBareName ? 1 : 0) + 1}`;
}

function nextSequentialFrameName(nodes: CodeLayerNode[]): string {
  const used = new Set(
    nodes
      .filter((node) => node.dataAttributes["data-an-primitive"] === "frame")
      .map((node) => node.layerName.trim()),
  );
  let index = 1;
  while (used.has(`Frame ${index}`)) index += 1;
  return `Frame ${index}`;
}

interface AbsoluteUnionBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * L7: computes the union bounding box of a set of sibling elements, but only
 * when EVERY element is absolutely positioned with pixel left/top/width/
 * height. Returns null otherwise (mixed/flow children have no meaningful
 * bounding box without an actual layout pass — the wrapper falls back to a
 * plain flow div in that case).
 */
function computeAbsoluteUnionBounds(
  elements: ParsedElement[],
  /**
   * Live-rendered width/height fallback, keyed by exact parsed element
   * identity, for a target whose inline style carries
   * position/left/top but omits width/height (auto-sized content, e.g. a
   * Text-tool node sized by its text rather than an explicit box). Never
   * overrides an explicit inline width/height — only fills the gap that
   * would otherwise return null and leave the wrapper with no geometry at
   * all (a frame that doesn't enclose its own content).
   */
  sizeHints?: ReadonlyMap<ParsedElement, WrapNodeSizeHint>,
): AbsoluteUnionBounds | null {
  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;

  for (const element of elements) {
    const style = parseStyle(attributeValue(element, "style"));
    if (style.position !== "absolute") return null;
    const left = parsePixelLength(style.left);
    const top = parsePixelLength(style.top);
    const hint = sizeHints?.get(element);
    const width = parsePixelLength(style.width) ?? hint?.width ?? null;
    const height = parsePixelLength(style.height) ?? hint?.height ?? null;
    if (left === null || top === null || width === null || height === null) {
      return null;
    }
    minLeft = Math.min(minLeft, left);
    minTop = Math.min(minTop, top);
    maxRight = Math.max(maxRight, left + width);
    maxBottom = Math.max(maxBottom, top + height);
  }

  if (
    !Number.isFinite(minLeft) ||
    !Number.isFinite(minTop) ||
    !Number.isFinite(maxRight) ||
    !Number.isFinite(maxBottom)
  ) {
    return null;
  }

  return {
    left: minLeft,
    top: minTop,
    width: maxRight - minLeft,
    height: maxBottom - minTop,
  };
}

interface SelectionBackgroundRectangle {
  element: ParsedElement;
  node: CodeLayerNode;
  bounds: AbsoluteUnionBounds;
  padding: { top: number; right: number; bottom: number; left: number };
}

/**
 * A painted rectangle can be the visual background of a Shift+A selection.
 * Figma turns that layer into the frame itself, but only when it is the
 * bottom-most selected sibling and fully contains every other selected layer.
 * Partial overlaps stay ordinary auto-layout children so selecting two
 * arbitrary shapes never changes their identity or stacking semantics.
 */
function findSelectionBackgroundRectangle(
  targetElements: ParsedElement[],
  nodeByElement: ReadonlyMap<ParsedElement, CodeLayerNode>,
  sizeHintsByElement: ReadonlyMap<ParsedElement, WrapNodeSizeHint>,
): SelectionBackgroundRectangle | null {
  if (targetElements.length < 2) return null;

  const background = targetElements[0]!;
  const backgroundNode = nodeByElement.get(background);
  if (
    !backgroundNode ||
    background.tag !== "div" ||
    attributeValue(background, "data-an-primitive") !== "rectangle" ||
    background.childIndexes.length > 0 ||
    backgroundNode.paintsOwnText ||
    backgroundNode.componentInstance ||
    Object.prototype.hasOwnProperty.call(
      backgroundNode.dataAttributes,
      "data-agent-native-component",
    ) ||
    Object.prototype.hasOwnProperty.call(
      backgroundNode.dataAttributes,
      "data-agent-native-component-id",
    ) ||
    Object.prototype.hasOwnProperty.call(
      backgroundNode.dataAttributes,
      "data-agent-native-component-ref",
    ) ||
    Object.prototype.hasOwnProperty.call(
      backgroundNode.dataAttributes,
      "data-agent-native-group-wrapper",
    ) ||
    Object.prototype.hasOwnProperty.call(
      backgroundNode.dataAttributes,
      "data-agent-native-group",
    )
  ) {
    return null;
  }
  const backgroundStyle = parseStyle(attributeValue(background, "style"));
  const fill =
    backgroundStyle["background-color"] ?? backgroundStyle.background;
  const parsedFill = fill ? parseCssColorExtended(fill) : null;
  if (!parsedFill || parsedFill.a <= 0) return null;
  if (backgroundStyle.transform && backgroundStyle.transform !== "none") {
    return null;
  }
  if (
    backgroundStyle.rotate &&
    backgroundStyle.rotate !== "none" &&
    backgroundStyle.rotate !== "0deg" &&
    backgroundStyle.rotate !== "0"
  ) {
    return null;
  }
  if (
    backgroundStyle.scale &&
    backgroundStyle.scale !== "none" &&
    backgroundStyle.scale !== "1"
  ) {
    return null;
  }

  const origin = {
    left: parsePixelLength(backgroundStyle.left),
    top: parsePixelLength(backgroundStyle.top),
  };
  const backgroundHint = sizeHintsByElement.get(background);
  const left = origin.left ?? backgroundHint?.left ?? null;
  const top = origin.top ?? backgroundHint?.top ?? null;
  const width =
    parsePixelLength(backgroundStyle.width) ?? backgroundHint?.width ?? null;
  const height =
    parsePixelLength(backgroundStyle.height) ?? backgroundHint?.height ?? null;
  if (
    backgroundStyle.position !== "absolute" ||
    left === null ||
    top === null ||
    width === null ||
    height === null ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  const bounds = { left, top, width, height };

  const childBounds = targetElements.slice(1).map((element) => {
    const style = parseStyle(attributeValue(element, "style"));
    const hint = sizeHintsByElement.get(element);
    const childLeft = parsePixelLength(style.left) ?? hint?.left ?? null;
    const childTop = parsePixelLength(style.top) ?? hint?.top ?? null;
    const childWidth = parsePixelLength(style.width) ?? hint?.width ?? null;
    const childHeight = parsePixelLength(style.height) ?? hint?.height ?? null;
    return childLeft === null ||
      childTop === null ||
      childWidth === null ||
      childHeight === null ||
      childWidth <= 0 ||
      childHeight <= 0
      ? null
      : {
          left: childLeft,
          top: childTop,
          width: childWidth,
          height: childHeight,
        };
  });
  if (
    childBounds.some(
      (child) =>
        child === null ||
        child.left < bounds.left ||
        child.top < bounds.top ||
        child.left + child.width > bounds.left + bounds.width ||
        child.top + child.height > bounds.top + bounds.height,
    )
  ) {
    return null;
  }

  const minLeft = Math.min(...childBounds.map((child) => child!.left));
  const minTop = Math.min(...childBounds.map((child) => child!.top));
  const maxRight = Math.max(
    ...childBounds.map((child) => child!.left + child!.width),
  );
  const maxBottom = Math.max(
    ...childBounds.map((child) => child!.top + child!.height),
  );
  return {
    element: background,
    node: backgroundNode,
    bounds,
    padding: {
      left: minLeft - bounds.left,
      top: minTop - bounds.top,
      right: bounds.left + bounds.width - maxRight,
      bottom: bounds.top + bounds.height - maxBottom,
    },
  };
}

function promoteSelectionBackgroundRectangle(
  html: string,
  promotion: SelectionBackgroundRectangle,
  targetElements: ParsedElement[],
  wrapperNodeId: string,
  wrapperLayerName: string,
): string {
  const backgroundMarkup = html.slice(
    promotion.element.start,
    promotion.element.end,
  );
  const backgroundRoot = parseHtmlElements(backgroundMarkup).find(
    (element) => element.parentIndex === undefined,
  );
  if (!backgroundRoot) return html;

  const centered =
    Math.abs(promotion.padding.left - promotion.padding.right) <= 8 &&
    Math.abs(promotion.padding.top - promotion.padding.bottom) <= 8;
  let style = attributeValue(backgroundRoot, "style") ?? "";
  for (const [property, value] of [
    ["display", "flex"],
    ["flex-direction", centered ? "row" : "column"],
    ["gap", "10px"],
    ["align-items", centered ? "center" : "flex-start"],
    ["justify-content", centered ? "center" : "flex-start"],
    ["box-sizing", "border-box"],
    [
      "padding",
      `${formatMeasuredPixel(promotion.padding.top)} ${formatMeasuredPixel(promotion.padding.right)} ${formatMeasuredPixel(promotion.padding.bottom)} ${formatMeasuredPixel(promotion.padding.left)}`,
    ],
  ] as const) {
    style = setStyleValue(style, property, value);
  }

  let promoted = patchElementAttributes(backgroundMarkup, [
    {
      element: backgroundRoot,
      attributes: {
        "data-agent-native-node-id": wrapperNodeId,
        "data-agent-native-layer-name": wrapperLayerName,
        "data-an-primitive": "frame",
        "data-agent-native-group-wrapper": "true",
        "data-agent-native-preserve-styles": "true",
        style,
      },
    },
  ]);

  const promotedRoot = parseHtmlElements(promoted).find(
    (element) => element.parentIndex === undefined,
  );
  if (!promotedRoot) return html;
  const childFragments = targetElements.slice(1).map((element) => {
    const fragment = html.slice(element.start, element.end);
    const root = parseHtmlElements(fragment).find(
      (candidate) => candidate.parentIndex === undefined,
    );
    return root ? stripAbsolutePositioningFromChild(fragment, root) : fragment;
  });
  const children = childFragments.join("");
  if (promotedRoot.selfClosing) {
    const opening = promoted.slice(promotedRoot.start, promotedRoot.openEnd);
    promoted = `${opening.replace(/\/\>\s*$/, ">")}${children}</${promotedRoot.tag}>`;
  } else {
    promoted = `${promoted.slice(0, promotedRoot.contentStart)}${children}${promoted.slice(promotedRoot.contentEnd)}`;
  }

  const topmostStart = targetElements[targetElements.length - 1]!.start;
  let removedBefore = 0;
  let result = html;
  for (const element of [...targetElements].sort(
    (left, right) => right.start - left.start,
  )) {
    result = `${result.slice(0, element.start)}${result.slice(element.end)}`;
    if (element.start < topmostStart)
      removedBefore += element.end - element.start;
  }
  const insertAt = topmostStart - removedBefore;
  return `${result.slice(0, insertAt)}${promoted}${result.slice(insertAt)}`;
}

/**
 * Compute a measured union for targets that currently participate in their
 * parent's flow. The wrapper stays in that flow slot, so its parent-relative
 * origin is deliberately not written to the wrapper; only its dimensions are
 * persisted and each direct child is rebased into that local origin.
 */
function computeMeasuredFlowBounds(
  elements: ParsedElement[],
  sizeHints?: ReadonlyMap<ParsedElement, WrapNodeSizeHint>,
): AbsoluteUnionBounds | null {
  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;

  for (const element of elements) {
    if (isOutOfFlowElement(element)) return null;
    const hint = sizeHints?.get(element);
    if (
      !hint ||
      hint.outOfFlow ||
      !Number.isFinite(hint.left) ||
      !Number.isFinite(hint.top) ||
      !Number.isFinite(hint.width) ||
      !Number.isFinite(hint.height) ||
      hint.width < 0 ||
      hint.height < 0
    ) {
      return null;
    }
    minLeft = Math.min(minLeft, hint.left!);
    minTop = Math.min(minTop, hint.top!);
    maxRight = Math.max(maxRight, hint.left! + hint.width);
    maxBottom = Math.max(maxBottom, hint.top! + hint.height);
  }

  if (
    !Number.isFinite(minLeft) ||
    !Number.isFinite(minTop) ||
    !Number.isFinite(maxRight) ||
    !Number.isFinite(maxBottom)
  ) {
    return null;
  }

  return {
    left: minLeft,
    top: minTop,
    width: maxRight - minLeft,
    height: maxBottom - minTop,
  };
}

/**
 * Origin-only variant: an auto-layout wrapper hugs its children, so it needs
 * where the selection starts but not how big it is. Absolutely positioned text
 * routinely has left/top and no width/height, and demanding all four sent it
 * back to the parent's flow origin.
 */
function computeAbsoluteUnionOrigin(
  elements: ParsedElement[],
): { left: number; top: number } | null {
  let minLeft = Infinity;
  let minTop = Infinity;
  for (const element of elements) {
    const style = parseStyle(attributeValue(element, "style"));
    if (style.position !== "absolute") return null;
    const left = parsePixelLength(style.left);
    const top = parsePixelLength(style.top);
    if (left === null || top === null) return null;
    minLeft = Math.min(minLeft, left);
    minTop = Math.min(minTop, top);
  }
  if (!Number.isFinite(minLeft) || !Number.isFinite(minTop)) return null;
  return { left: minLeft, top: minTop };
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
  const { autoLayout = false } = intent;
  const wrapperIsFrame = autoLayout || intent.wrapperKind === "frame";
  // A UI selection is unique, but action/tool callers and stale multi-select
  // state can repeat an id. Extracting/removing the same source span twice
  // corrupts the surrounding document and duplicates the node inside the new
  // wrapper. Normalize at the deterministic edit boundary.
  const targetIds = Array.from(new Set(intent.targetIds));
  if (targetIds.length === 0) return "unsupported";

  // Resolve selected projection identities exactly; the authored ID fallback
  // is only for legacy callers whose ID is unique in this projection.
  const targetElements: ParsedElement[] = [];
  const nodeByElement = new Map<ParsedElement, CodeLayerNode>();
  const sizeHintsByElement = new Map<ParsedElement, WrapNodeSizeHint>();
  const authoredNodeIdCounts = new Map<string, number>();
  for (const node of build.projection.nodes) {
    const authoredNodeId = node.dataAttributes["data-agent-native-node-id"];
    if (authoredNodeId) {
      authoredNodeIdCounts.set(
        authoredNodeId,
        (authoredNodeIdCounts.get(authoredNodeId) ?? 0) + 1,
      );
    }
  }
  for (const id of targetIds) {
    const node =
      build.projection.nodes.find((candidate) => candidate.id === id) ??
      build.projection.nodes.find(
        (candidate) =>
          candidate.dataAttributes["data-agent-native-node-id"] === id &&
          authoredNodeIdCounts.get(id) === 1,
      );
    if (!node) return "conflict";
    const el = build.elementByNodeId.get(node.id);
    if (!el) return "conflict";
    targetElements.push(el);
    nodeByElement.set(el, node);
    const authoredNodeId = node.dataAttributes["data-agent-native-node-id"];
    const hint =
      intent.sizeHints?.[node.id] ??
      (authoredNodeId && authoredNodeIdCounts.get(authoredNodeId) === 1
        ? intent.sizeHints?.[authoredNodeId]
        : undefined);
    if (hint) sizeHintsByElement.set(el, hint);
  }

  // All targets must share the same parent.
  const parentIndexes = new Set(targetElements.map((el) => el.parentIndex));
  if (parentIndexes.size !== 1) return "unsupported";

  // Sort targets by their source position (ascending).
  targetElements.sort((a, b) => a.start - b.start);

  // L6: targets no longer need to be sibling-index-CONTIGUOUS. The removal +
  // single-reinsertion-point algorithm below extracts every target
  // (regardless of gaps) and re-inserts them together at the topmost
  // target's stacking position — the LAST one in source order, since later
  // source position paints on top for plain siblings with no z-index. A
  // non-adjacent same-parent selection (e.g. sibling indexes 0, 2, 4) closes
  // its own gaps naturally: the un-selected siblings that were between them
  // (1, 3) end up adjacent to each other once the targets are pulled out,
  // and the targets end up adjacent to each other inside the new wrapper.
  // This matches Figma's group behavior: the group lands at the z-position
  // of its topmost selected child, not its bottommost.

  // Shift+A treats a painted rectangle that contains the rest of the
  // selection as the frame's background. Reuse that source element so the
  // promoted frame keeps the rectangle's identity and fill. Frame selection
  // and ordinary grouping remain on the generic wrapper path.
  const backgroundPromotion = autoLayout
    ? findSelectionBackgroundRectangle(
        targetElements,
        nodeByElement,
        sizeHintsByElement,
      )
    : null;
  if (backgroundPromotion) {
    const usedIds = new Set(
      build.projection.nodes.flatMap((node) => {
        const id = node.dataAttributes["data-agent-native-node-id"];
        return id ? [id] : [];
      }),
    );
    const authoredNodeId =
      backgroundPromotion.node.dataAttributes["data-agent-native-node-id"];
    const wrapperNodeId =
      authoredNodeId && authoredNodeIdCounts.get(authoredNodeId) === 1
        ? authoredNodeId
        : freshNodeId(usedIds, `promote:${backgroundPromotion.element.start}`);
    const wrapperLayerName = nextSequentialFrameName(
      build.projection.nodes.filter(
        (node) => node.id !== backgroundPromotion.node.id,
      ),
    );
    const content = promoteSelectionBackgroundRectangle(
      html,
      backgroundPromotion,
      targetElements,
      wrapperNodeId,
      wrapperLayerName,
    );
    if (content !== html) {
      return {
        content,
        capability: {
          kind: "structure",
          operations: ["moveNode"],
          confidence: 0.92,
        },
        wrapperNodeId,
      };
    }
  }

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

  // L7: sequential naming — an auto-layout wrap (Shift+A) reads as a Figma
  // "Frame", a plain wrap (⌘G) as a "Group"; count existing same-named
  // layers already in the projection so repeated wraps don't produce
  // multiple ambiguous layers with the same bare name.
  const wrapperLayerName = nextSequentialWrapperName(
    build.projection.nodes,
    wrapperIsFrame ? "Frame" : "Group",
  );

  // L7: when EVERY target is absolutely positioned with pixel left/top (and
  // ideally width/height), give the wrapper real computed geometry — the
  // union bounding box of its children — instead of a zero-geometry static
  // div. This matches Figma: grouping absolutely-positioned layers produces
  // a group frame sized/positioned to fit them, not a layout-only wrapper.
  // Falls back to the previous flow/auto-layout wrapper when any child isn't
  // absolutely positioned (there is no meaningful bounding box to compute
  // without a layout pass).
  const targetGeometry = computeAbsoluteUnionBounds(
    targetElements,
    sizeHintsByElement,
  );
  if (
    !targetGeometry &&
    targetElements.some((element) => sizeHintsByElement.get(element)?.outOfFlow)
  ) {
    return "unsupported";
  }
  const measuredFlowGeometry =
    !autoLayout && !targetGeometry
      ? computeMeasuredFlowBounds(targetElements, sizeHintsByElement)
      : null;

  // Collect the source fragments for all targets.
  const fragments = targetElements.map((el) => {
    let frag = html.slice(el.start, el.end);
    if (autoLayout) {
      // We need a ParsedElement that reflects the fragment's own positions.
      // Re-parse the fragment to find the root element and strip its style.
      const fragElements = parseHtmlElements(frag);
      const root = fragElements.find((fe) => fe.parentIndex === undefined);
      if (root) {
        frag = stripAbsolutePositioningFromChild(frag, root);
      }
    } else if (targetGeometry) {
      // Rebase each child's left/top from the old parent's coordinate space
      // into the new wrapper's coordinate space (wrapper now sits at the
      // union's top-left origin).
      const fragElements = parseHtmlElements(frag);
      const root = fragElements.find((fe) => fe.parentIndex === undefined);
      if (root) {
        frag = rebaseChildOffset(
          frag,
          root,
          -targetGeometry.left,
          -targetGeometry.top,
        );
      }
    } else if (measuredFlowGeometry) {
      const hint = sizeHintsByElement.get(el);
      const fragElements = parseHtmlElements(frag);
      const root = fragElements.find((fe) => fe.parentIndex === undefined);
      if (hint && root) {
        frag = rebaseMeasuredFlowChild(
          frag,
          root,
          hint.left! - measuredFlowGeometry.left,
          hint.top! - measuredFlowGeometry.top,
        );
      }
    }
    return frag;
  });

  // An auto-layout wrapper takes the union's origin but no width/height, so
  // it hugs its children the way Figma's does. Omitting the origin drops the
  // wrapper at the parent's flow start and teleports the selection to 0,0.
  const autoLayoutStyle = "display: flex; flex-direction: column; gap: 8px";
  const autoLayoutOrigin = autoLayout
    ? (targetGeometry ?? computeAbsoluteUnionOrigin(targetElements))
    : null;
  const wrapperStyle = autoLayout
    ? autoLayoutOrigin
      ? `position: absolute; left: ${autoLayoutOrigin.left}px; top: ${autoLayoutOrigin.top}px; ${autoLayoutStyle}`
      : autoLayoutStyle
    : targetGeometry
      ? `position: absolute; left: ${targetGeometry.left}px; top: ${targetGeometry.top}px; width: ${targetGeometry.width}px; height: ${targetGeometry.height}px;`
      : measuredFlowGeometry
        ? `position: relative; width: ${formatMeasuredPixel(measuredFlowGeometry.width)}; height: ${formatMeasuredPixel(measuredFlowGeometry.height)};`
        : null;
  const wrapperStyleAttr = wrapperStyle ? ` style="${wrapperStyle}"` : "";
  const wrapperKindAttr = wrapperIsFrame
    ? ' data-an-primitive="frame"'
    : ' data-agent-native-group="true"';
  const hasMeasuredGroupRuntime = Boolean(
    measuredFlowGeometry && !wrapperIsFrame,
  );
  const measuredFlowAttr = hasMeasuredGroupRuntime
    ? ` ${MEASURED_FLOW_GROUP_ATTR}="true"`
    : "";
  const measuredFlowOriginAttr = measuredFlowGeometry
    ? ` data-agent-native-group-origin-left="${formatMeasuredPixel(measuredFlowGeometry!.left)}" data-agent-native-group-origin-top="${formatMeasuredPixel(measuredFlowGeometry!.top)}"`
    : "";
  const wrapperOpen = `<div data-agent-native-node-id="${escapeHtmlAttribute(wrapperNodeId)}" data-agent-native-layer-name="${escapeHtmlAttribute(wrapperLayerName)}" data-agent-native-group-wrapper="true" data-agent-native-preserve-styles="true"${wrapperKindAttr}${measuredFlowAttr}${measuredFlowOriginAttr}${wrapperStyleAttr}>`;
  const wrapperClose = `</div>`;
  const wrapperContent = `${wrapperOpen}${fragments.join("")}${wrapperClose}`;

  // Build the replacement: remove all targets from html (back to front) then
  // insert the wrapper at the LAST target's position — targetElements is
  // sorted ascending by source position, so the last entry is the topmost in
  // stacking order. Inserting there (rather than at the first/bottommost
  // target) is what leaves an un-selected sibling that sat between the
  // targets (e.g. Green between Red and Blue) BELOW the new group, matching
  // Figma. Sort by position descending to remove safely.
  const sorted = [...targetElements].sort((a, b) => b.start - a.start);
  const lastTargetStart = targetElements[targetElements.length - 1]!.start;

  // Remove all targets from the html (back to front).
  let result = html;
  for (const el of sorted) {
    result = `${result.slice(0, el.start)}${result.slice(el.end)}`;
  }

  // Re-compute lastTargetStart relative to the modified string: every other
  // target removed before it shifts it left by its own length.
  let bytesRemovedBefore = 0;
  for (const el of targetElements) {
    if (el.start < lastTargetStart) {
      bytesRemovedBefore += el.end - el.start;
    }
  }
  const insertAt = lastTargetStart - bytesRemovedBefore;

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

interface BooleanOperandGeometry {
  element: ParsedElement;
  sourceNode: CodeLayerNode;
  kind: "rectangle" | "ellipse";
  left: number;
  top: number;
  width: number;
  height: number;
  radiusX: number;
  radiusY: number;
  radiusCss: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
}

type BooleanSubtractEditResult =
  | {
      content: string;
      capability: EditCapability;
      wrapperNodeId: string;
    }
  | { status: "unsupported" | "conflict"; message: string };

function booleanShapeRadius(
  value: string | undefined,
  width: number,
  height: number,
): { x: number; y: number } | null {
  if (!value || value === "0" || value === "0px") return { x: 0, y: 0 };
  const radii = value.trim().split("/");
  if (radii.length > 2) return null;
  const [horizontal, vertical] = radii.map((part) => {
    const parts = part.trim().split(/\s+/);
    return parts.length === 1 ? parts[0] : undefined;
  });
  if (!horizontal || (value.includes("/") && !vertical)) return null;
  const resolve = (part: string, dimension: number) => {
    if (part.endsWith("%")) {
      const percentage = Number(part.slice(0, -1));
      return Number.isFinite(percentage) && percentage >= 0
        ? (dimension * percentage) / 100
        : null;
    }
    return parsePixelLength(part);
  };
  const x = resolve(horizontal, width);
  const y = resolve(vertical ?? horizontal, height);
  if (x === null || y === null || x < 0 || y < 0) return null;
  return { x: Math.min(x, width / 2), y: Math.min(y, height / 2) };
}

function borderPaint(style: Record<string, string>): {
  color: string;
  width: number;
} | null {
  const shorthand = style.border?.trim();
  if (shorthand && shorthand !== "none") {
    const match = /^([\d.]+)px\s+solid\s+(.+)$/i.exec(shorthand);
    if (!match) return null;
    const width = Number(match[1]);
    const color = match[2]!.trim();
    if (!Number.isFinite(width) || width < 0 || !parseCssColorExtended(color)) {
      return null;
    }
    return { color, width };
  }
  const widthValue = style["border-width"] ?? "0px";
  const borderStyle = style["border-style"] ?? "none";
  if (borderStyle === "none" || widthValue === "0" || widthValue === "0px") {
    return { color: "none", width: 0 };
  }
  const width = parsePixelLength(widthValue);
  const color = style["border-color"];
  if (
    width === null ||
    width < 0 ||
    borderStyle !== "solid" ||
    !color ||
    !parseCssColorExtended(color)
  ) {
    return null;
  }
  return { color, width };
}

function booleanOperandGeometry(
  html: string,
  build: ProjectionBuild,
  targetIds: readonly string[],
):
  | { operands: BooleanOperandGeometry[]; parentIndex: number }
  | { status: "unsupported" | "conflict"; message: string } {
  const uniqueIds = Array.from(new Set(targetIds));
  if (uniqueIds.length < 2) {
    return {
      status: "unsupported",
      message: "Subtract needs at least two selected shapes.",
    };
  }

  const operands: BooleanOperandGeometry[] = [];
  for (const id of uniqueIds) {
    const sourceNode = build.projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === id ||
        node.id === id,
    );
    const element = sourceNode && build.elementByNodeId.get(sourceNode.id);
    if (!sourceNode || !element) {
      return {
        status: "conflict",
        message: "A selected shape could not be resolved in the source.",
      };
    }
    const primitiveKind = sourceNode.dataAttributes["data-an-primitive"];
    const shapeKind =
      primitiveKind === "ellipse" ||
      primitiveKind === "circle" ||
      primitiveKind === "oval"
        ? "ellipse"
        : primitiveKind === "rectangle" || primitiveKind === "rect"
          ? "rectangle"
          : null;
    const style = parseStyle(attributeValue(element, "style"));
    const fill = style["background-color"] ?? style.background;
    const left = parsePixelLength(style.left);
    const top = parsePixelLength(style.top);
    const width = parsePixelLength(style.width);
    const height = parsePixelLength(style.height);
    const radius = booleanShapeRadius(
      style["border-radius"],
      width ?? 0,
      height ?? 0,
    );
    const border = borderPaint(style);
    const opacity = style.opacity === undefined ? 1 : Number(style.opacity);
    const allowedProperties = new Set([
      "position",
      "left",
      "top",
      "width",
      "height",
      "background",
      "background-color",
      "border",
      "border-width",
      "border-style",
      "border-color",
      "border-radius",
      "background-image",
      "opacity",
      "transform",
    ]);
    const unsupportedStyle = Object.keys(style).some(
      (property) =>
        !allowedProperties.has(property) ||
        (property === "transform" && style[property] !== "none"),
    );
    if (
      !shapeKind ||
      element.tag !== "div" ||
      element.childIndexes.length > 0 ||
      html.slice(element.contentStart, element.contentEnd).trim() ||
      sourceNode.classes.length > 0 ||
      Boolean(attributeValue(element, "id")) ||
      style.position !== "absolute" ||
      left === null ||
      top === null ||
      width === null ||
      height === null ||
      width <= 0 ||
      height <= 0 ||
      !fill ||
      !parseCssColorExtended(fill) ||
      (style["background-image"] && style["background-image"] !== "none") ||
      unsupportedStyle ||
      !radius ||
      !border ||
      !Number.isFinite(opacity) ||
      opacity < 0 ||
      opacity > 1 ||
      (style["z-index"] !== undefined && style["z-index"] !== "auto")
    ) {
      return {
        status: "unsupported",
        message:
          "Subtract supports positioned rectangle and ellipse layers with a solid fill and no children.",
      };
    }

    if (
      element.attributes.some(
        (attribute) =>
          attribute.lowerName.startsWith("on") ||
          ["class", "id"].includes(attribute.lowerName) ||
          (!attribute.lowerName.startsWith("data-") &&
            !attribute.lowerName.startsWith("aria-") &&
            attribute.lowerName !== "style" &&
            attribute.lowerName !== "title" &&
            attribute.lowerName !== "role"),
      )
    ) {
      return {
        status: "unsupported",
        message:
          "Subtract cannot preserve custom markup on these shape layers.",
      };
    }

    operands.push({
      element,
      sourceNode,
      kind: shapeKind,
      left,
      top,
      width,
      height,
      radiusX: shapeKind === "ellipse" ? width / 2 : radius.x,
      radiusY: shapeKind === "ellipse" ? height / 2 : radius.y,
      radiusCss: style["border-radius"] ?? "0px",
      fill,
      stroke: border.color,
      strokeWidth: border.width,
      opacity,
    });
  }

  const parentIndexes = new Set(
    operands.map(({ element }) => element.parentIndex),
  );
  if (
    parentIndexes.size !== 1 ||
    operands.some(({ element }) => element.parentIndex === undefined)
  ) {
    return {
      status: "unsupported",
      message: "Subtract requires shapes with the same parent.",
    };
  }
  operands.sort((a, b) => a.element.start - b.element.start);
  const parentIndex = operands[0]!.element.parentIndex!;
  const parentElement = build.elements[parentIndex];
  if (!parentElement) {
    return {
      status: "conflict",
      message: "The selected shapes no longer share a source parent.",
    };
  }
  const siblingIndexes = parentElement.childIndexes;
  const firstSiblingIndex = siblingIndexes.indexOf(operands[0]!.element.index);
  if (
    firstSiblingIndex < 0 ||
    operands.some(
      ({ element }, offset) =>
        siblingIndexes[firstSiblingIndex + offset] !== element.index,
    )
  ) {
    return {
      status: "unsupported",
      message: "Subtract requires consecutive sibling shape layers.",
    };
  }
  return { operands, parentIndex };
}

function applyBooleanSubtract(
  html: string,
  build: ProjectionBuild,
  intent: BooleanSubtractEditIntent,
): BooleanSubtractEditResult {
  const validation = booleanOperandGeometry(html, build, intent.targetIds);
  if ("status" in validation) return validation;
  const { operands } = validation;
  const minLeft = Math.min(...operands.map((operand) => operand.left));
  const minTop = Math.min(...operands.map((operand) => operand.top));
  const maxRight = Math.max(
    ...operands.map((operand) => operand.left + operand.width),
  );
  const maxBottom = Math.max(
    ...operands.map((operand) => operand.top + operand.height),
  );
  const width = maxRight - minLeft;
  const height = maxBottom - minTop;
  const usedIds = new Set<string>();
  for (const node of build.projection.nodes) {
    for (const id of [
      node.dataAttributes["data-agent-native-node-id"],
      typeof node.attributes.id === "string" ? node.attributes.id : undefined,
    ]) {
      if (id) usedIds.add(id);
    }
  }
  const wrapperNodeId = freshNodeId(
    usedIds,
    `boolean-subtract:${operands.map((operand) => operand.element.start).join(":")}`,
  );
  const geometryIds = operands.map((operand) =>
    freshNodeId(usedIds, `boolean-geometry:${operand.sourceNode.id}`),
  );
  const maskId = freshNodeId(usedIds, `boolean-mask:${wrapperNodeId}`);
  const operandFragments = operands.map((operand, index) => {
    const nodeId =
      operand.sourceNode.dataAttributes["data-agent-native-node-id"] ??
      operand.sourceNode.id;
    const name =
      resolveLayerNameAttribute((attribute) =>
        attributeValue(operand.element, attribute),
      )?.value ?? operand.sourceNode.layerName;
    const localLeft = operand.left - minLeft;
    const localTop = operand.top - minTop;
    const strokeInset = operand.strokeWidth / 2;
    const rectWidth = Math.max(0, operand.width - operand.strokeWidth);
    const rectHeight = Math.max(0, operand.height - operand.strokeWidth);
    const radiusX =
      operand.kind === "ellipse"
        ? rectWidth / 2
        : Math.max(0, operand.radiusX - strokeInset);
    const radiusY =
      operand.kind === "ellipse"
        ? rectHeight / 2
        : Math.max(0, operand.radiusY - strokeInset);
    const resultRadiusStyle =
      index === 0
        ? `rx:var(--boolean-result-radius-x,${radiusX}px);ry:var(--boolean-result-radius-y,${radiusY}px);`
        : "";
    const attributes = operand.element.attributes
      .filter((attribute) => {
        const name = attribute.lowerName;
        return (
          name.startsWith("data-") ||
          name.startsWith("aria-") ||
          name === "title" ||
          name === "role"
        );
      })
      .map((attribute) =>
        attribute.value === true
          ? ` ${attribute.name}`
          : ` ${attribute.name}="${escapeHtmlAttribute(String(attribute.value))}"`,
      )
      .filter(
        (attribute) =>
          !/^ data-agent-native-(?:node-id|layer-name)(?:=|$)/i.test(
            attribute,
          ) &&
          !/^ data-an-primitive(?:=|$)/i.test(attribute) &&
          !/^ data-an-boolean-(?:operand|shape)(?:=|$)/i.test(attribute),
      )
      .join("");
    const operandTag = index === 0 ? "base" : "subtract";
    return `<svg id="${escapeHtmlAttribute(geometryIds[index]!)}" data-agent-native-node-id="${escapeHtmlAttribute(nodeId)}" data-agent-native-layer-name="${escapeHtmlAttribute(name)}" data-an-primitive="boolean-operand" data-an-boolean-shape="${operand.kind}" data-an-boolean-operand="${operandTag}"${attributes} x="${localLeft}" y="${localTop}" width="${operand.width}" height="${operand.height}" viewBox="0 0 ${operand.width} ${operand.height}" preserveAspectRatio="none" style="position:absolute;left:${localLeft}px;top:${localTop}px;width:${operand.width}px;height:${operand.height}px;border-radius:${escapeHtmlAttribute(operand.radiusCss)};--operand-fill:${escapeHtmlAttribute(operand.fill)};--operand-fill-opacity:1;--operand-opacity:${operand.opacity};--operand-stroke:${escapeHtmlAttribute(operand.stroke)};--operand-stroke-width:${operand.strokeWidth};--operand-stroke-opacity:1"><rect x="${strokeInset}" y="${strokeInset}" width="${rectWidth}" height="${rectHeight}" rx="${radiusX}" ry="${radiusY}" style="${resultRadiusStyle}fill:var(--boolean-mask-fill,var(--operand-fill));fill-opacity:var(--boolean-mask-fill-opacity,var(--operand-fill-opacity));opacity:var(--boolean-mask-opacity,var(--operand-opacity));stroke:var(--boolean-mask-stroke,var(--operand-stroke));stroke-width:var(--boolean-mask-stroke-width,var(--operand-stroke-width));stroke-opacity:var(--boolean-mask-stroke-opacity,var(--operand-stroke-opacity))"/></svg>`;
  });
  const cutterUses = geometryIds
    .slice(1)
    .map(
      (geometryId) =>
        `<use href="#${escapeHtmlAttribute(geometryId)}" data-an-boolean-cutter="true" style="--boolean-mask-fill:black;--boolean-mask-fill-opacity:1;--boolean-mask-opacity:1;--boolean-mask-stroke:none;--boolean-mask-stroke-width:0;--boolean-mask-stroke-opacity:1;fill:black;fill-opacity:1;opacity:1;stroke:none;stroke-width:0"/>`,
    )
    .join("");
  const cutterStrokeUses = geometryIds
    .slice(1)
    .map(
      (geometryId, cutterOffset) =>
        `<use href="#${escapeHtmlAttribute(geometryId)}" data-an-boolean-cutter-stroke="true" mask="url(#${escapeHtmlAttribute(maskId)})" style="--boolean-mask-fill:none;--boolean-mask-fill-opacity:0;--boolean-mask-opacity:1;--boolean-mask-stroke:${escapeHtmlAttribute(operands[0]!.stroke)};--boolean-mask-stroke-width:${operands[0]!.strokeWidth}px;--boolean-mask-stroke-opacity:1;fill:none;fill-opacity:0;opacity:1;stroke:var(--boolean-mask-stroke);stroke-width:calc(var(--boolean-mask-stroke-width) * 2);stroke-opacity:var(--boolean-mask-stroke-opacity)"/>`,
    )
    .join("");
  const baseRadius = `--boolean-result-radius-x:${operands[0]!.radiusX}px;--boolean-result-radius-y:${operands[0]!.radiusY}px`;
  const resultUseStyle = `--boolean-mask-opacity:1;--boolean-mask-fill:${escapeHtmlAttribute(operands[0]!.fill)};--boolean-mask-fill-opacity:1;--boolean-mask-stroke:${escapeHtmlAttribute(operands[0]!.stroke)};--boolean-mask-stroke-width:${operands[0]!.strokeWidth}px;--boolean-mask-stroke-opacity:1;${baseRadius};fill:var(--boolean-mask-fill);fill-opacity:var(--boolean-mask-fill-opacity);opacity:1;stroke:var(--boolean-mask-stroke);stroke-width:calc(var(--boolean-mask-stroke-width) * 2);stroke-opacity:var(--boolean-mask-stroke-opacity)`;
  const whiteMaskUseStyle = `--boolean-mask-fill:white;--boolean-mask-fill-opacity:1;--boolean-mask-opacity:1;--boolean-mask-stroke:none;--boolean-mask-stroke-width:0;--boolean-mask-stroke-opacity:1;${baseRadius};fill:white;fill-opacity:1;opacity:1;stroke:none;stroke-width:0`;
  const rootStyle = `position:absolute;left:${minLeft}px;top:${minTop}px;width:${width}px;height:${height}px;overflow:visible;opacity:${operands[0]!.opacity};--boolean-mask-opacity:1;--boolean-mask-fill:${escapeHtmlAttribute(operands[0]!.fill)};--boolean-mask-fill-opacity:1;--boolean-mask-stroke:${escapeHtmlAttribute(operands[0]!.stroke)};--boolean-mask-stroke-width:${operands[0]!.strokeWidth}px;--boolean-mask-stroke-opacity:1`;
  const wrapper = `<svg data-agent-native-node-id="${escapeHtmlAttribute(wrapperNodeId)}" data-agent-native-layer-name="Subtract" data-an-primitive="boolean" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="${rootStyle}"><defs><mask id="${escapeHtmlAttribute(maskId)}" maskUnits="objectBoundingBox" maskContentUnits="userSpaceOnUse" x="-10%" y="-10%" width="120%" height="120%"><use href="#${escapeHtmlAttribute(geometryIds[0]!)}" style="${whiteMaskUseStyle}"/>${cutterUses}</mask>${operandFragments.join("")}</defs><use data-an-boolean-result="true" href="#${escapeHtmlAttribute(geometryIds[0]!)}" mask="url(#${escapeHtmlAttribute(maskId)})" style="${resultUseStyle}"/>${cutterStrokeUses}</svg>`;

  const targets = operands.map((operand) => operand.element);
  const insertAt = targets[0]!.start;
  let result = html;
  for (const target of [...targets].sort((a, b) => b.start - a.start)) {
    result = `${result.slice(0, target.start)}${result.slice(target.end)}`;
  }
  result = `${result.slice(0, insertAt)}${wrapper}${result.slice(insertAt)}`;
  return {
    content: result,
    capability: {
      kind: "structure",
      operations: ["moveNode"],
      confidence: 0.9,
    },
    wrapperNodeId,
  };
}

/** Parse a CSS length like "12px" into a finite pixel number, else null. */
function parsePixelLength(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(-?[\d.]+)px$/.exec(value.trim());
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMeasuredPixel(value: number): string {
  return `${Number(value.toFixed(4))}px`;
}

/**
 * Rebase a single child element's `left`/`top` inline-style offsets by the
 * given deltas (adding the unwrapped wrapper's own offset so the child keeps
 * its absolute screen position once reparented into the wrapper's parent).
 * No-ops (returns html unchanged) when the child isn't absolutely positioned
 * with a pixel offset — non-absolute children have no coordinate space to
 * rebase, and non-pixel units (%, calc(), var()) can't be safely combined
 * without a layout pass.
 */
function rebaseChildOffset(
  html: string,
  child: ParsedElement,
  deltaLeftPx: number,
  deltaTopPx: number,
): string {
  const currentStyle = attributeValue(child, "style");
  const style = parseStyle(currentStyle);
  if (style.position !== "absolute") return html;

  let nextStyle = currentStyle ?? "";
  const currentLeft = parsePixelLength(style.left);
  if (currentLeft !== null && deltaLeftPx !== 0) {
    nextStyle = setStyleValue(
      nextStyle,
      "left",
      `${currentLeft + deltaLeftPx}px`,
    );
  }
  const currentTop = parsePixelLength(style.top);
  if (currentTop !== null && deltaTopPx !== 0) {
    nextStyle = setStyleValue(nextStyle, "top", `${currentTop + deltaTopPx}px`);
  }
  if (nextStyle === (currentStyle ?? "")) return html;
  return replaceOrInsertAttribute(html, child, "style", nextStyle);
}

interface BooleanLinearTransform {
  a: number;
  b: number;
  c: number;
  d: number;
}

const IDENTITY_BOOLEAN_TRANSFORM: BooleanLinearTransform = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
};

function multiplyBooleanTransforms(
  left: BooleanLinearTransform,
  right: BooleanLinearTransform,
): BooleanLinearTransform {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
  };
}

function parseBooleanAngle(value: string): number | null {
  const match = /^([+-]?[\d.]+(?:e[+-]?\d+)?)(deg|rad|turn|grad)$/i.exec(
    value.trim(),
  );
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2]!.toLowerCase();
  const degrees =
    unit === "rad"
      ? amount * (180 / Math.PI)
      : unit === "turn"
        ? amount * 360
        : unit === "grad"
          ? amount * 0.9
          : amount;
  return (degrees * Math.PI) / 180;
}

function parseBooleanScale(value: string): [number, number] | null {
  if (value.trim() === "none") return [1, 1];
  const values = value.trim().split(/\s+/);
  if (values.length < 1 || values.length > 2) return null;
  const x = Number(values[0]);
  const y = values.length === 2 ? Number(values[1]) : x;
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function booleanRotationTransform(radians: number): BooleanLinearTransform {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return { a: cosine, b: sine, c: -sine, d: cosine };
}

function parseBooleanTransformList(
  value: string | undefined,
): BooleanLinearTransform | null {
  if (!value || value.trim() === "none") return IDENTITY_BOOLEAN_TRANSFORM;
  const functions = [...value.matchAll(/([a-z][a-z0-9]*)\(([^()]*)\)/gi)];
  if (functions.length === 0) return null;
  const remainder = value.replace(/([a-z][a-z0-9]*)\(([^()]*)\)/gi, "");
  if (remainder.trim()) return null;

  let result = IDENTITY_BOOLEAN_TRANSFORM;
  for (const match of functions) {
    const name = match[1]!.toLowerCase();
    const args = match[2]!.trim();
    let next: BooleanLinearTransform;
    if (name === "rotate" || name === "rotatez") {
      const angle = parseBooleanAngle(args);
      if (angle === null) return null;
      next = booleanRotationTransform(angle);
    } else if (name === "scale") {
      const scale = parseBooleanScale(args);
      if (!scale) return null;
      next = { a: scale[0], b: 0, c: 0, d: scale[1] };
    } else if (name === "scalex" || name === "scaley") {
      const amount = Number(args);
      if (!Number.isFinite(amount)) return null;
      next =
        name === "scalex"
          ? { a: amount, b: 0, c: 0, d: 1 }
          : { a: 1, b: 0, c: 0, d: amount };
    } else if (
      name === "translate" ||
      name === "translatex" ||
      name === "translatey"
    ) {
      // Translation is copied to each released shape. Percentages would
      // resolve against each operand's box instead of the Boolean result.
      if (args.includes("%") || /calc\s*\(/i.test(args)) return null;
      if (
        !/^[+-]?(?:[\d.]+(?:e[+-]?\d+)?(?:px)?)(?:\s+[+-]?(?:[\d.]+(?:e[+-]?\d+)?(?:px)?))?$/i.test(
          args,
        )
      ) {
        return null;
      }
      next = IDENTITY_BOOLEAN_TRANSFORM;
    } else {
      return null;
    }
    result = multiplyBooleanTransforms(result, next);
  }
  return result;
}

function booleanTransformOrigin(
  value: string | undefined,
  width: number,
  height: number,
): { x: number; y: number } | null {
  const parts = (value ?? "50% 50%").trim().split(/\s+/);
  if (parts.length < 1 || parts.length > 3) return null;
  const resolve = (
    token: string | undefined,
    extent: number,
    start: "left" | "top",
    end: "right" | "bottom",
  ): number | null => {
    if (!token || token === "center") return extent / 2;
    if (token === start) return 0;
    if (token === end) return extent;
    if (token.endsWith("%")) {
      const amount = Number(token.slice(0, -1));
      return Number.isFinite(amount) ? (extent * amount) / 100 : null;
    }
    if (token.endsWith("px")) return parsePixelLength(token);
    if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(token) && Number(token) === 0) {
      return 0;
    }
    return null;
  };
  if (parts.length === 3 && !/^0(?:px)?$/.test(parts[2]!)) return null;
  const x = resolve(parts[0], width, "left", "right");
  const y = resolve(parts[1], height, "top", "bottom");
  return x === null || y === null ? null : { x, y };
}

function removeElementAttributes(
  html: string,
  element: ParsedElement,
  names: readonly string[],
): string {
  const remove = new Set(names.map((name) => name.toLowerCase()));
  const attributes = element.attributes
    .filter((attribute) => remove.has(attribute.lowerName))
    .sort((left, right) => right.start - left.start);
  let result = html;
  for (const attribute of attributes) {
    result = `${result.slice(0, attribute.start)}${result.slice(attribute.end)}`;
  }
  return result;
}

function releaseBooleanRoot(
  html: string,
  element: ParsedElement,
): { content: string; capability: EditCapability } | PatchResultStatus {
  const rootStyle = parseStyle(attributeValue(element, "style"));
  const viewBox = (attributeValue(element, "viewBox") ?? "")
    .trim()
    .split(/\s+/)
    .map(Number);
  const rootWidth =
    parsePixelLength(rootStyle.width) ??
    Number(attributeValue(element, "width"));
  const rootHeight =
    parsePixelLength(rootStyle.height) ??
    Number(attributeValue(element, "height"));
  const rootLeft = parsePixelLength(rootStyle.left);
  const rootTop = parsePixelLength(rootStyle.top);
  if (
    element.tag !== "svg" ||
    rootStyle.position !== "absolute" ||
    rootLeft === null ||
    rootTop === null ||
    !Number.isFinite(rootWidth) ||
    !Number.isFinite(rootHeight) ||
    rootWidth <= 0 ||
    rootHeight <= 0 ||
    viewBox.length !== 4 ||
    viewBox[0] !== 0 ||
    viewBox[1] !== 0 ||
    viewBox[2] !== rootWidth ||
    viewBox[3] !== rootHeight
  ) {
    return "unsupported";
  }
  const transform = parseBooleanTransformList(rootStyle.transform);
  const independentRotation =
    !rootStyle.rotate || rootStyle.rotate === "none"
      ? 0
      : parseBooleanAngle(rootStyle.rotate);
  const scale = parseBooleanScale(rootStyle.scale ?? "none");
  const origin = booleanTransformOrigin(
    rootStyle["transform-origin"],
    rootWidth,
    rootHeight,
  );
  const translate = rootStyle.translate;
  if (
    !transform ||
    independentRotation === null ||
    !scale ||
    !origin ||
    (translate && translate !== "none" && translate.includes("%"))
  ) {
    return "unsupported";
  }
  const combined = multiplyBooleanTransforms(
    multiplyBooleanTransforms(booleanRotationTransform(independentRotation), {
      a: scale[0],
      b: 0,
      c: 0,
      d: scale[1],
    }),
    transform,
  );

  const innerContent = html.slice(element.contentStart, element.contentEnd);
  const innerElements = parseHtmlElements(innerContent);
  const operands = innerElements.filter(booleanOperandFor);
  const baseIndex = operands.findIndex(
    (operand) => attributeValue(operand, "data-an-boolean-operand") === "base",
  );
  const cutterCount = operands.filter(
    (operand) =>
      attributeValue(operand, "data-an-boolean-operand") === "subtract",
  ).length;
  const baseShape =
    baseIndex === -1
      ? undefined
      : attributeValue(operands[baseIndex]!, "data-an-boolean-shape");
  if (
    baseIndex === -1 ||
    cutterCount === 0 ||
    (baseShape !== "rectangle" && baseShape !== "ellipse")
  ) {
    return "unsupported";
  }

  const groupRadius = rootStyle["border-radius"]
    ? booleanShapeRadius(rootStyle["border-radius"], rootWidth, rootHeight)
    : null;
  if (rootStyle["border-radius"] && !groupRadius) return "unsupported";

  const releasedOperands = operands.map((operand) => {
    const shape = attributeValue(operand, "data-an-boolean-shape");
    if (shape !== "rectangle" && shape !== "ellipse") return null;
    const rect = operand.childIndexes
      .map((index) => innerElements[index])
      .find((child) => child?.tag === "rect");
    if (!rect || operand.childIndexes.length !== 1) return null;
    const operandStyle = parseStyle(attributeValue(operand, "style"));
    const localLeft = parsePixelLength(operandStyle.left);
    const localTop = parsePixelLength(operandStyle.top);
    const width = Number(attributeValue(operand, "width"));
    const height = Number(attributeValue(operand, "height"));
    const operandTransform = operandStyle.transform;
    if (
      operandStyle.position !== "absolute" ||
      localLeft === null ||
      localTop === null ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0 ||
      (operandTransform && operandTransform !== "none") ||
      (operandStyle.rotate && operandStyle.rotate !== "none") ||
      (operandStyle.scale && operandStyle.scale !== "none") ||
      (operandStyle.translate && operandStyle.translate !== "none")
    ) {
      return null;
    }
    const centerX = localLeft + width / 2;
    const centerY = localTop + height / 2;
    const transformedCenterX =
      origin.x +
      combined.a * (centerX - origin.x) +
      combined.c * (centerY - origin.y);
    const transformedCenterY =
      origin.y +
      combined.b * (centerX - origin.x) +
      combined.d * (centerY - origin.y);
    const fill = operandStyle["--operand-fill"];
    const stroke = operandStyle["--operand-stroke"];
    const fillOpacity = operandStyle["--operand-fill-opacity"] ?? "1";
    const strokeOpacity = operandStyle["--operand-stroke-opacity"] ?? "1";
    const ownOpacity = Number(operandStyle["--operand-opacity"] ?? "1");
    const strokeWidth = operandStyle["--operand-stroke-width"] ?? "0";
    const strokeWidthNumber =
      parsePixelLength(strokeWidth) ?? Number(strokeWidth);
    if (
      !fill ||
      !stroke ||
      !Number.isFinite(ownOpacity) ||
      ownOpacity < 0 ||
      ownOpacity > 1 ||
      !Number.isFinite(Number(fillOpacity)) ||
      !Number.isFinite(Number(strokeOpacity)) ||
      !Number.isFinite(strokeWidthNumber) ||
      strokeWidthNumber < 0
    ) {
      return null;
    }

    let released = innerContent.slice(operand.start, operand.end);
    let localElements = parseHtmlElements(released);
    const localOperand = localElements[0];
    const localRect = localOperand?.childIndexes
      .map((index) => localElements[index])
      .find((child) => child?.tag === "rect");
    if (!localOperand || !localRect) return null;
    let nextOperandStyle = stripStyleProperties(
      attributeValue(localOperand, "style"),
      [
        "--operand-fill",
        "--operand-fill-opacity",
        "--operand-opacity",
        "--operand-stroke",
        "--operand-stroke-width",
        "--operand-stroke-opacity",
        "border-radius",
      ],
    );
    for (const property of [
      "transform",
      "rotate",
      "scale",
      "translate",
    ] as const) {
      const value = rootStyle[property];
      if (value && value !== "none") {
        nextOperandStyle = setStyleValue(nextOperandStyle, property, value);
      }
    }
    nextOperandStyle = setStyleValue(nextOperandStyle, "position", "absolute");
    nextOperandStyle = setStyleValue(
      nextOperandStyle,
      "left",
      `${rootLeft + transformedCenterX - width / 2}px`,
    );
    nextOperandStyle = setStyleValue(
      nextOperandStyle,
      "top",
      `${rootTop + transformedCenterY - height / 2}px`,
    );
    nextOperandStyle = setStyleValue(nextOperandStyle, "width", `${width}px`);
    nextOperandStyle = setStyleValue(nextOperandStyle, "height", `${height}px`);
    nextOperandStyle = setStyleValue(
      nextOperandStyle,
      "transform-origin",
      "center center",
    );
    nextOperandStyle = setStyleValue(
      nextOperandStyle,
      "opacity",
      String(ownOpacity),
    );

    let nextRectStyle = stripStyleProperties(
      attributeValue(localRect, "style"),
      [
        "rx",
        "ry",
        "fill",
        "fill-opacity",
        "opacity",
        "stroke",
        "stroke-width",
        "stroke-opacity",
      ],
    );
    nextRectStyle = setStyleValue(nextRectStyle, "fill", fill);
    nextRectStyle = setStyleValue(nextRectStyle, "fill-opacity", fillOpacity);
    nextRectStyle = setStyleValue(nextRectStyle, "stroke", stroke);
    nextRectStyle = setStyleValue(
      nextRectStyle,
      "stroke-width",
      `${strokeWidthNumber}px`,
    );
    nextRectStyle = setStyleValue(
      nextRectStyle,
      "stroke-opacity",
      strokeOpacity,
    );
    const rectAttributes: Record<string, string> = {};
    if (
      attributeValue(operand, "data-an-boolean-operand") === "base" &&
      groupRadius
    ) {
      rectAttributes.rx = String(groupRadius.x);
      rectAttributes.ry = String(groupRadius.y);
      nextRectStyle = setStyleValue(
        nextRectStyle,
        "rx" as VisualStyleProperty,
        `${groupRadius.x}px`,
      );
      nextRectStyle = setStyleValue(
        nextRectStyle,
        "ry" as VisualStyleProperty,
        `${groupRadius.y}px`,
      );
      nextOperandStyle = setStyleValue(
        nextOperandStyle,
        "border-radius",
        groupRadius.x === groupRadius.y
          ? `${groupRadius.x}px`
          : `${groupRadius.x}px / ${groupRadius.y}px`,
      );
    }
    rectAttributes.style = nextRectStyle;

    released = patchElementAttributes(released, [
      {
        element: localOperand,
        attributes: {
          "data-an-primitive": shape,
          x: "0",
          y: "0",
          style: nextOperandStyle,
        },
      },
      { element: localRect, attributes: rectAttributes },
    ]);
    localElements = parseHtmlElements(released);
    const patchedOperand = localElements[0];
    if (!patchedOperand) return null;
    released = removeElementAttributes(released, patchedOperand, [
      "data-an-boolean-shape",
      "data-an-boolean-operand",
    ]);
    return released;
  });
  const releasedMarkup = releasedOperands.filter(
    (operand): operand is string => operand !== null,
  );
  if (releasedMarkup.length !== operands.length) return "unsupported";
  // Keep the operands in their original base-then-cutter order. The complete
  // defs/mask/use scaffold is removed with the Boolean root.
  return {
    content: `${html.slice(0, element.start)}${releasedMarkup.join("")}${html.slice(element.end)}`,
    capability: {
      kind: "structure",
      operations: ["moveNode"],
      confidence: 0.85,
    },
  };
}

/**
 * UNGROUP: replace the wrapper node with its children, spliced into the
 * wrapper's parent at the wrapper's position, then remove the wrapper.
 *
 * L3 safety: only containers (elements with at least one direct element
 * child) can be ungrouped. A leaf node (text-only element like <p>Hello</p>
 * or a void/self-closing element) has no children to "release" — splicing
 * its inner text/content directly into the parent would silently destroy
 * the element's own tag, attributes, and styles. Callers (canUngroup gate)
 * are expected to also pre-filter to containers, but this is the
 * authoritative, safety-critical check since applyUnwrap can be invoked
 * directly.
 *
 * L3 coordinate rebase: when the wrapper being removed is itself absolutely
 * positioned with pixel left/top offsets, its direct children were
 * positioned relative to IT. Splicing them into the wrapper's parent without
 * adjustment would silently shift every absolutely-positioned child by the
 * wrapper's former offset. Rebase each such child's left/top by adding the
 * wrapper's offset so it keeps the same absolute screen position under the
 * new parent.
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
  if (attributeValue(element, "data-an-primitive") === "boolean") {
    return releaseBooleanRoot(html, element);
  }
  if (booleanOperandFor(element)) return "unsupported";
  if (element.selfClosing || element.contentStart >= element.contentEnd) {
    // Nothing to unwrap from an empty/void element.
    return "unsupported";
  }
  if (element.childIndexes.length === 0) {
    // Leaf node (text-only or otherwise childless): there is nothing to
    // "release" as children, and splicing raw inner content into the parent
    // would destroy this element's own identity (tag/attrs/styles).
    return "unsupported";
  }

  // If the wrapper has a measured flow origin or is positioned with pixel
  // left/top, rebase each direct child's own absolute left/top before
  // splicing, so children keep their absolute screen position once
  // reparented. Re-parse the wrapper's inner HTML in isolation so child
  // element spans are relative to that fragment (matches how
  // replaceOrInsertAttribute below operates on the fragment, not the outer
  // document offsets).
  const wrapperStyle = parseStyle(attributeValue(element, "style"));
  const wrapperLeft = parsePixelLength(wrapperStyle.left);
  const wrapperTop = parsePixelLength(wrapperStyle.top);
  const measuredGroupLeft = parsePixelLength(
    attributeValue(element, "data-agent-native-group-origin-left") ?? undefined,
  );
  const measuredGroupTop = parsePixelLength(
    attributeValue(element, "data-agent-native-group-origin-top") ?? undefined,
  );
  const hasPositionedOffset =
    (wrapperStyle.position === "absolute" ||
      wrapperStyle.position === "relative") &&
    (wrapperLeft !== null || wrapperTop !== null);
  const hasMeasuredFlowOrigin =
    measuredGroupLeft !== null || measuredGroupTop !== null;
  const shouldRebase = hasPositionedOffset || hasMeasuredFlowOrigin;

  let innerContent = html.slice(element.contentStart, element.contentEnd);
  if (shouldRebase) {
    // A relative wrapper contributes both its normal-flow origin and its
    // authored inset. Dropping either term shifts children when the wrapper
    // is removed and they become siblings of the original flow parent.
    const deltaLeftPx =
      (measuredGroupLeft ?? 0) + (hasPositionedOffset ? (wrapperLeft ?? 0) : 0);
    const deltaTopPx =
      (measuredGroupTop ?? 0) + (hasPositionedOffset ? (wrapperTop ?? 0) : 0);
    const fragmentElements = parseHtmlElements(innerContent);
    const directChildren = fragmentElements.filter(
      (fe) => fe.parentIndex === undefined,
    );
    // Apply back-to-front so earlier offsets in the fragment stay valid as
    // later ones are rewritten.
    for (const child of [...directChildren].sort((a, b) => b.start - a.start)) {
      innerContent = rebaseChildOffset(
        innerContent,
        child,
        deltaLeftPx,
        deltaTopPx,
      );
    }
  }

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
/** Whether an existing min-width/min-height already preserves `extent` px. */
function holdsOpen(value: string, extent: number): boolean {
  const trimmed = value.trim();
  if (!/^[\d.]+px$/i.test(trimmed)) return !/^0[a-z%]*$/i.test(trimmed);
  return Number.parseFloat(trimmed) >= extent;
}

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
    const childRects = intent.childRects;
    const hasRects = !!childRects && Object.keys(childRects).length > 0;
    if (!hasRects) return "needsAgent";
    const currentStyle = attributeValue(element, "style");
    const declarations = parseStyleDeclarations(currentStyle);
    const setOnContainer = (property: string, value: string) => {
      setStyleDeclaration(declarations, property, value);
    };
    setOnContainer("display", "block");
    if (hasRects) {
      // Absolute children resolve against the nearest positioned ancestor, so
      // a static container would let them escape to the page.
      const position = effectiveStyleDeclarations(declarations).find(
        (d) => cssPropertyKey(d.prop) === "position",
      );
      if (!position || position.value === "static") {
        setOnContainer("position", "relative");
      }
      // With every child absolute the content box is empty, so a hug-sized
      // container collapses and overflow:hidden then hides what we just pinned.
      const rect = intent.containerRect;
      if (rect) {
        for (const [property, value] of [
          ["min-width", rect.width],
          ["min-height", rect.height],
        ] as const) {
          const existing = effectiveStyleDeclarations(declarations).find(
            (d) => cssPropertyKey(d.prop) === property,
          );
          // `min-height: 0` is the standard flex idiom and holds nothing open.
          // Only a px minimum at least as large as the measured extent does.
          if (existing && !holdsOpen(existing.value, value)) {
            setOnContainer(property, `${Math.round(value)}px`);
          } else if (!existing) {
            setOnContainer(property, `${Math.round(value)}px`);
          }
        }
      }
    }
    let result = replaceOrInsertAttribute(
      html,
      element,
      "style",
      serializeStyleDeclarations(declarations),
    );
    const updatedElements = parseHtmlElements(result);
    const targetAttr = attributeValue(element, "data-agent-native-node-id");
    const updatedTarget =
      (targetAttr
        ? updatedElements.find(
            (fe) =>
              attributeValue(fe, "data-agent-native-node-id") === targetAttr,
          )
        : undefined) ??
      updatedElements.find((fe) => fe.start === element.start);
    if (updatedTarget) {
      // Reverse order keeps earlier offsets valid as each write shifts the rest.
      for (const childIndex of [...updatedTarget.childIndexes].reverse()) {
        const child = updatedElements[childIndex];
        if (!child) continue;
        const childId = attributeValue(child, "data-agent-native-node-id");
        const rect = childId ? childRects[childId] : undefined;
        if (!rect) continue;
        const childDecls = parseStyleDeclarations(
          attributeValue(child, "style"),
        );
        const setOnChild = (property: string, value: string) => {
          setStyleDeclaration(childDecls, property, value);
        };
        // The measured rect is a border box placed by its margin edge, so a
        // content-box child would grow by its padding and a margin would shift
        // it off the position we just measured.
        setOnChild("box-sizing", "border-box");
        setOnChild("margin", "0");
        setOnChild("position", "absolute");
        setOnChild("left", `${Math.round(rect.x)}px`);
        setOnChild("top", `${Math.round(rect.y)}px`);
        setOnChild("width", `${Math.round(rect.width)}px`);
        setOnChild("height", `${Math.round(rect.height)}px`);
        result = replaceOrInsertAttribute(
          result,
          child,
          "style",
          serializeStyleDeclarations(childDecls),
        );
      }
    }
    return {
      content: result,
      capability: {
        kind: "style",
        properties: [
          "display",
          "position",
          "min-width",
          "min-height",
          "left",
          "top",
          "width",
          "height",
        ],
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
    setStyleDeclaration(declarations, prop, val);
  };
  const containerStyles = intent.containerStyles;
  const writtenProperties: VisualStyleProperty[] = [];
  if (containerStyles) {
    const declared: Array<[VisualStyleProperty, string]> = [];
    for (const [rawProperty, rawValue] of Object.entries(containerStyles)) {
      const property = normalizeStyleProperty(rawProperty);
      // All or nothing: a half-written flow (a display without its tracks) is
      // a layout nobody asked for, and it would report as applied.
      if (!property || !isSafeStyleValue(property, rawValue)) {
        return "needsAgent";
      }
      declared.push([property, rawValue.trim()]);
    }
    if (declared.length === 0) return "needsAgent";
    for (const [property, value] of declared) {
      setOrReplace(property, value);
      writtenProperties.push(property);
    }
  } else {
    setOrReplace("display", "flex");
    setOrReplace("flex-direction", direction);
    setOrReplace("gap", gap);
    writtenProperties.push("display", "flex-direction", "gap");
  }
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

  const frameElements = parseHtmlElements(result);
  const frameTarget = frameElements.find(
    (candidate) =>
      attributeValue(candidate, "data-agent-native-node-id") === targetId ||
      candidate.start === element.start,
  );
  if (frameTarget) {
    const convertGroupName =
      enabled && node.dataAttributes["data-agent-native-group"] === "true";
    result = removeElementAttributes(result, frameTarget, [
      "data-agent-native-group",
    ]);
    const retaggedElements = parseHtmlElements(result);
    const retaggedTarget = retaggedElements.find(
      (candidate) =>
        attributeValue(candidate, "data-agent-native-node-id") === targetId ||
        candidate.start === element.start,
    );
    if (retaggedTarget) {
      result = replaceOrInsertAttribute(
        result,
        retaggedTarget,
        "data-an-primitive",
        "frame",
      );
      if (convertGroupName) {
        const renamedElements = parseHtmlElements(result);
        const renamedTarget = renamedElements.find(
          (candidate) =>
            attributeValue(candidate, "data-agent-native-node-id") ===
              targetId || candidate.start === element.start,
        );
        if (renamedTarget) {
          result = replaceOrInsertAttribute(
            result,
            renamedTarget,
            "data-agent-native-layer-name",
            nextSequentialFrameName(
              build.projection.nodes.filter(
                (candidate) => candidate.id !== node.id,
              ),
            ),
          );
        }
      }
    }
  }

  return {
    content: result,
    capability: {
      kind: "style",
      properties: writtenProperties,
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

function applyVisualEditUnsafe(
  html: string,
  intent: EditIntent,
  options: {
    source?: CodeLayerSource;
    allowMainComponentStructure?: boolean;
    moveNode?: {
      destinationIsFlow?: boolean;
      sourceWasIgnoredInFlow?: boolean;
      forceRootIntoFlow?: boolean;
    };
  } = {},
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
  // See moveNodeBetweenDocuments' twin guard: a URL-backed screen stores its
  // route, not a document, and every edit below concatenates against `html`.
  // Callers only ever check `status`, so refusing here turns ~40 gesture and
  // action call sites into "nothing happened" instead of a screen silently
  // unbound from the running app.
  if (isStandaloneHttpUrl(html)) {
    return {
      content: html,
      projection: buildCodeLayerProjection(html, { source }),
      result: patchResult(
        "unsupported",
        source,
        intent,
        false,
        URL_BACKED_SCREEN_EDIT_REFUSAL,
      ),
    };
  }

  const initial = buildProjection(html, source);

  const structureTargets =
    intent.kind === "wrapNodes" || intent.kind === "booleanSubtract"
      ? intent.targetIds.map(
          (nodeId) => resolveTarget(initial, { nodeId }).node,
        )
      : intent.kind === "unwrap"
        ? [resolveTarget(initial, { nodeId: intent.targetId }).node]
        : intent.kind === "deleteNode"
          ? [resolveTarget(initial, intent.target).node]
          : [];
  if (
    structureTargets.some((node) => {
      if (!node) return false;
      if (
        (intent.kind === "deleteNode" || intent.kind === "unwrap") &&
        initial.projection.nodes.some(
          (candidate) =>
            Object.prototype.hasOwnProperty.call(
              candidate.dataAttributes,
              COMPONENT_ID_ATTR,
            ) &&
            candidate.source &&
            node.source &&
            candidate.source.start >= node.source.start &&
            candidate.source.end <= node.source.end,
        )
      )
        return true;
      const affectedParent =
        intent.kind === "unwrap"
          ? node
          : initial.projection.nodes.find(
              (parent) => parent.id === node.parentId,
            );
      const linkedRoot = affectedParent
        ? linkedComponentRootForNode(affectedParent, initial.projection)
        : null;
      return (
        linkedRoot &&
        (!options.allowMainComponentStructure ||
          !linkedRoot.dataAttributes[COMPONENT_ID_ATTR])
      );
    })
  ) {
    return {
      content: html,
      projection: initial.projection,
      result: patchResult(
        "unsupported",
        source,
        intent,
        false,
        LINKED_COMPONENT_STRUCTURE_REFUSAL,
      ),
    };
  }

  // --- Structural intents that don't resolve a single target node ---

  if (intent.kind === "wrapNodes") {
    const wrapEdit = applyWrapNodes(html, initial, intent);
    if (typeof wrapEdit === "string") {
      // L6: a distinct, specific message per failure kind instead of one
      // generic "group failed" toast — the previous single message
      // ("...share a common parent element") was misleadingly shown even
      // when the real cause was an empty selection or an unresolvable node,
      // making it hard for the user to tell what to fix.
      const message =
        wrapEdit === "unsupported"
          ? intent.targetIds.length === 0
            ? "Select at least one layer to group."
            : "Group requires all selected layers to share the same parent."
          : "Could not find one or more selected layers to group — the selection may be stale.";
      return {
        content: html,
        projection: initial.projection,
        result: {
          ...patchResult(wrapEdit, source, intent, false, message),
        },
      };
    }
    // Component structure validation requires this intermediate transform to
    // change only the canonical main span. Propagation installs the document
    // runtime after that boundary has been validated for every linked copy.
    const nextContent = options.allowMainComponentStructure
      ? wrapEdit.content
      : ensureGroupRuntime(wrapEdit.content);
    const nextProjection = buildCodeLayerProjection(nextContent, {
      source,
    });
    return {
      content: nextContent,
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

  if (intent.kind === "booleanSubtract") {
    const subtractEdit = applyBooleanSubtract(html, initial, intent);
    if ("status" in subtractEdit) {
      return {
        content: html,
        projection: initial.projection,
        result: patchResult(
          subtractEdit.status,
          source,
          intent,
          false,
          subtractEdit.message,
        ),
      };
    }
    const nextProjection = buildCodeLayerProjection(subtractEdit.content, {
      source,
    });
    return {
      content: subtractEdit.content,
      projection: nextProjection,
      result: {
        ...patchResult(
          "applied",
          source,
          intent,
          subtractEdit.content !== html,
          "Boolean subtraction created.",
          undefined,
          subtractEdit.capability,
        ),
        wrapperNodeId: subtractEdit.wrapperNodeId,
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

  if (intent.kind === "deleteNode") {
    if (booleanOperandFor(element)) {
      return {
        content: html,
        projection: initial.projection,
        result: patchResult(
          "unsupported",
          source,
          intent,
          false,
          "A Boolean operand cannot be deleted while its mask references it.",
          beforeNode,
          undefined,
          before,
        ),
      };
    }
    const deleted = removeCodeLayerNodeFromHtml(html, beforeNode);
    if (deleted === null) {
      return {
        content: html,
        projection: initial.projection,
        result: patchResult(
          "unsupported",
          source,
          intent,
          false,
          "This node cannot be deleted from the editable source.",
          beforeNode,
          undefined,
          before,
        ),
      };
    }
    return {
      content: deleted,
      projection: buildCodeLayerProjection(deleted, { source }),
      result: patchResult(
        "applied",
        source,
        intent,
        deleted !== html,
        "Node deleted.",
        beforeNode,
        {
          kind: "structure",
          operations: ["deleteNode"],
          confidence: 0.95,
        },
        before,
      ),
    };
  }

  let edit: { content: string; capability: EditCapability } | PatchResultStatus;
  let moveInsertAt: number | undefined;
  if (intent.kind === "style") {
    const route = resolveStyleEditTargetRoute(
      html,
      beforeNode,
      element,
      intent,
      initial.elements,
    );
    if (route.kind === "unsupported") {
      edit = "unsupported";
    } else if (intent.operation === "remove") {
      edit = applyStyleRemoveEdit(html, element, intent, route);
    } else if (route.kind === "boolean-operand") {
      edit = applyBooleanOperandStyleEdit(
        html,
        element,
        intent,
        initial.elements,
      );
    } else if (route.kind === "boolean-result") {
      edit = applyBooleanResultStyleEdit(
        html,
        element,
        intent,
        initial.elements,
      );
    } else if (route.kind === "released-svg") {
      edit = applyReleasedSvgShapeStyleEdit(
        html,
        element,
        intent,
        initial.elements,
      );
    } else if (route.kind === "vector-paint") {
      edit = applyStyleEdit(html, route.element, intent);
      if (typeof edit !== "string") {
        edit = {
          ...edit,
          content: clearVectorWrapperPaint(edit.content, element),
        };
      }
    } else {
      edit = applyStyleEdit(html, route.element, intent);
    }
  } else if (intent.kind === "class") {
    edit = applyClassEdit(html, element, intent);
  } else if (intent.kind === "textContent") {
    edit = applyTextEdit(html, element, intent);
  } else if (intent.kind === "attribute") {
    edit = applyAttributeEdit(html, element, intent);
  } else if (intent.kind === "responsive-class") {
    edit = applyResponsiveClassEdit(html, element, intent);
  } else if (intent.kind === "breakpoint-style") {
    edit = applyBreakpointStyleEdit(html, element, beforeNode, intent);
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
    const sourceParent = initial.projection.nodes.find(
      (node) => node.id === beforeNode.parentId,
    );
    const destinationParentNode =
      intent.placement === "inside"
        ? anchorResolution.node
        : initial.projection.nodes.find(
            (node) => node.id === anchorResolution.node!.parentId,
          );
    if (
      [sourceParent, destinationParentNode].some((node) => {
        const linkedRoot = node
          ? linkedComponentRootForNode(node, initial.projection)
          : null;
        return (
          linkedRoot &&
          (!options.allowMainComponentStructure ||
            !linkedRoot.dataAttributes[COMPONENT_ID_ATTR])
        );
      })
    ) {
      return {
        content: html,
        projection: initial.projection,
        result: patchResult(
          "unsupported",
          source,
          intent,
          false,
          LINKED_COMPONENT_STRUCTURE_REFUSAL,
          beforeNode,
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
    const destinationParent =
      intent.placement === "inside"
        ? anchorElement
        : anchorResolution.node.parentId
          ? initial.elementByNodeId.get(anchorResolution.node.parentId)
          : undefined;
    edit = applyMoveNodeEdit(
      html,
      element,
      anchorElement,
      intent,
      destinationParent,
      options.moveNode,
    );
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

export function applyVisualEdit(
  html: string,
  intent: EditIntent,
  options: {
    source?: CodeLayerSource;
    /** Only the atomic linked-component action may publish this transform. */
    allowMainComponentStructure?: boolean;
    moveNode?: {
      destinationIsFlow?: boolean;
      sourceWasIgnoredInFlow?: boolean;
      forceRootIntoFlow?: boolean;
    };
  } = {},
): ApplyVisualEditResult {
  try {
    return applyVisualEditUnsafe(html, intent, options);
  } catch (error) {
    if (!(error instanceof InvalidInlineStyleError)) throw error;
    const source = options.source ?? { kind: "inline-html" };
    return {
      content: html,
      projection: buildCodeLayerProjection(html, { source }),
      result: patchResult("unsupported", source, intent, false, error.message),
    };
  }
}

export type VisualStyleBatchResult =
  | { status: "applied"; content: string }
  | { status: "fallback" }
  | { status: "failed"; editIndex: number; reason: string };

/**
 * Internal fast path for one gesture's ordinary inline CSS edits. Semantic
 * vector targets return `fallback` so callers can replay the whole gesture
 * through `applyVisualEdit` and retain its specialized routing.
 */
export function applyOrdinaryVisualStyleBatch(
  html: string,
  edits: readonly {
    target: EditIntentTarget;
    property: string;
    value: string;
  }[],
  options: { source?: CodeLayerSource } = {},
): VisualStyleBatchResult {
  if (edits.length === 0) return { status: "applied", content: html };
  const source = options.source ?? { kind: "inline-html" };
  if (
    (source.kind !== "inline-html" && source.kind !== "design-file") ||
    isStandaloneHttpUrl(html)
  ) {
    return { status: "fallback" };
  }

  const initial = buildProjection(html, source);
  const updatesByElement = new Map<
    number,
    { element: ParsedElement; style: string; values: Map<string, string> }
  >();

  for (const [editIndex, edit] of edits.entries()) {
    const resolution = resolveTarget(initial, edit.target);
    if (resolution.status !== "resolved" || !resolution.node) {
      return {
        status: "failed",
        editIndex,
        reason: resolution.message ?? "Could not resolve the edit target.",
      };
    }
    const element = initial.elementByNodeId.get(resolution.node.id);
    if (!element || !resolution.node.source) {
      return {
        status: "failed",
        editIndex,
        reason: "The target node does not have editable source spans.",
      };
    }

    const intent: StyleEditIntent = {
      kind: "style",
      target: edit.target,
      property: edit.property,
      value: edit.value,
    };
    const route = resolveStyleEditTargetRoute(
      html,
      resolution.node,
      element,
      intent,
      initial.elements,
    );
    if (route.kind !== "ordinary") return { status: "fallback" };

    const normalized = normalizedSafeStyleValue(edit.property, edit.value);
    if (!normalized) {
      return {
        status: "failed",
        editIndex,
        reason:
          "The requested edit is not supported by the deterministic editor.",
      };
    }

    const existingUpdate = updatesByElement.get(route.element.index);
    const update = existingUpdate ?? {
      element: route.element,
      style: attributeValue(route.element, "style") ?? "",
      values: new Map<string, string>(),
    };
    if (!existingUpdate) {
      updatesByElement.set(route.element.index, update);
    }
    const previousValue = update.values.get(normalized.property);
    if (previousValue !== undefined && previousValue !== normalized.value) {
      return {
        status: "failed",
        editIndex,
        reason: `Conflicting values for ${normalized.property} on the same target.`,
      };
    }
    if (previousValue === undefined) {
      update.values.set(normalized.property, normalized.value);
      try {
        update.style = setStyleValue(
          update.style,
          normalized.property,
          normalized.value,
        );
      } catch (error) {
        if (!(error instanceof InvalidInlineStyleError)) throw error;
        return { status: "failed", editIndex, reason: error.message };
      }
    }
  }

  return {
    status: "applied",
    content: patchElementAttributes(
      html,
      [...updatesByElement.values()].map((update) => ({
        element: update.element,
        attributes: { style: update.style },
      })),
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
  nodeId?: string;
  sourceSelector?: string;
  anchorNodeId?: string;
  anchorSelector?: string;
  placement?: "before" | "after" | "inside";
  moveLayout?: {
    destinationIsFlow?: boolean;
    sourceWasIgnoredInFlow?: boolean;
    forceRootIntoFlow?: boolean;
  };
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
  /**
   * Finding 8: true when the requested anchor placement fell inside a
   * `<template>` interior and the insert was redirected to a real DOM slot
   * instead (immediately after the enclosing template's `</template>` when
   * that could be located, otherwise the pre-existing doc-end/body-end
   * fallback). Hosts can use this to toast a "landed near, not exactly
   * where you dropped it" notice instead of the previous fully silent
   * teleport. Only meaningful when status is "applied" and an anchor was
   * requested.
   */
  anchorRedirected?: boolean;
}

/**
 * Move a node from sourceHtml into destHtml by stable ID or unique authored
 * selectors. ID-less source and destination nodes are stamped before the move
 * so later edits can resolve them durably. Omitting an anchor explicitly
 * appends to the body; a requested but unresolved anchor fails atomically.
 * Any node ids in the moved subtree that already exist in destHtml are
 * re-stamped to stay unique. No external dependencies.
 */
export function moveNodeBetweenDocuments(
  sourceHtml: string,
  destHtml: string,
  opts: MoveNodeBetweenDocumentsOptions,
): MoveNodeBetweenDocumentsResult {
  const {
    nodeId,
    sourceSelector,
    anchorNodeId,
    anchorSelector,
    placement = "inside",
    moveLayout,
  } = opts;
  const originalSourceHtml = sourceHtml;
  const originalDestHtml = destHtml;

  // A URL-backed (localhost/fusion) screen stores its route URL as content,
  // not a document. Both branches below end in string concatenation against
  // `destHtml`, so a URL destination yields "http://host/<div …>" — a screen
  // permanently unbound from the running app, with no parse error anywhere.
  // Refusing HERE and not only at the persist gate matters: callers move
  // several files in one gesture and write the source screens first, so a
  // late refusal would delete the node from its source and land it nowhere.
  if (isStandaloneHttpUrl(destHtml) || isStandaloneHttpUrl(sourceHtml)) {
    return {
      sourceHtml,
      destHtml,
      status: "unsupported",
      message: URL_BACKED_SCREEN_EDIT_REFUSAL,
    };
  }

  const sourceBuild = buildProjection(sourceHtml, { kind: "inline-html" });
  const sourceResolution = resolveTarget(sourceBuild, {
    ...(nodeId ? { nodeId } : {}),
    ...(sourceSelector ? { selector: sourceSelector } : {}),
  });
  if (sourceResolution.status !== "resolved" || !sourceResolution.node) {
    return {
      sourceHtml,
      destHtml,
      status: "unsupported",
      message:
        sourceResolution.message ??
        "The moved layer did not resolve uniquely in sourceHtml.",
    };
  }

  const hasRequestedAnchor = Boolean(anchorNodeId || anchorSelector);
  const destBuild = hasRequestedAnchor
    ? buildProjection(destHtml, { kind: "inline-html" })
    : null;
  const anchorResolution =
    hasRequestedAnchor && destBuild
      ? resolveTarget(destBuild, {
          ...(anchorNodeId ? { nodeId: anchorNodeId } : {}),
          ...(anchorSelector ? { selector: anchorSelector } : {}),
        })
      : null;
  if (
    hasRequestedAnchor &&
    (anchorResolution?.status !== "resolved" || !anchorResolution.node)
  ) {
    return {
      sourceHtml,
      destHtml,
      status: "unsupported",
      message:
        anchorResolution?.message ??
        "The requested destination anchor did not resolve uniquely in destHtml.",
    };
  }

  const sourceParentNode = sourceBuild.projection.nodes.find(
    (node) => node.id === sourceResolution.node!.parentId,
  );
  const destinationParent =
    anchorResolution?.node && destBuild
      ? placement === "inside"
        ? anchorResolution.node
        : destBuild.projection.nodes.find(
            (node) => node.id === anchorResolution.node!.parentId,
          )
      : undefined;
  if (
    (sourceParentNode &&
      linkedComponentRootForNode(sourceParentNode, sourceBuild.projection)) ||
    (destinationParent &&
      destBuild &&
      linkedComponentRootForNode(destinationParent, destBuild.projection))
  )
    return {
      sourceHtml,
      destHtml,
      status: "unsupported",
      message: LINKED_COMPONENT_STRUCTURE_REFUSAL,
    };

  const sourceIdentity = ensureCodeLayerNodeIdInHtml(
    sourceHtml,
    sourceResolution.node.id,
    { selector: sourceResolution.node.path },
  );
  if (!sourceIdentity.nodeId) {
    return {
      sourceHtml,
      destHtml,
      status: "unsupported",
      message: "The moved layer could not receive a durable source identity.",
    };
  }
  const destIdentity =
    anchorResolution?.status === "resolved" && anchorResolution.node
      ? ensureCodeLayerNodeIdInHtml(destHtml, anchorResolution.node.id, {
          selector: anchorResolution.node.path,
        })
      : null;
  if (hasRequestedAnchor && !destIdentity?.nodeId) {
    return {
      sourceHtml,
      destHtml,
      status: "unsupported",
      message: "The destination anchor could not receive a durable identity.",
    };
  }
  sourceHtml = sourceIdentity.content;
  destHtml = destIdentity?.content ?? destHtml;
  const resolvedNodeId = sourceIdentity.nodeId;
  const resolvedAnchorNodeId = destIdentity?.nodeId;

  // --- Locate the identified source and destination elements ---
  const sourceElements = parseHtmlElements(sourceHtml);
  const sourceTarget = sourceElements.find(
    (el) => attributeValue(el, "data-agent-native-node-id") === resolvedNodeId,
  );
  if (!sourceTarget) {
    return {
      sourceHtml: originalSourceHtml,
      destHtml: originalDestHtml,
      status: "unsupported",
      message: "The moved layer identity was lost before extraction.",
    };
  }
  const sourceParent =
    sourceTarget.parentIndex === undefined
      ? undefined
      : sourceElements[sourceTarget.parentIndex];
  const sourceWasIgnoredInFlow =
    moveLayout?.sourceWasIgnoredInFlow ??
    (isFlowLayoutContainer(sourceParent) && isOutOfFlowElement(sourceTarget));
  const fragmentMoveLayout = {
    ...moveLayout,
    sourceWasIgnoredInFlow,
  };

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
  // Replacements are tracked PER ATTRIBUTE OCCURRENCE, not in an
  // old-id -> new-id map: malformed/generated source can already contain the
  // same stable id more than once. Mapping by the old string would assign the
  // same replacement to every duplicate and leave the destination ambiguous
  // after a cross-screen move (selection and undo would then target whichever
  // duplicate happened to resolve first).
  const fragElements = parseHtmlElements(fragment);
  const remapEdits: Array<{ start: number; end: number; value: string }> = [];
  let movedNodeId = resolvedNodeId;
  for (const fragEl of fragElements) {
    const attr = getAttribute(fragEl, "data-agent-native-node-id");
    if (!attr || typeof attr.value !== "string") continue;
    const existingId = attr.value;
    let nextId = existingId;
    if (destUsedIds.has(existingId)) {
      const newId = freshNodeId(
        destUsedIds,
        `moved:${existingId}:${fragEl.start}`,
      );
      nextId = newId;
      remapEdits.push({
        start: attr.start,
        end: attr.end,
        value: `data-agent-native-node-id="${escapeHtmlAttribute(newId)}"`,
      });
    } else {
      destUsedIds.add(existingId);
    }
    if (fragEl.parentIndex === undefined) movedNodeId = nextId;
  }

  // Apply id remaps to the fragment (back to front by attribute position).
  if (remapEdits.length > 0) {
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
  let anchorRedirected = false;

  if (resolvedAnchorNodeId) {
    const anchor = destElements.find(
      (el) =>
        attributeValue(el, "data-agent-native-node-id") ===
        resolvedAnchorNodeId,
    );
    if (!anchor) {
      return {
        sourceHtml: originalSourceHtml,
        destHtml: originalDestHtml,
        status: "unsupported",
        message: "The requested destination anchor was lost before insertion.",
      };
    }
    let insertAt =
      placement === "before"
        ? anchor.start
        : placement === "after"
          ? anchor.end
          : anchor.selfClosing
            ? anchor.end
            : anchor.contentEnd;
    // Never splice into a <template> interior — it renders nowhere and is
    // unselectable afterward (see isOffsetInsideTemplateInterior doc above).
    // Finding 8: redirect to immediately AFTER the ENCLOSING outer
    // </template> when it can be located — still a guaranteed-safe real-DOM
    // slot, just a sibling of the template instead of a jump all the way to
    // the end of <body>/the document. Falls back to the old doc-end/body-end
    // behavior only if the enclosing template's close somehow can't be
    // resolved (defense-in-depth for a guard that should always agree with
    // itself here).
    const enclosingTemplate = findEnclosingTemplateClose(destHtml, insertAt);
    if (enclosingTemplate) {
      insertAt = enclosingTemplate.closeEnd;
      anchorRedirected = true;
    } else if (isOffsetInsideTemplateInterior(destHtml, insertAt)) {
      const bodyEl = destElements.find((el) => el.tag === "body");
      insertAt = bodyEl
        ? bodyEl.selfClosing
          ? bodyEl.end
          : bodyEl.contentEnd
        : destHtml.length;
      anchorRedirected = true;
    }
    const destinationParent =
      placement === "inside"
        ? anchor
        : anchor.parentIndex === undefined
          ? undefined
          : destElements[anchor.parentIndex];
    fragment = prepareMovedFragmentForParent(
      fragment,
      destinationParent,
      fragmentMoveLayout,
    );
    nextDestHtml = `${destHtml.slice(0, insertAt)}${fragment}${destHtml.slice(insertAt)}`;
  } else {
    // Default: find <body> and append inside it, or append at end of doc.
    const bodyEl = destElements.find((el) => el.tag === "body");
    let insertAt = bodyEl
      ? bodyEl.selfClosing
        ? bodyEl.end
        : bodyEl.contentEnd
      : destHtml.length;
    // Same template-interior guard as the anchored branch above — a
    // miscomputed bodyEl.contentEnd (or a body that itself is only reachable
    // through a template, e.g. a fragment being treated as a full document)
    // must never land inside template markup.
    if (isOffsetInsideTemplateInterior(destHtml, insertAt)) {
      insertAt = destHtml.length;
    }
    // Appending inside <body> makes the moved node a flow child of the body,
    // exactly like the anchored `placement: "inside"` branch above. When the
    // destination body is a flex/grid container, carrying the fragment's
    // former absolute offsets along would leave it visually detached from
    // the body's ordering/gap/alignment, so run the same normalization
    // (prepareMovedFragmentForParent no-ops for non-flow bodies).
    fragment = prepareMovedFragmentForParent(
      fragment,
      bodyEl,
      fragmentMoveLayout,
    );
    nextDestHtml = `${destHtml.slice(0, insertAt)}${fragment}${destHtml.slice(insertAt)}`;
  }

  return {
    sourceHtml: nextSourceHtml,
    destHtml: nextDestHtml,
    status: "applied",
    movedNodeId,
    ...(anchorRedirected ? { anchorRedirected: true } : {}),
  };
}
