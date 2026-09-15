/**
 * figma-node-spec.ts — the scene -> Figma NODE TREE serializer, the
 * auto-layout half of the Figma export.
 *
 * The SVG path (`figma-svg-scene.ts`) hands Figma one flat sheet of
 * absolutely-positioned geometry, because SVG has no way to say "this is a
 * row with a 16px gap". Figma's Plugin API does — `layoutMode`,
 * `itemSpacing`, `padding*`, `layoutGrow`, `layoutSizing*` — so an export
 * that builds real nodes can hand a designer frames they can actually resize
 * and re-flow, plus the text tracking and effects Figma's SVG importer drops
 * on the floor.
 *
 * Pure and DOM-free: it consumes a `FigmaSvgNode` tree (already hydrated by
 * `figma-svg-scene.ts`) and returns plain data. `figma-node-spec.test.ts`
 * covers it with hand-built scenes; there is no browser in the loop here.
 *
 * Two things make the output trustworthy rather than plausible:
 *
 *  1. Every auto-layout frame is ADMITTED BY SIMULATION. `simulateLines`
 *     replays Figma's own stacking arithmetic over the mapped properties and
 *     compares the result to the geometry the browser actually laid out. A
 *     frame only keeps `layoutMode` when the simulation reproduces every
 *     child's position within `POSITION_EPSILON`. Anything else falls back to
 *     absolute positioning AND is named in the report — a container that
 *     silently became "auto-layout" while its children drifted would be the
 *     worst possible outcome, since it looks like the feature working.
 *
 *  2. Sizing modes are derived from MEASURED geometry, never from CSS.
 *     `getComputedStyle` reports used width/height, so no in-page read can
 *     tell `width: 240px` from a content-derived width. A frame hugs only
 *     when hugging arithmetically reproduces the size the browser produced.
 */

import { parseCssColorExtended } from "./color-utils.js";
import {
  isZeroRadii,
  type FigmaSvgBorder,
  type FigmaSvgCornerRadii,
  type FigmaSvgFillLayer,
  type FigmaSvgLayoutFacts,
  type FigmaSvgNode,
  type FigmaSvgTextStyle,
} from "./figma-svg-scene.js";

// ---------------------------------------------------------------------------
// Spec types — deliberately shaped like the Plugin API properties they set,
// so the materializing plugin script is an assignment loop and not a second
// place where the mapping can drift.
// ---------------------------------------------------------------------------

export type FigmaLayoutMode = "NONE" | "HORIZONTAL" | "VERTICAL";
export type FigmaPrimaryAxisAlign = "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
export type FigmaCounterAxisAlign = "MIN" | "CENTER" | "MAX" | "BASELINE";
export type FigmaAxisSizingMode = "FIXED" | "AUTO";
export type FigmaLayoutSizing = "FIXED" | "HUG" | "FILL";

export interface FigmaRgb {
  r: number;
  g: number;
  b: number;
}

export interface FigmaGradientStop {
  position: number;
  color: FigmaRgb;
  opacity: number;
}

export type FigmaPaintSpec =
  | { type: "SOLID"; color: FigmaRgb; opacity: number }
  | {
      type: "GRADIENT_LINEAR";
      /** CSS gradient angle (0 = to top, 90 = to right). */
      angleDeg: number;
      stops: FigmaGradientStop[];
    }
  | { type: "GRADIENT_RADIAL"; stops: FigmaGradientStop[] }
  | { type: "IMAGE"; href: string; scaleMode: "FILL" | "FIT" | "CROP" };

export interface FigmaEffectSpec {
  type: "DROP_SHADOW" | "INNER_SHADOW";
  color: FigmaRgb;
  opacity: number;
  offset: { x: number; y: number };
  radius: number;
  spread: number;
}

export interface FigmaStrokeSpec {
  paint: FigmaPaintSpec;
  weight: number;
  dashed: boolean;
  /** [top, right, bottom, left] when the CSS sides differ in width. */
  sideWeights?: [number, number, number, number];
}

export interface FigmaTextSpec {
  /** One entry per MEASURED visual line; joined with "\n" when materialized. */
  lines: string[];
  /** The whole CSS `font-family` list, for a materializer that wants to run
   *  its own fallback. */
  fontFamily: string;
  /** The ONE family the browser actually measured with. Use this: the geometry
   *  in this spec is that family's geometry, so materializing in a different
   *  one silently changes every text width. */
  resolvedFontFamily?: string;
  fontSizePx: number;
  fontWeight: number;
  italic: boolean;
  letterSpacingPx: number;
  lineHeightPx?: number;
  color: FigmaRgb;
  colorOpacity: number;
  textAlignHorizontal: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  textAlignVertical: "TOP" | "CENTER" | "BOTTOM";
}

export interface FigmaAutoLayoutSpec {
  mode: FigmaLayoutMode;
  itemSpacing: number;
  /** Between wrapped lines; only meaningful with `layoutWrap: "WRAP"`. */
  counterAxisSpacing: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  primaryAxisAlignItems: FigmaPrimaryAxisAlign;
  counterAxisAlignItems: FigmaCounterAxisAlign;
  primaryAxisSizingMode: FigmaAxisSizingMode;
  counterAxisSizingMode: FigmaAxisSizingMode;
  layoutWrap: "NO_WRAP" | "WRAP";
}

export interface FigmaNodeSpec {
  id: string;
  name: string;
  type: "FRAME" | "TEXT" | "SVG";
  /** Parent-relative, px, top-left origin — Figma's own x/y convention. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg?: number;
  opacity?: number;
  cornerRadii?: FigmaSvgCornerRadii;
  clipsContent?: boolean;
  fills?: FigmaPaintSpec[];
  stroke?: FigmaStrokeSpec;
  effects?: FigmaEffectSpec[];
  text?: FigmaTextSpec;
  /** Inline `<svg>` markup for `figma.createNodeFromSvg`. */
  svgMarkup?: string;
  layout: FigmaAutoLayoutSpec;
  /** Child-of-auto-layout properties. Set AFTER `appendChild`. */
  layoutPositioning?: "ABSOLUTE";
  layoutGrow?: number;
  layoutAlign?: "STRETCH" | "INHERIT";
  layoutSizingHorizontal?: FigmaLayoutSizing;
  layoutSizingVertical?: FigmaLayoutSizing;
  children: FigmaNodeSpec[];
}

export interface FigmaNodeSpecReport {
  autoLayoutFrames: number;
  absoluteFrames: number;
  wrappersCollapsed: number;
  nodeCountBefore: number;
  nodeCountAfter: number;
  maxDepthBefore: number;
  maxDepthAfter: number;
  /** Everything CSS expressed that this mapping could not carry across. */
  notes: Array<{ node: string; note: string }>;
}

/** Subpixel layout jitter that must not disqualify an auto-layout frame. */
export const POSITION_EPSILON = 0.75;

// ---------------------------------------------------------------------------
// Paint / effect conversion
// ---------------------------------------------------------------------------

function toFigmaRgb(css: string): { color: FigmaRgb; opacity: number } | null {
  const parsed = parseCssColorExtended(css);
  if (!parsed) return null;
  return {
    color: { r: parsed.r / 255, g: parsed.g / 255, b: parsed.b / 255 },
    opacity: parsed.a,
  };
}

function toGradientStops(
  stops: Array<{ offset: number; color: string }>,
): FigmaGradientStop[] {
  const converted: FigmaGradientStop[] = [];
  for (const stop of stops) {
    const rgb = toFigmaRgb(stop.color);
    // A stop whose colour cannot be parsed is dropped rather than guessed at:
    // a transparent stop and an unreadable one must not look the same.
    if (!rgb) continue;
    converted.push({
      position: stop.offset,
      color: rgb.color,
      opacity: rgb.opacity,
    });
  }
  return converted;
}

function toPaint(
  layer: FigmaSvgFillLayer,
  notes: Array<{ node: string; note: string }>,
  nodeLabel: string,
): FigmaPaintSpec | null {
  switch (layer.kind) {
    case "solid": {
      const rgb = toFigmaRgb(layer.color);
      return rgb ? { type: "SOLID", ...rgb } : null;
    }
    case "linear-gradient": {
      const stops = toGradientStops(layer.stops);
      if (stops.length < 2) return null;
      return { type: "GRADIENT_LINEAR", angleDeg: layer.angleDeg, stops };
    }
    case "radial-gradient": {
      const stops = toGradientStops(layer.stops);
      if (stops.length < 2) return null;
      return { type: "GRADIENT_RADIAL", stops };
    }
    case "image":
      return {
        type: "IMAGE",
        href: layer.href,
        scaleMode:
          layer.fit === "cover"
            ? "FILL"
            : layer.fit === "contain"
              ? "FIT"
              : "CROP",
      };
    case "unsupported":
      notes.push({
        node: nodeLabel,
        note: `background-image layer has no Figma paint equivalent: ${layer.css}`,
      });
      return null;
  }
}

function toStroke(
  border: FigmaSvgBorder,
  notes: Array<{ node: string; note: string }>,
  nodeLabel: string,
): FigmaStrokeSpec | null {
  const rgb = toFigmaRgb(border.color);
  if (!rgb) return null;
  const sides = border.sides;
  let sideWeights: [number, number, number, number] | undefined;
  if (sides) {
    sideWeights = [
      sides[0]?.widthPx ?? 0,
      sides[1]?.widthPx ?? 0,
      sides[2]?.widthPx ?? 0,
      sides[3]?.widthPx ?? 0,
    ];
    const colors = sides.filter(Boolean).map((side) => side!.color);
    if (colors.some((color) => color !== colors[0])) {
      notes.push({
        node: nodeLabel,
        note:
          "per-side border COLOURS differ; Figma strokes carry one paint for " +
          "all four sides, so the first side's colour is used for every side.",
      });
    }
  }
  return {
    paint: { type: "SOLID", ...rgb },
    weight: border.widthPx,
    dashed: Boolean(border.dashed),
    sideWeights,
  };
}

function toEffects(
  shadows: NonNullable<FigmaSvgNode["shadows"]>,
): FigmaEffectSpec[] {
  const effects: FigmaEffectSpec[] = [];
  for (const shadow of shadows) {
    const rgb = toFigmaRgb(shadow.color);
    if (!rgb) continue;
    effects.push({
      type: shadow.inset ? "INNER_SHADOW" : "DROP_SHADOW",
      color: rgb.color,
      opacity: rgb.opacity,
      offset: { x: shadow.offsetX, y: shadow.offsetY },
      // CSS blur-radius is a diameter-ish spread; Figma's is the Gaussian
      // radius, which is half of it. This is the one conversion Figma's SVG
      // importer never gets to do at all, because it drops shadows entirely.
      radius: shadow.blur / 2,
      spread: shadow.spread,
    });
  }
  return effects;
}

// ---------------------------------------------------------------------------
// Layout mapping
// ---------------------------------------------------------------------------

/** `candidateMode` needs a third state that is not a Figma value. */
type ModeCandidate = FigmaLayoutMode | "GRID_CANDIDATE";

function candidateMode(node: FigmaSvgNode): ModeCandidate {
  const css = node.layout;
  if (!css) return "NONE";
  const display = css.display;
  if (display === "flex" || display === "inline-flex") {
    if (css.flexDirection === "row") return "HORIZONTAL";
    if (css.flexDirection === "column") return "VERTICAL";
    // `row-reverse`/`column-reverse` paint in DOM order but position in
    // reverse. Figma has no reverse; expressing it would mean reordering the
    // children, which reorders the paint stack too.
    return "NONE";
  }
  if (display === "grid" || display === "inline-grid") return "GRID_CANDIDATE";
  return "NONE";
}

/**
 * With exactly one flow item the distribution keywords all degenerate to a
 * plain placement — CSS's own rule, not a fudge: `space-between` puts the
 * single item at the start, `space-around`/`space-evenly` centre it. Worth
 * handling because it is common: a flex row whose only ELEMENT child sits
 * beside a bare text node arrives here with one item.
 */
function primaryAlignFrom(
  justifyContent: string,
  flowCount: number,
): FigmaPrimaryAxisAlign | null {
  if (flowCount === 1) {
    if (justifyContent === "space-between") return "MIN";
    if (
      justifyContent === "space-around" ||
      justifyContent === "space-evenly"
    ) {
      return "CENTER";
    }
  }
  switch (justifyContent) {
    case "flex-start":
    case "start":
    case "left":
    case "normal":
      return "MIN";
    case "center":
      return "CENTER";
    case "flex-end":
    case "end":
    case "right":
      return "MAX";
    case "space-between":
      return "SPACE_BETWEEN";
    default:
      // space-around / space-evenly / stretch: Figma has no equivalent.
      return null;
  }
}

function counterAlignFrom(
  alignItems: string,
  mode: FigmaLayoutMode,
): FigmaCounterAxisAlign | null {
  switch (alignItems) {
    case "flex-start":
    case "start":
    case "stretch":
    case "normal":
      return "MIN";
    case "center":
      return "CENTER";
    case "flex-end":
    case "end":
      return "MAX";
    case "baseline":
      // Figma only baselines a horizontal stack.
      return mode === "HORIZONTAL" ? "BASELINE" : null;
    default:
      return null;
  }
}

function stretchesCounterAxis(
  css: FigmaSvgLayoutFacts | undefined,
  parentAlignItems: string,
): boolean {
  if (!css) return false;
  const self = css.alignSelf;
  if (self === "stretch") return true;
  if (self === "auto" || self === "normal") {
    return parentAlignItems === "stretch" || parentAlignItems === "normal";
  }
  return false;
}

// ---------------------------------------------------------------------------
// Wrapper collapsing — the "not a million wrapper divs" pass.
// ---------------------------------------------------------------------------

function isPaintNeutral(node: FigmaSvgNode): boolean {
  return (
    node.kind === "box" &&
    !node.fills?.length &&
    !node.border &&
    !node.shadows?.length &&
    (!node.cornerRadii || isZeroRadii(node.cornerRadii)) &&
    !node.clipsContent &&
    !node.rotationDeg &&
    (node.opacity === undefined || node.opacity === 1)
  );
}

function sameRect(a: FigmaSvgNode, b: FigmaSvgNode): boolean {
  return (
    Math.abs(a.rect.x - b.rect.x) <= POSITION_EPSILON &&
    Math.abs(a.rect.y - b.rect.y) <= POSITION_EPSILON &&
    Math.abs(a.rect.width - b.rect.width) <= POSITION_EPSILON &&
    Math.abs(a.rect.height - b.rect.height) <= POSITION_EPSILON
  );
}

/**
 * A paint-neutral box whose single child occupies its exact box contributes
 * nothing: whatever its own padding/gap/alignment did is already baked into
 * that child's measured rect. Replacing it with the child is provably a
 * visual no-op — but the child inherits its ITEM facts, because the child is
 * now the parent's flex item, not the wrapper's.
 */
function passThroughOnce(node: FigmaSvgNode): FigmaSvgNode | null {
  if (!isPaintNeutral(node)) return null;
  if (node.children?.length !== 1) return null;
  const child = node.children[0];
  if (!sameRect(node, child)) return null;
  if (!node.layout || !child.layout) return child;
  return {
    ...child,
    layout: {
      ...child.layout,
      position: node.layout.position,
      flexGrow: node.layout.flexGrow,
      flexShrink: node.layout.flexShrink,
      flexBasis: node.layout.flexBasis,
      alignSelf: node.layout.alignSelf,
    },
  };
}

/**
 * Inside a container that will be absolutely positioned anyway, a
 * paint-neutral box positions nothing — its children already carry
 * root-relative rects. Splicing them into the parent AT THE WRAPPER'S INDEX
 * preserves paint order exactly, and a childless one paints nothing at all.
 *
 * Deliberately NOT applied under an auto-layout parent: there the wrapper is
 * a flow item, so removing it changes spacing.
 */
function canHoistInto(parent: FigmaSvgNode, node: FigmaSvgNode): boolean {
  return (
    isPaintNeutral(node) &&
    candidateMode(parent) === "NONE" &&
    candidateMode(node) === "NONE"
  );
}

function collapseWrappers(
  node: FigmaSvgNode,
  counter: { count: number },
): FigmaSvgNode {
  if (!node.children?.length) return node;
  const next: FigmaSvgNode[] = [];
  for (const rawChild of node.children) {
    let child = collapseWrappers(rawChild, counter);
    for (;;) {
      const collapsed = passThroughOnce(child);
      if (!collapsed) break;
      child = collapsed;
      counter.count += 1;
    }
    if (canHoistInto(node, child)) {
      counter.count += 1;
      next.push(...(child.children ?? []));
    } else {
      next.push(child);
    }
  }
  return { ...node, children: next };
}

// ---------------------------------------------------------------------------
// Auto-layout simulation — the admission test.
// ---------------------------------------------------------------------------

interface FlowItem {
  spec: FigmaNodeSpec;
  css?: FigmaSvgLayoutFacts;
}

interface SimulationInput {
  mode: "HORIZONTAL" | "VERTICAL";
  /** Container box in its own coordinates. */
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
  itemSpacing: number;
  counterAxisSpacing: number;
  primaryAlign: FigmaPrimaryAxisAlign;
  counterAlign: FigmaCounterAxisAlign;
  /** One entry per wrapped line; a non-wrapping stack is a single line. */
  lines: FlowItem[][];
  /** Children whose counter-axis size Figma will stretch to the line height. */
  stretched: Set<FigmaNodeSpec>;
}

/**
 * Replays Figma's stacking over the mapped properties and returns the worst
 * per-child position error in px, or `null` when the mapping is structurally
 * unrepresentable (SPACE_BETWEEN with negative free space, for example).
 */
export function simulateLines(input: SimulationInput): number | null {
  const horizontal = input.mode === "HORIZONTAL";
  const primaryStart = horizontal ? input.padding.left : input.padding.top;
  const primaryEnd = horizontal ? input.padding.right : input.padding.bottom;
  const counterStart = horizontal ? input.padding.top : input.padding.left;
  const counterEnd = horizontal ? input.padding.bottom : input.padding.right;
  const primarySpace =
    (horizontal ? input.width : input.height) - primaryStart - primaryEnd;
  const counterSpace =
    (horizontal ? input.height : input.width) - counterStart - counterEnd;

  const primarySizeOf = (spec: FigmaNodeSpec) =>
    horizontal ? spec.width : spec.height;
  const counterSizeOf = (spec: FigmaNodeSpec) =>
    horizontal ? spec.height : spec.width;
  const primaryPosOf = (spec: FigmaNodeSpec) => (horizontal ? spec.x : spec.y);
  const counterPosOf = (spec: FigmaNodeSpec) => (horizontal ? spec.y : spec.x);

  const lineCounterSizes = input.lines.map((line) =>
    line.reduce((max, item) => Math.max(max, counterSizeOf(item.spec)), 0),
  );
  let worst = 0;
  let counterCursor = counterStart;

  for (const [lineIndex, line] of input.lines.entries()) {
    if (line.length === 0) return null;
    const contentPrimary =
      line.reduce((sum, item) => sum + primarySizeOf(item.spec), 0) +
      input.itemSpacing * (line.length - 1);
    const free = primarySpace - contentPrimary;

    let offset = 0;
    let extraGap = 0;
    if (input.primaryAlign === "CENTER") offset = free / 2;
    else if (input.primaryAlign === "MAX") offset = free;
    else if (input.primaryAlign === "SPACE_BETWEEN") {
      if (line.length < 2 || free < -POSITION_EPSILON) return null;
      extraGap = free / (line.length - 1);
    }

    let cursor = primaryStart + offset;
    const lineCounter = lineCounterSizes[lineIndex];
    for (const item of line) {
      const expectedPrimary = cursor;
      worst = Math.max(
        worst,
        Math.abs(expectedPrimary - primaryPosOf(item.spec)),
      );
      cursor += primarySizeOf(item.spec) + input.itemSpacing + extraGap;

      const childCounter = counterSizeOf(item.spec);
      // Figma stretches a line's items to the LINE's counter size, not the
      // container's — identical for a single line, different once wrapped.
      const lineExtent = input.lines.length > 1 ? lineCounter : counterSpace;
      let expectedCounter = counterCursor;
      if (input.stretched.has(item.spec)) {
        worst = Math.max(worst, Math.abs(lineExtent - childCounter));
      } else if (input.counterAlign === "CENTER") {
        expectedCounter = counterCursor + (lineExtent - childCounter) / 2;
      } else if (input.counterAlign === "MAX") {
        expectedCounter = counterCursor + lineExtent - childCounter;
      } else if (input.counterAlign === "BASELINE") {
        // Baseline offsets are not in the scene model; treat the mapping as
        // unverifiable rather than pretending MIN is the same thing.
        return null;
      }
      worst = Math.max(
        worst,
        Math.abs(expectedCounter - counterPosOf(item.spec)),
      );
    }
    counterCursor += lineCounter + input.counterAxisSpacing;
  }
  return worst;
}

/**
 * Groups flow children into the visual lines the browser actually produced,
 * by watching the primary-axis cursor go backwards.
 */
function groupIntoLines(items: FlowItem[], horizontal: boolean): FlowItem[][] {
  const lines: FlowItem[][] = [];
  let current: FlowItem[] = [];
  let previousEnd = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const start = horizontal ? item.spec.x : item.spec.y;
    const end = start + (horizontal ? item.spec.width : item.spec.height);
    if (current.length > 0 && start < previousEnd - POSITION_EPSILON) {
      lines.push(current);
      current = [];
    }
    current.push(item);
    previousEnd = end;
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

// ---------------------------------------------------------------------------
// Scene -> spec
// ---------------------------------------------------------------------------

const NO_LAYOUT: FigmaAutoLayoutSpec = {
  mode: "NONE",
  itemSpacing: 0,
  counterAxisSpacing: 0,
  paddingTop: 0,
  paddingRight: 0,
  paddingBottom: 0,
  paddingLeft: 0,
  primaryAxisAlignItems: "MIN",
  counterAxisAlignItems: "MIN",
  primaryAxisSizingMode: "FIXED",
  counterAxisSizingMode: "FIXED",
  layoutWrap: "NO_WRAP",
};

function nameFor(node: FigmaSvgNode, mode: ModeCandidate): string {
  if (node.name) return node.name;
  if (node.kind === "text") {
    const first = node.text?.lines[0]?.text?.trim() ?? "";
    return first ? first.slice(0, 32) : "Text";
  }
  if (node.kind === "image") return "Image";
  if (node.kind === "vector") return "Vector";
  if (mode === "HORIZONTAL") return "Row";
  if (mode === "VERTICAL") return "Column";
  if (mode === "GRID_CANDIDATE") return "Grid";
  return "Frame";
}

function contentBoxInset(node: FigmaSvgNode): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const padding = node.layout?.paddingPx ?? [0, 0, 0, 0];
  const sides = node.border?.sides;
  const uniform = node.border?.widthPx ?? 0;
  const borderAt = (index: number) =>
    sides ? (sides[index]?.widthPx ?? 0) : uniform;
  return {
    top: padding[0] + borderAt(0),
    right: padding[1] + borderAt(1),
    bottom: padding[2] + borderAt(2),
    left: padding[3] + borderAt(3),
  };
}

function textSpecFrom(
  style: FigmaSvgTextStyle,
  lines: string[],
): FigmaTextSpec | null {
  const rgb = toFigmaRgb(style.color);
  if (!rgb) return null;
  const align = style.textAlign ?? "left";
  return {
    lines,
    fontFamily: style.fontFamily,
    resolvedFontFamily: style.resolvedFontFamily,
    fontSizePx: style.fontSizePx,
    fontWeight: style.fontWeight ?? 400,
    italic: Boolean(style.italic),
    // Figma's SVG importer drops tracking entirely; the Plugin API does not,
    // which is one of the concrete wins of building nodes instead of SVG.
    letterSpacingPx: style.letterSpacingPx ?? 0,
    lineHeightPx: style.lineHeightPx,
    color: rgb.color,
    colorOpacity: rgb.opacity,
    textAlignHorizontal:
      align === "center"
        ? "CENTER"
        : align === "right"
          ? "RIGHT"
          : align === "justify"
            ? "JUSTIFIED"
            : "LEFT",
    // CSS stacks line boxes from the content-box top; with one line the box
    // IS one line tall, so TOP and CENTER agree. `figma-svg-scene.ts` centres
    // the single-line case for the same reason.
    textAlignVertical: lines.length > 1 ? "TOP" : "CENTER",
  };
}

interface BuildContext {
  notes: Array<{ node: string; note: string }>;
  autoLayoutFrames: number;
  absoluteFrames: number;
}

function paintPropsFor(
  node: FigmaSvgNode,
  ctx: BuildContext,
  label: string,
): Pick<
  FigmaNodeSpec,
  "fills" | "stroke" | "effects" | "cornerRadii" | "clipsContent"
> {
  const fills: FigmaPaintSpec[] = [];
  // Scene fills run topmost-first; Figma paints run bottom-first.
  for (const layer of [...(node.fills ?? [])].reverse()) {
    const paint = toPaint(layer, ctx.notes, label);
    if (paint) fills.push(paint);
  }
  if (node.kind === "image" && node.image?.href) {
    fills.push({
      type: "IMAGE",
      href: node.image.href,
      scaleMode:
        node.image.fit === "cover"
          ? "FILL"
          : node.image.fit === "contain"
            ? "FIT"
            : "CROP",
    });
  }
  if (node.kind === "raster" && node.raster) {
    if (node.raster.href) {
      fills.push({ type: "IMAGE", href: node.raster.href, scaleMode: "CROP" });
    }
    ctx.notes.push({ node: label, note: node.raster.reason });
  }
  const stroke = node.border ? toStroke(node.border, ctx.notes, label) : null;
  const effects = node.shadows ? toEffects(node.shadows) : [];
  return {
    fills: fills.length ? fills : undefined,
    stroke: stroke ?? undefined,
    effects: effects.length ? effects : undefined,
    cornerRadii:
      node.cornerRadii && !isZeroRadii(node.cornerRadii)
        ? node.cornerRadii
        : undefined,
    clipsContent: node.clipsContent,
  };
}

function buildSpec(
  node: FigmaSvgNode,
  origin: { x: number; y: number },
  ctx: BuildContext,
): FigmaNodeSpec {
  const mode = candidateMode(node);
  const label = nameFor(node, mode);
  const base: FigmaNodeSpec = {
    id: node.id,
    name: label,
    type: node.kind === "vector" ? "SVG" : "FRAME",
    x: node.rect.x - origin.x,
    y: node.rect.y - origin.y,
    width: node.rect.width,
    height: node.rect.height,
    rotationDeg: node.rotationDeg,
    opacity: node.opacity,
    svgMarkup: node.vector?.markup,
    ...paintPropsFor(node, ctx, label),
    layout: { ...NO_LAYOUT },
    children: [],
  };

  if (node.kind === "text" && node.text) {
    const lines = node.text.lines.map((line) => line.text);
    const text = textSpecFrom(node.text.style, lines);
    if (!text) {
      ctx.notes.push({
        node: label,
        note: `text colour "${node.text.style.color}" could not be parsed — text omitted.`,
      });
      return base;
    }
    const inset = contentBoxInset(node);
    const padded =
      inset.top > 0 || inset.right > 0 || inset.bottom > 0 || inset.left > 0;
    const painted = Boolean(base.fills || base.stroke || base.effects);
    if (!padded && !painted) {
      return { ...base, type: "TEXT", text };
    }
    // A padded or painted text leaf is a button/pill/badge. A designer builds
    // that as an auto-layout frame with padding wrapping a text layer — which
    // is also what keeps the paint AND the text, since a Figma TEXT node's
    // fills colour the glyphs, not a background.
    ctx.autoLayoutFrames += 1;
    return {
      ...base,
      layout: {
        ...NO_LAYOUT,
        mode: "HORIZONTAL",
        paddingTop: inset.top,
        paddingRight: inset.right,
        paddingBottom: inset.bottom,
        paddingLeft: inset.left,
      },
      children: [
        {
          id: `${node.id}-text`,
          name: label,
          type: "TEXT",
          x: inset.left,
          y: inset.top,
          width: Math.max(0, node.rect.width - inset.left - inset.right),
          height: Math.max(0, node.rect.height - inset.top - inset.bottom),
          text,
          layout: { ...NO_LAYOUT },
          layoutSizingHorizontal: "FILL",
          layoutSizingVertical: "FILL",
          children: [],
        },
      ],
    };
  }

  const childOrigin = { x: node.rect.x, y: node.rect.y };
  const children = (node.children ?? []).map((child) =>
    buildSpec(child, childOrigin, ctx),
  );
  if (children.length === 0) return base;
  return resolveContainer(node, base, children, mode, ctx);
}

function resolveContainer(
  node: FigmaSvgNode,
  base: FigmaNodeSpec,
  children: FigmaNodeSpec[],
  candidate: ModeCandidate,
  ctx: BuildContext,
): FigmaNodeSpec {
  const css = node.layout;
  const sceneChildren = node.children ?? [];
  const flow: FlowItem[] = [];
  const absolute: FigmaNodeSpec[] = [];
  children.forEach((spec, index) => {
    const childCss = sceneChildren[index]?.layout;
    const position = childCss?.position;
    if (position === "absolute" || position === "fixed") {
      absolute.push(spec);
    } else {
      flow.push({ spec, css: childCss });
    }
  });

  const giveUp = (note?: string): FigmaNodeSpec => {
    if (note) ctx.notes.push({ node: base.name, note });
    ctx.absoluteFrames += 1;
    return { ...base, children };
  };

  if (candidate === "NONE" || !css) return giveUp();
  if (flow.length === 0) return giveUp();

  let mode: "HORIZONTAL" | "VERTICAL";
  if (candidate === "GRID_CANDIDATE") {
    // Figma auto-layout is single-axis. A grid whose items all share one row
    // (or one column) IS a row/column with a gap; anything else is a genuine
    // two-axis layout with no equivalent, and gets said so out loud.
    const sameRow = flow.every(
      (item) => Math.abs(item.spec.y - flow[0].spec.y) <= POSITION_EPSILON,
    );
    const sameColumn = flow.every(
      (item) => Math.abs(item.spec.x - flow[0].spec.x) <= POSITION_EPSILON,
    );
    if (sameRow) mode = "HORIZONTAL";
    else if (sameColumn) mode = "VERTICAL";
    else {
      return giveUp(
        "CSS grid spans both axes; Figma auto-layout is single-axis, so this " +
          "frame keeps absolutely-positioned children.",
      );
    }
  } else {
    mode = candidate;
  }

  const primaryAlign = primaryAlignFrom(css.justifyContent, flow.length);
  if (!primaryAlign) {
    return giveUp(
      `justify-content: ${css.justifyContent} has no Figma primaryAxisAlignItems equivalent.`,
    );
  }
  const counterAlign = counterAlignFrom(css.alignItems, mode);
  if (!counterAlign) {
    return giveUp(
      `align-items: ${css.alignItems} has no Figma counterAxisAlignItems equivalent for a ${mode.toLowerCase()} stack.`,
    );
  }

  const horizontal = mode === "HORIZONTAL";
  const itemSpacing = horizontal ? css.columnGapPx : css.rowGapPx;
  const counterAxisSpacing = horizontal ? css.rowGapPx : css.columnGapPx;
  // CSS lays children out inside padding AND border; a Figma frame's stroke
  // does not inset its auto-layout children at all. Folding the border width
  // into the padding is what puts a bordered card's contents where the
  // browser put them — the simulation catches it as a 1px drift otherwise.
  const padding = contentBoxInset(node);

  const wraps = css.flexWrap === "wrap" || css.flexWrap === "wrap-reverse";
  const lines = wraps ? groupIntoLines(flow, horizontal) : [flow];
  if (css.flexWrap === "wrap-reverse" && lines.length > 1) {
    return giveUp(
      "flex-wrap: wrap-reverse stacks lines against the counter axis; Figma's layoutWrap only stacks forwards.",
    );
  }

  // `align-items: stretch` only stretches an item with no explicit cross
  // size; one that has its own height is placed at flex-start instead. Since
  // computed styles cannot tell those apart, use the measured size: a child
  // counts as stretched only when it already fills the extent Figma would
  // stretch it to. Anything else is a plain MIN-aligned item, which is
  // exactly what CSS did.
  const counterSpaceOf = (line: FlowItem[]) =>
    lines.length > 1
      ? line.reduce(
          (max, item) =>
            Math.max(max, horizontal ? item.spec.height : item.spec.width),
          0,
        )
      : (horizontal ? base.height : base.width) -
        (horizontal
          ? padding.top + padding.bottom
          : padding.left + padding.right);
  const stretched = new Set<FigmaNodeSpec>();
  for (const line of lines) {
    const extent = counterSpaceOf(line);
    for (const item of line) {
      const size = horizontal ? item.spec.height : item.spec.width;
      if (
        stretchesCounterAxis(item.css, css.alignItems) &&
        Math.abs(size - extent) <= POSITION_EPSILON
      ) {
        stretched.add(item.spec);
      }
    }
  }

  const worst = simulateLines({
    mode,
    width: base.width,
    height: base.height,
    padding,
    itemSpacing,
    counterAxisSpacing,
    primaryAlign,
    counterAlign,
    lines,
    stretched,
  });
  if (worst === null || worst > POSITION_EPSILON) {
    return giveUp(
      worst === null
        ? "this stack's alignment cannot be replayed with Figma auto-layout properties; children stay absolutely positioned."
        : `Figma auto-layout would move a child by ${worst.toFixed(2)}px, so this frame keeps absolutely-positioned children.`,
    );
  }

  // FILL along the primary axis reproduces flex-grow only when Figma's equal
  // split of the free space lands on the size flex actually computed —
  // flex-grow RATIOS (flex: 2 next to flex: 1) do not survive that.
  // CSS grid `1fr` tracks compute to used pixels and grid items keep
  // `flex-grow: 0`, so no computed style says "this track shares the free
  // space". The even-split check below is the only honest test available:
  // when Figma's FILL reproduces the measured track, the track behaved like
  // `1fr` and FILL keeps the frame resizable instead of frozen.
  const growItems =
    candidate === "GRID_CANDIDATE"
      ? flow
      : flow.filter((item) => (item.css?.flexGrow ?? 0) >= 1);
  let primaryFill = growItems.length > 0 && lines.length === 1;
  if (primaryFill) {
    const primaryOf = (spec: FigmaNodeSpec) =>
      horizontal ? spec.width : spec.height;
    const available =
      (horizontal ? base.width : base.height) -
      (horizontal
        ? padding.left + padding.right
        : padding.top + padding.bottom) -
      itemSpacing * (flow.length - 1);
    const fixedTotal = flow
      .filter((item) => !growItems.includes(item))
      .reduce((sum, item) => sum + primaryOf(item.spec), 0);
    const share = (available - fixedTotal) / growItems.length;
    primaryFill = growItems.every(
      (item) => Math.abs(share - primaryOf(item.spec)) <= POSITION_EPSILON,
    );
    // Only worth reporting where the author actually asked for growth:
    // a grid track that does not split evenly is simply a fixed track, and
    // FIXED represents it exactly.
    if (!primaryFill && candidate !== "GRID_CANDIDATE") {
      ctx.notes.push({
        node: base.name,
        note:
          "flex-grow ratios across siblings have no Figma equivalent (FILL " +
          "splits free space evenly), so these children keep fixed sizes.",
      });
    }
  }

  for (const item of flow) {
    const grows = primaryFill && growItems.includes(item);
    const stretches = stretched.has(item.spec);
    if (grows) item.spec.layoutGrow = 1;
    if (stretches) item.spec.layoutAlign = "STRETCH";
    item.spec.layoutSizingHorizontal = horizontal
      ? grows
        ? "FILL"
        : "FIXED"
      : stretches
        ? "FILL"
        : "FIXED";
    item.spec.layoutSizingVertical = horizontal
      ? stretches
        ? "FILL"
        : "FIXED"
      : grows
        ? "FILL"
        : "FIXED";
  }
  for (const spec of absolute) spec.layoutPositioning = "ABSOLUTE";

  // Hug only where hugging arithmetically reproduces the measured box — a
  // frame that hugs when it should not is a frame that silently resizes.
  const lineExtents = lines.map((line) => ({
    primary:
      line.reduce(
        (sum, item) => sum + (horizontal ? item.spec.width : item.spec.height),
        0,
      ) +
      itemSpacing * (line.length - 1),
    counter: line.reduce(
      (max, item) =>
        Math.max(max, horizontal ? item.spec.height : item.spec.width),
      0,
    ),
  }));
  const hugPrimary =
    lineExtents.reduce((max, line) => Math.max(max, line.primary), 0) +
    (horizontal ? padding.left + padding.right : padding.top + padding.bottom);
  const hugCounter =
    lineExtents.reduce((sum, line) => sum + line.counter, 0) +
    counterAxisSpacing * (lines.length - 1) +
    (horizontal ? padding.top + padding.bottom : padding.left + padding.right);
  const measuredPrimary = horizontal ? base.width : base.height;
  const measuredCounter = horizontal ? base.height : base.width;

  ctx.autoLayoutFrames += 1;
  return {
    ...base,
    layout: {
      mode,
      itemSpacing,
      counterAxisSpacing,
      paddingTop: padding.top,
      paddingRight: padding.right,
      paddingBottom: padding.bottom,
      paddingLeft: padding.left,
      primaryAxisAlignItems: primaryAlign,
      counterAxisAlignItems: counterAlign,
      primaryAxisSizingMode:
        !primaryFill &&
        Math.abs(hugPrimary - measuredPrimary) <= POSITION_EPSILON
          ? "AUTO"
          : "FIXED",
      counterAxisSizingMode:
        stretched.size === 0 &&
        Math.abs(hugCounter - measuredCounter) <= POSITION_EPSILON
          ? "AUTO"
          : "FIXED",
      layoutWrap: lines.length > 1 ? "WRAP" : "NO_WRAP",
    },
    children,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function measure(node: FigmaSvgNode): { count: number; depth: number } {
  let count = 1;
  let depth = 1;
  for (const child of node.children ?? []) {
    const sub = measure(child);
    count += sub.count;
    depth = Math.max(depth, sub.depth + 1);
  }
  return { count, depth };
}

/**
 * Turns a hydrated `FigmaSvgNode` scene into a Figma node-spec tree with real
 * auto-layout, plus a report of what was collapsed and what could not be
 * represented.
 */
export function buildFigmaNodeSpec(root: FigmaSvgNode): {
  root: FigmaNodeSpec;
  report: FigmaNodeSpecReport;
} {
  const before = measure(root);
  const counter = { count: 0 };
  const collapsed = collapseWrappers(root, counter);
  const after = measure(collapsed);
  const ctx: BuildContext = {
    notes: [],
    autoLayoutFrames: 0,
    absoluteFrames: 0,
  };
  const spec = buildSpec(collapsed, { x: root.rect.x, y: root.rect.y }, ctx);
  return {
    root: spec,
    report: {
      autoLayoutFrames: ctx.autoLayoutFrames,
      absoluteFrames: ctx.absoluteFrames,
      wrappersCollapsed: counter.count,
      nodeCountBefore: before.count,
      nodeCountAfter: after.count,
      maxDepthBefore: before.depth,
      maxDepthAfter: after.depth,
      notes: ctx.notes,
    },
  };
}
