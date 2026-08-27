/**
 * figma-svg-scene.ts — the browser-safe half of the Figma SVG export: the
 * scene model, the pure scene -> SVG serializer, the in-page DOM walk that
 * produces a raw scene, and the raw -> scene hydration between them. It lives
 * in `shared/` because BOTH exporters run it: the server's Playwright
 * renderer (`server/lib/design-to-figma-svg.ts`, which re-exports everything
 * here) and the editor's live-DOM "Copy as SVG" / "Download Figma SVG"
 * commands (`app/lib/figma-svg-copy.ts`). Those two were once independent
 * implementations and drifted badly — every fidelity fix landed on the server
 * path only. One pipeline, one place to fix.
 *
 * Nothing here may import a server-only module (playwright, node builtins,
 * SSRF helpers): the whole file has to load in a browser bundle.
 *
 * Three layers:
 *
 *  1. A pure, DOM-free SCENE -> SVG serializer (`buildFigmaSvgDocument` and
 *     its helpers). It consumes a `FigmaSvgNode` tree — plain data, no DOM —
 *     and emits SVG markup plus an export report. This is the part covered by
 *     `design-to-figma-svg.spec.ts` with hand-built fixture nodes (gradient
 *     stops, rounded-rect path commands, stroke inset geometry, tspan
 *     positions).
 *
 *  2. A pure raw -> scene HYDRATION step (`hydrateRawFigmaSvgNode`,
 *     `buildFillLayersFromComputedStyle`) that turns mostly-untouched
 *     computed-style strings into the scene model. Also unit-tested.
 *
 *  3. The in-page DOM WALK (`collectRawFigmaSvgScene`) that reads real
 *     `getBoundingClientRect()` / `getComputedStyle()` values off a live,
 *     laid-out document. Delegating geometry to the actual browser layout
 *     engine is what makes the boxes PIXEL-PERFECT without reimplementing
 *     flexbox/auto-layout math by hand. The server hands this function to
 *     `page.evaluate`, so it must stay a single self-contained function with
 *     no closures over module scope (Playwright serializes it via
 *     `Function#toString()`), which is why it duplicates a few tiny helpers
 *     rather than importing them.
 */

import { parseCssColorExtended } from "./color-utils.js";

// ---------------------------------------------------------------------------
// Scene types
// ---------------------------------------------------------------------------

export interface FigmaSvgRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FigmaSvgCornerRadii {
  tl: number;
  tr: number;
  br: number;
  bl: number;
  /**
   * The element is a full ellipse (CSS `border-radius: 50%` or larger on both
   * axes). A single scalar radius per corner cannot describe one whose width
   * and height differ, and `roundedRectPath` draws circular arcs, so a 338x71
   * ring came out as a pair of straight lines and a 125px circle as a rounded
   * square. Flagged here rather than at each shape site so fills, clips,
   * shadows and outlines all pick it up from the one path builder.
   */
  ellipse?: boolean;
}

export const ZERO_RADII: FigmaSvgCornerRadii = { tl: 0, tr: 0, br: 0, bl: 0 };

export interface FigmaSvgColorStop {
  /** 0-1 */
  offset: number;
  // guard:allow-raw-color — exported SVG paint read from the design's own computed styles, never app UI
  /** Any valid SVG color (rgb()/rgba()/#hex/named). */
  color: string;
}

export type FigmaSvgFillLayer =
  | { kind: "solid"; color: string }
  | { kind: "linear-gradient"; angleDeg: number; stops: FigmaSvgColorStop[] }
  | {
      kind: "radial-gradient";
      stops: FigmaSvgColorStop[];
      /** Shape/extent/position, resolved against the box at emit time. */
      geometry?: ParsedRadialGradient;
      /** objectBoundingBox 0-1 fallback when no geometry was parsed. */
      cx?: number;
      cy?: number;
      r?: number;
    }
  | {
      kind: "image";
      href: string;
      fit: "cover" | "contain" | "stretch";
      /** An explicit `background-size` in px, i.e. a Figma CROP. */
      sizePx?: { width: number; height: number };
      /** The matching `background-position` in px, when the size is explicit. */
      offsetPx?: { x: number; y: number };
      /**
       * `background-repeat` asked for tiling, i.e. a Figma TILE fill. The tile
       * is `sizePx` when the importer resolved the image's intrinsic size; a
       * repeating fill WITHOUT one cannot be tiled correctly and is reported
       * rather than drawn as a single stretched copy.
       */
      repeat?: boolean;
    }
  /** A background-image layer with no SVG equivalent (conic, repeating, …). */
  | { kind: "unsupported"; css: string };

export interface FigmaSvgShadow {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: string;
  inset?: boolean;
  /**
   * Cast from what the subtree paints rather than from the node's box, and not
   * knocked out under it. Set for a `drop-shadow()` filter.
   */
  castFromContent?: boolean;
}

export interface FigmaSvgBorder {
  widthPx: number;
  color: string;
  dashed?: boolean;
  /** Set when the source had non-uniform per-side width/color/style and we
   *  fell back to one representative side — surfaced as "approximated". */
  nonUniform?: boolean;
  /** Per-side [top, right, bottom, left]; present whenever the sides differ,
   *  so each edge is drawn on its own instead of as one box outline. */
  sides?: Array<{ widthPx: number; color: string; dashed: boolean } | null>;
}

/** CSS `outline`: a band straddling the border box, offset by `offsetPx`. */
export interface FigmaSvgOutline {
  widthPx: number;
  color: string;
  offsetPx: number;
  dashed?: boolean;
}

export interface FigmaSvgTextLine {
  text: string;
  x: number;
  /** Vertical CENTER of the line box (rendered with dominant-baseline="central"). */
  y: number;
}

export interface FigmaSvgTextStyle {
  fontFamily: string;
  fontSizePx: number;
  fontWeight?: number;
  italic?: boolean;
  letterSpacingPx?: number;
  color: string;
  textAlign?: "left" | "center" | "right" | "justify";
  /** The single family the browser ACTUALLY rendered with, resolved out of
   *  `fontFamily`'s fallback list by measurement. */
  resolvedFontFamily?: string;
  /** Used `line-height` in px. Unused by the SVG path (which places every line
   *  at an absolute baseline); the Figma NODE path needs it, because a real
   *  TEXT node re-lays its own lines out. */
  lineHeightPx?: number;
}

/**
 * The CSS layout facts of one element, in the parent's terms and its own.
 * Carried through the scene untouched by the SVG serializer, which cannot
 * express layout at all — `shared/figma-node-spec.ts` reads these to build
 * real Figma auto-layout frames.
 *
 * Sizing modes are deliberately NOT here: `getComputedStyle` reports USED
 * width/height, so `width: 240px` and a content-derived width are the same
 * string, and no in-page read distinguishes them. The node-spec builder
 * derives hug-vs-fixed from measured geometry instead — a frame hugs only
 * when hugging reproduces the size the browser actually laid out.
 */
export interface FigmaSvgLayoutFacts {
  /** Computed `display` — "flex", "inline-flex", "grid", "block", … */
  display: string;
  flexDirection: string;
  flexWrap: string;
  justifyContent: string;
  alignItems: string;
  rowGapPx: number;
  columnGapPx: number;
  /** [top, right, bottom, left] */
  paddingPx: [number, number, number, number];
  position: string;
  /** How this node behaves as its PARENT's flex/grid item. */
  flexGrow: number;
  flexShrink: number;
  flexBasis: string;
  alignSelf: string;
}

export interface FigmaSvgNode {
  /** Stable id used for SVG element ids / gradient-def ids / the export report. */
  id: string;
  /** Human label (from data-agent-native-layer-name or a fallback). */
  name?: string;
  kind: "box" | "text" | "image" | "raster" | "vector";
  rect: FigmaSvgRect;
  rotationDeg?: number;
  /**
   * The reflection a mirrored transform carries, applied about the rect centre
   * after the rotation. A rotation alone cannot express a mirror.
   */
  reflection?: [number, number, number, number];
  /** 0-1; omit or 1 for fully opaque. */
  opacity?: number;
  /**
   * A lone `blur(Npx)`. Figma's SVG importer maps `feGaussianBlur` to a real
   * LAYER_BLUR, so this survives the trip; any other filter is rasterized
   * instead, never dropped.
   */
  blurPx?: number;
  /** CSS `mix-blend-mode`, when it is not `normal`. Figma has native layer blend modes. */
  blendMode?: string;
  /** `pixelated` / `crisp-edges`, passed through to `<image>`. */
  imageRendering?: string;
  cornerRadii?: FigmaSvgCornerRadii;
  /** CSS order: index 0 is the TOPMOST paint layer (painted last in SVG). */
  fills?: FigmaSvgFillLayer[];
  border?: FigmaSvgBorder;
  outline?: FigmaSvgOutline;
  /** Non-inset drop shadows; inset shadows are reported as approximated/omitted. */
  shadows?: FigmaSvgShadow[];
  /** Children are clipped to this node's rounded box (CSS `overflow: hidden`). */
  clipsContent?: boolean;
  text?: { lines: FigmaSvgTextLine[]; style: FigmaSvgTextStyle };
  image?: {
    href: string;
    fit: "cover" | "contain" | "stretch";
    /** CSS `object-position`, so the export anchors it as the import did. */
    position?: string;
  };
  /** Fully rasterized fallback (video/canvas/iframe/backdrop-blur/other unsupported paint). */
  raster?: { href: string; reason: string };
  /** Sanitized markup of an inline `<svg>`, re-emitted verbatim at this rect. */
  vector?: { markup: string };
  /** CSS layout facts. Ignored by the SVG serializer, read by the Figma
   *  auto-layout node-spec builder. */
  layout?: FigmaSvgLayoutFacts;
  children?: FigmaSvgNode[];
}

export interface FigmaSvgExportReport {
  vectorized: string[];
  approximated: Array<{ node: string; note: string }>;
  rasterized: Array<{ node: string; reason: string }>;
  omitted: Array<{ node: string; reason: string }>;
  warnings: string[];
  /** One-time caveat surfaced regardless of whether any text node was found. */
  vectorizedTextCaveat: string;
}

// ---------------------------------------------------------------------------
// Small formatting helpers
// ---------------------------------------------------------------------------

/** Round to 3 decimal places and strip a trailing ".000"/trailing zeros. */
export function n(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}

export function escapeXmlAttr(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeXmlText(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function isUniformRadius(radii: FigmaSvgCornerRadii): boolean {
  // An ellipse has no uniform-`rx` <rect> form; it must go through the path.
  if (radii.ellipse) return false;
  return (
    radii.tl === radii.tr && radii.tr === radii.br && radii.br === radii.bl
  );
}

export function isZeroRadii(radii: FigmaSvgCornerRadii): boolean {
  return radii.tl === 0 && radii.tr === 0 && radii.br === 0 && radii.bl === 0;
}

export function clampRadius(radius: number, maxRadius: number): number {
  return Math.max(0, Math.min(radius, maxRadius));
}

// ---------------------------------------------------------------------------
// Rounded-rect path (per-corner radii) — SVG's `rx`/`ry` on <rect> is
// uniform-only, so any element with differing corner radii must be emitted
// as an explicit path built from four line/arc segments.
// ---------------------------------------------------------------------------

export function roundedRectPath(
  rect: FigmaSvgRect,
  radii: FigmaSvgCornerRadii,
): string {
  const { x, y, width, height } = rect;
  if (radii.ellipse) {
    const rx = width / 2;
    const ry = height / 2;
    // Two half-turn arcs, so `rx` and `ry` stay independent.
    return [
      `M ${n(x)} ${n(y + ry)}`,
      `A ${n(rx)} ${n(ry)} 0 0 1 ${n(x + width)} ${n(y + ry)}`,
      `A ${n(rx)} ${n(ry)} 0 0 1 ${n(x)} ${n(y + ry)}`,
      "Z",
    ].join(" ");
  }
  const maxR = Math.max(0, Math.min(width, height) / 2);
  const tl = clampRadius(radii.tl, maxR);
  const tr = clampRadius(radii.tr, maxR);
  const br = clampRadius(radii.br, maxR);
  const bl = clampRadius(radii.bl, maxR);
  const x2 = x + width;
  const y2 = y + height;

  return [
    `M ${n(x + tl)} ${n(y)}`,
    `L ${n(x2 - tr)} ${n(y)}`,
    tr > 0 ? `A ${n(tr)} ${n(tr)} 0 0 1 ${n(x2)} ${n(y + tr)}` : "",
    `L ${n(x2)} ${n(y2 - br)}`,
    br > 0 ? `A ${n(br)} ${n(br)} 0 0 1 ${n(x2 - br)} ${n(y2)}` : "",
    `L ${n(x + bl)} ${n(y2)}`,
    bl > 0 ? `A ${n(bl)} ${n(bl)} 0 0 1 ${n(x)} ${n(y2 - bl)}` : "",
    `L ${n(x)} ${n(y + tl)}`,
    tl > 0 ? `A ${n(tl)} ${n(tl)} 0 0 1 ${n(x + tl)} ${n(y)}` : "",
    "Z",
  ]
    .filter(Boolean)
    .join(" ");
}

// ---------------------------------------------------------------------------
// Border stroke geometry — CSS `border` paints INSIDE the box edge (the box's
// own width/height already include the border band). SVG strokes are
// centered on the path by default. Insetting the stroke's path by half the
// stroke width on every side makes the stroke's outer edge land exactly on
// the box's true edge and its inner edge land exactly border-width inside —
// i.e. pixel-identical to the CSS border band — while a separate full-rect
// fill shape (background-clip: border-box) still paints all the way to the
// true edge underneath it.
// ---------------------------------------------------------------------------

export function insetRectForStroke(
  rect: FigmaSvgRect,
  strokeWidth: number,
): FigmaSvgRect {
  const inset = strokeWidth / 2;
  const width = Math.max(0, rect.width - strokeWidth);
  const height = Math.max(0, rect.height - strokeWidth);
  return { x: rect.x + inset, y: rect.y + inset, width, height };
}

export function insetRadiiForStroke(
  radii: FigmaSvgCornerRadii,
  strokeWidth: number,
): FigmaSvgCornerRadii {
  const d = strokeWidth / 2;
  const clamp = (r: number) => Math.max(0, r - d);
  return {
    tl: clamp(radii.tl),
    tr: clamp(radii.tr),
    br: clamp(radii.br),
    bl: clamp(radii.bl),
  };
}

// ---------------------------------------------------------------------------
// Gradients
// ---------------------------------------------------------------------------

/**
 * CSS `0deg` points "to top"; SVG's default objectBoundingBox gradient
 * vector runs (0,0) -> (1,0), i.e. "to right", which is CSS's `90deg`.
 * Rotating that default vector by `(angleDeg - 90)` around the box center
 * reproduces the CSS direction exactly for a SQUARE element. For a
 * non-square element, objectBoundingBox first non-uniformly scales the unit
 * gradient vector to the box's aspect ratio before the rotation is applied,
 * which skews the visually-apparent angle — documented in the export report
 * as an approximation for non-square boxes, not a bug in this formula.
 */
export function gradientAngleToRotation(angleDeg: number): number {
  return (((angleDeg - 90) % 360) + 360) % 360;
}

/**
 * SVG 1.1 ignores the alpha channel of `stop-color` — opacity must travel in
 * `stop-opacity`. Chromium happens to honour a colour's alpha there, which is why a
 * Chromium-vs-Chromium diff never caught this, but Figma's SVG importer drops
 * it and every translucent gradient stop pastes in fully opaque.
 */
/**
 * CSS interpolates gradient stops in PREMULTIPLIED alpha, so a fade to
 * `transparent` keeps its neighbour's hue the whole way out. SVG — and Figma —
 * interpolate colour and opacity separately, which drags a fade-to-transparent
 * through black and changes both the tint and the apparent falloff.
 *
 * Giving a fully transparent stop its neighbour's colour (opacity still 0)
 * makes the two models agree exactly. This is the standard fix, not an
 * approximation.
 */
export function premultiplyTransparentStops(
  stops: FigmaSvgColorStop[],
): FigmaSvgColorStop[] {
  const alphaOf = (color: string) => parseCssColorExtended(color)?.a ?? 1;
  const transparentOf = (color: string) => {
    const parsed = parseCssColorExtended(color);
    return parsed
      ? // guard:allow-raw-color — SVG paint serializer: these emit literal color values into the exported document, they are not app UI
        `rgba(${Math.round(parsed.r)}, ${Math.round(parsed.g)}, ${Math.round(parsed.b)}, 0)`
      : color;
  };
  return stops.map((stop, index) => {
    if (alphaOf(stop.color) > 0) return stop;
    const before = stops
      .slice(0, index)
      .reverse()
      .find((s) => alphaOf(s.color) > 0);
    const after = stops.slice(index + 1).find((s) => alphaOf(s.color) > 0);
    const neighbour = before ?? after;
    return neighbour
      ? { ...stop, color: transparentOf(neighbour.color) }
      : stop;
  });
}

/**
 * SVG ignores the alpha channel of `fill`/`stroke` — opacity belongs in
 * `fill-opacity`/`stroke-opacity`. Chromium tolerates inline alpha there, which is
 * why a Chromium-vs-Chromium diff never caught it, but Figma's SVG importer
 * drops the alpha and every translucent fill, stroke and text colour pastes in
 * fully opaque.
 *
 * Returns the attribute pair: an opaque colour plus a separate opacity attr.
 * `url(#…)` paint references and `none` pass through untouched.
 */
export function paintAttributes(
  kind: "fill" | "stroke",
  color: string,
): string {
  if (!color || color === "none" || color.startsWith("url(")) {
    return `${kind}="${escapeXmlAttr(color || "none")}"`;
  }
  const parsed = parseCssColorExtended(color);
  if (!parsed) return `${kind}="${escapeXmlAttr(color)}"`;
  // guard:allow-raw-color — SVG paint serializer: these emit literal color values into the exported document, they are not app UI
  const rgb = `rgb(${Math.round(parsed.r)}, ${Math.round(parsed.g)}, ${Math.round(parsed.b)})`;
  const opacity = parsed.a < 1 ? ` ${kind}-opacity="${n(parsed.a)}"` : "";
  return `${kind}="${rgb}"${opacity}`;
}

function stopMarkup(rawStops: FigmaSvgColorStop[]): string {
  return premultiplyTransparentStops(rawStops)
    .map((s) => {
      const parsed = parseCssColorExtended(s.color);
      const color = parsed
        ? // guard:allow-raw-color — SVG paint serializer: these emit literal color values into the exported document, they are not app UI
          `rgb(${Math.round(parsed.r)}, ${Math.round(parsed.g)}, ${Math.round(parsed.b)})`
        : s.color;
      const opacity =
        parsed && parsed.a < 1 ? ` stop-opacity="${n(parsed.a)}"` : "";
      return `<stop offset="${n(s.offset * 100)}%" stop-color="${escapeXmlAttr(color)}"${opacity}/>`;
    })
    .join("");
}

/**
 * CSS linear-gradient geometry in user space.
 *
 * `objectBoundingBox` + `rotate()` — the previous approach — is only correct
 * on a square box: the bounding-box space is non-uniformly scaled, so a 45°
 * rotation in that space is not a 45° gradient on screen. Resolving the real
 * endpoints against the element's own width/height is exact at any aspect
 * ratio, and is also the form Figma's importer reads most faithfully.
 *
 * `angleDeg` follows CSS: 0deg points to the top, increasing clockwise.
 */
export function linearGradientEndpoints(
  angleDeg: number,
  width: number,
  height: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const radians = (angleDeg * Math.PI) / 180;
  // Screen space has y growing downwards, so "to top" is -y.
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  // The gradient line is long enough that its perpendiculars through the
  // endpoints touch the two corners nearest each end — the CSS definition.
  const length = Math.abs(width * dx) + Math.abs(height * dy);
  const cx = width / 2;
  const cy = height / 2;
  return {
    x1: cx - (dx * length) / 2,
    y1: cy - (dy * length) / 2,
    x2: cx + (dx * length) / 2,
    y2: cy + (dy * length) / 2,
  };
}

/**
 * CSS lets a colour stop sit outside the gradient line — `... 110.36%` is legal
 * and shifts where the ramp lands. SVG CLAMPS an offset to [0,1], so those
 * stops silently collapsed onto the ends and the ramp came out wrong. Extend
 * the gradient VECTOR to span the stops' real range and rescale the offsets
 * into [0,1]; the painted result is identical and nothing is clamped away.
 */
function spanOutOfRangeStops(stops: FigmaSvgColorStop[]): {
  stops: FigmaSvgColorStop[];
  lo: number;
  hi: number;
} {
  if (!stops.length) return { stops, lo: 0, hi: 1 };
  const lo = Math.min(0, ...stops.map((stop) => stop.offset));
  const hi = Math.max(1, ...stops.map((stop) => stop.offset));
  if (lo === 0 && hi === 1) return { stops, lo, hi };
  const span = hi - lo;
  return {
    lo,
    hi,
    stops: stops.map((stop) => ({
      ...stop,
      offset: (stop.offset - lo) / span,
    })),
  };
}

export function buildLinearGradientDef(
  id: string,
  angleDeg: number,
  stops: FigmaSvgColorStop[],
  box?: { x?: number; y?: number; width: number; height: number },
): string {
  const spanned = spanOutOfRangeStops(stops);
  stops = spanned.stops;
  if (box && box.width > 0 && box.height > 0) {
    const base = linearGradientEndpoints(angleDeg, box.width, box.height);
    const dx = base.x2 - base.x1;
    const dy = base.y2 - base.y1;
    const x1 = base.x1 + dx * spanned.lo;
    const y1 = base.y1 + dy * spanned.lo;
    const x2 = base.x1 + dx * spanned.hi;
    const y2 = base.y1 + dy * spanned.hi;
    // `userSpaceOnUse` resolves against the document's coordinate system, not
    // the element's box, so endpoints computed box-relative must be translated
    // to where the box actually sits. Without this a gradient on any element
    // away from the origin renders as a flat band of its last stop.
    const originX = box.x ?? 0;
    const originY = box.y ?? 0;
    return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(x1 + originX)}" y1="${n(y1 + originY)}" x2="${n(x2 + originX)}" y2="${n(y2 + originY)}">${stopMarkup(stops)}</linearGradient>`;
  }
  const rotation = gradientAngleToRotation(angleDeg);
  return `<linearGradient id="${id}" x1="${n(spanned.lo)}" y1="0" x2="${n(spanned.hi)}" y2="0" gradientTransform="rotate(${n(rotation)} 0.5 0.5)">${stopMarkup(stops)}</linearGradient>`;
}

export function buildRadialGradientDef(
  id: string,
  stops: FigmaSvgColorStop[],
  opts?: { cx?: number; cy?: number; r?: number; rx?: number; ry?: number },
): string {
  const cx = opts?.cx ?? 0.5;
  const cy = opts?.cy ?? 0.5;
  // An ellipse is a circle of radius rx scaled on y about the centre — the
  // only way SVG expresses a non-circular radial gradient.
  if (opts?.rx !== undefined && opts?.ry !== undefined && opts.rx > 0) {
    const scaleY = opts.ry / opts.rx;
    const transform = `translate(0 ${n(cy * (1 - scaleY))}) scale(1 ${n(scaleY)})`;
    return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(cx)}" cy="${n(cy)}" r="${n(opts.rx)}" gradientTransform="${transform}">${stopMarkup(stops)}</radialGradient>`;
  }
  const r = opts?.r ?? 0.5;
  const units = opts?.r !== undefined ? ` gradientUnits="userSpaceOnUse"` : "";
  return `<radialGradient id="${id}"${units} cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}">${stopMarkup(stops)}</radialGradient>`;
}

// ---------------------------------------------------------------------------
// Computed-style string parsers — pure, unit-testable without a browser.
// These assume Chromium's normalized `getComputedStyle` output (the engine
// `extractFigmaSvgScene` renders with), documented per-function.
// ---------------------------------------------------------------------------

// guard:allow-raw-color — exported SVG paint read from the design's own computed styles, never app UI
/** Split on top-level commas only — doesn't split inside `rgba(...)`/`rgb(...)` parens. */
export function splitTopLevelCommas(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const LENGTH_RE = /(-?[\d.]+)px/g;

/**
 * Parses Chromium's computed `box-shadow` — `<color> <dx> <dy> <blur>
 * <spread>` with the color first and an optional trailing `inset`, including
 * multiple comma-separated shadows.
 */
/**
 * A lone `filter: drop-shadow(<dx> <dy> <stdDeviation> <color>)`. The REST
 * importer emits it for a layer whose shadow Figma casts from its CONTENT and
 * does not knock out (`showShadowBehindNode`), which `box-shadow` cannot
 * express. The stdDeviation is doubled back into a box-shadow blur LENGTH so
 * the rest of this exporter can treat it like any other shadow.
 */
export function parseComputedDropShadowFilter(
  value: string | null | undefined,
  exact?: string | null,
): FigmaSvgShadow[] {
  if (!value || value === "none") return [];
  const match = /^drop-shadow\(\s*(.+?)\s*\)$/.exec(value.trim());
  if (!match?.[1]) return [];
  const inner = match[1];
  const colorMatch = inner.match(/(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})\s*$/);
  // guard:allow-raw-color — SVG paint serializer: a literal colour for the exported document, not app UI
  const color = colorMatch ? colorMatch[1] : "rgb(0, 0, 0)";
  const lengths = Array.from(
    (colorMatch ? inner.slice(0, colorMatch.index) : inner).matchAll(LENGTH_RE),
  ).map((m) => Number(m[1]));
  if (lengths.length < 2) return [];
  const fromFilter: FigmaSvgShadow = {
    offsetX: lengths[0] ?? 0,
    offsetY: lengths[1] ?? 0,
    blur: (lengths[2] ?? 0) * 2,
    spread: 0,
    color,
    castFromContent: true,
  };
  // `--figma-content-shadow` carries the spread `drop-shadow()` cannot, but a
  // custom property INHERITS: a descendant with a drop-shadow of its own sees
  // its ancestor's value, and a layer whose filter was edited afterwards still
  // carries the old one. Only trust it when it describes THIS filter, matched
  // on the offsets the two forms share.
  if (exact) {
    const declared = parseComputedBoxShadow(exact);
    const first = declared[0];
    if (
      declared.length === 1 &&
      first &&
      !first.inset &&
      Math.abs(first.offsetX - fromFilter.offsetX) < 0.51 &&
      Math.abs(first.offsetY - fromFilter.offsetY) < 0.51
    ) {
      return [{ ...first, castFromContent: true }];
    }
  }
  return [fromFilter];
}

export function parseComputedBoxShadow(
  value: string | null | undefined,
): FigmaSvgShadow[] {
  if (!value || value === "none") return [];
  return splitTopLevelCommas(value).map((part) => {
    const inset = /\binset\b/.test(part);
    const withoutInset = part.replace(/\binset\b/g, "").trim();
    const colorMatch = withoutInset.match(
      /^(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}|[a-zA-Z]+)/,
    );
    // guard:allow-raw-color — exported SVG paint read from the design's own computed styles, never app UI
    const color = colorMatch ? colorMatch[0] : "rgb(0, 0, 0)";
    const rest = colorMatch
      ? withoutInset.slice(colorMatch[0].length)
      : withoutInset;
    const lengths = Array.from(rest.matchAll(LENGTH_RE)).map((m) =>
      Number.parseFloat(m[1]),
    );
    const [offsetX = 0, offsetY = 0, blur = 0, spread = 0] = lengths;
    return { offsetX, offsetY, blur, spread, color, inset };
  });
}

const ANGLE_KEYWORDS: Record<string, number> = {
  "to top": 0,
  "to top right": 45,
  "to right top": 45,
  "to right": 90,
  "to bottom right": 135,
  "to right bottom": 135,
  "to bottom": 180,
  "to bottom left": 225,
  "to left bottom": 225,
  "to left": 270,
  "to top left": 315,
  "to left top": 315,
};

/** A stop before position defaulting: `offset` is null when CSS omitted it. */
interface ParsedColorStop {
  offset: number | null;
  color: string;
}

function parseColorStop(part: string): ParsedColorStop {
  const trimmed = part.trim();
  const percentMatch = trimmed.match(/(-?[\d.]+)%\s*$/);
  if (!percentMatch) return { offset: null, color: trimmed };
  const offset = Number.parseFloat(percentMatch[1]) / 100;
  const color = trimmed.slice(0, percentMatch.index).trim();
  return { offset, color };
}

/**
 * Applies the CSS gradient stop-position defaults: first stop 0, last stop 1,
 * runs of unpositioned stops spread evenly between their positioned
 * neighbours, and each position clamped to be no smaller than the one before.
 *
 * Chromium's computed `background-image` does NOT fill these in — it echoes
 * the authored stop list. Treating a missing position as 0 emitted
 * out-of-order SVG offsets, which browsers clamp up to the previous stop, so
 * a `linear-gradient` fading from transparent to a translucent ink rendered as a
 * hard-edged wedge instead of a soft fade.
 */
export function normalizeStopOffsets(
  stops: ParsedColorStop[],
): FigmaSvgColorStop[] {
  if (!stops.length) return [];
  const offsets: (number | null)[] = stops.map((stop) => stop.offset);
  if (offsets[0] === null) offsets[0] = 0;
  if (offsets[offsets.length - 1] === null) offsets[offsets.length - 1] = 1;

  for (let i = 0; i < offsets.length; i++) {
    if (offsets[i] !== null) continue;
    let end = i;
    while (offsets[end] === null) end++;
    const before = offsets[i - 1] as number;
    const after = offsets[end] as number;
    const steps = end - i + 1;
    for (let k = i; k < end; k++) {
      offsets[k] = before + ((after - before) * (k - i + 1)) / steps;
    }
    i = end - 1;
  }

  let previous = -Infinity;
  return stops.map((stop, index) => {
    const offset = Math.max(previous, offsets[index] as number);
    previous = offset;
    return { offset, color: stop.color };
  });
}

export interface ParsedGradient {
  angleDeg: number;
  stops: FigmaSvgColorStop[];
}

/**
 * Parses Chromium's computed `linear-gradient(...)` string. Assumes explicit
 * percentage stops, which Chromium always fills in on computed style even
 * when the source omitted them.
 */
export function parseComputedLinearGradient(
  value: string,
): ParsedGradient | null {
  const match = value.match(/linear-gradient\((.*)\)\s*$/s);
  if (!match) return null;
  const parts = splitTopLevelCommas(match[1]);
  let angleDeg = 180; // CSS default direction is "to bottom".
  let stopParts = parts;
  const first = (parts[0] ?? "").trim();
  const degMatch = first.match(/^(-?[\d.]+)deg$/);
  if (degMatch) {
    angleDeg = Number.parseFloat(degMatch[1]);
    stopParts = parts.slice(1);
  } else if (/^to\s/.test(first) && first in ANGLE_KEYWORDS) {
    angleDeg = ANGLE_KEYWORDS[first];
    stopParts = parts.slice(1);
  }
  return {
    angleDeg,
    stops: normalizeStopOffsets(stopParts.map(parseColorStop)),
  };
}

export type RadialExtent =
  | "closest-side"
  | "closest-corner"
  | "farthest-side"
  | "farthest-corner";

export interface ParsedRadialGradient {
  shape: "circle" | "ellipse";
  extent: RadialExtent;
  /** Explicit `<length-percentage>` size, when the source gave one instead of a keyword. */
  size?: { x: string; y?: string };
  /** CSS `at <position>`, defaulting to the element centre. */
  position: { x: string; y: string };
  stops: FigmaSvgColorStop[];
}

const RADIAL_POSITION_KEYWORDS: Record<string, string> = {
  left: "0%",
  top: "0%",
  center: "50%",
  right: "100%",
  bottom: "100%",
};

/**
 * Parses Chromium's computed `radial-gradient(...)` string, including shape,
 * extent keyword, explicit size, and `at <position>`.
 *
 * These were previously discarded and every radial gradient was emitted as a
 * centred circle spanning the bounding box, which moved and resized any
 * off-centre gradient. SVG `<radialGradient>` expresses all of it exactly, so
 * this is a real mapping rather than an approximation.
 */
export function parseComputedRadialGradient(
  value: string,
): ParsedRadialGradient | null {
  const match = value.match(/radial-gradient\((.*)\)\s*$/s);
  if (!match) return null;
  const parts = splitTopLevelCommas(match[1]);

  let shape: "circle" | "ellipse" = "ellipse";
  let extent: RadialExtent = "farthest-corner";
  let size: { x: string; y?: string } | undefined;
  let position = { x: "50%", y: "50%" };
  let stopParts = parts;

  const head = (parts[0] ?? "").trim();
  // The head is a configuration clause only when it names a shape, an extent,
  // an explicit size, or an `at` position — otherwise it is the first stop.
  if (
    /^(circle|ellipse)\b|\bat\b|^(closest|farthest)-(side|corner)\b|^[\d.]/.test(
      head,
    )
  ) {
    stopParts = parts.slice(1);
    const [geometry, positionText] = head.split(/\bat\b/);
    const tokens = geometry.trim().split(/\s+/).filter(Boolean);
    const sizeTokens: string[] = [];
    for (const token of tokens) {
      if (token === "circle" || token === "ellipse") shape = token;
      else if (/^(closest|farthest)-(side|corner)$/.test(token))
        extent = token as RadialExtent;
      else if (/^[\d.]/.test(token)) sizeTokens.push(token);
    }
    if (sizeTokens.length) {
      size = { x: sizeTokens[0], y: sizeTokens[1] };
      if (!tokens.includes("circle") && sizeTokens.length > 1)
        shape = "ellipse";
      else if (sizeTokens.length === 1 && !tokens.includes("ellipse"))
        shape = "circle";
    }
    if (positionText) {
      const positionTokens = positionText.trim().split(/\s+/).filter(Boolean);
      const resolved = positionTokens.map(
        (t) => RADIAL_POSITION_KEYWORDS[t] ?? t,
      );
      // A single value sets x and centres y (CSS `at 30px`).
      position = { x: resolved[0] ?? "50%", y: resolved[1] ?? "50%" };
      if (
        positionTokens.length === 1 &&
        /^(top|bottom)$/.test(positionTokens[0])
      ) {
        position = { x: "50%", y: resolved[0] };
      }
    }
  }

  return {
    shape,
    extent,
    size,
    position,
    stops: normalizeStopOffsets(stopParts.map(parseColorStop)),
  };
}

/** Resolves a CSS `<length-percentage>` against one axis of the box. */
function resolveLengthPercentage(value: string, basis: number): number {
  if (value.endsWith("%")) return (Number.parseFloat(value) / 100) * basis;
  return Number.parseFloat(value);
}

/**
 * Resolves a parsed radial gradient to concrete user-space geometry for the
 * element's box, following the CSS sizing rules for each extent keyword.
 */
export function resolveRadialGradientGeometry(
  gradient: ParsedRadialGradient,
  width: number,
  height: number,
): { cx: number; cy: number; rx: number; ry: number } {
  const cx = resolveLengthPercentage(gradient.position.x, width);
  const cy = resolveLengthPercentage(gradient.position.y, height);

  if (gradient.size) {
    const rx = resolveLengthPercentage(gradient.size.x, width);
    const ry = gradient.size.y
      ? resolveLengthPercentage(gradient.size.y, height)
      : rx;
    return { cx, cy, rx, ry };
  }

  const dxLeft = Math.abs(cx);
  const dxRight = Math.abs(width - cx);
  const dyTop = Math.abs(cy);
  const dyBottom = Math.abs(height - cy);
  const nearX = Math.min(dxLeft, dxRight);
  const farX = Math.max(dxLeft, dxRight);
  const nearY = Math.min(dyTop, dyBottom);
  const farY = Math.max(dyTop, dyBottom);

  if (gradient.shape === "circle") {
    const radius =
      gradient.extent === "closest-side"
        ? Math.min(nearX, nearY)
        : gradient.extent === "farthest-side"
          ? Math.max(farX, farY)
          : gradient.extent === "closest-corner"
            ? Math.hypot(nearX, nearY)
            : Math.hypot(farX, farY);
    return { cx, cy, rx: radius, ry: radius };
  }

  if (gradient.extent === "closest-side")
    return { cx, cy, rx: nearX, ry: nearY };
  if (gradient.extent === "farthest-side")
    return { cx, cy, rx: farX, ry: farY };
  // Corner extents keep the closest/farthest-side aspect ratio and scale it
  // out until the ellipse passes through that corner.
  const [sideX, sideY] =
    gradient.extent === "closest-corner" ? [nearX, nearY] : [farX, farY];
  if (!sideX || !sideY) return { cx, cy, rx: sideX, ry: sideY };
  const scale = Math.SQRT2;
  return { cx, cy, rx: sideX * scale, ry: sideY * scale };
}

// ---------------------------------------------------------------------------
// object-fit -> preserveAspectRatio
// ---------------------------------------------------------------------------

/**
 * SVG `preserveAspectRatio="... slice"` clips content to the image's own
 * x/y/width/height viewport, which reproduces CSS `object-fit: cover`
 * exactly with no extra `<clipPath>` needed. `object-position` is not
 * modeled beyond the common `center` case (always emits `xMidYMid`) —
 * approximated for any other alignment.
 */
export function objectFitToPreserveAspectRatio(
  fit: "cover" | "contain" | "stretch" | "none" | "scale-down",
  /** CSS `object-position`; only the top-left anchor differs from the default. */
  position?: string,
): string {
  if (fit === "stretch" || fit === "none") return "none";
  // The importer anchors a fallback render top-left, because Figma's
  // `absoluteRenderBounds` states where the ink STARTS. Centring it here
  // instead moved the artwork back — 1.26 points of round-trip drift on one
  // product page, where the export no longer reproduced the import.
  const align = isTopLeftObjectPosition(position) ? "xMinYMin" : "xMidYMid";
  if (fit === "contain" || fit === "scale-down") return `${align} meet`;
  return `${align} slice`; // cover (default)
}

function isTopLeftObjectPosition(position: string | undefined): boolean {
  if (!position) return false;
  const [x, y] = position.trim().split(/\s+/);
  const atStart = (v: string | undefined) =>
    v === "0px" || v === "0%" || v === "0" || v === "left" || v === "top";
  return atStart(x) && atStart(y ?? x);
}

// ---------------------------------------------------------------------------
// Shadow filter defs
// ---------------------------------------------------------------------------

function floodColorParts(color: string): {
  floodColor: string;
  floodOpacity: number;
} {
  const parsed = parseCssColorExtended(color);
  if (!parsed) return { floodColor: color, floodOpacity: 1 };
  return {
    // guard:allow-raw-color — exported SVG paint read from the design's own computed styles, never app UI
    floodColor: `rgb(${Math.round(parsed.r)}, ${Math.round(parsed.g)}, ${Math.round(parsed.b)})`,
    floodOpacity: parsed.a,
  };
}

// ---------------------------------------------------------------------------
// Node renderer
// ---------------------------------------------------------------------------

interface RenderCtx {
  defs: string[];
  report: FigmaSvgExportReport;
  nextId: (prefix: string) => string;
}

function wrapGroup(
  markup: string,
  node: Pick<
    FigmaSvgNode,
    "rect" | "rotationDeg" | "reflection" | "opacity" | "blurPx" | "blendMode"
  >,
  ctx?: RenderCtx,
): string {
  const attrs: string[] = [];
  if (node.blurPx !== undefined && node.blurPx > 0 && ctx) {
    const id = ctx.nextId("blur");
    ctx.defs.push(buildBlurFilterDef(id, node.blurPx));
    attrs.push(`filter="url(#${id})"`);
  }
  if (node.blendMode && node.blendMode !== "normal") {
    // CSS Compositing applies to SVG content, and Figma imports it as the
    // layer's own blend mode.
    attrs.push(`style="mix-blend-mode:${node.blendMode}"`);
  }
  if (node.rotationDeg || node.reflection) {
    const cx = node.rect.x + node.rect.width / 2;
    const cy = node.rect.y + node.rect.height / 2;
    const parts: string[] = [];
    if (node.rotationDeg) {
      parts.push(`rotate(${n(node.rotationDeg)} ${n(cx)} ${n(cy)})`);
    }
    if (node.reflection) {
      const [a, b, c, d] = node.reflection;
      parts.push(
        `translate(${n(cx)} ${n(cy)}) matrix(${n(a)} ${n(b)} ${n(c)} ${n(d)} 0 0) translate(${n(-cx)} ${n(-cy)})`,
      );
    }
    attrs.push(`transform="${parts.join(" ")}"`);
  }
  if (node.opacity !== undefined && node.opacity !== 1) {
    attrs.push(`opacity="${n(node.opacity)}"`);
  }
  if (attrs.length === 0) return markup;
  return `<g ${attrs.join(" ")}>${markup}</g>`;
}

function resolveFillPaint(
  fill: FigmaSvgFillLayer,
  node: FigmaSvgNode,
  ctx: RenderCtx,
): string {
  if (fill.kind === "solid") return fill.color;

  if (fill.kind === "linear-gradient") {
    const id = ctx.nextId("lg");
    ctx.defs.push(
      buildLinearGradientDef(id, fill.angleDeg, fill.stops, node.rect),
    );
    return `url(#${id})`;
  }

  if (fill.kind === "radial-gradient") {
    const id = ctx.nextId("rg");
    if (fill.geometry && node.rect.width > 0 && node.rect.height > 0) {
      const local = resolveRadialGradientGeometry(
        fill.geometry,
        node.rect.width,
        node.rect.height,
      );
      // Same userSpaceOnUse translation as the linear case.
      const cx = local.cx + node.rect.x;
      const cy = local.cy + node.rect.y;
      ctx.defs.push(
        Math.abs(local.rx - local.ry) < 0.01
          ? buildRadialGradientDef(id, fill.stops, { cx, cy, r: local.rx })
          : buildRadialGradientDef(id, fill.stops, {
              cx,
              cy,
              rx: local.rx,
              ry: local.ry,
            }),
      );
    } else {
      ctx.defs.push(
        buildRadialGradientDef(id, fill.stops, {
          cx: fill.cx,
          cy: fill.cy,
          r: fill.r,
        }),
      );
      ctx.report.approximated.push({
        node: node.name || node.id,
        note: "Radial gradient geometry unavailable; approximated as a centered circle over the element's bounding box.",
      });
    }
    return `url(#${id})`;
  }

  if (fill.kind === "unsupported") {
    ctx.report.omitted.push({
      node: node.name || node.id,
      reason: `Background layer has no SVG equivalent and was not exported: ${fill.css.slice(0, 120)}`,
    });
    return "none";
  }

  // image fill
  //
  // An href that no consumer can resolve must not become an `<image>`. The
  // clipboard import cannot carry image bytes, so it points unresolved fills
  // at `about:blank` until `hydrate-figma-paste-images` fills them in; passing
  // that straight through hands Figma a broken reference, and a renderer whose
  // own document URL is `about:blank` resolves it to the document ITSELF and
  // paints a recursive smear of the page where the design has a placeholder.
  // Report the gap instead — an absent image and an unresolvable one are the
  // same fact, and neither is "here is a picture".
  if (!/^(https?:|data:|blob:)/i.test(fill.href.trim())) {
    ctx.report.omitted.push({
      node: node.name || node.id,
      reason:
        `Image fill has no resolvable source (${fill.href.slice(0, 60) || "empty"}); ` +
        `left unpainted rather than exported as a broken reference.`,
    });
    return "none";
  }
  const id = ctx.nextId("img-fill");
  const par = objectFitToPreserveAspectRatio(fill.fit);
  // A Figma TILE fill: the image is drawn at its own size and repeated, which
  // is exactly an SVG pattern whose tile IS that size. Pattern content is
  // tile-relative under `userSpaceOnUse`, so the image sits at the tile origin
  // while the tile itself is anchored to the box. This must precede the CROP
  // branch below, which would otherwise claim the same explicit pixel size and
  // draw one copy.
  if (fill.repeat) {
    if (!fill.sizePx) {
      // `background-size: auto` leaves the tile size unknown here. Falling
      // through to `cover` draws one stretched copy over the node's whole
      // fill area; an unknown tile size and a full-bleed image are not the
      // same fact, so say so rather than paint a confident wrong answer.
      ctx.report.approximated.push({
        node: node.name || node.id,
        note:
          "Tiled (TILE) image fill exported as a single covering image: the " +
          "computed background-size was `auto`, so the tile's intrinsic size " +
          "is unknown at export time and the repeat could not be reproduced.",
      });
    } else {
      ctx.defs.push(
        `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${n(node.rect.x)}" y="${n(node.rect.y)}" width="${n(fill.sizePx.width)}" height="${n(fill.sizePx.height)}">` +
          `<image href="${escapeXmlAttr(fill.href)}" x="0" y="0" width="${n(fill.sizePx.width)}" height="${n(fill.sizePx.height)}" preserveAspectRatio="none"${
            node.imageRendering
              ? ` image-rendering="${node.imageRendering}"`
              : ""
          }/></pattern>`,
      );
      return `url(#${id})`;
    }
  }
  // An explicit pixel size is Figma's CROP: the image is drawn at that size at
  // that offset, not fitted to the box. `objectBoundingBox` cannot express it,
  // so place the image in user space instead — exactly, with no approximation
  // note, because there is nothing approximate about it.
  if (fill.sizePx) {
    const offset = fill.offsetPx ?? { x: 0, y: 0 };
    ctx.defs.push(
      `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${n(node.rect.x)}" y="${n(node.rect.y)}" width="${n(node.rect.width)}" height="${n(node.rect.height)}">` +
        `<image href="${escapeXmlAttr(fill.href)}" x="${n(offset.x)}" y="${n(offset.y)}" width="${n(fill.sizePx.width)}" height="${n(fill.sizePx.height)}" preserveAspectRatio="none"${
          node.imageRendering ? ` image-rendering="${node.imageRendering}"` : ""
        }/></pattern>`,
    );
    return `url(#${id})`;
  }
  // Figma magnifies an image fill with nearest-neighbour sampling and the
  // importer asks for it with `image-rendering`; dropping it here would smooth
  // on the way back out what the import deliberately kept crisp.
  const rendering = node.imageRendering
    ? ` image-rendering="${node.imageRendering}"`
    : "";
  ctx.defs.push(
    `<pattern id="${id}" patternUnits="objectBoundingBox" width="1" height="1"><image href="${escapeXmlAttr(fill.href)}" x="0" y="0" width="${n(node.rect.width)}" height="${n(node.rect.height)}" preserveAspectRatio="${par}"${rendering}/></pattern>`,
  );
  ctx.report.approximated.push({
    node: node.name || node.id,
    note: "Background-image fill approximated via an objectBoundingBox pattern; exact cover/contain cropping may differ from the browser for extreme aspect ratios.",
  });
  return `url(#${id})`;
}

/**
 * Fills, shadow filter and border for a node's own box. Shared by box and
 * text-leaf rendering — a button is both, and rendering it as text alone drops
 * its background.
 */
/**
 * A plain blur filter, the one filter primitive Figma's SVG importer maps to
 * something meaningful (a LAYER_BLUR on the filtered node).
 */
export function buildBlurFilterDef(id: string, stdDeviation: number): string {
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${n(stdDeviation)}"/></filter>`;
}

/** Grows (or shrinks) a rect uniformly, as CSS box-shadow `spread` does. */
export function inflateRect(rect: FigmaSvgRect, by: number): FigmaSvgRect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: Math.max(0, rect.width + by * 2),
    height: Math.max(0, rect.height + by * 2),
  };
}

/** Corner radii follow the spread, never going negative. */
export function inflateRadii(
  radii: FigmaSvgCornerRadii,
  by: number,
): FigmaSvgCornerRadii {
  return {
    tl: Math.max(0, radii.tl + by),
    tr: Math.max(0, radii.tr + by),
    br: Math.max(0, radii.br + by),
    bl: Math.max(0, radii.bl + by),
  };
}

/**
 * Shadows as real geometry rather than a filter on the shape.
 *
 * Figma's SVG importer does not import shadows at all: every `feDropShadow`
 * variant tested produced zero effects, and a composed
 * feMorphology/feGaussianBlur/feOffset/feFlood chain was mapped to a
 * LAYER_BLUR that blurs the element itself — worse than losing the shadow.
 * A blurred, offset, spread-adjusted copy of the shape painted *behind* the
 * shape renders identically in a browser and arrives in Figma as a blurred
 * layer behind the shape, which is what a drop shadow looks like.
 *
 * Spread is applied to the geometry, so `feMorphology` is no longer needed.
 */
/**
 * The shadow of a subtree, cast from the subtree's own alpha: erode/dilate for
 * spread, flood the shadow colour through that alpha, blur, offset by the
 * wrapping transform. Not knocked out under the node, which is the half CSS
 * `box-shadow` cannot do. Figma's SVG importer reads the blur as a LAYER_BLUR
 * on a duplicated layer behind the real one — the same bargain
 * `shadowGeometryMarkup` already makes for a box, with the shape corrected.
 */
function contentShadowMarkup(
  node: FigmaSvgNode,
  ctx: RenderCtx,
  childrenMarkup: string,
): string {
  if (!childrenMarkup) return "";
  return (node.shadows ?? [])
    .filter((shadow) => shadow.castFromContent && !shadow.inset)
    .slice()
    .reverse()
    .map((shadow) => {
      const id = ctx.nextId("cshadow");
      const parsed = parseCssColorExtended(shadow.color);
      const rgb = parsed
        ? // guard:allow-raw-color — SVG paint serializer: a literal colour for the exported document, not app UI
          `rgb(${Math.round(parsed.r)}, ${Math.round(parsed.g)}, ${Math.round(parsed.b)})`
        : shadow.color;
      const alpha = parsed ? parsed.a : 1;
      const morph =
        Math.abs(shadow.spread) > 1e-6
          ? `<feMorphology in="SourceAlpha" operator="${shadow.spread > 0 ? "dilate" : "erode"}" radius="${n(Math.abs(shadow.spread))}" result="sp"/>`
          : "";
      // A percentage region is a fraction of the subtree's own bounds, so a
      // small icon with a large offset or blur had its shadow clipped. Size the
      // region in user space from the geometry that actually bleeds: the
      // offset, the blur (3 standard deviations covers it) and the spread.
      const bleed =
        Math.abs(shadow.offsetX) +
        Math.abs(shadow.offsetY) +
        shadow.blur * 1.5 +
        Math.abs(shadow.spread) +
        2;
      // From what the subtree actually PAINTS, not the parent's own box: a
      // transparent, unclipped container whose child overflows casts a shadow
      // outside that box, and anchoring the region to the box clipped it.
      // Clipping is respected — a clipping parent's children cannot paint
      // outside it anyway.
      const painted = node.clipsContent
        ? node.rect
        : (node.children ?? []).reduce(
            (box, child) => {
              const right = Math.max(
                box.x + box.width,
                child.rect.x + child.rect.width,
              );
              const bottom = Math.max(
                box.y + box.height,
                child.rect.y + child.rect.height,
              );
              const x = Math.min(box.x, child.rect.x);
              const y = Math.min(box.y, child.rect.y);
              return { x, y, width: right - x, height: bottom - y };
            },
            { ...node.rect },
          );
      ctx.defs.push(
        `<filter id="${id}" filterUnits="userSpaceOnUse" x="${n(painted.x - bleed)}" y="${n(painted.y - bleed)}" width="${n(painted.width + bleed * 2)}" height="${n(painted.height + bleed * 2)}">` +
          morph +
          `<feFlood flood-color="${escapeXmlAttr(rgb)}" flood-opacity="${n(alpha)}" result="fl"/>` +
          `<feComposite in="fl" in2="${morph ? "sp" : "SourceAlpha"}" operator="in" result="tint"/>` +
          `<feGaussianBlur in="tint" stdDeviation="${n(shadow.blur / 2)}"/>` +
          `</filter>`,
      );
      const move =
        shadow.offsetX || shadow.offsetY
          ? ` transform="translate(${n(shadow.offsetX)} ${n(shadow.offsetY)})"`
          : "";
      return `<g${move} filter="url(#${id})">${childrenMarkup}</g>`;
    })
    .join("");
}

function shadowGeometryMarkup(
  node: FigmaSvgNode,
  ctx: RenderCtx,
  shape: (
    rect: FigmaSvgRect,
    radii: FigmaSvgCornerRadii,
    paint: string,
    extra: string,
  ) => string,
): { behind: string; inside: string } {
  const shadows = node.shadows ?? [];
  if (!shadows.length) return { behind: "", inside: "" };
  const rect = node.rect;
  const radii = node.cornerRadii ?? ZERO_RADII;

  // CSS paints the first-listed shadow on top, so emit in reverse.
  // A content-cast shadow is drawn in `renderBox` from the subtree's own alpha;
  // painting a copy of the box here too would put a rectangle behind it.
  const outer = shadows.filter((s) => !s.inset && !s.castFromContent);
  // CSS clips an outer box-shadow to OUTSIDE the border box (CSS Backgrounds 3
  // §7.1.1). Painting the blurred copy under the fill instead let it show
  // through anything non-opaque — a shadow-only card, or any translucent
  // "glass" fill, showed its own shadow through its middle. Knock the shape out
  // of the shadow layer with an evenodd clip, mirroring the inset branch below.
  let outerClipAttr = "";
  if (outer.length) {
    const bleed =
      Math.max(rect.width, rect.height) +
      Math.max(
        ...outer.map(
          (s) =>
            Math.abs(s.offsetX) +
            Math.abs(s.offsetY) +
            s.blur * 2 +
            Math.abs(s.spread),
        ),
      ) +
      16;
    const knockoutId = ctx.nextId("clip");
    ctx.defs.push(
      `<clipPath id="${knockoutId}"><path clip-rule="evenodd" d="M ${n(rect.x - bleed)} ${n(rect.y - bleed)} H ${n(rect.x + rect.width + bleed)} V ${n(rect.y + rect.height + bleed)} H ${n(rect.x - bleed)} Z ${roundedRectPath(rect, radii)}"/></clipPath>`,
    );
    outerClipAttr = ` clip-path="url(#${knockoutId})"`;
  }

  const behind = outer
    .slice()
    .reverse()
    .map((s) => {
      const offsetRect = inflateRect(
        { ...rect, x: rect.x + s.offsetX, y: rect.y + s.offsetY },
        s.spread,
      );
      if (!offsetRect.width || !offsetRect.height) return "";
      let blurAttr = "";
      if (s.blur > 0) {
        const blurId = ctx.nextId("blur");
        ctx.defs.push(buildBlurFilterDef(blurId, s.blur / 2));
        blurAttr = ` filter="url(#${blurId})"`;
      }
      return shape(
        offsetRect,
        inflateRadii(radii, s.spread),
        s.color,
        blurAttr,
      );
    })
    .join("");
  const behindClipped = behind ? `<g${outerClipAttr}>${behind}</g>` : "";

  // An inset shadow is the same idea inverted: fill everything OUTSIDE the
  // shape, blur it, and clip the result back to the shape.
  const inside = shadows
    .filter((s) => s.inset)
    .slice()
    .reverse()
    .map((s) => {
      const innerRect = inflateRect(
        { ...rect, x: rect.x + s.offsetX, y: rect.y + s.offsetY },
        -s.spread,
      );
      if (!innerRect.width || !innerRect.height) return "";
      const bleed = Math.max(rect.width, rect.height) + s.blur * 4 + 16;
      const outer: FigmaSvgRect = {
        x: rect.x - bleed,
        y: rect.y - bleed,
        width: rect.width + bleed * 2,
        height: rect.height + bleed * 2,
      };
      const ringPath =
        `M ${n(outer.x)} ${n(outer.y)} H ${n(outer.x + outer.width)} V ${n(outer.y + outer.height)} H ${n(outer.x)} Z ` +
        roundedRectPath(innerRect, inflateRadii(radii, -s.spread));
      let blurAttr = "";
      if (s.blur > 0) {
        const blurId = ctx.nextId("blur");
        ctx.defs.push(buildBlurFilterDef(blurId, s.blur / 2));
        blurAttr = ` filter="url(#${blurId})"`;
      }
      const clipId = ctx.nextId("clip");
      ctx.defs.push(
        `<clipPath id="${clipId}">${isUniformRadius(radii) ? `<rect x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.width)}" height="${n(rect.height)}"${radii.tl ? ` rx="${n(radii.tl)}"` : ""}/>` : `<path d="${roundedRectPath(rect, radii)}"/>`}</clipPath>`,
      );
      return `<g clip-path="url(#${clipId})"><path d="${ringPath}" fill-rule="evenodd" ${paintAttributes("fill", s.color)}${blurAttr}/></g>`;
    })
    .join("");

  return { behind: behindClipped, inside };
}

function boxPaintMarkup(node: FigmaSvgNode, ctx: RenderCtx): string {
  const rect = node.rect;
  const radii = node.cornerRadii ?? ZERO_RADII;
  const fills = node.fills ?? [];

  const fillTag = (
    r: FigmaSvgRect,
    radiiForShape: FigmaSvgCornerRadii,
    paint: string,
    filterAttr: string,
  ) =>
    isUniformRadius(radiiForShape)
      ? `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.width)}" height="${n(r.height)}"${radiiForShape.tl ? ` rx="${n(radiiForShape.tl)}"` : ""} ${paintAttributes("fill", paint)}${filterAttr}/>`
      : `<path d="${roundedRectPath(r, radiiForShape)}" ${paintAttributes("fill", paint)}${filterAttr}/>`;

  const shadowMarkup = shadowGeometryMarkup(node, ctx, (r, rr, paint, extra) =>
    fillTag(r, rr, paint, extra),
  );

  // CSS background layer 0 is the TOPMOST paint; SVG paints later elements
  // on top, so emit layers in reverse (last CSS layer first). Only the
  // topmost (last-emitted) shape carries the shadow filter — lower layers
  // must not double-apply it.
  //
  // A box with no fills and no border is a pure layout wrapper — a flex
  // container div, or <body> itself when exporting a whole screen — that
  // paints nothing in the browser. Emitting a `fill="none"` placeholder shape
  // for it anyway produces a phantom layer Figma imports as a real (if
  // invisible) shape at whatever oversized bounds that wrapper happens to
  // have. Shadows no longer need a carrier shape: they are their own geometry.
  const reversedLayers = fills.slice().reverse();
  let body =
    shadowMarkup.behind +
    reversedLayers
      .map((f) => fillTag(rect, radii, resolveFillPaint(f, node, ctx), ""))
      .join("");

  // CSS paints an outline as a band starting `outline-offset` from the border
  // box and running `outline-width` outward, so its centre line sits at
  // offset + width/2. An SVG stroke straddles its path, so putting the path
  // there with the same width reproduces it exactly — including the negative
  // offset the Figma importer uses for a CENTER-aligned stroke.
  if (node.outline) {
    const grow = node.outline.offsetPx + node.outline.widthPx / 2;
    const outlineRect = inflateRect(rect, grow);
    const outlineRadii = inflateRadii(radii, grow);
    const dash = node.outline.dashed
      ? ` stroke-dasharray="${n(node.outline.widthPx * 2)} ${n(node.outline.widthPx)}"`
      : "";
    body += isUniformRadius(outlineRadii)
      ? `<rect x="${n(outlineRect.x)}" y="${n(outlineRect.y)}" width="${n(outlineRect.width)}" height="${n(outlineRect.height)}"${outlineRadii.tl ? ` rx="${n(outlineRadii.tl)}"` : ""} fill="none" ${paintAttributes("stroke", node.outline.color)} stroke-width="${n(node.outline.widthPx)}"${dash}/>`
      : `<path d="${roundedRectPath(outlineRect, outlineRadii)}" fill="none" ${paintAttributes("stroke", node.outline.color)} stroke-width="${n(node.outline.widthPx)}"${dash}/>`;
  }

  body += shadowMarkup.inside;

  if (node.border?.sides) {
    // Draw each edge that actually exists. A stroke straddles its path, so
    // each segment sits half a width inside the box to land where CSS puts it.
    const [top, right, bottom, left] = node.border.sides;
    const r = rect;
    const segment = (
      side: { widthPx: number; color: string; dashed: boolean },
      x1: number,
      y1: number,
      x2: number,
      y2: number,
    ) => {
      const dash = side.dashed
        ? ` stroke-dasharray="${n(side.widthPx * 2)} ${n(side.widthPx)}"`
        : "";
      return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" ${paintAttributes("stroke", side.color)} stroke-width="${n(side.widthPx)}"${dash}/>`;
    };
    if (top)
      body += segment(
        top,
        r.x,
        r.y + top.widthPx / 2,
        r.x + r.width,
        r.y + top.widthPx / 2,
      );
    if (right)
      body += segment(
        right,
        r.x + r.width - right.widthPx / 2,
        r.y,
        r.x + r.width - right.widthPx / 2,
        r.y + r.height,
      );
    if (bottom)
      body += segment(
        bottom,
        r.x,
        r.y + r.height - bottom.widthPx / 2,
        r.x + r.width,
        r.y + r.height - bottom.widthPx / 2,
      );
    if (left)
      body += segment(
        left,
        r.x + left.widthPx / 2,
        r.y,
        r.x + left.widthPx / 2,
        r.y + r.height,
      );
    if (!isZeroRadii(radii)) {
      ctx.report.approximated.push({
        node: node.name || node.id,
        note: "Per-side borders on a rounded box are drawn as straight segments; CSS miters them into the corner arcs.",
      });
    }
  } else if (node.border && node.border.widthPx > 0) {
    const insetRect = insetRectForStroke(rect, node.border.widthPx);
    const insetRadii = insetRadiiForStroke(radii, node.border.widthPx);
    const dash = node.border.dashed
      ? ` stroke-dasharray="${n(node.border.widthPx * 2)} ${n(node.border.widthPx)}"`
      : "";
    body += isUniformRadius(insetRadii)
      ? `<rect x="${n(insetRect.x)}" y="${n(insetRect.y)}" width="${n(insetRect.width)}" height="${n(insetRect.height)}"${insetRadii.tl ? ` rx="${n(insetRadii.tl)}"` : ""} fill="none" ${paintAttributes("stroke", node.border.color)} stroke-width="${n(node.border.widthPx)}"${dash}/>`
      : `<path d="${roundedRectPath(insetRect, insetRadii)}" fill="none" ${paintAttributes("stroke", node.border.color)} stroke-width="${n(node.border.widthPx)}"${dash}/>`;
    if (node.border.nonUniform) {
      ctx.report.approximated.push({
        node: node.name || node.id,
        note: "Border had differing per-side width/color/style; rendered using one representative side.",
      });
    }
  }

  return body;
}

function renderBox(node: FigmaSvgNode, ctx: RenderCtx): string {
  const body = boxPaintMarkup(node, ctx);
  ctx.report.vectorized.push(node.name || node.id);

  let childrenMarkup = (node.children ?? [])
    .map((child) => renderFigmaSvgNode(child, ctx))
    .join("");

  // CSS `overflow: hidden` was not expressed at all, so anything a container
  // cropped — a rotated colour bleed, an oversized image, a scrolling list —
  // escaped its box in the export and painted over the rest of the screen.
  if (node.clipsContent && childrenMarkup) {
    const radii = node.cornerRadii ?? ZERO_RADII;
    const clipId = ctx.nextId("clip");
    const shape = isZeroRadii(radii)
      ? `<rect x="${n(node.rect.x)}" y="${n(node.rect.y)}" width="${n(node.rect.width)}" height="${n(node.rect.height)}"/>`
      : isUniformRadius(radii)
        ? `<rect x="${n(node.rect.x)}" y="${n(node.rect.y)}" width="${n(node.rect.width)}" height="${n(node.rect.height)}" rx="${n(radii.tl)}"/>`
        : `<path d="${roundedRectPath(node.rect, radii)}"/>`;
    ctx.defs.push(`<clipPath id="${clipId}">${shape}</clipPath>`);
    childrenMarkup = `<g clip-path="url(#${clipId})">${childrenMarkup}</g>`;
  }

  // A container that also owns direct text (an icon plus its label, a row plus
  // its badge) paints that text alongside its children.
  const ownText = node.text ? renderTextMarkup(node, ctx) : "";
  // The browser's filter reads the element's WHOLE alpha, its own text
  // included, so the shadow source has to be everything the node paints.
  const contentShadow = contentShadowMarkup(
    node,
    ctx,
    childrenMarkup + ownText,
  );
  return wrapGroup(contentShadow + body + childrenMarkup + ownText, node, ctx);
}

/**
 * Just the `<text>` element. Split out because a node can own text WITHOUT
 * being a text leaf: an element whose direct text sits beside children that
 * carry their own paint — an icon and its label, a row and its badge — renders
 * both, and `renderBox` reuses this for the text half.
 */
function renderTextMarkup(node: FigmaSvgNode, ctx: RenderCtx): string {
  if (!node.text) return "";
  const { style, lines } = node.text;
  const anchor =
    style.textAlign === "center"
      ? "middle"
      : style.textAlign === "right"
        ? "end"
        : "start";
  if (style.textAlign === "justify") {
    ctx.report.approximated.push({
      node: node.name || node.id,
      note: "text-align: justify has no SVG equivalent; rendered left-aligned.",
    });
  }

  const tspans = lines
    .map(
      (l) =>
        `<tspan x="${n(l.x)}" y="${n(l.y)}">${escapeXmlText(l.text)}</tspan>`,
    )
    .join("");
  const attrs = [
    `font-family="${escapeXmlAttr(style.fontFamily)}"`,
    `font-size="${n(style.fontSizePx)}"`,
    style.fontWeight ? `font-weight="${style.fontWeight}"` : "",
    style.italic ? `font-style="italic"` : "",
    style.letterSpacingPx ? `letter-spacing="${n(style.letterSpacingPx)}"` : "",
    paintAttributes("fill", style.color),
    `text-anchor="${anchor}"`,
  ]
    .filter(Boolean)
    .join(" ");

  return `<text ${attrs}>${tspans}</text>`;
}

function renderText(node: FigmaSvgNode, ctx: RenderCtx): string {
  const markup = renderTextMarkup(node, ctx);
  if (!markup) return "";
  ctx.report.vectorized.push(node.name || node.id);
  // A text leaf that also carries box paint (button, pill, badge, chip) must
  // draw its background/border/shadow beneath the glyphs.
  return wrapGroup(`${boxPaintMarkup(node, ctx)}${markup}`, node, ctx);
}

function renderImage(node: FigmaSvgNode, ctx: RenderCtx): string {
  if (!node.image) return "";
  const rect = node.rect;
  const radii = node.cornerRadii ?? ZERO_RADII;
  const par = objectFitToPreserveAspectRatio(
    node.image.fit,
    node.image.position,
  );
  let clipAttr = "";
  if (!isZeroRadii(radii)) {
    const clipId = ctx.nextId("clip");
    const shape = isUniformRadius(radii)
      ? `<rect x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.width)}" height="${n(rect.height)}" rx="${n(radii.tl)}"/>`
      : `<path d="${roundedRectPath(rect, radii)}"/>`;
    ctx.defs.push(`<clipPath id="${clipId}">${shape}</clipPath>`);
    clipAttr = ` clip-path="url(#${clipId})"`;
  }
  ctx.report.vectorized.push(node.name || node.id);
  const markup = `<image x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.width)}" height="${n(rect.height)}" href="${escapeXmlAttr(node.image.href)}" preserveAspectRatio="${par}"${clipAttr}/>`;
  return wrapGroup(markup, node, ctx);
}

/**
 * Inline `<svg>` icons are already vectors, so re-emit them verbatim instead
 * of walking into them: their children paint through `fill`/`d` attributes and
 * a `viewBox` scale that the box/text model has no way to express, so walking
 * produced an empty hole where every icon used to be.
 */
function renderVector(node: FigmaSvgNode, ctx: RenderCtx): string {
  if (!node.vector) return "";
  const rect = node.rect;
  ctx.report.vectorized.push(node.name || node.id);
  const markup = node.vector.markup.replace(
    /^<svg\b([^>]*)>/i,
    (_opening, attributes: string) =>
      `<svg x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.width)}" height="${n(rect.height)}"${attributes.replace(/\s(?:x|y|width|height)="[^"]*"/gi, "")}>`,
  );
  return wrapGroup(markup, node, ctx);
}

function renderRaster(node: FigmaSvgNode, ctx: RenderCtx): string {
  if (!node.raster) return "";
  ctx.report.rasterized.push({
    node: node.name || node.id,
    reason: node.raster.reason,
  });
  const rect = node.rect;
  const markup = `<image x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.width)}" height="${n(rect.height)}" href="${escapeXmlAttr(node.raster.href)}" preserveAspectRatio="none"/>`;
  return wrapGroup(markup, node, ctx);
}

export function renderFigmaSvgNode(node: FigmaSvgNode, ctx: RenderCtx): string {
  switch (node.kind) {
    case "box":
      return renderBox(node, ctx);
    case "text":
      return renderText(node, ctx);
    case "image":
      return renderImage(node, ctx);
    case "raster":
      return renderRaster(node, ctx);
    case "vector":
      return renderVector(node, ctx);
    default:
      return "";
  }
}

export function createEmptyFigmaSvgReport(): FigmaSvgExportReport {
  return {
    vectorized: [],
    approximated: [],
    rasterized: [],
    omitted: [],
    warnings: [],
    vectorizedTextCaveat:
      "Figma imports SVG <text> as live, editable type, but its SVG importer " +
      "reads only font family, size and a coarse bold weight. Letter spacing " +
      "is dropped, and weights above 700 resolve to Bold, so tracked or " +
      "extra-bold text arrives at a different width than the design. Measured " +
      "against Figma directly: textLength/lengthAdjust, multi-value and " +
      "sibling tspan x, word-spacing and family-encoded weights are all " +
      "ignored too. This is a Figma import limitation, not a defect in this " +
      "export; everything else in the document is geometry-exact.",
  };
}

/**
 * How far the scene's own boxes reach past the frame's right and bottom edges.
 *
 * An SVG root clips to its viewBox, so an artboard sized to the frame silently
 * cuts off whatever the design draws outside it — a dashboard whose content
 * runs 106px past its 960px frame shipped to Figma with that strip missing.
 * Figma sizes its own render to the ink extent for the same reason.
 *
 * Only the right/bottom edges are reported. Growing the artboard up or left
 * would move the viewBox ORIGIN, which shifts every coordinate in the document
 * at once: doing that scored 63% on a design whose only stray node was a
 * shadow a few pixels off the left edge. Overflow past those edges stays
 * clipped, exactly as it is today.
 */
export function figmaSvgSceneExtent(node: FigmaSvgNode): {
  right: number;
  bottom: number;
} {
  let right = node.rect.x + node.rect.width;
  let bottom = node.rect.y + node.rect.height;
  for (const child of node.children ?? []) {
    const b = figmaSvgSceneExtent(child);
    if (b.right > right) right = b.right;
    if (b.bottom > bottom) bottom = b.bottom;
  }
  return { right, bottom };
}

export function buildFigmaSvgDocument(args: {
  width: number;
  height: number;
  title?: string | null;
  root: FigmaSvgNode;
}): { svg: string; report: FigmaSvgExportReport } {
  const report = createEmptyFigmaSvgReport();
  let idCounter = 0;
  const ctx: RenderCtx = {
    defs: [],
    report,
    nextId: (prefix) => `${prefix}-${++idCounter}`,
  };
  const body = renderFigmaSvgNode(args.root, ctx);
  const defsBlock = ctx.defs.length ? `<defs>${ctx.defs.join("")}</defs>` : "";
  const titleTag = args.title
    ? `<title>${escapeXmlText(args.title)}</title>`
    : "";
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n(args.width)}" height="${n(args.height)}" viewBox="0 0 ${n(args.width)} ${n(args.height)}">` +
    `${titleTag}${defsBlock}${body}</svg>`;
  return { svg, report };
}

export function safeFigmaSvgFilename(title: string | null | undefined): string {
  const safe = (title || "design")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${safe || "design"}-figma-${Date.now()}.svg`;
}

// ---------------------------------------------------------------------------
// Raw scene (browser-extracted) -> FigmaSvgNode hydration
// ---------------------------------------------------------------------------
//
// `extractFigmaSvgScene` below walks the LIVE rendered DOM inside Playwright
// and returns a tree of `RawFigmaSvgNode` — mostly-untouched computed-style
// STRINGS plus real geometry from getBoundingClientRect(). The functions in
// this section turn that raw tree into the final `FigmaSvgNode` tree consumed
// by `buildFigmaSvgDocument` above, reusing the same pure
// `parseComputedBoxShadow` / `parseComputedLinearGradient` /
// `parseComputedRadialGradient` parsers already covered by
// `design-to-figma-svg.spec.ts` — so this hydration step is itself pure and
// unit-testable with a hand-built `RawFigmaSvgNode` fixture (no browser
// needed), even though the DOM WALK that produces the raw tree is not.

export interface RawFigmaSvgTextLine {
  text: string;
  x: number;
  y: number;
}

export interface RawFigmaSvgTextStyle {
  fontFamily: string;
  fontSizePx: number;
  fontWeight: number;
  italic: boolean;
  letterSpacingPx: number;
  color: string;
  textAlign: string;
  /** See `FigmaSvgTextStyle.resolvedFontFamily`. */
  resolvedFontFamily?: string;
  /** Only the Figma NODE export reads it — a real TEXT node re-lays its own
   *  lines out, where the SVG path pins every line to an absolute baseline. */
  lineHeightPx?: number;
}

export interface RawFigmaSvgNode {
  id: string;
  name?: string;
  domTag: string;
  rect: FigmaSvgRect;
  rotationDeg: number;
  /** The reflection part of a mirrored transform, if any. */
  reflection?: [number, number, number, number];
  opacity: number;
  cornerRadiiRaw: FigmaSvgCornerRadii;
  // guard:allow-raw-color — exported SVG paint read from the design's own computed styles, never app UI
  /** Computed `background-color`, e.g. "rgba(0, 0, 0, 0)" or "rgb(255, 255, 255)". */
  backgroundColor: string;
  /** Computed `background-image`, e.g. "none" or a comma-separated gradient/url list. */
  backgroundImage: string;
  /**
   * Computed `background-size` / `background-position`, one entry per layer.
   * Figma's four image scale modes reach the DOM only through these: FILL is
   * `cover`, FIT is `contain`, STRETCH is `100% 100%`, and a CROP is an
   * explicit pixel size with an offset. Exporting every layer as `cover`
   * cropped the three that are not.
   */
  backgroundSize?: string;
  backgroundPosition?: string;
  /**
   * Computed `background-repeat`, one entry per layer. TILE is the one scale
   * mode `background-size` alone cannot express: both importers emit it as
   * `auto` + `repeat`, and `auto` is indistinguishable from an absent size, so
   * reading only the size exported a tiled fill as a single stretched copy.
   */
  backgroundRepeat?: string;
  /** Computed `box-shadow`, e.g. "none" or a Chromium-normalized shadow list. */
  boxShadow: string;
  /**
   * `--figma-content-shadow`: the exact shadow behind a `drop-shadow()` filter,
   * in `box-shadow` syntax. `drop-shadow()` has no spread and this export needs
   * one, so the importer carries the original values through a custom property.
   */
  contentShadow?: string;
  borderWidthPx: number;
  borderColor: string;
  borderStyle: string;
  borderNonUniform: boolean;
  /** `overflow` clips children, the CSS equivalent of Figma's clipsContent. */
  clipsContent?: boolean;
  /**
   * CSS `outline`. The Figma importer maps CENTER and OUTSIDE stroke alignment
   * to an outline (a border can only sit inside), so an export that ignores it
   * loses those strokes entirely on the way back to Figma.
   */
  outlineWidthPx?: number;
  outlineColor?: string;
  outlineOffsetPx?: number;
  outlineDashed?: boolean;
  /** Per-side [top, right, bottom, left], so a single-sided rule stays single-sided. */
  borderWidths?: [number, number, number, number];
  borderColors?: [string, string, string, string];
  borderStyles?: [string, string, string, string];
  backdropFilter: string;
  /** Raw computed `filter`; `none` unless the element is filtered. */
  filter: string;
  /** Raw computed `mix-blend-mode`. */
  mixBlendMode: string;
  /** Raw computed `image-rendering`. */
  imageRendering: string;
  isLeafText: boolean;
  textLines?: RawFigmaSvgTextLine[];
  textStyle?: RawFigmaSvgTextStyle;
  imgSrc?: string;
  imgObjectFit?: string;
  imgObjectPosition?: string;
  /** Set when this node must be rasterized (video/canvas/iframe/backdrop-blur/other unsupported paint). */
  rasterReason?: string;
  /** Filled in by the orchestrator after a screenshot crop (data: URI or hosted URL). */
  rasterHref?: string;
  /** Sanitized serialization of an inline `<svg>` subtree, passed through as-is. */
  svgMarkup?: string;
  /** Computed CSS layout facts — see `FigmaSvgLayoutFacts`. */
  layout?: FigmaSvgLayoutFacts;
  children: RawFigmaSvgNode[];
}

/**
 * Normalizes CSS `object-fit` to the 3-way union `FigmaSvgFill`/`image` fit
 * accepts. `none` (no scaling) and `scale-down` (contain, but never upscale)
 * both approximate to `contain` — closest available SVG mapping.
 */
function objectFitFromRaw(raw?: string): "cover" | "contain" | "stretch" {
  if (raw === "cover") return "cover";
  if (raw === "contain" || raw === "none" || raw === "scale-down")
    return "contain";
  return "stretch"; // CSS default object-fit is "fill", closest SVG mapping is "stretch".
}

/**
 * Builds the ordered `FigmaSvgFillLayer[]` for a box's own background paint:
 * each comma-separated `background-image` layer (gradients/url()) in CSS
 * order (index 0 = topmost), followed by `background-color` as the implicit
 * bottommost layer when it isn't fully transparent.
 */
/**
 * `background-size` for one layer, as Figma's scale modes reach the DOM:
 * `cover` (FILL), `contain` (FIT), `100% 100%` (STRETCH), or an explicit pixel
 * pair (CROP). Anything else falls back to cover, which is what every layer
 * used to get unconditionally.
 */
function imageFitFromSize(
  size: string | undefined,
  position: string | undefined,
  repeat?: string,
): {
  fit: "cover" | "contain" | "stretch";
  sizePx?: { width: number; height: number };
  offsetPx?: { x: number; y: number };
  repeat?: boolean;
} {
  const value = (size ?? "").trim();
  // Any repeating value means a Figma TILE. `no-repeat` is what the other four
  // scale modes emit, and an absent value is CSS's `repeat` initial — but an
  // absent value here means "the collector read no background-repeat at all",
  // which is not the same fact, so only an explicit repeat tiles.
  const tiles = /^repeat(-x|-y)?$/.test((repeat ?? "").trim());
  const px = Array.from(value.matchAll(/(-?[\d.]+)px/g)).map((m) =>
    Number(m[1]),
  );
  const explicitPx =
    px.length === 2 && px[0]! > 0 && px[1]! > 0
      ? { width: px[0]!, height: px[1]! }
      : undefined;
  if (tiles) {
    // A tile is drawn at its own size and repeated, so the only geometry that
    // matters is that size. `auto` (the importers' TILE size) leaves it unknown
    // here; `imageFillMarkup` reports that rather than guessing a fit.
    return { fit: "stretch", sizePx: explicitPx, repeat: true };
  }
  if (value === "contain") return { fit: "contain" };
  if (value === "cover" || value === "" || value === "auto") {
    return { fit: "cover" };
  }
  if (/^100%\s+100%$/.test(value)) return { fit: "stretch" };
  if (explicitPx) {
    const offsets = Array.from((position ?? "").matchAll(/(-?[\d.]+)px/g)).map(
      (m) => Number(m[1]),
    );
    return {
      fit: "stretch",
      sizePx: explicitPx,
      offsetPx:
        offsets.length === 2 ? { x: offsets[0]!, y: offsets[1]! } : undefined,
    };
  }
  return { fit: "cover" };
}

export function buildFillLayersFromComputedStyle(
  backgroundColor: string,
  backgroundImage: string,
  backgroundSize?: string,
  backgroundPosition?: string,
  backgroundRepeat?: string,
): FigmaSvgFillLayer[] {
  const layers: FigmaSvgFillLayer[] = [];
  const sizes = splitTopLevelCommas(backgroundSize ?? "");
  const positions = splitTopLevelCommas(backgroundPosition ?? "");
  const repeats = splitTopLevelCommas(backgroundRepeat ?? "");

  if (backgroundImage && backgroundImage !== "none") {
    let layerIndex = -1;
    for (const part of splitTopLevelCommas(backgroundImage)) {
      layerIndex += 1;
      // `background: <gradient>, <color>` computes to "<gradient>, none": the
      // colour layer contributes no image. That per-layer "none" is not an
      // unsupported paint, and reporting it as one made every layered
      // background export with a phantom omission and a phantom `fill="none"`
      // shape. Only the WHOLE value being "none" short-circuits above.
      if (part === "none") continue;
      if (part.startsWith("linear-gradient")) {
        const parsed = parseComputedLinearGradient(part);
        if (parsed) {
          layers.push({
            kind: "linear-gradient",
            angleDeg: parsed.angleDeg,
            stops: parsed.stops,
          });
        }
      } else if (part.startsWith("radial-gradient")) {
        const parsed = parseComputedRadialGradient(part);
        if (parsed)
          layers.push({
            kind: "radial-gradient",
            stops: parsed.stops,
            geometry: parsed,
          });
      } else if (part.startsWith("url(")) {
        const hrefMatch = part.match(/url\((["']?)(.*?)\1\)/);
        if (hrefMatch)
          layers.push({
            kind: "image",
            href: hrefMatch[2],
            // CSS repeats a shorter `background-size` / `background-position`
            // list across the layers rather than leaving the tail unset, so a
            // single `contain` applies to every image, not just the first.
            ...imageFitFromSize(
              sizes.length ? sizes[layerIndex % sizes.length] : undefined,
              positions.length
                ? positions[layerIndex % positions.length]
                : undefined,
              repeats.length ? repeats[layerIndex % repeats.length] : undefined,
            ),
          });
      } else {
        // Conic/repeating gradients and any future background-image syntax have
        // no SVG equivalent. Recording the layer keeps it visible in the export
        // report; dropping it silently made the paint vanish with no trace.
        layers.push({ kind: "unsupported", css: part.trim() });
      }
    }
  }

  const bg = parseCssColorExtended(backgroundColor);
  if (bg && bg.a > 0) {
    layers.push({
      kind: "solid",
      // guard:allow-raw-color — exported SVG paint read from the design's own computed styles, never app UI
      color: `rgba(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)}, ${bg.a})`,
    });
  }

  return layers;
}

/** CSS `outline`, when one is actually painted. */
function buildOutline(raw: RawFigmaSvgNode): FigmaSvgOutline | undefined {
  if (!raw.outlineWidthPx || raw.outlineWidthPx <= 0) return undefined;
  return {
    widthPx: raw.outlineWidthPx,
    // guard:allow-raw-color — exported design paint read from the page's own outline, never app UI
    color: raw.outlineColor ?? "rgb(0, 0, 0)",
    offsetPx: raw.outlineOffsetPx ?? 0,
    dashed: raw.outlineDashed || undefined,
  };
}

/**
 * Per-side border detail, present only when the sides actually differ.
 *
 * A `border-top: 1px` divider used to be reported as "non-uniform" and drawn
 * as one representative side around the WHOLE box — a footer rule became a
 * full rectangle outline. Returning the real four sides lets the renderer draw
 * only the edges that exist.
 */
function buildBorderSides(
  raw: RawFigmaSvgNode,
): FigmaSvgBorder["sides"] | undefined {
  if (!raw.borderNonUniform) return undefined;
  const widths = raw.borderWidths;
  const colors = raw.borderColors;
  const styles = raw.borderStyles;
  if (!widths || !colors || !styles) return undefined;
  return widths.map((widthPx, i) =>
    widthPx > 0 && styles[i] !== "none"
      ? {
          widthPx,
          color: colors[i],
          dashed: styles[i] === "dashed" || styles[i] === "dotted",
        }
      : null,
  );
}

/** Pure hydration: `RawFigmaSvgNode` (browser-extracted computed strings + geometry) -> `FigmaSvgNode`. */
export function hydrateRawFigmaSvgNode(raw: RawFigmaSvgNode): FigmaSvgNode {
  const rotationDeg = raw.rotationDeg ? raw.rotationDeg : undefined;
  const reflection = raw.reflection;
  const opacity = raw.opacity !== 1 ? raw.opacity : undefined;
  // A non-blur filter never reaches here — the walk rasterizes it — so the only
  // filter left to carry is a lone blur.
  const blurMatch = /^blur\(\s*([\d.]+)px\s*\)$/.exec(
    (raw.filter ?? "none").trim(),
  );
  const blurPx = blurMatch ? Number(blurMatch[1]) : undefined;
  const blendMode =
    raw.mixBlendMode && raw.mixBlendMode !== "normal"
      ? raw.mixBlendMode
      : undefined;
  const imageRendering =
    raw.imageRendering === "pixelated" || raw.imageRendering === "crisp-edges"
      ? raw.imageRendering
      : undefined;

  if (raw.rasterReason) {
    return {
      id: raw.id,
      name: raw.name,
      kind: "raster",
      rect: raw.rect,
      rotationDeg,
      opacity,
      blurPx,
      blendMode,
      imageRendering,
      raster: { href: raw.rasterHref ?? "", reason: raw.rasterReason },
      layout: raw.layout,
    };
  }

  if (raw.svgMarkup) {
    return {
      id: raw.id,
      name: raw.name,
      kind: "vector",
      rect: raw.rect,
      rotationDeg,
      reflection,
      opacity,
      blurPx,
      blendMode,
      imageRendering,
      vector: { markup: raw.svgMarkup },
      layout: raw.layout,
    };
  }

  if (raw.isLeafText && raw.textLines && raw.textStyle) {
    const textAlign =
      raw.textStyle.textAlign === "center" ||
      raw.textStyle.textAlign === "right" ||
      raw.textStyle.textAlign === "justify"
        ? raw.textStyle.textAlign
        : "left";
    // An element can be both a box and a text leaf — every button, pill,
    // badge and chip is. Carrying its box paint here is what keeps the
    // background, border, radius and shadow from being dropped on export.
    const textBoxFills = buildFillLayersFromComputedStyle(
      raw.backgroundColor,
      raw.backgroundImage,
      raw.backgroundSize,
      raw.backgroundPosition,
      raw.backgroundRepeat,
    );
    const textBoxShadows = parseComputedBoxShadow(raw.boxShadow);
    return {
      id: raw.id,
      name: raw.name,
      kind: "text",
      rect: raw.rect,
      rotationDeg,
      reflection,
      opacity,
      blurPx,
      blendMode,
      imageRendering,
      cornerRadii: isZeroRadii(raw.cornerRadiiRaw)
        ? undefined
        : raw.cornerRadiiRaw,
      fills: textBoxFills.length > 0 ? textBoxFills : undefined,
      border:
        raw.borderWidthPx > 0
          ? {
              widthPx: raw.borderWidthPx,
              color: raw.borderColor,
              dashed:
                raw.borderStyle === "dashed" || raw.borderStyle === "dotted",
              nonUniform: raw.borderNonUniform || undefined,
              sides: buildBorderSides(raw),
            }
          : undefined,
      outline: buildOutline(raw),
      shadows: textBoxShadows.length > 0 ? textBoxShadows : undefined,
      text: {
        lines: raw.textLines,
        style: {
          fontFamily: raw.textStyle.fontFamily,
          fontSizePx: raw.textStyle.fontSizePx,
          fontWeight: raw.textStyle.fontWeight,
          italic: raw.textStyle.italic,
          letterSpacingPx: raw.textStyle.letterSpacingPx,
          color: raw.textStyle.color,
          textAlign,
          resolvedFontFamily: raw.textStyle.resolvedFontFamily,
          lineHeightPx: raw.textStyle.lineHeightPx,
        },
      },
      layout: raw.layout,
    };
  }

  if (raw.domTag === "IMG" && raw.imgSrc) {
    return {
      id: raw.id,
      name: raw.name,
      kind: "image",
      rect: raw.rect,
      rotationDeg,
      reflection,
      opacity,
      blurPx,
      blendMode,
      imageRendering,
      cornerRadii: isZeroRadii(raw.cornerRadiiRaw)
        ? undefined
        : raw.cornerRadiiRaw,
      image: {
        href: raw.imgSrc,
        fit: objectFitFromRaw(raw.imgObjectFit),
        position: raw.imgObjectPosition,
      },
      layout: raw.layout,
    };
  }

  const fills = buildFillLayersFromComputedStyle(
    raw.backgroundColor,
    raw.backgroundImage,
    raw.backgroundSize,
    raw.backgroundPosition,
    raw.backgroundRepeat,
  );
  const shadows = [
    ...parseComputedBoxShadow(raw.boxShadow),
    ...parseComputedDropShadowFilter(raw.filter, raw.contentShadow),
  ];
  const border =
    raw.borderWidthPx > 0
      ? {
          widthPx: raw.borderWidthPx,
          color: raw.borderColor,
          dashed: raw.borderStyle === "dashed" || raw.borderStyle === "dotted",
          nonUniform: raw.borderNonUniform || undefined,
          sides: buildBorderSides(raw),
        }
      : undefined;
  const outline = buildOutline(raw);

  return {
    id: raw.id,
    name: raw.name,
    kind: "box",
    rect: raw.rect,
    rotationDeg,
    reflection,
    opacity,
    blurPx,
    blendMode,
    imageRendering,
    cornerRadii: isZeroRadii(raw.cornerRadiiRaw)
      ? undefined
      : raw.cornerRadiiRaw,
    fills: fills.length > 0 ? fills : undefined,
    border,
    outline,
    shadows: shadows.length > 0 ? shadows : undefined,
    clipsContent: raw.clipsContent,
    // A container's own direct text, when its children had to stay separate.
    text:
      raw.textLines && raw.textStyle
        ? {
            lines: raw.textLines,
            style: {
              fontFamily: raw.textStyle.fontFamily,
              fontSizePx: raw.textStyle.fontSizePx,
              fontWeight: raw.textStyle.fontWeight,
              italic: raw.textStyle.italic,
              letterSpacingPx: raw.textStyle.letterSpacingPx,
              color: raw.textStyle.color,
              textAlign:
                raw.textStyle.textAlign === "center" ||
                raw.textStyle.textAlign === "right" ||
                raw.textStyle.textAlign === "justify"
                  ? raw.textStyle.textAlign
                  : "left",
            },
          }
        : undefined,
    layout: raw.layout,
    children: raw.children.map(hydrateRawFigmaSvgNode),
  };
}

// ---------------------------------------------------------------------------
// In-page DOM walk — mirrors take-design-screenshot.ts's
// `collectPageDiagnostics`: a single self-contained function with no closures
// over outer scope (Playwright serializes it via `Function#toString()` into
// the page), so it duplicates a few tiny helpers rather than importing them.
// Not unit-tested directly for the same reason `collectPageDiagnostics` isn't
// — see that file's spec docblock. Geometry comes straight from
// `getBoundingClientRect()`, which is what makes it pixel-perfect without
// reimplementing flexbox/auto-layout math.
// ---------------------------------------------------------------------------

export interface RawFigmaSvgSceneResult {
  root: RawFigmaSvgNode;
  /** The export root's absolute page-space offset, so the orchestrator can
   *  convert a raster node's origin-relative rect back to page coordinates
   *  for `page.screenshot({ clip })`. */
  originOffset: { x: number; y: number };
}

export function collectRawFigmaSvgScene(
  rootSelector: string | null,
  rootOverride?: Element | null,
): RawFigmaSvgSceneResult | null {
  // `rootOverride` is the client entry point: the editor already holds the
  // preview's root Element (possibly in another document — a hidden snapshot
  // iframe), which no selector evaluated against the ambient `document` can
  // reach. Playwright never passes it; `page.evaluate` forwards one argument.
  const root =
    rootOverride ??
    (rootSelector ? document.querySelector(rootSelector) : document.body);
  if (!root) return null;
  const doc = root.ownerDocument;
  if (!doc.defaultView) return null;
  const view = doc.defaultView;
  const originRect = root.getBoundingClientRect();
  let autoId = 0;

  function nextId(): string {
    autoId += 1;
    return `n${autoId}`;
  }

  // Affine [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f.
  // `getBoundingClientRect()` reports the axis-aligned box of the TRANSFORMED
  // element, so a rotated card measured that way is stored oversized and then
  // rotated a second time by the renderer — and every descendant inherits the
  // error. Carrying a page -> local matrix down the walk expresses each node in
  // its rotated ancestor's own space, which is the space the renderer's
  // `<g transform="rotate(...)">` actually establishes.
  type Affine = [number, number, number, number, number, number];

  function composeAffine(outer: Affine, inner: Affine): Affine {
    return [
      outer[0] * inner[0] + outer[2] * inner[1],
      outer[1] * inner[0] + outer[3] * inner[1],
      outer[0] * inner[2] + outer[2] * inner[3],
      outer[1] * inner[2] + outer[3] * inner[3],
      outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
      outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
    ];
  }

  function rotationAbout(deg: number, cx: number, cy: number): Affine {
    const radians = (deg * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return [
      cos,
      sin,
      -sin,
      cos,
      cx - cos * cx + sin * cy,
      cy - sin * cx - cos * cy,
    ];
  }

  function applyAffine(m: Affine, x: number, y: number): [number, number] {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }

  /**
   * The element's own untransformed border box.
   *
   * `getBoundingClientRect()` gives the AABB of the TRANSFORMED element, which
   * is larger than the element under rotation. `offsetWidth/Height` is the
   * untransformed box — but only HTML elements have it. An inline `<svg>` or
   * `<math>` returns undefined, and `undefined > 0` is false, so those silently
   * took the AABB and were exported oversized.
   *
   * For those, solve the AABB back to the real box using the accumulated
   * rotation: W = w|cos| + h|sin|, H = w|sin| + h|cos|. The system is singular
   * at 45 degrees (|cos| == |sin|), where the AABB genuinely carries no size
   * information, so that case keeps the AABB.
   */
  function untransformedSize(
    el: Element,
    rect: DOMRect,
    rotationActive: boolean,
    toLocal: Affine,
  ): { width: number; height: number } {
    if (!rotationActive) return { width: rect.width, height: rect.height };
    const layout = el as HTMLElement;
    if (
      typeof layout.offsetWidth === "number" &&
      layout.offsetWidth > 0 &&
      layout.offsetHeight > 0
    ) {
      return { width: layout.offsetWidth, height: layout.offsetHeight };
    }
    const angle = Math.atan2(toLocal[1], toLocal[0]);
    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    const determinant = cos * cos - sin * sin;
    if (Math.abs(determinant) < 1e-3) {
      return { width: rect.width, height: rect.height };
    }
    const width = (rect.width * cos - rect.height * sin) / determinant;
    const height = (rect.height * cos - rect.width * sin) / determinant;
    return width > 0 && height > 0
      ? { width, height }
      : { width: rect.width, height: rect.height };
  }

  /**
   * The reflection a transform carries, if any.
   *
   * `rotationFromTransform` reduces a matrix to `atan2(b, a)`, which cannot
   * tell a MIRROR from a half turn: `matrix(-1, 0, 0, 1)` reads as 180 degrees,
   * so a mirrored layer exported as a half turn — identical on a symmetric
   * shape and wrong on every other one. Positivus alone carries 11 of them.
   * Decomposing as `R(theta) . M` leaves M as the reflection, and a mirror
   * about the default centre origin preserves the bounding box, so the rect
   * needs no reconstruction. Scale and skew (a positive determinant with a
   * non-identity residual) are NOT returned here: those do move the box, and
   * they need the rect work that is tracked separately.
   */
  function reflectionFromTransform(
    transform: string,
  ): { residual: [number, number, number, number]; mirror: boolean } | null {
    if (!transform || transform === "none") return null;
    const m = transform.match(/matrix\(([^)]+)\)/);
    if (!m) return null;
    const [a, b, c, d] = m[1]
      .split(",")
      .map((v) => Number.parseFloat(v.trim()));
    if (![a, b, c, d].every((v) => Number.isFinite(v))) return null;
    const theta = Math.atan2(b!, a!);
    const cos = Math.cos(-theta);
    const sin = Math.sin(-theta);
    const residual: [number, number, number, number] = [
      cos * a! - sin * b!,
      sin * a! + cos * b!,
      cos * c! - sin * d!,
      sin * c! + cos * d!,
    ];
    const identity = [1, 0, 0, 1];
    if (residual.every((v, i) => Math.abs(v - identity[i]!) < 1e-4))
      return null;
    return { residual, mirror: a! * d! - c! * b! < 0 };
  }

  function rotationFromTransform(transform: string): number {
    if (!transform || transform === "none") return 0;
    const m = transform.match(/matrix\(([^)]+)\)/);
    if (!m) return 0;
    const parts = m[1].split(",").map((v) => Number.parseFloat(v.trim()));
    const [a, b] = parts;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    return Math.atan2(b, a) * (180 / Math.PI);
  }

  /**
   * Which family in a `font-family` fallback list the browser is ACTUALLY
   * painting with. `document.fonts.check("13px Inter")` is not the answer: it
   * returns true for a family that is not installed, so a design rendered in
   * Helvetica exports as "Inter" and every text box comes out the wrong width
   * once the importing tool DOES have Inter. Measuring is the only honest
   * test — the list's own width identifies the family that won the cascade.
   * Returns undefined when nothing matches, because "unknown" and "the first
   * name in the list" must not be the same answer.
   */
  const resolvedFamilyCache = new Map<string, string | undefined>();
  function resolveFontFamily(cssFamily: string): string | undefined {
    if (resolvedFamilyCache.has(cssFamily)) {
      return resolvedFamilyCache.get(cssFamily);
    }
    let resolved: string | undefined;
    const ctx = doc.createElement("canvas").getContext("2d");
    if (ctx) {
      const probe = "AaBbGgMmWw0123 iIlL";
      ctx.font = `16px ${cssFamily}`;
      const target = ctx.measureText(probe).width;
      for (const raw of cssFamily.split(",")) {
        const family = raw.trim().replace(/^["']|["']$/g, "");
        if (!family) continue;
        ctx.font = `16px "${family}"`;
        if (Math.abs(ctx.measureText(probe).width - target) < 0.01) {
          resolved = family;
          break;
        }
      }
    }
    resolvedFamilyCache.set(cssFamily, resolved);
    return resolved;
  }

  function isVisible(el: Element, style: CSSStyleDeclaration): boolean {
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (el.getAttribute("data-agent-native-hidden") === "true") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * Character index of each line break, found by binary search on how many
   * distinct line-box tops a prefix of the text occupies. Indices are flat
   * across every text node in the element, so inline children and `<br>` are
   * handled the same as a single run.
   */
  function splitLineOffsets(
    charAt: Array<{ node: Text; offset: number }>,
    lineCount: number,
  ): number[] {
    const totalLength = charAt.length;
    const offsets: number[] = [];
    let start = 0;
    const range = doc.createRange();
    // A range START is the position OF character `index`; a range END is the
    // position AFTER character `index - 1`. Using the next character's start as
    // the end put the boundary at the head of the following line box, so the
    // search saw two line tops one character early and every break landed one
    // character short — `A<br>B` split as "A" / ",B".
    const startPos = (index: number) =>
      charAt[Math.min(index, totalLength - 1)];
    const endPos = (index: number) => {
      const at = charAt[Math.max(0, Math.min(index, totalLength) - 1)];
      return { node: at.node, offset: at.offset + 1 };
    };
    for (let line = 0; line < lineCount - 1; line++) {
      let lo = start;
      let hi = totalLength;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const from = startPos(start);
        const to = endPos(mid);
        range.setStart(from.node, from.offset);
        range.setEnd(to.node, to.offset);
        const rects = Array.from(range.getClientRects());
        const tops = new Set(rects.map((r) => Math.round(r.top)));
        if (tops.size <= 1) {
          lo = mid;
        } else {
          hi = mid - 1;
        }
      }
      offsets.push(lo || start + 1);
      start = offsets[offsets.length - 1];
    }
    offsets.push(totalLength);
    return offsets;
  }

  /**
   * `Range.getClientRects()` can return MORE THAN ONE rect for a single
   * visual line: a wrapped trailing space "hangs" at the end of the
   * previous line as its own thin rect, and bidi/font-fallback boundaries
   * can split one line into multiple runs. Treating the raw rect count as
   * the line count over-splits real wrapped text into an extra bogus
   * "line" that lands at the SAME y as the line it actually belongs to —
   * this was the multi-line wrap-loss bug (a wrapped line rendered as a
   * second tspan glued onto the first line's baseline instead of dropping
   * to its own line). Merge same-top rects (rounded to a whole px, since
   * sub-pixel layout can jitter the exact float) into one rect spanning
   * their full horizontal extent before counting/splitting real visual
   * lines.
   */
  function groupRectsByLine(rects: DOMRect[]): DOMRect[] {
    const lines: DOMRect[] = [];
    for (const r of rects) {
      if (r.width === 0 && r.height === 0) continue;
      const prev = lines[lines.length - 1];
      if (prev && Math.round(prev.top) === Math.round(r.top)) {
        const left = Math.min(prev.left, r.left);
        const right = Math.max(prev.right, r.right);
        lines[lines.length - 1] = new DOMRect(
          left,
          prev.top,
          right - left,
          Math.max(prev.height, r.height),
        );
      } else {
        lines.push(r);
      }
    }
    return lines;
  }

  /**
   * Either the laid-out lines, or a note that this element's own text cannot be
   * folded into a run because its children carry paint or styling of their own.
   * The second case used to be an unreported `null`, which dropped the text.
   */
  type TextExtraction = {
    lines: RawFigmaSvgTextLine[];
    /** True when these are only the element's DIRECT runs and its element
     *  children still need walking as nodes of their own. */
    partial: boolean;
  } | null;

  function extractTextLines(
    el: Element,
    toLocal: Affine,
    rotationActive: boolean,
  ): TextExtraction {
    // Text runs through inline children as well as direct text nodes. Requiring
    // `el.children.length === 0` meant any element containing a `<br>`,
    // `<strong>`, `<em>`, `<a>` or `<span>` was not a text leaf, was walked as a
    // container, and — because the walk only recurses into ELEMENT children —
    // had every one of its text nodes silently dropped from the export. A
    // headline written as `A<br>B` exported as nothing at all.
    const own = view.getComputedStyle(el);
    // A child can be folded into this text run only if doing so loses nothing:
    // it must paint nothing of its own and must not restyle its text. A `<br>`
    // qualifies trivially. A styled child — a status pill with its own
    // background, a bold or coloured run — must stay a node of its own, so the
    // element is walked as a container exactly as before.
    const absorbable = (childEl: Element): boolean => {
      if (childEl.tagName.toUpperCase() === "BR") return true;
      // A REPLACED element paints content the box/text model cannot see. It
      // passes every style test below — an inline <img> or <svg> inherits its
      // parent's colour and paints no box of its own — so without this the
      // parent became a text leaf, `walk` never recursed, and the image or icon
      // was deleted along with its advance width. Sending it down the partial
      // path keeps the text AND walks the child as its own node.
      // SVG elements report a LOWERCASE tagName (only HTML elements uppercase
      // theirs), so an inline `<svg>` slipped straight past an uppercase test.
      if (
        /^(IMG|SVG|VIDEO|CANVAS|IFRAME|PICTURE|OBJECT|EMBED|INPUT|BUTTON|SELECT|TEXTAREA|MATH)$/.test(
          childEl.tagName.toUpperCase(),
        )
      ) {
        return false;
      }
      const cs = view.getComputedStyle(childEl);
      if (!cs.display.startsWith("inline") && cs.display !== "contents")
        return false;
      const paintsOwnBox =
        cs.backgroundImage !== "none" ||
        // The walker is serialized into the page, so it cannot call helpers
        // from this module's scope. A computed background-color is always a
        // functional colour string; fully transparent is the only "no paint"
        // value Chromium reports.
        // guard:allow-raw-color — comparing against a computed CSS value, not authoring one
        (cs.backgroundColor !== "rgba(0, 0, 0, 0)" &&
          cs.backgroundColor !== "transparent") ||
        cs.boxShadow !== "none" ||
        (Number.parseFloat(cs.borderTopWidth) || 0) > 0 ||
        (Number.parseFloat(cs.borderRightWidth) || 0) > 0 ||
        (Number.parseFloat(cs.borderBottomWidth) || 0) > 0 ||
        (Number.parseFloat(cs.borderLeftWidth) || 0) > 0;
      if (paintsOwnBox) return false;
      return (
        cs.color === own.color &&
        cs.fontFamily === own.fontFamily &&
        cs.fontSize === own.fontSize &&
        cs.fontWeight === own.fontWeight &&
        cs.fontStyle === own.fontStyle &&
        cs.textDecorationLine === own.textDecorationLine &&
        cs.letterSpacing === own.letterSpacing
      );
    };

    const textNodes: Text[] = [];
    const foldable = (function collect(node: Node): boolean {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          if ((child.textContent || "").length > 0)
            textNodes.push(child as Text);
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const childEl = child as Element;
        if (!absorbable(childEl)) return false;
        if (!collect(childEl)) return false;
      }
      return true;
    })(el);

    // When a child carries its own paint or styling it must stay a node of its
    // own — but this element's DIRECT text still has to be exported. "Search
    // assets" next to an icon, "Home" under a tab glyph, "Overview" beside a
    // count badge: all of these are text-plus-child, and all of them used to
    // vanish, because the walk only recurses into ELEMENT children. So measure
    // just the direct text runs and let the children be walked normally.
    if (!foldable) {
      textNodes.length = 0;
      for (const child of Array.from(el.childNodes)) {
        if (
          child.nodeType === Node.TEXT_NODE &&
          (child.textContent || "").length > 0
        ) {
          textNodes.push(child as Text);
        }
      }
    }
    if (!textNodes.some((node) => (node.textContent || "").trim().length > 0)) {
      return null;
    }
    // `textContent` is the SOURCE text; `text-transform` is a paint-time
    // effect, so the glyphs on screen (and the rects measured below) may be a
    // different case entirely. Exporting the untransformed string shipped
    // "Northstar" where the design renders "NORTHSTAR".
    const transform = view.getComputedStyle(el).textTransform;
    const applyTransform = (value: string) => {
      if (transform === "uppercase") return value.toUpperCase();
      if (transform === "lowercase") return value.toLowerCase();
      if (transform === "capitalize") {
        return value.replace(
          /(^|\s)(\S)/g,
          (_m, lead, ch) => lead + ch.toUpperCase(),
        );
      }
      return value;
    };
    // Slice offsets are computed against the ORIGINAL string (a transform can
    // change length, e.g. German ss), so transform each line after slicing.
    //
    // `charAt[i]` maps a character index in `full` back to its (node, offset),
    // so a Range can be positioned by flat index across several text nodes.
    const charAt: Array<{ node: Text; offset: number }> = [];
    let full = "";
    for (const node of textNodes) {
      const value = node.textContent || "";
      for (let i = 0; i < value.length; i++) charAt.push({ node, offset: i });
      full += value;
    }
    // Measure the TEXT NODES, not the element. `selectNodeContents(el)` would
    // also return the boxes of any element children, inventing line boxes this
    // text does not occupy — which matters for the partial case, where the
    // children are exactly the things that are NOT part of this run.
    const range = doc.createRange();
    const rawRects: DOMRect[] = [];
    for (const node of textNodes) {
      range.selectNodeContents(node);
      rawRects.push(...Array.from(range.getClientRects()));
    }
    if (rawRects.length === 0) return null;
    const lineRects = groupRectsByLine(rawRects);
    if (lineRects.length === 0) return null;

    const style = view.getComputedStyle(el);
    const textAlign = style.textAlign;
    const elRect = el.getBoundingClientRect();
    // Vertical centers use the ELEMENT's own CSS line-height box, not the
    // Range's tight glyph-metrics rect: Chromium's getClientRects() height
    // reflects font ascent/descent, which is usually shorter than the
    // line-height the surrounding layout actually reserves, so
    // `dominant-baseline="central"` measured against the tight rect lands a
    // few px off from where the line visually centers (this was the global
    // baseline-offset bug).
    const lineHeightPx =
      Number.parseFloat(style.lineHeight) || elRect.height / lineRects.length;

    // Emit the true alphabetic baseline instead of a line centre plus
    // `dominant-baseline="central"`. Figma's SVG importer ignores
    // dominant-baseline and reads `y` as the baseline, which lifted every
    // imported text node by about one ascent (32px on an 82px headline).
    // Alphabetic is SVG's default too, so Chromium agrees with no attribute.
    //
    // CSS half-leading: inside a line box of height L the (ascent + descent)
    // content area is centred, so baseline = lineCentre + (ascent - descent)/2.
    const metricsCtx = doc.createElement("canvas").getContext("2d");
    let baselineFromCentre = 0;
    if (metricsCtx) {
      metricsCtx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const metrics = metricsCtx.measureText("Hxg");
      const ascent = metrics.fontBoundingBoxAscent;
      const descent = metrics.fontBoundingBoxDescent;
      if (Number.isFinite(ascent) && Number.isFinite(descent)) {
        baselineFromCentre = (ascent - descent) / 2;
      }
    }

    // Line boxes stack from the CONTENT box, not the border box. Positioning
    // from the border box put every padded wrapping block — a quote, a callout,
    // a card body — out by its padding and border.
    //
    // Under a rotated ancestor, `getBoundingClientRect()` gives the AABB of the
    // rotated element, whose edges are NOT the element's own edges. Its centre
    // is, though: rotation maps a rectangle's centre to its AABB's centre. So
    // the box is rebuilt from that centre using the untransformed layout size.
    const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
    const borderBottom = Number.parseFloat(style.borderBottomWidth) || 0;
    const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
    const borderRight = Number.parseFloat(style.borderRightWidth) || 0;
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(style.paddingRight) || 0;

    const { width: boxWidth, height: boxHeight } = untransformedSize(
      el,
      elRect,
      rotationActive,
      toLocal,
    );
    const [localCentreX, localCentreY] = applyAffine(
      toLocal,
      elRect.left + elRect.width / 2,
      elRect.top + elRect.height / 2,
    );
    const contentTop = localCentreY - boxHeight / 2 + borderTop + paddingTop;
    const contentLeft = localCentreX - boxWidth / 2 + borderLeft + paddingLeft;
    const contentHeight = Math.max(
      0,
      boxHeight - borderTop - paddingTop - borderBottom - paddingBottom,
    );
    const contentWidth = Math.max(
      0,
      boxWidth - borderLeft - paddingLeft - borderRight - paddingRight,
    );

    // Glyph rects are exact when nothing is rotated. Under rotation they are
    // AABBs too, so the anchor comes from the content box and `text-anchor`
    // instead — exact for normal text-align, and the one case it approximates
    // (text centred by flex rather than text-align, inside a rotated element)
    // is reported by the caller rather than passed off as exact.
    const anchorFromContentBox = () =>
      textAlign === "center"
        ? contentLeft + contentWidth / 2
        : textAlign === "right" || textAlign === "end"
          ? contentLeft + contentWidth
          : contentLeft;
    const localAnchorX = (rect: DOMRect) =>
      rotationActive
        ? anchorFromContentBox()
        : applyAffine(toLocal, anchorX(rect), 0)[0];

    const anchorX = (rect: DOMRect) => {
      if (textAlign === "center") return rect.left + rect.width / 2;
      if (textAlign === "right" || textAlign === "end") return rect.right;
      return rect.left;
    };

    // Where a line actually sits is MEASURED, not derived. Chromium's line
    // rects are the (ascent + descent) content area, which CSS half-leading
    // centres inside the line box — so the rect's centre IS the line box's
    // centre, and `baselineFromCentre` turns it into the baseline.
    //
    // Deriving it from the element box instead was wrong twice over. A single
    // line was placed at the content-box centre, which only holds when the box
    // hugs its line: `align-items: stretch` is the flex/grid DEFAULT, so a
    // label beside a taller sibling stretches and its text was exported half
    // the slack too low. And multi-line text was stacked from `contentTop` with
    // a stride that fell back to the element height when `line-height` is
    // `normal` — the opposite, top-anchored assumption on the same element, so
    // whether a string happened to wrap decided which of two contradictory
    // models applied.
    //
    // Under rotation the rects are axis-aligned boxes of rotated text, so the
    // measurement is unusable and the element-box derivation is kept, with the
    // stride taken from the rects where possible rather than the element box.
    const rotatedStride =
      Number.parseFloat(style.lineHeight) ||
      (lineRects.length > 1
        ? lineRects[1].top - lineRects[0].top
        : contentHeight);
    const lineBaseline = (r: DOMRect, index: number) =>
      rotationActive
        ? contentTop + rotatedStride * (index + 0.5) + baselineFromCentre
        : applyAffine(toLocal, 0, r.top + r.height / 2)[1] + baselineFromCentre;

    // Anchor a line on the rect of the text actually EMITTED, not on the raw
    // line rect. Chromium returns a soft wrap's trailing space as its own thin
    // rect at the same top, and `groupRectsByLine` unions it into the line
    // extent — that union is required, or the line COUNT over-splits. But the
    // emitted text is trimmed, so a centred line that wraps at a space was
    // anchored half a space's advance to the right of its own ink (5.9px at
    // 48px type). Measure the range being emitted instead; the merge stays
    // untouched, because a rect alone cannot be told apart from a bidi or
    // font-fallback run split.
    const inkRect = (from: number, to: number, fallback: DOMRect): DOMRect => {
      const raw = full.slice(from, to);
      const lead = raw.length - raw.replace(/^\s+/, "").length;
      const trail = raw.length - raw.replace(/\s+$/, "").length;
      const a = charAt[from + lead];
      const b = charAt[to - trail - 1];
      if (!a || !b) return fallback;
      const inkRange = doc.createRange();
      inkRange.setStart(a.node, a.offset);
      inkRange.setEnd(b.node, b.offset + 1);
      const merged = groupRectsByLine(Array.from(inkRange.getClientRects()));
      return merged.length === 1 ? merged[0]! : fallback;
    };

    if (lineRects.length === 1) {
      const r = lineRects[0];
      return {
        partial: !foldable,
        lines: [
          {
            text: applyTransform(full.trim()),
            x: localAnchorX(inkRect(0, full.length, r)),
            y: lineBaseline(r, 0),
          },
        ],
      };
    }

    const offsets = splitLineOffsets(charAt, lineRects.length);
    let start = 0;
    const lines = lineRects.map((r, i) => {
      const end = offsets[i] ?? full.length;
      const text = applyTransform(full.slice(start, end).trim());
      const ink = inkRect(start, end, r);
      start = end;
      return { text, x: localAnchorX(ink), y: lineBaseline(r, i) };
    });
    return { partial: !foldable, lines };
  }

  // Stored design HTML is untrusted, and this markup is re-emitted verbatim
  // into a file the user opens and shares. Strip anything executable.
  function serializeInlineSvg(el: Element): string {
    const clone = el.cloneNode(true) as Element;
    for (const node of Array.from(
      clone.querySelectorAll("script, foreignObject"),
    )) {
      node.remove();
    }
    for (const node of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
      for (const attribute of Array.from(node.attributes)) {
        if (/^on/i.test(attribute.name)) {
          node.removeAttribute(attribute.name);
        } else if (
          (attribute.name === "href" || attribute.name === "xlink:href") &&
          /^\s*javascript:/i.test(attribute.value)
        ) {
          node.removeAttribute(attribute.name);
        }
      }
    }
    return new XMLSerializer().serializeToString(clone);
  }

  function walk(
    el: Element,
    toLocal: Affine,
    rotatedAncestor: boolean,
  ): RawFigmaSvgNode | null {
    const style = view.getComputedStyle(el);
    if (!isVisible(el, style)) return null;

    const rect = el.getBoundingClientRect();
    const ownRotation = rotationFromTransform(style.transform);
    const decomposed = reflectionFromTransform(style.transform);
    const ownReflection = decomposed?.residual ?? null;
    // A mirror about the default centre origin preserves the bounding box, so
    // the existing rect is already right for it. A scale or skew does NOT: it
    // moves the box, so its geometry has to be reconstructed.
    const movesBox = !!decomposed && !decomposed.mirror;
    const rotationActive = rotatedAncestor || ownRotation !== 0 || movesBox;

    // A rotation about the default 50%/50% origin preserves the element's
    // centre, so the centre is the one point that survives the transform and
    // can be mapped back into the parent's local space. `offsetWidth/Height`
    // is the untransformed border box; it is integer-rounded, so it is only
    // used when a rotation is actually in play — unrotated nodes keep the
    // exact fractional rect they already had.
    const { width, height } = untransformedSize(
      el,
      rect,
      rotationActive,
      toLocal,
    );
    const [centreX, centreY] = applyAffine(
      toLocal,
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    const relRect: FigmaSvgRect = {
      x: centreX - width / 2,
      y: centreY - height / 2,
      width,
      height,
    };
    // A rasterized node is a SCREENSHOT of its region, so a box-moving
    // transform is already in its pixels: it keeps the transformed box and must
    // not have the matrix applied a second time. The importer's
    // angular-gradient overlay is exactly this — a conic gradient has no SVG
    // equivalent, so it rasterizes, and reconstructing its untransformed box
    // then re-applying the scale squashed it into a strip.
    const rasterGeometry = movesBox
      ? (() => {
          const [tx, ty] = applyAffine(
            toLocal,
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return {
            rect: {
              x: tx - rect.width / 2,
              y: ty - rect.height / 2,
              width: rect.width,
              height: rect.height,
            },
            reflection: undefined,
          };
        })()
      : {};

    const name = el.getAttribute("data-agent-native-layer-name") || undefined;
    const id = el.getAttribute("data-agent-native-node-id") || nextId();
    const tag = el.tagName.toUpperCase();

    const widths = [
      Number.parseFloat(style.borderTopWidth) || 0,
      Number.parseFloat(style.borderRightWidth) || 0,
      Number.parseFloat(style.borderBottomWidth) || 0,
      Number.parseFloat(style.borderLeftWidth) || 0,
    ];
    const colors = [
      style.borderTopColor,
      style.borderRightColor,
      style.borderBottomColor,
      style.borderLeftColor,
    ];
    const styles = [
      style.borderTopStyle,
      style.borderRightStyle,
      style.borderBottomStyle,
      style.borderLeftStyle,
    ];
    const borderNonUniform =
      widths.some((w) => Math.abs(w - widths[0]) > 0.5) ||
      colors.some((c) => c !== colors[0]) ||
      styles.some((s) => s !== styles[0]);

    const base = {
      id,
      name,
      domTag: tag,
      rect: relRect,
      rotationDeg: ownRotation,
      // A rasterized node is a screenshot of its region, so the mirror is
      // already in its pixels and must not be applied a second time.
      reflection: ownReflection ?? undefined,
      clipsContent:
        style.overflow !== "visible" && style.overflow !== ""
          ? true
          : undefined,
      opacity: Number.parseFloat(style.opacity || "1"),
      cornerRadiiRaw: (() => {
        // getComputedStyle keeps a percentage radius as a percentage, and
        // `parseFloat("50%")` is 50 — so a 125px circle became a rounded square
        // with 50px corners and a 338x71 ring collapsed to two straight lines.
        // A percentage resolves against the element's own box, per axis.
        const axis = (raw: string, along: number, across: number) => {
          const parts = String(raw || "0")
            .trim()
            .split(/\s+/);
          const one = (v: string, basis: number) =>
            v.endsWith("%")
              ? ((Number.parseFloat(v) || 0) / 100) * basis
              : Number.parseFloat(v) || 0;
          return {
            x: one(parts[0] ?? "0", along),
            y: one(parts[1] ?? parts[0] ?? "0", across),
          };
        };
        const w = relRect.width;
        const h = relRect.height;
        const tl = axis(style.borderTopLeftRadius, w, h);
        const tr = axis(style.borderTopRightRadius, w, h);
        const br = axis(style.borderBottomRightRadius, w, h);
        const bl = axis(style.borderBottomLeftRadius, w, h);
        // CSS shrinks every corner by one shared factor when the radii along
        // an edge would overlap, and getComputedStyle reports the value BEFORE
        // that — a pill written `border-radius: 999px` comes back as literally
        // "999px". Testing the raw value said "999 >= half the width AND half
        // the height", so every pill exported as a true ellipse (rx = w/2)
        // instead of a stadium (rx = ry = h/2). Scaling first is also what
        // makes the emitted radius correct, not just the flag: a `<rect
        // rx="999">` would be clamped by the renderer to the same ellipse.
        const ratio = (edge: number, a: number, b: number) =>
          a + b > 0 ? edge / (a + b) : Number.POSITIVE_INFINITY;
        const f = Math.min(
          1,
          ratio(w, tl.x, tr.x),
          ratio(w, bl.x, br.x),
          ratio(h, tl.y, bl.y),
          ratio(h, tr.y, br.y),
        );
        for (const r of [tl, tr, br, bl]) {
          r.x *= f;
          r.y *= f;
        }
        const halves = (r: { x: number; y: number }) =>
          w > 0 && h > 0 && r.x >= w / 2 - 0.01 && r.y >= h / 2 - 0.01;
        const ellipse = halves(tl) && halves(tr) && halves(br) && halves(bl);
        return {
          tl: tl.x,
          tr: tr.x,
          br: br.x,
          bl: bl.x,
          ...(ellipse ? { ellipse: true } : {}),
        };
      })(),
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      backgroundSize: style.backgroundSize,
      backgroundPosition: style.backgroundPosition,
      backgroundRepeat: style.backgroundRepeat,
      boxShadow: style.boxShadow,
      // `el.style`, not the computed value: a custom property INHERITS, so
      // `getComputedStyle` hands every descendant its ancestor's shadow. The
      // importer writes this inline, so the own-declaration read is the one
      // that means "this layer's shadow".
      contentShadow: (el as HTMLElement).style
        ?.getPropertyValue("--figma-content-shadow")
        .trim(),
      borderWidthPx: Math.max(
        ...widths.map((w, i) => (styles[i] === "none" ? 0 : w)),
      ),
      borderColor: colors[0],
      borderStyle: styles[0],
      borderNonUniform,
      outlineWidthPx:
        style.outlineStyle && style.outlineStyle !== "none"
          ? Number.parseFloat(style.outlineWidth) || 0
          : 0,
      outlineColor: style.outlineColor,
      outlineOffsetPx: Number.parseFloat(style.outlineOffset) || 0,
      outlineDashed:
        style.outlineStyle === "dashed" || style.outlineStyle === "dotted",
      borderWidths: widths as [number, number, number, number],
      borderColors: colors as [string, string, string, string],
      borderStyles: styles as [string, string, string, string],
      backdropFilter:
        (style as CSSStyleDeclaration & { backdropFilter?: string })
          .backdropFilter || "none",
      // The walk used to snapshot a fixed whitelist that omitted these three,
      // and the rasterize escape hatch below did not mention them either — so a
      // blur, a blend mode and a nearest-neighbour image fill were dropped from
      // the export with NOTHING in the report. `fills-effects` lost a multiply
      // blend and a layer blur that way and still reported "0 omitted".
      filter: style.filter || "none",
      mixBlendMode: style.mixBlendMode || "normal",
      imageRendering: style.imageRendering || "auto",
      // `row-gap`/`column-gap` compute to "normal" outside a flex/grid
      // container, and `flex-basis` keeps the SPECIFIED keyword/length —
      // unlike width/height, which compute to used pixels and so cannot tell
      // an authored size from a content-derived one.
      layout: {
        display: style.display,
        flexDirection: style.flexDirection,
        flexWrap: style.flexWrap,
        justifyContent: style.justifyContent,
        alignItems: style.alignItems,
        rowGapPx: Number.parseFloat(style.rowGap) || 0,
        columnGapPx: Number.parseFloat(style.columnGap) || 0,
        paddingPx: [
          Number.parseFloat(style.paddingTop) || 0,
          Number.parseFloat(style.paddingRight) || 0,
          Number.parseFloat(style.paddingBottom) || 0,
          Number.parseFloat(style.paddingLeft) || 0,
        ] as [number, number, number, number],
        position: style.position,
        flexGrow: Number.parseFloat(style.flexGrow) || 0,
        flexShrink: Number.parseFloat(style.flexShrink) || 0,
        flexBasis: style.flexBasis,
        alignSelf: style.alignSelf,
      },
      isLeafText: false,
      children: [] as RawFigmaSvgNode[],
    };

    if (tag === "VIDEO" || tag === "CANVAS" || tag === "IFRAME") {
      return {
        ...base,
        ...rasterGeometry,
        rasterReason: `<${tag.toLowerCase()}> content has no SVG equivalent — rasterized via screenshot.`,
      };
    }
    if (base.backdropFilter !== "none") {
      return {
        ...base,
        ...rasterGeometry,
        rasterReason:
          "backdrop-filter cannot be expressed in SVG — rasterized this element's region via screenshot.",
      };
    }
    // A lone blur maps to feGaussianBlur, which Figma imports as a real
    // LAYER_BLUR. Anything else — a drop-shadow, a saturate, a chain — has no
    // SVG equivalent this exporter builds, so it rasterizes rather than
    // silently losing the effect.
    // This walk is serialized into the page, so the drop-shadow test is inlined
    // rather than calling a module-scope helper that is not defined there.
    const filterText = base.filter.trim();
    // Not for an `<img>`: the image branch of the hydrator carries no shadows,
    // so vectorizing one would silently drop a shadow the raster path keeps.
    const isLoneDropShadow =
      tag !== "IMG" &&
      filterText.startsWith("drop-shadow(") &&
      filterText.endsWith(")") &&
      filterText.indexOf("drop-shadow(", 12) === -1 &&
      !/\b(?:blur|saturate|brightness|contrast|grayscale|sepia|invert|hue-rotate|opacity)\(/.test(
        filterText,
      );
    if (
      base.filter !== "none" &&
      !/^blur\(\s*[\d.]+px\s*\)$/.test(filterText) &&
      !isLoneDropShadow
    ) {
      return {
        ...base,
        ...rasterGeometry,
        rasterReason: `CSS filter "${base.filter.slice(0, 60)}" has no SVG equivalent here — rasterized this element's region via screenshot.`,
      };
    }
    // A CSS clip-path or mask reshapes what the element paints, and the box
    // model this exporter builds has no way to carry an arbitrary one — so a
    // masked element exported at full size. Positivus' contact block is a
    // black rectangle revealed through a starburst; unmasked it covered the
    // whole form. A screenshot of the region reproduces the mask exactly.
    if (
      (style.clipPath && style.clipPath !== "none") ||
      (style.maskImage && style.maskImage !== "none") ||
      (style.webkitMaskImage && style.webkitMaskImage !== "none")
    ) {
      return {
        ...base,
        ...rasterGeometry,
        rasterReason:
          "clip-path / mask has no SVG equivalent here — rasterized this element's region via screenshot.",
      };
    }
    // SVG has no conic gradient, and the paint builder answered that by
    // dropping the layer — Figma received a blank tile where the design has an
    // angular gradient. A screenshot of the region reproduces it exactly. Only
    // for a leaf: rasterizing a container would flatten real children that
    // export perfectly well on their own, and they would also still be walked
    // and drawn underneath it.
    if (
      el.children.length === 0 &&
      /(^|[\s,(])(repeating-)?conic-gradient\(/i.test(
        base.backgroundImage || "",
      )
    ) {
      return {
        ...base,
        ...rasterGeometry,
        rasterReason:
          "conic-gradient has no SVG equivalent — rasterized this element's region via screenshot.",
      };
    }
    // The fill builder resolves every gradient layer against the whole box, so
    // a background TILED with its own background-size/position exports as one
    // stretched gradient. The importer draws a Figma diamond gradient as four
    // quadrant tiles precisely because CSS has no diamond, and flattening them
    // turned a four-pointed star back into a single diagonal ramp on the way
    // out. Rasterizing the leaf reproduces whatever the tiles draw.
    if (
      el.children.length === 0 &&
      /gradient\(/i.test(base.backgroundImage || "") &&
      /\d\s*px/.test(style.backgroundSize || "")
    ) {
      return {
        ...base,
        ...rasterGeometry,
        rasterReason:
          "tiled gradient background (per-layer background-size) has no SVG equivalent — rasterized this element's region via screenshot.",
      };
    }

    // An inline <svg> is already vector art. Its children paint through
    // presentation attributes and a viewBox scale that the box/text model
    // cannot express, so walking into them yields an empty hole.
    if (tag === "SVG") {
      return { ...base, svgMarkup: serializeInlineSvg(el) };
    }

    if (tag === "IMG") {
      const img = el as HTMLImageElement;
      return {
        ...base,
        imgSrc: img.currentSrc || img.src,
        imgObjectFit: view.getComputedStyle(img).objectFit,
        imgObjectPosition: view.getComputedStyle(img).objectPosition,
      };
    }

    const extracted = extractTextLines(el, toLocal, rotationActive);
    const lines = extracted?.lines ?? null;
    const textStyle = lines
      ? {
          fontFamily: style.fontFamily,
          fontSizePx: Number.parseFloat(style.fontSize) || 16,
          fontWeight: Number.parseInt(style.fontWeight, 10) || 400,
          italic: style.fontStyle === "italic",
          letterSpacingPx:
            style.letterSpacing === "normal"
              ? 0
              : Number.parseFloat(style.letterSpacing) || 0,
          color: style.color,
          textAlign: style.textAlign,
          resolvedFontFamily: resolveFontFamily(style.fontFamily),
          // `line-height: normal` has no px value — it means "the font's own
          // default", which is exactly Figma's AUTO line height. Substituting
          // the border-box height here made every unstyled button ship a
          // 31px line height for 13px type.
          lineHeightPx:
            style.lineHeight === "normal"
              ? undefined
              : Number.parseFloat(style.lineHeight) || undefined,
        }
      : undefined;

    // A FULL extraction consumed everything this element renders, so it is a
    // leaf. A PARTIAL one only took the direct runs — the element children
    // still carry paint of their own and must be walked below.
    if (lines && textStyle && !extracted!.partial) {
      return { ...base, isLeafText: true, textLines: lines, textStyle };
    }

    const children: RawFigmaSvgNode[] = [];
    // The renderer wraps this node's children in `rotate(own, centre)`, so the
    // children must be measured in the space that rotation establishes.
    // Composed in the node's OWN local space, where both the rotation and its
    // centre live. Un-rotating in page space first and mapping afterwards
    // measures identically (1.810% on `effects-transforms` either way) because
    // a rigid ancestor commutes with it; the two only diverge once an ancestor
    // scales or skews, which is tracked separately below.
    let childToLocal = ownRotation
      ? composeAffine(rotationAbout(-ownRotation, centreX, centreY), toLocal)
      : toLocal;
    // The renderer wraps the children in the reflection as well, so they have
    // to be measured with it undone — otherwise every child of a mirrored
    // layer is mirrored twice. A reflection is its own inverse, so the same
    // matrix undoes it.
    if (ownReflection) {
      const [ra, rb, rc, rd] = ownReflection;
      const det = ra * rd - rc * rb;
      // A reflection is its own inverse; a scale or skew is not.
      const [a, b, c, d] =
        Math.abs(det) < 1e-9
          ? [1, 0, 0, 1]
          : [rd / det, -rb / det, -rc / det, ra / det];
      childToLocal = composeAffine(
        [
          a,
          b,
          c,
          d,
          centreX - (a * centreX + c * centreY),
          centreY - (b * centreX + d * centreY),
        ],
        childToLocal,
      );
    }
    for (const child of Array.from(el.children)) {
      const childNode = walk(child, childToLocal, rotationActive);
      if (childNode) children.push(childNode);
    }
    return {
      ...base,
      children,
      ...(lines && textStyle ? { textLines: lines, textStyle } : {}),
    };
  }

  const rootNode = walk(
    root,
    [1, 0, 0, 1, -originRect.left, -originRect.top],
    false,
  );
  if (!rootNode) return null;
  return {
    root: rootNode,
    originOffset: { x: originRect.left, y: originRect.top },
  };
}
