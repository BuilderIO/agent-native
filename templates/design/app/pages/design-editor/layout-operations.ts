import {
  formatSvgShapeTranslate,
  parseSvgShapeTranslate,
  type SvgShapeOffset,
} from "@shared/svg-shape-offset";

import type {
  DesignHotkeyAlignEdge,
  DesignHotkeyDistributeAxis,
} from "@/hooks/useDesignHotkeys";

import { editableSvgShapeParent } from "./position-coordinate-context";

/** An omitted axis keeps its authored offset, which may not be in px. */
export type NodePositionPatch = { x?: number; y?: number };

export interface AlignableRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeAlignedPositions(
  rects: readonly AlignableRect[],
  bounds: { x: number; y: number; width: number; height: number },
  edge: DesignHotkeyAlignEdge,
): Map<string, NodePositionPatch> {
  const next = new Map<string, NodePositionPatch>();
  for (const rect of rects) {
    let x = rect.x;
    let y = rect.y;
    switch (edge) {
      case "left":
        x = bounds.x;
        break;
      case "right":
        x = bounds.x + bounds.width - rect.width;
        break;
      case "center-h":
        x = bounds.x + (bounds.width - rect.width) / 2;
        break;
      case "top":
        y = bounds.y;
        break;
      case "bottom":
        y = bounds.y + bounds.height - rect.height;
        break;
      case "center-v":
        y = bounds.y + (bounds.height - rect.height) / 2;
        break;
    }
    x = Math.round(x);
    y = Math.round(y);
    if (x !== Math.round(rect.x)) next.set(rect.id, { x });
    if (y !== Math.round(rect.y)) next.set(rect.id, { y });
  }
  return next;
}

export function computeDistributedPositions(
  rects: readonly AlignableRect[],
  axis: DesignHotkeyDistributeAxis,
): Map<string, NodePositionPatch> {
  const next = new Map<string, NodePositionPatch>();
  if (rects.length < 3) return next;
  const sorted = [...rects].sort((a, b) =>
    axis === "horizontal" ? a.x - b.x : a.y - b.y,
  );
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const size = (rect: AlignableRect) =>
    axis === "horizontal" ? rect.width : rect.height;
  const start = (rect: AlignableRect) =>
    axis === "horizontal" ? rect.x : rect.y;
  const totalSpan = start(last) + size(last) - start(first);
  const totalContentSize = sorted.reduce((sum, rect) => sum + size(rect), 0);
  const gapCount = sorted.length - 1;
  const gap = (totalSpan - totalContentSize) / gapCount;
  let cursor = start(first) + size(first) + gap;
  for (let index = 1; index < sorted.length - 1; index += 1) {
    const rect = sorted[index]!;
    const position = Math.round(cursor);
    if (position !== Math.round(start(rect))) {
      next.set(
        rect.id,
        axis === "horizontal" ? { x: position } : { y: position },
      );
    }
    cursor += size(rect) + gap;
  }
  return next;
}

export interface ReflowCandidate {
  id: string;
  geometry: { x: number; y: number; width: number; height: number };
  footprint: AlignableRect;
}

function footprintsOverlap(rects: readonly AlignableRect[]): boolean {
  return rects.some((a, i) =>
    rects.some(
      (b, j) =>
        i !== j &&
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height,
    ),
  );
}

export function computeOverlapReflowGeometry(
  candidates: readonly ReflowCandidate[],
): Map<string, { x: number; y: number; width: number; height: number }> {
  const result = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  if (candidates.length < 2) return result;
  const footprints = candidates.map((candidate) => candidate.footprint);
  if (!footprintsOverlap(footprints)) return result;
  const positions = computeTidyPositions(footprints);
  if (positions.size === 0) return result;
  for (const candidate of candidates) {
    const position = positions.get(candidate.id);
    if (!position) continue;
    result.set(candidate.id, {
      ...candidate.geometry,
      x: candidate.geometry.x + (position.x - candidate.footprint.x),
      y: candidate.geometry.y + (position.y - candidate.footprint.y),
    });
  }
  return result;
}

export function computeTidyPositions(
  rects: readonly AlignableRect[],
): Map<string, { x: number; y: number }> {
  const next = new Map<string, { x: number; y: number }>();
  if (rects.length === 0) return next;
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const columns = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
  const median = (values: number[]): number => {
    const sortedValues = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sortedValues.length / 2);
    return sortedValues.length % 2 === 0
      ? (sortedValues[mid - 1]! + sortedValues[mid]!) / 2
      : sortedValues[mid]!;
  };
  const cellWidth = median(sorted.map((rect) => rect.width));
  const cellHeight = median(sorted.map((rect) => rect.height));
  let gap = 24;
  const gapsFound: number[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = 0; j < sorted.length; j += 1) {
      if (i === j) continue;
      const a = sorted[i]!;
      const b = sorted[j]!;
      const verticallyOverlaps = a.y < b.y + b.height && b.y < a.y + a.height;
      if (!verticallyOverlaps) continue;
      const candidateGap = b.x - (a.x + a.width);
      if (candidateGap > 0) gapsFound.push(candidateGap);
    }
  }
  if (gapsFound.length > 0) gap = Math.max(...gapsFound);
  const originX = Math.min(...sorted.map((rect) => rect.x));
  const originY = Math.min(...sorted.map((rect) => rect.y));
  sorted.forEach((rect, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = Math.round(originX + col * (cellWidth + gap));
    const y = Math.round(originY + row * (cellHeight + gap));
    if (x !== Math.round(rect.x) || y !== Math.round(rect.y)) {
      next.set(rect.id, { x, y });
    }
  });
  return next;
}

/** A 2×2 linear map: how a CSS-pixel offset vector appears in the shared space. */
export interface Linear2D {
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface SharedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Whether an inset or size property is authored, read from its computed (not used) value. */
export type SpecifiedState = "auto" | "set" | "unknown";

export interface OffsetAxis {
  start: SpecifiedState;
  end: SpecifiedState;
  size: SpecifiedState;
  sizePx: number;
}

export interface AutoLayoutParent {
  display: "flex" | "grid";
  flexDirection: string;
  flexWrap: string;
  direction: string;
  justifyContent: string;
  alignItems: string;
  justifyItems: string;
}

export type AlignNodeLayout =
  | {
      kind: "offset";
      position: "absolute" | "fixed" | "relative" | "static";
      /** Resolved offsets in the node's own offset space; 0 for static. */
      left: number;
      top: number;
      x: OffsetAxis;
      y: OffsetAxis;
    }
  | {
      kind: "auto-layout-child";
      parent: AutoLayoutParent;
      /** Stretched across the parent's cross axis, so cross alignment is a no-op. */
      fillsCrossAxis: boolean;
    }
  /** A shape inside an editable SVG, moved by its CSS `translate`. */
  | { kind: "svg-shape"; offset: SvgShapeOffset }
  | { kind: "unsupported" };

/**
 * One selected layer measured in the screen document's coordinates, which every
 * node of a selection shares whatever its parent, depth, or containing block.
 */
export interface MeasuredAlignNode {
  id: string;
  /** Painted bounding box, transforms included: what the user sees. */
  rect: SharedRect;
  /** The parent's padding box, the screen for a top-level layer, null when there is nothing to align against. */
  parentBox: SharedRect | null;
  /** `data-agent-native-node-id` of the rendered parent; null for a top-level layer. */
  parentStableId: string | null;
  offsetToShared: Linear2D;
  layout: AlignNodeLayout;
  /** The nearest other selected layer that contains this one. */
  selectedAncestorId: string | null;
  /** Static → relative would re-anchor absolutely positioned descendants. */
  movesNestedLayers: boolean;
}

export type AlignMeasurement =
  | { status: "measured"; nodes: MeasuredAlignNode[] }
  | { status: "unmeasurable"; nodeId: string; reason: string };

export type StylePatch = Array<readonly [property: string, value: string]>;

export type SharedDelta = { dx: number; dy: number };

const IDENTITY_LINEAR: Linear2D = { a: 1, b: 0, c: 0, d: 1 };
const SVG_NS = "http://www.w3.org/2000/svg";
const AXIS_PROPERTIES = {
  x: { start: "left", end: "right", size: "width" },
  y: { start: "top", end: "bottom", size: "height" },
} as const;

function multiplyLinear(left: Linear2D, right: Linear2D): Linear2D {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
  };
}

export function invertLinear(
  matrix: Linear2D,
  vector: SharedDelta,
): SharedDelta | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) {
    return null;
  }
  const dx = (matrix.d * vector.dx - matrix.c * vector.dy) / determinant;
  const dy = (-matrix.b * vector.dx + matrix.a * vector.dy) / determinant;
  return Number.isFinite(dx) && Number.isFinite(dy) ? { dx, dy } : null;
}

/** Shared-space motion that puts `rect` on `bounds`' named edge or center. */
export function alignSharedDelta(
  rect: SharedRect,
  bounds: SharedRect,
  edge: DesignHotkeyAlignEdge,
): SharedDelta {
  switch (edge) {
    case "left":
      return { dx: bounds.x - rect.x, dy: 0 };
    case "right":
      return { dx: bounds.x + bounds.width - rect.width - rect.x, dy: 0 };
    case "center-h":
      return { dx: bounds.x + (bounds.width - rect.width) / 2 - rect.x, dy: 0 };
    case "top":
      return { dx: 0, dy: bounds.y - rect.y };
    case "bottom":
      return { dx: 0, dy: bounds.y + bounds.height - rect.height - rect.y };
    case "center-v":
      return {
        dx: 0,
        dy: bounds.y + (bounds.height - rect.height) / 2 - rect.y,
      };
  }
}

export function unionSharedRects(rects: readonly SharedRect[]): SharedRect {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Moves one node by a local offset delta without changing its size, its parent,
 * or its siblings. A static node becomes `position: relative`, which offsets it
 * visually and leaves its slot in the flow where it was; offsets it carried
 * while static were inert, so they are neutralized rather than activated.
 */
export function offsetStylePatch(
  layout: Extract<AlignNodeLayout, { kind: "offset" }>,
  delta: SharedDelta,
): StylePatch {
  const patch: StylePatch = [];
  const moveX = Math.abs(delta.dx) >= 0.5;
  const moveY = Math.abs(delta.dy) >= 0.5;
  if (!moveX && !moveY) return patch;
  const fromStatic = layout.position === "static";
  const outOfFlow =
    layout.position === "absolute" || layout.position === "fixed";
  if (fromStatic) patch.push(["position", "relative"]);
  const writeAxis = (
    names: (typeof AXIS_PROPERTIES)[keyof typeof AXIS_PROPERTIES],
    axis: OffsetAxis,
    base: number,
    distance: number,
    moving: boolean,
  ) => {
    if (moving) {
      patch.push([names.start, `${Math.round(base + distance)}px`]);
      if (axis.end !== "auto") {
        patch.push([names.end, "auto"]);
        // An end inset can be what sizes an out-of-flow box; keep its size.
        if (outOfFlow && axis.size !== "set") {
          patch.push([names.size, `${axis.sizePx}px`]);
        }
      }
      return;
    }
    if (!fromStatic) return;
    if (axis.start !== "auto") patch.push([names.start, "0px"]);
    if (axis.end !== "auto") patch.push([names.end, "auto"]);
  };
  writeAxis(
    AXIS_PROPERTIES.x,
    layout.x,
    fromStatic ? 0 : layout.left,
    delta.dx,
    moveX,
  );
  writeAxis(
    AXIS_PROPERTIES.y,
    layout.y,
    fromStatic ? 0 : layout.top,
    delta.dy,
    moveY,
  );
  return patch;
}

export type SharedMovePlan =
  | { status: "planned"; patches: Map<string, StylePatch> }
  | {
      status: "blocked";
      blocker:
        | "auto-layout-children"
        | "unsupported-position"
        | "moves-nested-layers";
      nodeId: string;
    };

/**
 * Turns the shared-space motion each node should make into style patches in
 * that node's own offset space. A node inside another selected node already
 * rides along with it, so only the difference is its own to make.
 */
export function planSharedMoves(
  nodes: readonly MeasuredAlignNode[],
  deltas: ReadonlyMap<string, SharedDelta>,
): SharedMovePlan {
  const patches = new Map<string, StylePatch>();
  for (const node of nodes) {
    const total = deltas.get(node.id) ?? { dx: 0, dy: 0 };
    const inherited = node.selectedAncestorId
      ? (deltas.get(node.selectedAncestorId) ?? { dx: 0, dy: 0 })
      : { dx: 0, dy: 0 };
    const own = { dx: total.dx - inherited.dx, dy: total.dy - inherited.dy };
    if (Math.abs(own.dx) < 0.5 && Math.abs(own.dy) < 0.5) continue;
    if (node.layout.kind === "auto-layout-child") {
      return {
        status: "blocked",
        blocker: "auto-layout-children",
        nodeId: node.id,
      };
    }
    if (node.layout.kind === "unsupported") {
      return {
        status: "blocked",
        blocker: "unsupported-position",
        nodeId: node.id,
      };
    }
    if (
      node.layout.kind === "offset" &&
      node.layout.position === "static" &&
      node.movesNestedLayers
    ) {
      return {
        status: "blocked",
        blocker: "moves-nested-layers",
        nodeId: node.id,
      };
    }
    const local = invertLinear(node.offsetToShared, own);
    if (!local) {
      return {
        status: "blocked",
        blocker: "unsupported-position",
        nodeId: node.id,
      };
    }
    if (node.layout.kind === "svg-shape") {
      const { offset } = node.layout;
      patches.set(node.id, [
        [
          "translate",
          formatSvgShapeTranslate({
            x: offset.x + local.dx,
            y: offset.y + local.dy,
          }),
        ],
      ]);
      continue;
    }
    const patch = offsetStylePatch(node.layout, local);
    if (patch.length > 0) patches.set(node.id, patch);
  }
  return { status: "planned", patches };
}

// `normal` packs justify-content at the start but stretches align-items and
// justify-items, so it only equals flex-start for justify-content.
function normalizeFlexAlignment(property: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed === "normal") {
    return property === "justify-content" ? "flex-start" : "stretch";
  }
  if (trimmed === "start" || trimmed === "left") return "flex-start";
  if (trimmed === "end" || trimmed === "right") return "flex-end";
  return trimmed;
}

/**
 * A lone auto layout child aligns by changing its frame's alignment:
 * the main axis is `justify-content`, the cross axis `align-items`. Reversed
 * directions, `wrap-reverse`, and right-to-left text flip which value lands on
 * the requested visual edge.
 */
export function autoLayoutAlignmentPatch(
  parent: AutoLayoutParent,
  edge: DesignHotkeyAlignEdge,
  fillsCrossAxis: boolean,
): StylePatch {
  const horizontal = edge === "left" || edge === "center-h" || edge === "right";
  const placement =
    edge === "center-h" || edge === "center-v"
      ? "center"
      : edge === "left" || edge === "top"
        ? "start"
        : "end";
  const rtl = parent.direction === "rtl";
  let property: string;
  let flipped: boolean;
  let current: string;
  if (parent.display === "grid") {
    property = horizontal ? "justify-items" : "align-items";
    flipped = horizontal && rtl;
    current = horizontal ? parent.justifyItems : parent.alignItems;
  } else {
    const row = !parent.flexDirection.startsWith("column");
    const isMainAxis = horizontal === row;
    if (!isMainAxis && fillsCrossAxis) return [];
    property = isMainAxis ? "justify-content" : "align-items";
    const reversed = isMainAxis
      ? parent.flexDirection.endsWith("-reverse")
      : parent.flexWrap === "wrap-reverse";
    flipped = reversed !== (horizontal && rtl);
    current = isMainAxis ? parent.justifyContent : parent.alignItems;
  }
  const value =
    placement === "center"
      ? "center"
      : (placement === "start") !== flipped
        ? "flex-start"
        : "flex-end";
  return normalizeFlexAlignment(property, current) === value
    ? []
    : [[property, value]];
}

function cssPixels(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "0") return 0;
  const match = /^(-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?)px$/i.exec(trimmed);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]!);
  return Number.isFinite(parsed) ? parsed : null;
}

function cssPixelsOrZero(value: string | undefined): number {
  return cssPixels(value) ?? 0;
}

function parseLinearTransform(value: string, view: Window): Linear2D | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "none") return IDENTITY_LINEAR;
  const matrix = /^matrix\(([^)]*)\)$/.exec(trimmed);
  if (matrix) {
    const parts = matrix[1]!.split(",").map((part) => Number(part.trim()));
    if (parts.length !== 6 || !parts.every(Number.isFinite)) return null;
    return { a: parts[0]!, b: parts[1]!, c: parts[2]!, d: parts[3]! };
  }
  const Matrix = (
    view as Window & { DOMMatrixReadOnly?: typeof DOMMatrixReadOnly }
  ).DOMMatrixReadOnly;
  if (typeof Matrix !== "function") return null;
  try {
    const parsed = new Matrix(trimmed);
    return parsed.is2D
      ? { a: parsed.a, b: parsed.b, c: parsed.c, d: parsed.d }
      : null;
  } catch {
    // coercion-ok: an unparsable transform is reported as unmeasurable by the caller, never as identity.
    return null;
  }
}

function elementLinear(
  styles: CSSStyleDeclaration,
  view: Window,
): Linear2D | null {
  let result = parseLinearTransform(styles.transform ?? "", view);
  if (!result) return null;
  const scale = styles.getPropertyValue("scale").trim();
  if (scale && scale !== "none") {
    const [sx = "1", sy = sx, sz = "1"] = scale.split(/\s+/);
    const x = Number.parseFloat(sx);
    const y = Number.parseFloat(sy);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Number(sz) !== 1) {
      return null;
    }
    result = multiplyLinear({ a: x, b: 0, c: 0, d: y }, result);
  }
  const rotate = styles.getPropertyValue("rotate").trim();
  if (rotate && rotate !== "none") {
    const parts = rotate.split(/\s+/);
    if (parts.length > 2 || (parts.length === 2 && parts[0] !== "z")) {
      return null;
    }
    const angle = /^(-?(?:\d+\.?\d*|\.\d+))(deg|rad|turn|grad)$/.exec(
      parts[parts.length - 1]!,
    );
    if (!angle) return null;
    const amount = Number.parseFloat(angle[1]!);
    const radians =
      angle[2] === "rad"
        ? amount
        : angle[2] === "turn"
          ? amount * 2 * Math.PI
          : angle[2] === "grad"
            ? (amount * Math.PI) / 200
            : (amount * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    result = multiplyLinear({ a: cos, b: sin, c: -sin, d: cos }, result);
  }
  const zoom = Number.parseFloat(styles.getPropertyValue("zoom"));
  if (Number.isFinite(zoom) && zoom > 0 && zoom !== 1) {
    result = multiplyLinear({ a: zoom, b: 0, c: 0, d: zoom }, result);
  }
  return result;
}

/** How content laid out inside `element` maps onto the document, its own transform included. */
function cumulativeLinear(
  element: Element | null,
  view: Window,
): Linear2D | null {
  let total = IDENTITY_LINEAR;
  for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
    const linear = elementLinear(view.getComputedStyle(ancestor), view);
    if (!linear) return null;
    total = multiplyLinear(linear, total);
  }
  return total;
}

/** Preview elements belong to the iframe's realm, so the host's HTMLElement never matches them. */
function isHtmlElement(element: Element, view: Window): element is HTMLElement {
  const Html = (view as Window & typeof globalThis).HTMLElement;
  return typeof Html === "function" && element instanceof Html;
}

function sharedRectOf(element: Element, view: Window): SharedRect | null {
  if (element.getClientRects().length === 0) return null;
  const rect = element.getBoundingClientRect();
  const shared = {
    x: rect.left + view.scrollX,
    y: rect.top + view.scrollY,
    width: rect.width,
    height: rect.height,
  };
  return [shared.x, shared.y, shared.width, shared.height].every(
    Number.isFinite,
  )
    ? shared
    : null;
}

function linearBounds(
  linear: Linear2D,
  box: { left: number; top: number; right: number; bottom: number },
) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [
    [box.left, box.top],
    [box.right, box.top],
    [box.left, box.bottom],
    [box.right, box.bottom],
  ] as const) {
    xs.push(linear.a * x + linear.c * y);
    ys.push(linear.b * x + linear.d * y);
  }
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/** The padding box absolutely positioned children resolve against, scrollbars excluded. */
function paddingBoxOf(
  parent: Element,
  styles: CSSStyleDeclaration,
  view: Window,
  linear: Linear2D,
): SharedRect | null {
  const borderRect = sharedRectOf(parent, view);
  if (!borderRect) return null;
  if (!isHtmlElement(parent, view) || styles.display === "inline") {
    return borderRect;
  }
  const borderLeft = cssPixelsOrZero(styles.borderLeftWidth);
  const borderRight = cssPixelsOrZero(styles.borderRightWidth);
  const borderTop = cssPixelsOrZero(styles.borderTopWidth);
  const borderBottom = cssPixelsOrZero(styles.borderBottomWidth);
  const width = cssPixels(styles.width);
  const height = cssPixels(styles.height);
  const contentBox = styles.boxSizing !== "border-box";
  const horizontalExtras = contentBox
    ? cssPixelsOrZero(styles.paddingLeft) +
      cssPixelsOrZero(styles.paddingRight) +
      borderLeft +
      borderRight
    : 0;
  const verticalExtras = contentBox
    ? cssPixelsOrZero(styles.paddingTop) +
      cssPixelsOrZero(styles.paddingBottom) +
      borderTop +
      borderBottom
    : 0;
  const borderWidth =
    width === null ? parent.offsetWidth : width + horizontalExtras;
  const borderHeight =
    height === null ? parent.offsetHeight : height + verticalExtras;
  const scrollbar = (outer: number, inner: number, borders: number) => {
    const gutter = outer - inner - borders;
    return inner > 0 && gutter >= 1 ? gutter : 0;
  };
  const verticalScrollbar = scrollbar(
    parent.offsetWidth,
    parent.clientWidth,
    borderLeft + borderRight,
  );
  const horizontalScrollbar = scrollbar(
    parent.offsetHeight,
    parent.clientHeight,
    borderTop + borderBottom,
  );
  const border = linearBounds(linear, {
    left: 0,
    top: 0,
    right: borderWidth,
    bottom: borderHeight,
  });
  const padding = linearBounds(linear, {
    left: borderLeft,
    top: borderTop,
    right: borderWidth - borderRight - verticalScrollbar,
    bottom: borderHeight - borderBottom - horizontalScrollbar,
  });
  return {
    x: borderRect.x + (padding.minX - border.minX),
    y: borderRect.y + (padding.minY - border.minY),
    width: padding.maxX - padding.minX,
    height: padding.maxY - padding.minY,
  };
}

/**
 * Typed OM reports computed values, where `auto` survives; getComputedStyle
 * reports used values for positioned boxes and cannot tell `left: auto` from
 * `left: 0`. Without Typed OM the answer is "unknown", which callers treat as
 * set so they always neutralize the property instead of trusting it is unset.
 */
function specifiedState(element: Element, property: string): SpecifiedState {
  const typed = element as Element & {
    computedStyleMap?: () => { get(property: string): unknown };
  };
  if (typeof typed.computedStyleMap !== "function") return "unknown";
  try {
    const value = typed.computedStyleMap().get(property);
    if (value === undefined || value === null) return "unknown";
    return String(value).trim() === "auto" ? "auto" : "set";
  } catch {
    // coercion-ok: "unknown" is a distinct state that callers handle conservatively.
    return "unknown";
  }
}

function establishesAbsoluteContainingBlock(
  styles: CSSStyleDeclaration,
): boolean {
  const individual = ["translate", "rotate", "scale", "backdrop-filter"].some(
    (property) => {
      const value = styles.getPropertyValue(property).trim();
      return value !== "" && value !== "none";
    },
  );
  return (
    individual ||
    styles.position !== "static" ||
    (styles.transform !== "" && styles.transform !== "none") ||
    (styles.filter !== "" && styles.filter !== "none") ||
    (styles.perspective !== "" && styles.perspective !== "none") ||
    /(?:^|\s)(?:layout|paint|strict|content)(?:\s|$)/.test(
      styles.contain ?? "",
    ) ||
    /transform|perspective|filter|contain/.test(styles.willChange ?? "")
  );
}

/** An absolutely positioned descendant whose containing block is above `element`. */
function hasAbsoluteDescendantAnchoredAbove(
  element: Element,
  view: Window,
): boolean {
  for (const descendant of Array.from(element.querySelectorAll("*"))) {
    if (view.getComputedStyle(descendant).position !== "absolute") continue;
    let anchoredInside = false;
    for (
      let ancestor = descendant.parentElement;
      ancestor && ancestor !== element;
      ancestor = ancestor.parentElement
    ) {
      if (establishesAbsoluteContainingBlock(view.getComputedStyle(ancestor))) {
        anchoredInside = true;
        break;
      }
    }
    if (!anchoredInside) return true;
  }
  return false;
}

function offsetAxis(
  element: Element,
  names: (typeof AXIS_PROPERTIES)[keyof typeof AXIS_PROPERTIES],
  sizePx: number,
): OffsetAxis {
  return {
    start: specifiedState(element, names.start),
    end: specifiedState(element, names.end),
    size: specifiedState(element, names.size),
    sizePx,
  };
}

function autoLayoutParentOf(
  styles: CSSStyleDeclaration,
): AutoLayoutParent | null {
  const display = styles.display ?? "";
  const kind = /\bflex\b|inline-flex/.test(display)
    ? "flex"
    : /\bgrid\b|inline-grid/.test(display)
      ? "grid"
      : null;
  if (!kind) return null;
  return {
    display: kind,
    flexDirection: styles.flexDirection || "row",
    flexWrap: styles.flexWrap || "nowrap",
    direction: styles.direction || "ltr",
    justifyContent: styles.justifyContent || "normal",
    alignItems: styles.alignItems || "normal",
    justifyItems: styles.justifyItems || "normal",
  };
}

function fillsFlexCrossAxis(
  element: Element,
  styles: CSSStyleDeclaration,
  parent: Element,
  parentStyles: CSSStyleDeclaration,
  parentLayout: AutoLayoutParent,
  view: Window,
): boolean {
  if (parentLayout.display !== "flex") return false;
  if (!isHtmlElement(element, view) || !isHtmlElement(parent, view)) {
    return false;
  }
  const row = !parentLayout.flexDirection.startsWith("column");
  const parentInner = row
    ? parent.clientHeight -
      cssPixelsOrZero(parentStyles.paddingTop) -
      cssPixelsOrZero(parentStyles.paddingBottom)
    : parent.clientWidth -
      cssPixelsOrZero(parentStyles.paddingLeft) -
      cssPixelsOrZero(parentStyles.paddingRight);
  const childOuter = row
    ? element.offsetHeight +
      cssPixelsOrZero(styles.marginTop) +
      cssPixelsOrZero(styles.marginBottom)
    : element.offsetWidth +
      cssPixelsOrZero(styles.marginLeft) +
      cssPixelsOrZero(styles.marginRight);
  return parentInner > 0 && childOuter >= parentInner - 0.5;
}

function measureAlignNode(
  view: Window,
  target: { id: string; element: Element },
  options: { screenIsAlignable: boolean; checkNestedLayers: boolean },
): Omit<MeasuredAlignNode, "selectedAncestorId"> | { reason: string } {
  const { element } = target;
  const doc = element.ownerDocument;
  const rect = sharedRectOf(element, view);
  if (!rect) return { reason: "not-rendered" };
  const svgShape = measureSvgShapeAlignNode(target, rect, view);
  if (svgShape) return svgShape;
  const styles = view.getComputedStyle(element);
  const parent = element.parentElement;
  const topLevel =
    !parent || parent === doc.body || parent === doc.documentElement;
  const offsetToShared = cumulativeLinear(parent, view);
  if (!offsetToShared) return { reason: "transform-unsupported" };
  if (!invertLinear(offsetToShared, { dx: 1, dy: 1 })) {
    return { reason: "transform-singular" };
  }
  const parentStyles = parent ? view.getComputedStyle(parent) : null;
  const fixed = styles.position === "fixed";
  let parentBox: SharedRect | null = null;
  if (topLevel) {
    if (options.screenIsAlignable) {
      const root = doc.documentElement;
      parentBox = {
        x: fixed ? view.scrollX : 0,
        y: fixed ? view.scrollY : 0,
        width: root.clientWidth,
        height: root.clientHeight,
      };
    }
  } else {
    parentBox = paddingBoxOf(parent!, parentStyles!, view, offsetToShared);
    if (!parentBox) return { reason: "parent-not-rendered" };
  }
  const parentStableId = topLevel
    ? null
    : parent!.getAttribute("data-agent-native-node-id");
  const base = {
    id: target.id,
    rect,
    parentBox,
    parentStableId,
    offsetToShared,
    movesNestedLayers: false,
  };
  const position = styles.position || "static";
  if (
    position === "sticky" ||
    (element.namespaceURI === SVG_NS && parent?.namespaceURI === SVG_NS)
  ) {
    return { ...base, layout: { kind: "unsupported" } };
  }
  const inFlow = position === "static" || position === "relative";
  const parentLayout =
    inFlow && parentStyles ? autoLayoutParentOf(parentStyles) : null;
  if (parentLayout) {
    return {
      ...base,
      layout: {
        kind: "auto-layout-child",
        parent: parentLayout,
        fillsCrossAxis: fillsFlexCrossAxis(
          element,
          styles,
          parent!,
          parentStyles!,
          parentLayout,
          view,
        ),
      },
    };
  }
  if (
    position !== "absolute" &&
    position !== "fixed" &&
    position !== "relative" &&
    position !== "static"
  ) {
    return { reason: "position-unreadable" };
  }
  const left = position === "static" ? 0 : cssPixels(styles.left);
  const top = position === "static" ? 0 : cssPixels(styles.top);
  if (left === null || top === null) return { reason: "offset-unreadable" };
  const width = cssPixels(styles.width);
  const height = cssPixels(styles.height);
  if (
    (position === "absolute" || fixed) &&
    (width === null || height === null)
  ) {
    return { reason: "size-unreadable" };
  }
  return {
    ...base,
    movesNestedLayers:
      options.checkNestedLayers &&
      position === "static" &&
      !establishesAbsoluteContainingBlock(styles) &&
      hasAbsoluteDescendantAnchoredAbove(element, view),
    layout: {
      kind: "offset",
      position,
      left,
      top,
      x: offsetAxis(element, AXIS_PROPERTIES.x, width ?? 0),
      y: offsetAxis(element, AXIS_PROPERTIES.y, height ?? 0),
    },
  };
}

// A shape aligns inside its whole SVG: its parent group's box moves with it.
function measureSvgShapeAlignNode(
  target: { id: string; element: Element },
  rect: SharedRect,
  view: Window,
): Omit<MeasuredAlignNode, "selectedAncestorId"> | null {
  const { element } = target;
  const parent = editableSvgShapeParent(element);
  let root = (element as SVGElement).ownerSVGElement;
  while (root?.ownerSVGElement) root = root.ownerSVGElement;
  if (!parent || !root) return null;
  const matrix = parent.getScreenCTM();
  const offset = parseSvgShapeTranslate(
    view.getComputedStyle(element).translate,
  );
  const parentBox = sharedRectOf(root, view);
  return {
    id: target.id,
    rect,
    parentBox,
    parentStableId: parent.getAttribute("data-agent-native-node-id"),
    offsetToShared: matrix
      ? { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d }
      : IDENTITY_LINEAR,
    movesNestedLayers: false,
    layout:
      matrix && offset && parentBox
        ? { kind: "svg-shape", offset }
        : { kind: "unsupported" },
  };
}

/**
 * Measures a selection in one screen document. Any node that cannot be
 * measured fails the whole selection: a guessed rect would drag the rest of
 * the selection toward it.
 */
export function measureAlignNodes(
  view: Window,
  targets: readonly { id: string; element: Element }[],
  options: { screenIsAlignable: boolean; checkNestedLayers: boolean },
): AlignMeasurement {
  const nodes: MeasuredAlignNode[] = [];
  for (const target of targets) {
    const measured = measureAlignNode(view, target, options);
    if ("reason" in measured) {
      return {
        status: "unmeasurable",
        nodeId: target.id,
        reason: measured.reason,
      };
    }
    nodes.push({ ...measured, selectedAncestorId: null });
  }
  targets.forEach((target, index) => {
    let nearest: Element | null = null;
    let nearestId: string | null = null;
    for (const other of targets) {
      if (other === target || !other.element.contains(target.element)) continue;
      if (!nearest || nearest.contains(other.element)) {
        nearest = other.element;
        nearestId = other.id;
      }
    }
    nodes[index]!.selectedAncestorId = nearestId;
  });
  return { status: "measured", nodes };
}
