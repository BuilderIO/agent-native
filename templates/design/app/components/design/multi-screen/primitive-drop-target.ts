import { buildCodeLayerProjection } from "@shared/code-layer";

import { hashString } from "./board-surface-html";
import {
  boardPointToScreenLocalPoint,
  screenLocalRectToBoardGeometry,
} from "./coordinate-transforms";
import {
  geometryContainsGeometry,
  geometryContainsPoint,
} from "./frame-geometry";
import type {
  CrossScreenDropAxis,
  CrossScreenDropPlacement,
  FrameGeometry,
  FrameGeometryById,
  Point,
  ScreenProjectionNodeIdentity,
  ScreenFile,
} from "./types";

export interface PrimitiveDropTarget {
  nodeId: string;
  screenId: string;
  boardRect: FrameGeometry;
  targetIdentity?: ScreenProjectionNodeIdentity;
  placement?: CrossScreenDropPlacement;
  axis?: CrossScreenDropAxis;
  anchorNodeId?: string;
}

export interface ParsedScreenPrimitive {
  nodeId: string;
  screenId: string;
  projectionIdentity?: ScreenProjectionNodeIdentity;
  parentNodeId?: string;
  parentProjectionNodeId?: string;
  projectionAncestorNodeIds?: string[];
  localLeft: number;
  localTop: number;
  localWidth: number;
  localHeight: number;
  isContainer: boolean;
  autoLayoutAxis?: CrossScreenDropAxis;
  autoLayoutWrapped?: boolean;
  autoLayoutGrid?: boolean;
  zIndex?: number;
  stackingContextZIndices?: number[];
  stackingContextOrders?: number[];
}

function primitiveMatchesNodeId(
  primitive: ParsedScreenPrimitive,
  nodeId: string,
): boolean {
  return (
    primitive.nodeId === nodeId ||
    primitive.projectionIdentity?.nodeId === nodeId
  );
}

function isPrimitiveAncestor(
  ancestor: ParsedScreenPrimitive,
  descendant: ParsedScreenPrimitive,
  primitives: ParsedScreenPrimitive[],
): boolean {
  if (descendant.projectionAncestorNodeIds) {
    return ancestor.projectionIdentity
      ? descendant.projectionAncestorNodeIds.includes(
          ancestor.projectionIdentity.nodeId,
        )
      : false;
  }
  let parentId = descendant.parentProjectionNodeId ?? descendant.parentNodeId;
  const seen = new Set<string>();
  while (parentId && !seen.has(parentId)) {
    const currentParentId = parentId;
    seen.add(currentParentId);
    if (primitiveMatchesNodeId(ancestor, currentParentId)) return true;
    const parents = primitives.filter((primitive) =>
      primitiveMatchesNodeId(primitive, currentParentId),
    );
    if (parents.length !== 1) return false;
    const parent = parents[0];
    parentId = parent.parentProjectionNodeId ?? parent.parentNodeId;
  }
  return false;
}

function createsAuthoredStackingContext(
  style: CSSStyleDeclaration,
  parentDisplay: string,
): boolean {
  const value = (property: string) =>
    style.getPropertyValue(property).trim().toLowerCase();
  const position = value("position") || "static";
  const zIndex = Number.parseInt(value("z-index"), 10);
  const zIndexApplies =
    position !== "static" ||
    /^(?:flex|inline-flex|grid|inline-grid)$/.test(parentDisplay);

  if (
    position === "fixed" ||
    position === "sticky" ||
    (Number.isFinite(zIndex) && zIndexApplies)
  ) {
    return true;
  }
  const opacity = Number.parseFloat(value("opacity"));
  if (Number.isFinite(opacity) && opacity < 1) return true;
  if (
    [
      "transform",
      "scale",
      "rotate",
      "translate",
      "filter",
      "backdrop-filter",
      "perspective",
      "clip-path",
      "mask",
      "mask-image",
    ].some((property) => {
      const propertyValue = value(property);
      return propertyValue !== "" && propertyValue !== "none";
    })
  ) {
    return true;
  }
  if (value("mix-blend-mode") && value("mix-blend-mode") !== "normal") {
    return true;
  }
  if (value("isolation") === "isolate") return true;
  if (/\b(?:layout|paint|strict|content)\b/.test(value("contain"))) {
    return true;
  }
  if (/^(?:size|inline-size)$/.test(value("container-type"))) return true;
  return /\b(?:opacity|transform|filter|perspective|clip-path|mask)\b/.test(
    value("will-change"),
  );
}

function compareStackingContexts(
  left: ParsedScreenPrimitive,
  right: ParsedScreenPrimitive,
): number {
  const leftContexts = left.stackingContextZIndices ?? [];
  const rightContexts = right.stackingContextZIndices ?? [];
  const leftOrders = left.stackingContextOrders ?? [];
  const rightOrders = right.stackingContextOrders ?? [];
  for (
    let index = 0;
    index < Math.min(leftContexts.length, rightContexts.length);
    index += 1
  ) {
    if (
      leftOrders[index] !== undefined &&
      rightOrders[index] !== undefined &&
      leftOrders[index] !== rightOrders[index]
    ) {
      if (leftContexts[index] === rightContexts[index]) return 0;
      return (leftContexts[index] ?? 0) - (rightContexts[index] ?? 0);
    }
    if (leftContexts[index] !== rightContexts[index]) {
      return (leftContexts[index] ?? 0) - (rightContexts[index] ?? 0);
    }
  }
  return (left.zIndex ?? 0) - (right.zIndex ?? 0);
}

function computeAutoLayoutAxis(style: {
  display: string;
  flexDirection: string;
  flexWrap: string;
  gridTemplateColumns: string;
  gridAutoFlow: string;
}): CrossScreenDropAxis | undefined {
  if (style.display === "flex" || style.display === "inline-flex") {
    const direction = style.flexDirection || "row";
    const isRow = direction.startsWith("row");
    return isRow ? "x" : "y";
  }
  if (style.display === "grid" || style.display === "inline-grid") {
    if (
      /repeat\(\s*(?:auto-fit|auto-fill)\s*,/i.test(style.gridTemplateColumns)
    ) {
      return undefined;
    }
    if (/^column(?:-dense)?\b/i.test(style.gridAutoFlow)) return "y";
    const columns = gridTrackCount(style.gridTemplateColumns);
    return columns > 1 ? "x" : "y";
  }
  return undefined;
}

function gridTrackCount(template: string): number {
  let count = 0;
  for (const track of gridTemplateTokens(template)) {
    if (/^\[[^\]]+\]$/.test(track)) continue;
    const repeat = track.match(/^repeat\(\s*(\d+)\s*,([\s\S]+)\)$/i);
    count += repeat ? Number(repeat[1]) * gridTrackCount(repeat[2]) : 1;
  }
  return count;
}

function gridTemplateTokens(template: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let parenDepth = 0;
  let bracketDepth = 0;
  const flush = () => {
    if (token) tokens.push(token);
    token = "";
  };
  for (const character of template.trim()) {
    if (/\s/.test(character) && parenDepth === 0 && bracketDepth === 0) {
      flush();
      continue;
    }
    token += character;
    if (character === "(") parenDepth += 1;
    else if (character === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (character === "[") bracketDepth += 1;
    else if (character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
  }
  flush();
  return tokens;
}

function gridTracks(template: string): string[] {
  const tokens = gridTemplateTokens(template).filter(
    (track) => track && !/^\[[^\]]+\]$/.test(track),
  );
  return tokens.flatMap((track) => {
    const repeat = track.match(/^repeat\(\s*(\d+)\s*,([\s\S]+)\)$/i);
    if (!repeat) return [track];
    return Array.from({ length: Number(repeat[1]) }, () =>
      gridTracks(repeat[2]),
    ).flat();
  });
}

function extendGridTracks(tracks: string[], minimumCount: number): string[] {
  const result = tracks.length ? [...tracks] : ["1fr"];
  const fill = result[result.length - 1] ?? "1fr";
  while (result.length < minimumCount) result.push(fill);
  return result;
}

function gridTrackPixels(
  tracks: string[],
  available: number,
  gap: number,
): number[] {
  const fixed = tracks.map((track) => {
    const px = cssPixelNumber(track);
    if (px) return { size: px, fr: 0 };
    const minmax = track.match(
      /^minmax\(\s*(\d+(?:\.\d+)?)px\s*,\s*([^,]+)\)$/i,
    );
    const fr = (minmax?.[2] ?? track).match(/(?:^|,)\s*(\d+(?:\.\d+)?)fr/);
    return {
      size: minmax ? Number(minmax[1]) : 0,
      fr: fr ? Number(fr[1]) : 0,
    };
  });
  const remaining = Math.max(
    0,
    available -
      gap * Math.max(0, tracks.length - 1) -
      fixed.reduce((sum, item) => sum + (item.fr ? 0 : item.size), 0),
  );
  const frTotal = fixed.reduce((sum, item) => sum + item.fr, 0);
  return fixed.map((item) =>
    item.fr
      ? Math.max(item.size, frTotal ? (remaining * item.fr) / frTotal : 0)
      : item.size,
  );
}

function gridLine(template: string, value: string, fallback: number): number {
  if (/^span(?:\s|$)/i.test(value.trim())) return fallback;
  const numeric = Number.parseInt(value, 10);
  if (Number.isFinite(numeric)) {
    return numeric < 0
      ? Math.max(1, gridTrackCount(template) + numeric + 2)
      : numeric;
  }
  const match = value.match(/^(?:[\w-]+\s+)?([\w-]+)$/)?.[1];
  if (!match) return fallback;
  for (const group of template.matchAll(/\[([^\]]+)\]/g)) {
    if (group[1].split(/\s+/).includes(match)) {
      return gridTrackCount(template.slice(0, group.index ?? 0)) + 1;
    }
  }
  return fallback;
}

function gridStartValue(
  style: CSSStyleDeclaration,
  axis: "column" | "row",
): string {
  const start = axis === "column" ? style.gridColumnStart : style.gridRowStart;
  if (start) return start;
  const shorthand = axis === "column" ? style.gridColumn : style.gridRow;
  return shorthand.split("/")[0]?.trim() ?? "";
}

function gridStartIndex(
  style: CSSStyleDeclaration,
  axis: "column" | "row",
  template: string,
): number | undefined {
  const value = gridStartValue(style, axis);
  if (!value || /^auto$/i.test(value)) return undefined;
  const line = gridLine(template, value, Number.NaN);
  return Number.isFinite(line) ? line : undefined;
}

function gridSpan(style: CSSStyleDeclaration, axis: "column" | "row") {
  const shorthand = axis === "column" ? style.gridColumn : style.gridRow;
  const end = axis === "column" ? style.gridColumnEnd : style.gridRowEnd;
  const values = [gridStartValue(style, axis), end, shorthand.split("/")[1]];
  for (const value of values) {
    const match = value?.trim().match(/^span\s+(\d+)/i);
    if (match) return Math.max(1, Number(match[1]));
  }
  return 1;
}

export function findAutoLayoutInsertionAnchor(
  container: ParsedScreenPrimitive,
  screenPrimitives: ParsedScreenPrimitive[],
  localPoint: Point,
  excludeNodeId: string | null,
): {
  anchorNodeId: string;
  anchorProjectionNodeId?: string;
  placement: "before" | "after";
} | null {
  const axis = container.autoLayoutAxis;
  if (!axis) return null;
  let best: ParsedScreenPrimitive | null = null;
  let bestDistance = Infinity;
  let placement: "before" | "after" = "after";
  for (const sibling of screenPrimitives) {
    if (container.projectionIdentity) {
      if (
        sibling.parentProjectionNodeId !== container.projectionIdentity.nodeId
      ) {
        continue;
      }
    } else if (sibling.parentNodeId !== container.nodeId) {
      continue;
    }
    if (excludeNodeId && primitiveMatchesNodeId(sibling, excludeNodeId)) {
      continue;
    }
    const center =
      axis === "x"
        ? sibling.localLeft + sibling.localWidth / 2
        : sibling.localTop + sibling.localHeight / 2;
    const pointer = axis === "x" ? localPoint.x : localPoint.y;
    const gridHasRows =
      container.autoLayoutGrid === true &&
      screenPrimitives.some(
        (candidate) =>
          candidate.parentNodeId === container.nodeId &&
          candidate.localTop !== sibling.localTop,
      );
    const distance =
      container.autoLayoutWrapped || gridHasRows
        ? Math.hypot(
            localPoint.x - (sibling.localLeft + sibling.localWidth / 2),
            localPoint.y - (sibling.localTop + sibling.localHeight / 2),
          )
        : Math.abs(pointer - center);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = sibling;
      placement = pointer < center ? "before" : "after";
    }
  }
  if (!best) return null;
  return {
    anchorNodeId: best.nodeId,
    ...(best.projectionIdentity
      ? { anchorProjectionNodeId: best.projectionIdentity.nodeId }
      : {}),
    placement,
  };
}

export function getPrimitiveLowZoomHitRect(
  primitive: ParsedScreenPrimitive,
  zoom: number,
  minimumScreenPixels = 6,
): FrameGeometry {
  const scale = Math.max(0.0001, zoom / 100);
  const minimumWorldSize = minimumScreenPixels / scale;
  const width = Math.max(primitive.localWidth, minimumWorldSize);
  const height = Math.max(primitive.localHeight, minimumWorldSize);
  return {
    x: primitive.localLeft - (width - primitive.localWidth) / 2,
    y: primitive.localTop - (height - primitive.localHeight) / 2,
    width,
    height,
  };
}

export function isPrimitiveContainer(args: {
  tagName: string;
  primitiveKind: string;
  display: string;
  borderRadius: string;
}): boolean {
  const isDiv = [
    "div",
    "section",
    "main",
    "header",
    "footer",
    "article",
    "nav",
    "aside",
  ].includes(args.tagName.toLowerCase());
  const primitiveKind = args.primitiveKind.toLowerCase();
  const isEllipse =
    args.borderRadius === "50%" || args.borderRadius === "50% 50% 50% 50%";
  const isTextAutoSize = args.display === "inline-block";
  const isAutoLayout =
    args.display === "flex" ||
    args.display === "inline-flex" ||
    args.display === "grid" ||
    args.display === "inline-grid";
  const isCanvasContainer =
    isDiv &&
    (primitiveKind === "rectangle" ||
      primitiveKind === "rect" ||
      primitiveKind === "frame");
  return (
    isDiv &&
    !isEllipse &&
    !isTextAutoSize &&
    (isAutoLayout || isCanvasContainer)
  );
}

export const primitiveParseCache = new Map<string, ParsedScreenPrimitive[]>();
const PRIMITIVE_PARSE_CACHE_MAX = 64;
const PRIMITIVE_IDENTITY_CACHE_MAX = 64;
const primitiveParseIdentityCache = new Map<
  string,
  { content: string; sourceKey: string; result: ParsedScreenPrimitive[] }
>();

function rememberPrimitiveIdentity(
  screenId: string,
  content: string,
  sourceKey: string,
  result: ParsedScreenPrimitive[],
) {
  primitiveParseIdentityCache.delete(screenId);
  if (primitiveParseIdentityCache.size >= PRIMITIVE_IDENTITY_CACHE_MAX) {
    const oldestId = primitiveParseIdentityCache.keys().next().value;
    if (oldestId !== undefined) primitiveParseIdentityCache.delete(oldestId);
  }
  primitiveParseIdentityCache.set(screenId, { content, sourceKey, result });
}

export function __clearPrimitiveParseCachesForTests() {
  primitiveParseCache.clear();
  primitiveParseIdentityCache.clear();
}

export function __getPrimitiveParseCacheSizesForTests() {
  return {
    parsed: primitiveParseCache.size,
    identity: primitiveParseIdentityCache.size,
  };
}

type InlineNumericProperty =
  | "width"
  | "height"
  | "left"
  | "top"
  | "paddingLeft"
  | "paddingRight"
  | "paddingTop"
  | "paddingBottom"
  | "borderLeftWidth"
  | "borderRightWidth"
  | "borderTopWidth"
  | "borderBottomWidth"
  | "marginLeft"
  | "marginRight"
  | "marginTop"
  | "marginBottom"
  | "gap"
  | "rowGap"
  | "columnGap";

type AuthoredSizeAxis = "x" | "y";
type AuthoredSizeCache = Map<
  Element,
  Partial<Record<AuthoredSizeAxis, number>>
>;

function inlineNumber(element: Element, property: InlineNumericProperty) {
  const value = (element as HTMLElement).style[property];
  const parsed = Number.parseFloat(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function elementInlineSize(
  element: Element,
  axis: "x" | "y",
  cache?: AuthoredSizeCache,
  visiting?: Set<Element>,
) {
  return authoredElementSize(element, axis, cache, visiting);
}

function parseAuthoredLength(value: string | undefined, reference: number) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    !normalized ||
    normalized === "auto" ||
    normalized === "fit-content" ||
    normalized.startsWith("fit-content(")
  ) {
    return null;
  }
  if (/^[+-]?0(?:\.0+)?$/.test(normalized)) return 0;
  const px = normalized.match(/^(-?\d+(?:\.\d+)?)px$/);
  if (px?.[1]) return Number(px[1]);
  const percent = normalized.match(/^(-?\d+(?:\.\d+)?)%$/);
  if (percent?.[1] && reference >= 0) {
    return (Number(percent[1]) / 100) * reference;
  }
  return null;
}

function isOutOfFlow(element: Element) {
  const position = (element as HTMLElement).style.position;
  return position === "absolute" || position === "fixed";
}

function flexBasis(element: Element, reference: number) {
  const style = (element as HTMLElement).style;
  const explicit = parseAuthoredLength(style.flexBasis, reference);
  if (explicit !== null) return explicit;

  const shorthand = (style.flex || "").trim();
  if (!shorthand) return null;
  const tokens = shorthand.split(/\s+/);
  const shorthandKeyword = tokens[0]?.toLowerCase();
  if (
    shorthandKeyword === "auto" ||
    shorthandKeyword === "initial" ||
    shorthandKeyword === "none"
  ) {
    return null;
  }
  if (tokens.length === 1) {
    return parseAuthoredLength(tokens[0], reference) ?? 0;
  }
  if (tokens.length >= 3) {
    return parseAuthoredLength(tokens[2], reference);
  }
  if (
    tokens.length === 2 &&
    tokens.every((token) => /^-?\d+(?:\.\d+)?$/.test(token))
  ) {
    return 0;
  }
  return parseAuthoredLength(tokens[1], reference);
}

function flexGrow(element: Element) {
  const style = (element as HTMLElement).style;
  const explicit = Number.parseFloat(style.flexGrow || "");
  if (Number.isFinite(explicit)) return Math.max(0, explicit);
  const shorthand = (style.flex || "").trim().split(/\s+/)[0];
  const parsed = Number.parseFloat(shorthand || "");
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function flexMainAxis(parent: Element): AuthoredSizeAxis | null {
  const style = (parent as HTMLElement).style;
  if (style.display !== "flex" && style.display !== "inline-flex") return null;
  return (style.flexDirection || "row").startsWith("column") ? "y" : "x";
}

function flexMainAxisGap(parent: Element, axis: AuthoredSizeAxis) {
  const style = (parent as HTMLElement).style;
  const axisProperty = axis === "x" ? "columnGap" : "rowGap";
  if (style[axisProperty].trim()) return inlineNumber(parent, axisProperty);
  const shorthand = style.gap.trim().split(/\s+/).filter(Boolean);
  const value = shorthand[axis === "x" ? Math.min(1, shorthand.length - 1) : 0];
  const parsed = Number.parseFloat(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function parentContentSize(
  parent: Element,
  axis: AuthoredSizeAxis,
  cache: AuthoredSizeCache,
  visiting: Set<Element>,
) {
  const size = authoredElementSize(parent, axis, cache, visiting);
  const style = (parent as HTMLElement).style;
  const padding =
    axis === "x"
      ? inlineNumber(parent, "paddingLeft") +
        inlineNumber(parent, "paddingRight") +
        inlineNumber(parent, "borderLeftWidth") +
        inlineNumber(parent, "borderRightWidth")
      : inlineNumber(parent, "paddingTop") +
        inlineNumber(parent, "paddingBottom") +
        inlineNumber(parent, "borderTopWidth") +
        inlineNumber(parent, "borderBottomWidth");
  return style.boxSizing === "border-box" ? Math.max(0, size - padding) : size;
}

function authoredGridTrackSize(
  element: Element,
  parent: Element,
  axis: AuthoredSizeAxis,
  reference: number,
  cache: AuthoredSizeCache,
  visiting: Set<Element>,
) {
  const parentStyle = (parent as HTMLElement).style;
  const template =
    axis === "x"
      ? parentStyle.gridTemplateColumns
      : parentStyle.gridTemplateRows;
  const tracks = gridTracks(template);
  const line = gridStartIndex(
    (element as HTMLElement).style,
    axis === "x" ? "column" : "row",
    template,
  );
  if (!tracks.length || line === undefined || line < 1) return reference;
  return (
    gridTrackPixels(
      tracks,
      parentContentSize(parent, axis, cache, visiting),
      cssPixelNumber(
        parentStyle[axis === "x" ? "columnGap" : "rowGap"] || parentStyle.gap,
      ),
    )[line - 1] ?? reference
  );
}

function flexItemBaseSize(
  element: Element,
  axis: AuthoredSizeAxis,
  reference: number,
  cache: AuthoredSizeCache,
  visiting: Set<Element>,
) {
  const basis = flexBasis(element, reference);
  if (basis !== null) return basis;
  const style = (element as HTMLElement).style;
  const authored = parseAuthoredLength(
    style[axis === "x" ? "width" : "height"],
    reference,
  );
  if (authored !== null) return authored;
  if (
    (element.getAttribute("data-an-primitive") || "").toLowerCase() === "text"
  ) {
    return authoredTextIntrinsicSize(element)[
      axis === "x" ? "width" : "height"
    ];
  }
  return intrinsicContentSize(element, axis, cache, visiting);
}

function flexAvailableSize(
  element: Element,
  axis: AuthoredSizeAxis,
  parent: Element,
  available: number,
  cache: AuthoredSizeCache,
  visiting: Set<Element>,
) {
  if (flexMainAxis(parent) !== axis) return available;
  const children = Array.from(parent.children).filter(
    (child) => !isOutOfFlow(child),
  );
  const gap = flexMainAxisGap(parent, axis);
  let fixed = Math.max(0, children.length - 1) * gap;
  let growTotal = 0;
  let growBase = 0;
  for (const child of children) {
    const grow = flexGrow(child);
    const base = flexItemBaseSize(child, axis, available, cache, visiting);
    const leadingMargin = inlineNumber(
      child,
      axis === "x" ? "marginLeft" : "marginTop",
    );
    const trailingMargin = inlineNumber(
      child,
      axis === "x" ? "marginRight" : "marginBottom",
    );
    if (grow > 0) {
      growTotal += grow;
      growBase += base + leadingMargin + trailingMargin;
      continue;
    }
    fixed += base + leadingMargin + trailingMargin;
  }
  if (growTotal <= 0) return 0;
  return (
    flexItemBaseSize(element, axis, available, cache, visiting) +
    Math.max(0, available - fixed - growBase) * (flexGrow(element) / growTotal)
  );
}

function intrinsicContentSize(
  element: Element,
  axis: AuthoredSizeAxis,
  cache: AuthoredSizeCache,
  visiting: Set<Element>,
) {
  const leading =
    axis === "x"
      ? inlineNumber(element, "paddingLeft") +
        inlineNumber(element, "borderLeftWidth")
      : inlineNumber(element, "paddingTop") +
        inlineNumber(element, "borderTopWidth");
  const trailing =
    axis === "x"
      ? inlineNumber(element, "paddingRight") +
        inlineNumber(element, "borderRightWidth")
      : inlineNumber(element, "paddingBottom") +
        inlineNumber(element, "borderBottomWidth");
  const elementPosition = authoredElementPosition(element, cache, visiting);
  let extent = leading + trailing;
  for (const child of Array.from(element.children)) {
    if (isOutOfFlow(child)) continue;
    const childPosition = authoredElementPosition(child, cache, visiting);
    const offset =
      axis === "x"
        ? childPosition.x - elementPosition.x
        : childPosition.y - elementPosition.y;
    extent = Math.max(
      extent,
      Math.max(leading, offset) +
        authoredElementSize(child, axis, cache, visiting) +
        trailing,
    );
  }
  return Math.max(0, extent);
}

function authoredElementSize(
  element: Element,
  axis: AuthoredSizeAxis,
  cache: AuthoredSizeCache = new Map(),
  visiting: Set<Element> = new Set(),
): number {
  const cached = cache.get(element)?.[axis];
  if (cached !== undefined) return cached;
  if (visiting.has(element)) return 0;
  visiting.add(element);

  const style = (element as HTMLElement).style;
  const parent = element.parentElement;
  const reference = parent
    ? parentContentSize(parent, axis, cache, visiting)
    : 0;
  const authored = parseAuthoredLength(
    style[axis === "x" ? "width" : "height"],
    reference,
  );
  let size = authored;
  const authoredValue = style[axis === "x" ? "width" : "height"]
    .trim()
    .toLowerCase();

  if (size === null) {
    const primitiveKind = (
      element.getAttribute("data-an-primitive") || ""
    ).toLowerCase();
    if (primitiveKind === "text") {
      size =
        authoredTextIntrinsicSize(element)[axis === "x" ? "width" : "height"];
    } else if (
      authoredValue === "fit-content" ||
      authoredValue.startsWith("fit-content(")
    ) {
      size = intrinsicContentSize(element, axis, cache, visiting);
    } else if (parent) {
      const parentStyle = (parent as HTMLElement).style;
      const parentDisplay = parentStyle.display;
      const parentIsGrid =
        parentDisplay === "grid" || parentDisplay === "inline-grid";
      const mainAxis = flexMainAxis(parent);
      const isOutOfFlow =
        style.position === "absolute" || style.position === "fixed";
      if (!isOutOfFlow && (parentIsGrid || mainAxis !== null)) {
        if (mainAxis === axis && flexGrow(element) > 0) {
          size = flexAvailableSize(
            element,
            axis,
            parent,
            reference,
            cache,
            visiting,
          );
        } else if (mainAxis === axis) {
          size = flexItemBaseSize(element, axis, reference, cache, visiting);
        } else if (parentIsGrid) {
          size = authoredGridTrackSize(
            element,
            parent,
            axis,
            reference,
            cache,
            visiting,
          );
        } else if (mainAxis !== axis) {
          const alignSelf =
            style.alignSelf || parentStyle.alignItems || "stretch";
          if (alignSelf === "stretch" || parentIsGrid) size = reference;
        }
      } else if (
        axis === "x" &&
        !isOutOfFlow &&
        element.tagName.toLowerCase() === "div"
      ) {
        size = reference;
      }
    }
  }

  const resolved = Math.max(0, size ?? 0);
  visiting.delete(element);
  const current = cache.get(element) ?? {};
  current[axis] = resolved;
  cache.set(element, current);
  return resolved;
}

function hasNestedGridAncestor(element: Element) {
  let ancestor = element.parentElement;
  while (ancestor) {
    const display = (ancestor as HTMLElement).style.display;
    if (
      (display === "grid" || display === "inline-grid") &&
      ancestor !== element.parentElement
    ) {
      return true;
    }
    ancestor = ancestor.parentElement;
  }
  return false;
}

function cssPixelNumber(value: string | null | undefined) {
  const match = String(value || "")
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)px$/i);
  const parsed = match?.[1] ? Number(match[1]) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function estimatedTextLineWidth(
  text: string,
  fontSize: number,
  letterSpacing: number,
) {
  let width = 0;
  for (const character of Array.from(text)) {
    if (/\s/.test(character)) width += fontSize * 0.33;
    else if (/[MW@#%&]/.test(character)) width += fontSize * 0.82;
    else if (/[ilI1|.,'`:;]/.test(character)) width += fontSize * 0.3;
    else if (character.codePointAt(0)! > 0xff) width += fontSize;
    else width += fontSize * 0.56;
  }
  return Math.max(
    1,
    width + Math.max(0, Array.from(text).length - 1) * letterSpacing,
  );
}

export function authoredTextIntrinsicSize(element: Element) {
  const style = (element as HTMLElement).style;
  const fontSize = Math.max(1, cssPixelNumber(style.fontSize) || 16);
  const numericLineHeight = Number.parseFloat(style.lineHeight);
  const lineHeight = Math.max(
    1,
    cssPixelNumber(style.lineHeight) ||
      (Number.isFinite(numericLineHeight) && numericLineHeight > 0
        ? numericLineHeight * fontSize
        : fontSize * 1.2),
  );
  const letterSpacing = cssPixelNumber(style.letterSpacing);
  const whiteSpace = style.whiteSpace || "normal";
  const preservesLines = /^(?:pre|pre-wrap|pre-line|break-spaces)$/.test(
    whiteSpace,
  );
  const rawText = element.textContent || "";
  const lines = preservesLines
    ? rawText.split(/\r?\n/)
    : [rawText.replace(/\s+/g, " ").trim()];
  const lineWidths = lines.map((line) =>
    estimatedTextLineWidth(line, fontSize, letterSpacing),
  );
  const authoredWidth = cssPixelNumber(style.width);
  const maxWidth = cssPixelNumber(style.maxWidth);
  const wrapWidth = authoredWidth || maxWidth;
  const mayWrap =
    wrapWidth > 0 && whiteSpace !== "nowrap" && whiteSpace !== "pre";
  const visualLineCount = lineWidths.reduce(
    (count, width) =>
      count + (mayWrap ? Math.max(1, Math.ceil(width / wrapWidth)) : 1),
    0,
  );
  const naturalWidth = Math.max(1, ...lineWidths);
  return {
    width: Math.max(
      1,
      authoredWidth ||
        (maxWidth ? Math.min(naturalWidth, maxWidth) : naturalWidth),
    ),
    height: Math.max(
      1,
      cssPixelNumber(style.height) || Math.max(1, visualLineCount) * lineHeight,
    ),
  };
}

export function authoredElementPosition(
  element: Element,
  cache: AuthoredSizeCache = new Map(),
  visiting: Set<Element> = new Set(),
): Point {
  let x = 0;
  let y = 0;
  let cursor: Element | null = element;

  while (cursor && cursor.parentElement) {
    const htmlCursor = cursor as HTMLElement;
    const style = htmlCursor.style;
    const parent: Element = cursor.parentElement;
    if (style.position === "fixed") {
      x += inlineNumber(cursor, "left");
      y += inlineNumber(cursor, "top");
      break;
    }
    if (style.position === "absolute") {
      x += inlineNumber(cursor, "left");
      y += inlineNumber(cursor, "top");
    } else {
      const parentStyle = (parent as HTMLElement).style;
      x +=
        inlineNumber(parent, "paddingLeft") +
        inlineNumber(parent, "borderLeftWidth");
      y +=
        inlineNumber(parent, "paddingTop") +
        inlineNumber(parent, "borderTopWidth");
      const siblings: Element[] = Array.from(parent.children);
      const index = siblings.indexOf(cursor);
      const display = parentStyle.display;
      const isFlex = display === "flex" || display === "inline-flex";
      const isGrid = display === "grid" || display === "inline-grid";
      const isRow =
        isFlex && !(parentStyle.flexDirection || "row").startsWith("column");
      const gap = isFlex ? flexMainAxisGap(parent, isRow ? "x" : "y") : 0;
      if (isFlex) {
        if (isRow) x += inlineNumber(cursor, "marginLeft");
        else y += inlineNumber(cursor, "marginTop");
      }
      if (isGrid) {
        const columnValue = gridStartValue(style, "column");
        const rowValue = gridStartValue(style, "row");
        const autoChildren = siblings.filter(
          (sibling) => !isOutOfFlow(sibling),
        );
        const columns = gridTracks(parentStyle.gridTemplateColumns);
        const rows = gridTracks(parentStyle.gridTemplateRows);
        const baseColumnCount = Math.max(1, columns.length);
        const baseRowCount = Math.max(1, rows.length);
        const columnTracks = extendGridTracks(
          columns,
          parentStyle.gridAutoFlow.includes("column")
            ? Math.ceil(autoChildren.length / baseRowCount)
            : baseColumnCount,
        );
        const rowTracks = extendGridTracks(
          rows,
          parentStyle.gridAutoFlow.includes("column")
            ? baseRowCount
            : Math.ceil(autoChildren.length / columnTracks.length),
        );
        const columnCount = columnTracks.length;
        const rowCount = rowTracks.length;
        const occupied = new Set<string>();
        for (const sibling of autoChildren) {
          const siblingStyle = (sibling as HTMLElement).style;
          const explicitColumn = gridStartIndex(
            siblingStyle,
            "column",
            parentStyle.gridTemplateColumns,
          );
          const explicitRow = gridStartIndex(
            siblingStyle,
            "row",
            parentStyle.gridTemplateRows,
          );
          if (explicitColumn !== undefined || explicitRow !== undefined) {
            const rowStart = explicitRow ?? 1;
            const rowEnd = rowStart + gridSpan(siblingStyle, "row");
            const columnStart = explicitColumn ?? 1;
            const columnEnd = columnStart + gridSpan(siblingStyle, "column");
            for (let row = rowStart; row < rowEnd; row += 1) {
              for (let column = columnStart; column < columnEnd; column += 1) {
                occupied.add(`${row}:${column}`);
              }
            }
          }
        }
        let autoSlot = 0;
        for (const sibling of autoChildren) {
          const siblingStyle = (sibling as HTMLElement).style;
          const explicitColumn = gridStartIndex(
            siblingStyle,
            "column",
            parentStyle.gridTemplateColumns,
          );
          const explicitRow = gridStartIndex(
            siblingStyle,
            "row",
            parentStyle.gridTemplateRows,
          );
          const hasExplicit =
            explicitColumn !== undefined || explicitRow !== undefined;
          if (hasExplicit) continue;
          if (parentStyle.gridAutoFlow.includes("dense")) autoSlot = 0;
          while (true) {
            const row = parentStyle.gridAutoFlow.includes("column")
              ? (autoSlot % rowCount) + 1
              : Math.floor(autoSlot / columnCount) + 1;
            const column = parentStyle.gridAutoFlow.includes("column")
              ? Math.floor(autoSlot / rowCount) + 1
              : (autoSlot % columnCount) + 1;
            const rowSpan = gridSpan(siblingStyle, "row");
            const columnSpan = gridSpan(siblingStyle, "column");
            const rowFitsExplicitTracks =
              row > rowCount ? true : row + rowSpan - 1 <= rowCount;
            const columnFitsExplicitTracks =
              column > columnCount
                ? true
                : column + columnSpan - 1 <= columnCount;
            const fitsExplicitTracks =
              rowFitsExplicitTracks && columnFitsExplicitTracks;
            const fits =
              fitsExplicitTracks &&
              Array.from({ length: rowSpan }).every((_, rowOffset) =>
                Array.from({ length: columnSpan }).every(
                  (_, columnOffset) =>
                    !occupied.has(
                      `${row + rowOffset}:${column + columnOffset}`,
                    ),
                ),
              );
            if (fits) break;
            autoSlot += 1;
          }
          if (sibling === cursor) break;
          const row = parentStyle.gridAutoFlow.includes("column")
            ? (autoSlot % rowCount) + 1
            : Math.floor(autoSlot / columnCount) + 1;
          const column = parentStyle.gridAutoFlow.includes("column")
            ? Math.floor(autoSlot / rowCount) + 1
            : (autoSlot % columnCount) + 1;
          for (
            let rowOffset = 0;
            rowOffset < gridSpan(siblingStyle, "row");
            rowOffset += 1
          ) {
            for (
              let columnOffset = 0;
              columnOffset < gridSpan(siblingStyle, "column");
              columnOffset += 1
            ) {
              occupied.add(`${row + rowOffset}:${column + columnOffset}`);
            }
          }
          autoSlot += 1;
        }
        const autoIndex = autoSlot;
        const column = gridLine(
          parentStyle.gridTemplateColumns,
          columnValue,
          parentStyle.gridAutoFlow.includes("column")
            ? Math.floor(autoIndex / rowCount) + 1
            : (autoIndex % columnCount) + 1,
        );
        const row = gridLine(
          parentStyle.gridTemplateRows,
          rowValue,
          parentStyle.gridAutoFlow.includes("column")
            ? (autoIndex % rowCount) + 1
            : Math.floor(autoIndex / columnCount) + 1,
        );
        const gapX = cssPixelNumber(parentStyle.columnGap || parentStyle.gap);
        const gapY = cssPixelNumber(parentStyle.rowGap || parentStyle.gap);
        const columnSizes = gridTrackPixels(
          columnTracks,
          parentContentSize(parent, "x", cache, visiting),
          gapX,
        );
        const rowSizes = gridTrackPixels(
          rowTracks,
          parentContentSize(parent, "y", cache, visiting),
          gapY,
        );
        if (column > 1) {
          x += columnTracks
            .slice(0, column - 1)
            .reduce((sum, _track, index) => sum + columnSizes[index] + gapX, 0);
        }
        if (row > 1) {
          y += rowTracks
            .slice(0, row - 1)
            .reduce((sum, _track, index) => sum + rowSizes[index] + gapY, 0);
        }
      } else if (index > 0) {
        const previous = siblings.slice(0, index);
        for (const sibling of previous as Element[]) {
          if (isOutOfFlow(sibling)) continue;
          if (isRow) {
            x +=
              elementInlineSize(sibling, "x", cache, visiting) +
              inlineNumber(sibling, "marginLeft") +
              inlineNumber(sibling, "marginRight") +
              gap;
          } else {
            y +=
              elementInlineSize(sibling, "y", cache, visiting) +
              inlineNumber(sibling, "marginTop") +
              inlineNumber(sibling, "marginBottom") +
              (isFlex ? gap : 0);
          }
        }
      }
      if (style.position === "relative" || style.position === "sticky") {
        x += inlineNumber(cursor, "left");
        y += inlineNumber(cursor, "top");
      }
    }
    cursor = parent;
    if (cursor.tagName.toLowerCase() === "body") break;
  }

  return { x, y };
}

export function parsePrimitivesFromScreen(
  screen: ScreenFile,
): ParsedScreenPrimitive[] {
  const source =
    screen.codeLayerSource ??
    ({ kind: "design-file", fileId: screen.id } as const);
  const sourceKey = Object.entries(source)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("\u0000");
  const identityEntry = primitiveParseIdentityCache.get(screen.id);
  if (
    identityEntry &&
    identityEntry.content === screen.content &&
    identityEntry.sourceKey === sourceKey
  ) {
    return identityEntry.result;
  }

  const cacheKey = `${screen.id}:${sourceKey}:${screen.content.length}:${hashString(screen.content)}`;
  const cached = primitiveParseCache.get(cacheKey);
  if (cached) {
    rememberPrimitiveIdentity(screen.id, screen.content, sourceKey, cached);
    return cached;
  }

  const result: ParsedScreenPrimitive[] = [];
  if (typeof DOMParser === "undefined" || !screen.content) {
    return result;
  }

  try {
    const doc = new DOMParser().parseFromString(screen.content, "text/html");
    const sizeCache: AuthoredSizeCache = new Map();
    const projection = buildCodeLayerProjection(screen.content, { source });
    const projectionParentIdByNodeId = new Map(
      projection.nodes.map((node) => [node.id, node.parentId]),
    );
    const projectionIdentityByElement = new Map<
      Element,
      ScreenProjectionNodeIdentity
    >();
    const projectionParentIdByElement = new Map<Element, string>();
    const ambiguousIdentityElements = new Set<Element>();
    const domOrderByElement = new Map<Element, number>();
    Array.from(doc.querySelectorAll("*")).forEach((element, index) => {
      domOrderByElement.set(element, index);
    });
    for (const node of projection.nodes) {
      const matches = Array.from(doc.querySelectorAll(node.path));
      if (matches.length !== 1 || !matches[0]) continue;
      const element = matches[0];
      if (projectionIdentityByElement.has(element)) {
        projectionIdentityByElement.delete(element);
        projectionParentIdByElement.delete(element);
        ambiguousIdentityElements.add(element);
        continue;
      }
      if (ambiguousIdentityElements.has(element)) continue;
      projectionIdentityByElement.set(element, {
        projection,
        nodeId: node.id,
        authoredNodeId: node.dataAttributes["data-agent-native-node-id"] ?? "",
      });
      if (node.parentId) {
        projectionParentIdByElement.set(element, node.parentId);
      }
    }
    const nodes = doc.querySelectorAll("[data-agent-native-node-id]");
    nodes.forEach((element) => {
      const nodeId = element.getAttribute("data-agent-native-node-id");
      if (!nodeId) return;
      if (hasNestedGridAncestor(element)) return;

      const htmlElement = element as HTMLElement;
      const style = htmlElement.style;
      const tag = element.tagName.toLowerCase();
      const primitiveKind = (
        element.getAttribute("data-an-primitive") || ""
      ).toLowerCase();
      const position = authoredElementPosition(element, sizeCache);
      const width = authoredElementSize(element, "x", sizeCache);
      const height = authoredElementSize(element, "y", sizeCache);
      if (width <= 0 || height <= 0) return;

      const isContainer = isPrimitiveContainer({
        tagName: tag,
        primitiveKind,
        display: style.display,
        borderRadius: style.borderRadius,
      });
      const autoLayoutAxis = computeAutoLayoutAxis({
        display: style.display,
        flexDirection: style.flexDirection,
        flexWrap: style.flexWrap,
        gridTemplateColumns: style.gridTemplateColumns,
        gridAutoFlow: style.gridAutoFlow,
      });
      const autoLayoutWrapped =
        (style.display === "flex" || style.display === "inline-flex") &&
        (style.flexWrap === "wrap" || style.flexWrap === "wrap-reverse");
      const autoLayoutGrid =
        style.display === "grid" || style.display === "inline-grid";
      const projectionIdentity = projectionIdentityByElement.get(element);
      const projectionAncestorNodeIds: string[] = [];
      const seenProjectionIds = new Set<string>();
      let projectionAncestorId = projectionParentIdByElement.get(element);
      while (
        projectionAncestorId &&
        !seenProjectionIds.has(projectionAncestorId)
      ) {
        seenProjectionIds.add(projectionAncestorId);
        projectionAncestorNodeIds.push(projectionAncestorId);
        projectionAncestorId =
          projectionParentIdByNodeId.get(projectionAncestorId);
      }
      const parsedZIndex = Number.parseInt(style.zIndex, 10);
      const stackingContextZIndices: number[] = [];
      const stackingContextOrders: number[] = [];
      let contextElement: Element | null = element;
      while (contextElement) {
        const contextStyle = (contextElement as HTMLElement).style;
        const parentDisplay = contextElement.parentElement
          ? (contextElement.parentElement as HTMLElement).style.display
          : "";
        const contextZIndex = Number.parseInt(contextStyle.zIndex, 10);
        if (createsAuthoredStackingContext(contextStyle, parentDisplay)) {
          stackingContextZIndices.unshift(
            Number.isFinite(contextZIndex) ? contextZIndex : 0,
          );
          stackingContextOrders.unshift(
            domOrderByElement.get(contextElement) ?? 0,
          );
        }
        contextElement = contextElement.parentElement;
      }
      const zIndexApplies =
        (style.position || "static") !== "static" ||
        /^(?:flex|inline-flex|grid|inline-grid)$/.test(
          element.parentElement
            ? (element.parentElement as HTMLElement).style.display
            : "",
        );

      let parentNodeId: string | undefined;
      let ancestor: Element | null = element.parentElement;
      while (ancestor && ancestor.tagName.toLowerCase() !== "body") {
        const ancestorId = ancestor.getAttribute("data-agent-native-node-id");
        if (ancestorId) {
          parentNodeId = ancestorId;
          break;
        }
        ancestor = ancestor.parentElement;
      }

      result.push({
        nodeId,
        screenId: screen.id,
        projectionIdentity,
        parentProjectionNodeId: projectionParentIdByElement.get(element),
        parentNodeId,
        ...(projectionAncestorNodeIds.length
          ? { projectionAncestorNodeIds }
          : {}),
        localLeft: position.x,
        localTop: position.y,
        localWidth: width,
        localHeight: height,
        isContainer,
        autoLayoutAxis,
        ...(autoLayoutWrapped ? { autoLayoutWrapped: true } : {}),
        ...(autoLayoutGrid ? { autoLayoutGrid: true } : {}),
        ...(Number.isFinite(parsedZIndex) && zIndexApplies
          ? { zIndex: parsedZIndex }
          : {}),
        ...(stackingContextZIndices.length ? { stackingContextZIndices } : {}),
        ...(stackingContextOrders.length ? { stackingContextOrders } : {}),
      });
    });
  } catch {
    // Malformed imported HTML simply has no discoverable canvas primitives.
  }

  if (primitiveParseCache.size >= PRIMITIVE_PARSE_CACHE_MAX) {
    const firstKey = primitiveParseCache.keys().next().value;
    if (firstKey !== undefined) primitiveParseCache.delete(firstKey);
  }
  primitiveParseCache.set(cacheKey, result);
  rememberPrimitiveIdentity(screen.id, screen.content, sourceKey, result);
  return result;
}

export function primitiveLocalToBoardRect(
  localLeft: number,
  localTop: number,
  localWidth: number,
  localHeight: number,
  frameGeometry: FrameGeometry,
  metadata: { width: number; height: number },
): FrameGeometry {
  return screenLocalRectToBoardGeometry(
    {
      left: localLeft,
      top: localTop,
      width: localWidth,
      height: localHeight,
    },
    frameGeometry,
    metadata,
  );
}

export function getPrimitiveDropTargetForPoint(
  point: Point,
  draggedNodeId: string | null,
  screens: ScreenFile[],
  frameGeometryById: FrameGeometryById,
  getMetadata: (screen: ScreenFile) => { width: number; height: number },
  options: {
    identityCoordinateScreenIds?: ReadonlySet<string>;
    backgroundScreenIds?: ReadonlySet<string>;
    foregroundScreenId?: string;
  } = {},
): PrimitiveDropTarget | null {
  const toBoardRect = (
    primitive: ParsedScreenPrimitive,
    frameGeometry: FrameGeometry,
    metadata: { width: number; height: number },
  ): FrameGeometry => {
    if (options.identityCoordinateScreenIds?.has(primitive.screenId)) {
      return {
        x: primitive.localLeft,
        y: primitive.localTop,
        width: Math.max(1, primitive.localWidth),
        height: Math.max(1, primitive.localHeight),
      };
    }
    return primitiveLocalToBoardRect(
      primitive.localLeft,
      primitive.localTop,
      primitive.localWidth,
      primitive.localHeight,
      frameGeometry,
      metadata,
    );
  };

  let draggedBoardRect: FrameGeometry | null = null;
  let draggedScreenId: string | null = null;
  if (draggedNodeId) {
    outer: for (const screen of screens) {
      const frameGeometry = frameGeometryById[screen.id];
      if (!frameGeometry) continue;
      const metadata = getMetadata(screen);
      const primitives = parsePrimitivesFromScreen(screen);
      for (const primitive of primitives) {
        if (primitiveMatchesNodeId(primitive, draggedNodeId)) {
          draggedBoardRect = toBoardRect(primitive, frameGeometry, metadata);
          draggedScreenId = screen.id;
          break outer;
        }
      }
    }
  }

  const topScreen = screens
    .map((screen, index) => ({
      screen,
      index,
      geometry: frameGeometryById[screen.id],
    }))
    .filter(
      (
        entry,
      ): entry is {
        screen: ScreenFile;
        index: number;
        geometry: FrameGeometry;
      } => !!entry.geometry && geometryContainsPoint(entry.geometry, point),
    )
    .sort((a, b) => {
      const foregroundDelta =
        Number(b.screen.id === options.foregroundScreenId) -
        Number(a.screen.id === options.foregroundScreenId);
      if (foregroundDelta) return foregroundDelta;
      const backgroundDelta =
        Number(options.backgroundScreenIds?.has(a.screen.id)) -
        Number(options.backgroundScreenIds?.has(b.screen.id));
      if (backgroundDelta) return backgroundDelta;
      return (b.geometry.z ?? 0) - (a.geometry.z ?? 0) || b.index - a.index;
    })[0];

  if (!topScreen) return null;

  const metadata = getMetadata(topScreen.screen);
  const primitives = parsePrimitivesFromScreen(topScreen.screen);
  let best: PrimitiveDropTarget | null = null;
  let bestPrimitive: ParsedScreenPrimitive | null = null;
  for (const primitive of primitives) {
    if (!primitive.isContainer) continue;
    if (draggedNodeId && primitiveMatchesNodeId(primitive, draggedNodeId)) {
      continue;
    }
    const boardRect = toBoardRect(primitive, topScreen.geometry, metadata);
    if (
      draggedBoardRect &&
      (draggedBoardRect.width > boardRect.width + 1 ||
        draggedBoardRect.height > boardRect.height + 1)
    ) {
      continue;
    }
    if (
      draggedBoardRect &&
      draggedScreenId === topScreen.screen.id &&
      geometryContainsGeometry(draggedBoardRect, boardRect)
    ) {
      continue;
    }
    if (geometryContainsPoint(boardRect, point)) {
      if (
        bestPrimitive &&
        !isPrimitiveAncestor(bestPrimitive, primitive, primitives) &&
        !isPrimitiveAncestor(primitive, bestPrimitive, primitives)
      ) {
        if (compareStackingContexts(primitive, bestPrimitive) < 0) continue;
        best = {
          nodeId: primitive.nodeId,
          screenId: topScreen.screen.id,
          boardRect,
          targetIdentity: primitive.projectionIdentity,
        };
        bestPrimitive = primitive;
        continue;
      }
      if (
        bestPrimitive &&
        !isPrimitiveAncestor(bestPrimitive, primitive, primitives)
      ) {
        continue;
      }
      best = {
        nodeId: primitive.nodeId,
        screenId: topScreen.screen.id,
        boardRect,
        targetIdentity: primitive.projectionIdentity,
      };
      bestPrimitive = primitive;
    }
  }

  if (best) {
    const hitTargetIdentity = best.targetIdentity;
    const containerPrimitive = hitTargetIdentity
      ? primitives.find(
          (primitive) =>
            primitive.projectionIdentity?.nodeId === hitTargetIdentity.nodeId,
        )
      : primitives.find((primitive) => primitive.nodeId === best!.nodeId);
    if (containerPrimitive?.autoLayoutAxis) {
      const localPoint = options.identityCoordinateScreenIds?.has(
        topScreen.screen.id,
      )
        ? point
        : boardPointToScreenLocalPoint(point, topScreen.geometry, metadata);
      const anchor = findAutoLayoutInsertionAnchor(
        containerPrimitive,
        primitives,
        localPoint,
        draggedNodeId,
      );
      if (anchor) {
        const anchorPrimitive = anchor.anchorProjectionNodeId
          ? primitives.find(
              (primitive) =>
                primitive.projectionIdentity?.nodeId ===
                anchor.anchorProjectionNodeId,
            )
          : primitives.find(
              (primitive) => primitive.nodeId === anchor.anchorNodeId,
            );
        if (anchorPrimitive) {
          best = {
            nodeId: containerPrimitive.nodeId,
            screenId: topScreen.screen.id,
            targetIdentity: anchorPrimitive.projectionIdentity,
            boardRect: toBoardRect(
              anchorPrimitive,
              topScreen.geometry,
              metadata,
            ),
            anchorNodeId: anchor.anchorNodeId,
            placement: anchor.placement,
            axis: containerPrimitive.autoLayoutAxis,
          };
        }
      }
    }
  }

  if (best) return best;

  const source =
    topScreen.screen.codeLayerSource ??
    ({ kind: "design-file" as const, fileId: topScreen.screen.id } as const);
  const projection = buildCodeLayerProjection(topScreen.screen.content, {
    source,
  });
  const body = projection.nodes.find((node) => node.tag === "body");
  const bodyNodeId = body?.dataAttributes["data-agent-native-node-id"];
  if (body && bodyNodeId) {
    return {
      nodeId: bodyNodeId,
      screenId: topScreen.screen.id,
      boardRect: topScreen.geometry,
      targetIdentity: {
        projection,
        nodeId: body.id,
        authoredNodeId: bodyNodeId,
      },
    };
  }

  return best;
}

export function resolveNodeScreenId(
  nodeId: string,
  screens: ScreenFile[],
): string | null {
  for (const screen of screens) {
    const primitives = parsePrimitivesFromScreen(screen);
    if (
      primitives.some((primitive) => primitiveMatchesNodeId(primitive, nodeId))
    ) {
      return screen.id;
    }
  }
  return null;
}
