/**
 * design-to-figma-svg.ts — serialize the design element model (absolutely
 * positioned boxes + flex auto-layout containers, text, images, solid/
 * gradient/image fills, borders, border-radius, shadows/blurs, opacity,
 * rotation) into a standalone, GENUINELY VECTOR SVG document that Figma
 * imports as editable shapes — not the `foreignObject` wrapper produced by
 * `buildSvgForeignObject` in `design-export.ts` (that one round-trips the
 * live DOM/CSS for the editor's own "Download SVG" command, but Figma cannot
 * import `foreignObject` content as vectors — it stays an opaque embedded
 * HTML blob). This module builds real `<rect>`/`<path>`/`<text>`/`<image>`
 * markup with `<linearGradient>`/`<radialGradient>`/`<filter>` defs, which
 * Figma's SVG importer parses into normal editable layers.
 *
 * Two layers:
 *
 *  1. A pure, browser-free SCENE -> SVG serializer (`buildFigmaSvgDocument`
 *     and its helpers below). It consumes a `FigmaSvgNode` tree — plain
 *     data, no DOM — and emits SVG markup plus an export report. This is
 *     the part covered by `design-to-figma-svg.spec.ts` with hand-built
 *     fixture nodes (gradient stops, rounded-rect path commands, stroke
 *     inset geometry, tspan positions).
 *
 *  2. A Playwright-based SCENE EXTRACTOR (`renderDesignToFigmaSvg`, backed by
 *     the in-page `collectRawFigmaSvgScene` walk) that renders the design's
 *     real stored HTML in headless Chromium (mirrors
 *     `take-design-screenshot.ts`'s launch/import pattern) and walks the
 *     live, laid-out DOM to build a `FigmaSvgNode` tree from real
 *     `getBoundingClientRect()` / `getComputedStyle()` values. Delegating
 *     geometry to the actual browser layout engine is what makes the boxes
 *     PIXEL-PERFECT without reimplementing flexbox/auto-layout math by hand
 *     — the same reason `take-design-screenshot.ts` renders instead of
 *     statically analyzing HTML. This half is exercised in practice via the
 *     `export-design-as-figma-svg` action, not vitest (same split as
 *     `collectPageDiagnostics` in `take-design-screenshot.ts` — see that
 *     file's spec docblock for the rationale).
 */

import {
  isBlockedExtensionUrlWithDns,
  ssrfSafeFetch,
} from "@agent-native/core/extensions/url-safety";

import { parseCssColorExtended } from "../../shared/color-utils.js";
import { importPlaywright, launchChromium } from "./playwright-runtime.js";

export const MAX_EMBEDDED_IMAGE_BYTES = 8 * 1024 * 1024;
const EMBEDDED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

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
}

export const ZERO_RADII: FigmaSvgCornerRadii = { tl: 0, tr: 0, br: 0, bl: 0 };

export interface FigmaSvgColorStop {
  /** 0-1 */
  offset: number;
  /** Any valid SVG color (rgb()/rgba()/#hex/named). */
  color: string;
}

export type FigmaSvgFillLayer =
  | { kind: "solid"; color: string }
  | { kind: "linear-gradient"; angleDeg: number; stops: FigmaSvgColorStop[] }
  | {
      kind: "radial-gradient";
      stops: FigmaSvgColorStop[];
      /** objectBoundingBox 0-1, default centered circle. */
      cx?: number;
      cy?: number;
      r?: number;
    }
  | {
      kind: "image";
      href: string;
      fit: "cover" | "contain" | "stretch";
    };

export interface FigmaSvgShadow {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: string;
  inset?: boolean;
}

export interface FigmaSvgBorder {
  widthPx: number;
  color: string;
  dashed?: boolean;
  /** Set when the source had non-uniform per-side width/color/style and we
   *  fell back to one representative side — surfaced as "approximated". */
  nonUniform?: boolean;
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
}

export interface FigmaSvgNode {
  /** Stable id used for SVG element ids / gradient-def ids / the export report. */
  id: string;
  /** Human label (from data-agent-native-layer-name or a fallback). */
  name?: string;
  kind: "box" | "text" | "image" | "raster";
  rect: FigmaSvgRect;
  rotationDeg?: number;
  /** 0-1; omit or 1 for fully opaque. */
  opacity?: number;
  cornerRadii?: FigmaSvgCornerRadii;
  /** CSS order: index 0 is the TOPMOST paint layer (painted last in SVG). */
  fills?: FigmaSvgFillLayer[];
  border?: FigmaSvgBorder;
  /** Non-inset drop shadows; inset shadows are reported as approximated/omitted. */
  shadows?: FigmaSvgShadow[];
  text?: { lines: FigmaSvgTextLine[]; style: FigmaSvgTextStyle };
  image?: { href: string; fit: "cover" | "contain" | "stretch" };
  /** Fully rasterized fallback (video/canvas/iframe/backdrop-blur/other unsupported paint). */
  raster?: { href: string; reason: string };
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

function stopMarkup(stops: FigmaSvgColorStop[]): string {
  return stops
    .map(
      (s) =>
        `<stop offset="${n(s.offset * 100)}%" stop-color="${escapeXmlAttr(s.color)}"/>`,
    )
    .join("");
}

export function buildLinearGradientDef(
  id: string,
  angleDeg: number,
  stops: FigmaSvgColorStop[],
): string {
  const rotation = gradientAngleToRotation(angleDeg);
  return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0" gradientTransform="rotate(${n(rotation)} 0.5 0.5)">${stopMarkup(stops)}</linearGradient>`;
}

export function buildRadialGradientDef(
  id: string,
  stops: FigmaSvgColorStop[],
  opts?: { cx?: number; cy?: number; r?: number },
): string {
  const cx = opts?.cx ?? 0.5;
  const cy = opts?.cy ?? 0.5;
  const r = opts?.r ?? 0.5;
  return `<radialGradient id="${id}" cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}">${stopMarkup(stops)}</radialGradient>`;
}

// ---------------------------------------------------------------------------
// Computed-style string parsers — pure, unit-testable without a browser.
// These assume Chromium's normalized `getComputedStyle` output (the engine
// `extractFigmaSvgScene` renders with), documented per-function.
// ---------------------------------------------------------------------------

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
 * Parses Chromium's computed `box-shadow` string, e.g.
 * `"rgba(0, 0, 0, 0.25) 0px 4px 12px 0px"` or `"rgb(0,0,0) 0px 2px 4px 0px inset"`,
 * including multiple comma-separated shadows.
 */
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

function parseColorStop(part: string): FigmaSvgColorStop {
  const trimmed = part.trim();
  const percentMatch = trimmed.match(/(-?[\d.]+)%\s*$/);
  if (!percentMatch) return { offset: 0, color: trimmed };
  const offset = Number.parseFloat(percentMatch[1]) / 100;
  const color = trimmed.slice(0, percentMatch.index).trim();
  return { offset, color };
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
  return { angleDeg, stops: stopParts.map(parseColorStop) };
}

/**
 * Parses Chromium's computed `radial-gradient(...)` string. Shape/position
 * nuances (ellipse vs circle, off-center `at` position) are not modeled —
 * always mapped to a centered circle spanning the element's bounding box —
 * so callers should surface this as an approximation.
 */
export function parseComputedRadialGradient(
  value: string,
): { stops: FigmaSvgColorStop[] } | null {
  const match = value.match(/radial-gradient\((.*)\)\s*$/s);
  if (!match) return null;
  const parts = splitTopLevelCommas(match[1]);
  const stopParts = /\bat\b|circle|ellipse/.test(parts[0] ?? "")
    ? parts.slice(1)
    : parts;
  return { stops: stopParts.map(parseColorStop) };
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
): string {
  if (fit === "stretch" || fit === "none") return "none";
  if (fit === "contain" || fit === "scale-down") return "xMidYMid meet";
  return "xMidYMid slice"; // cover (default)
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
    floodColor: `rgb(${Math.round(parsed.r)}, ${Math.round(parsed.g)}, ${Math.round(parsed.b)})`,
    floodOpacity: parsed.a,
  };
}

/**
 * Builds a `<filter>` def for the non-inset shadows in `shadows` (inset
 * shadows are the caller's responsibility to report as approximated/omitted
 * — SVG has no direct inset-shadow primitive). Shadows with `spread === 0`
 * use a plain `feDropShadow` chain; any shadow with a non-zero spread needs
 * the decomposed feMorphology (dilate/erode) + feGaussianBlur + feOffset +
 * feFlood + feComposite chain, since `feDropShadow` has no spread parameter.
 * `stdDeviation = blur / 2` is the standard CSS-blur-radius-to-SVG-Gaussian
 * conversion used across browsers/renderers.
 */
export function buildShadowFilterDef(
  id: string,
  shadows: FigmaSvgShadow[],
): string {
  const outer = shadows.filter((s) => !s.inset);
  if (outer.length === 0) return "";

  if (outer.every((s) => s.spread === 0)) {
    const drops = outer
      .map((s) => {
        const { floodColor, floodOpacity } = floodColorParts(s.color);
        return `<feDropShadow dx="${n(s.offsetX)}" dy="${n(s.offsetY)}" stdDeviation="${n(s.blur / 2)}" flood-color="${escapeXmlAttr(floodColor)}" flood-opacity="${n(floodOpacity)}"/>`;
      })
      .join("");
    return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${drops}</filter>`;
  }

  const parts = outer
    .map((s, i) => {
      const morph =
        s.spread !== 0
          ? `<feMorphology in="SourceAlpha" operator="${s.spread > 0 ? "dilate" : "erode"}" radius="${n(Math.abs(s.spread))}" result="spread${i}"/>`
          : "";
      const blurIn = s.spread !== 0 ? `spread${i}` : "SourceAlpha";
      const { floodColor, floodOpacity } = floodColorParts(s.color);
      return (
        `${morph}` +
        `<feGaussianBlur in="${blurIn}" stdDeviation="${n(s.blur / 2)}" result="blur${i}"/>` +
        `<feOffset in="blur${i}" dx="${n(s.offsetX)}" dy="${n(s.offsetY)}" result="offset${i}"/>` +
        `<feFlood flood-color="${escapeXmlAttr(floodColor)}" flood-opacity="${n(floodOpacity)}" result="color${i}"/>` +
        `<feComposite in="color${i}" in2="offset${i}" operator="in" result="shadow${i}"/>`
      );
    })
    .join("");
  const merge = `<feMerge>${outer.map((_, i) => `<feMergeNode in="shadow${i}"/>`).join("")}<feMergeNode in="SourceGraphic"/></feMerge>`;
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${parts}${merge}</filter>`;
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
  node: Pick<FigmaSvgNode, "rect" | "rotationDeg" | "opacity">,
): string {
  const attrs: string[] = [];
  if (node.rotationDeg) {
    const cx = node.rect.x + node.rect.width / 2;
    const cy = node.rect.y + node.rect.height / 2;
    attrs.push(`transform="rotate(${n(node.rotationDeg)} ${n(cx)} ${n(cy)})"`);
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
    ctx.defs.push(buildLinearGradientDef(id, fill.angleDeg, fill.stops));
    const isSquareish = Math.abs(node.rect.width - node.rect.height) < 1;
    if (!isSquareish) {
      ctx.report.approximated.push({
        node: node.name || node.id,
        note: "Linear gradient angle mapped via objectBoundingBox rotation; exact for square elements, approximated for this element's non-square aspect ratio.",
      });
    }
    return `url(#${id})`;
  }

  if (fill.kind === "radial-gradient") {
    const id = ctx.nextId("rg");
    ctx.defs.push(
      buildRadialGradientDef(id, fill.stops, {
        cx: fill.cx,
        cy: fill.cy,
        r: fill.r,
      }),
    );
    ctx.report.approximated.push({
      node: node.name || node.id,
      note: "Radial gradient shape/position approximated as a centered circle over the element's bounding box.",
    });
    return `url(#${id})`;
  }

  // image fill
  const id = ctx.nextId("img-fill");
  const par = objectFitToPreserveAspectRatio(fill.fit);
  ctx.defs.push(
    `<pattern id="${id}" patternUnits="objectBoundingBox" width="1" height="1"><image href="${escapeXmlAttr(fill.href)}" x="0" y="0" width="${n(node.rect.width)}" height="${n(node.rect.height)}" preserveAspectRatio="${par}"/></pattern>`,
  );
  ctx.report.approximated.push({
    node: node.name || node.id,
    note: "Background-image fill approximated via an objectBoundingBox pattern; exact cover/contain cropping may differ from the browser for extreme aspect ratios.",
  });
  return `url(#${id})`;
}

function renderBox(node: FigmaSvgNode, ctx: RenderCtx): string {
  const rect = node.rect;
  const radii = node.cornerRadii ?? ZERO_RADII;
  const fills = node.fills ?? [];

  let filterId: string | null = null;
  if (node.shadows && node.shadows.length > 0) {
    const insetShadows = node.shadows.filter((s) => s.inset);
    if (insetShadows.length > 0) {
      ctx.report.approximated.push({
        node: node.name || node.id,
        note: `${insetShadows.length} inset shadow(s) omitted — SVG has no direct inset-shadow primitive.`,
      });
    }
    const id = ctx.nextId("shadow");
    const def = buildShadowFilterDef(id, node.shadows);
    if (def) {
      ctx.defs.push(def);
      filterId = id;
    }
  }

  const fillTag = (
    r: FigmaSvgRect,
    radiiForShape: FigmaSvgCornerRadii,
    paint: string,
    filterAttr: string,
  ) =>
    isUniformRadius(radiiForShape)
      ? `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.width)}" height="${n(r.height)}"${radiiForShape.tl ? ` rx="${n(radiiForShape.tl)}"` : ""} fill="${paint}"${filterAttr}/>`
      : `<path d="${roundedRectPath(r, radiiForShape)}" fill="${paint}"${filterAttr}/>`;

  // CSS background layer 0 is the TOPMOST paint; SVG paints later elements
  // on top, so emit layers in reverse (last CSS layer first). Only the
  // topmost (last-emitted) shape carries the shadow filter — lower layers
  // must not double-apply it.
  //
  // A box with no fills, no border, and no shadow filter is a pure layout
  // wrapper — a flex container div, or <body> itself when exporting a whole
  // screen — that paints nothing in the browser. Emitting a `fill="none"`
  // placeholder shape for it anyway produces a phantom layer Figma imports
  // as a real (if invisible) shape at whatever oversized bounds that
  // wrapper happens to have (e.g. <body>'s own box stretching to the full
  // render viewport width). Only synthesize a shapeless carrier rect when a
  // shadow filter needs geometry to attach to.
  const layers =
    fills.length > 0
      ? fills
      : filterId
        ? [{ kind: "solid", color: "none" } as FigmaSvgFillLayer]
        : [];
  const reversedLayers = layers.slice().reverse();
  let body = reversedLayers
    .map((f, i) => {
      const isTopmost = i === reversedLayers.length - 1;
      const paint = resolveFillPaint(f, node, ctx);
      const filterAttr =
        isTopmost && filterId ? ` filter="url(#${filterId})"` : "";
      return fillTag(rect, radii, paint, filterAttr);
    })
    .join("");

  if (node.border && node.border.widthPx > 0) {
    const insetRect = insetRectForStroke(rect, node.border.widthPx);
    const insetRadii = insetRadiiForStroke(radii, node.border.widthPx);
    const dash = node.border.dashed
      ? ` stroke-dasharray="${n(node.border.widthPx * 2)} ${n(node.border.widthPx)}"`
      : "";
    body += isUniformRadius(insetRadii)
      ? `<rect x="${n(insetRect.x)}" y="${n(insetRect.y)}" width="${n(insetRect.width)}" height="${n(insetRect.height)}"${insetRadii.tl ? ` rx="${n(insetRadii.tl)}"` : ""} fill="none" stroke="${escapeXmlAttr(node.border.color)}" stroke-width="${n(node.border.widthPx)}"${dash}/>`
      : `<path d="${roundedRectPath(insetRect, insetRadii)}" fill="none" stroke="${escapeXmlAttr(node.border.color)}" stroke-width="${n(node.border.widthPx)}"${dash}/>`;
    if (node.border.nonUniform) {
      ctx.report.approximated.push({
        node: node.name || node.id,
        note: "Border had differing per-side width/color/style; rendered using one representative side.",
      });
    }
  }

  ctx.report.vectorized.push(node.name || node.id);
  const childrenMarkup = (node.children ?? [])
    .map((child) => renderFigmaSvgNode(child, ctx))
    .join("");
  return wrapGroup(body + childrenMarkup, node);
}

function renderText(node: FigmaSvgNode, ctx: RenderCtx): string {
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
    `fill="${escapeXmlAttr(style.color)}"`,
    `text-anchor="${anchor}"`,
    `dominant-baseline="central"`,
  ]
    .filter(Boolean)
    .join(" ");

  ctx.report.vectorized.push(node.name || node.id);
  return wrapGroup(`<text ${attrs}>${tspans}</text>`, node);
}

function renderImage(node: FigmaSvgNode, ctx: RenderCtx): string {
  if (!node.image) return "";
  const rect = node.rect;
  const radii = node.cornerRadii ?? ZERO_RADII;
  const par = objectFitToPreserveAspectRatio(node.image.fit);
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
  return wrapGroup(markup, node);
}

function renderRaster(node: FigmaSvgNode, ctx: RenderCtx): string {
  if (!node.raster) return "";
  ctx.report.rasterized.push({
    node: node.name || node.id,
    reason: node.raster.reason,
  });
  const rect = node.rect;
  const markup = `<image x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.width)}" height="${n(rect.height)}" href="${escapeXmlAttr(node.raster.href)}" preserveAspectRatio="none"/>`;
  return wrapGroup(markup, node);
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
      "SVG <text> elements have pixel-exact geometry, but Figma converts ALL " +
      "imported SVG text to outlined vector paths on paste/drag-import — it " +
      "will not be live, editable type in Figma. This is a Figma import " +
      "limitation, not a defect in this export.",
  };
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
}

export interface RawFigmaSvgNode {
  id: string;
  name?: string;
  domTag: string;
  rect: FigmaSvgRect;
  rotationDeg: number;
  opacity: number;
  cornerRadiiRaw: FigmaSvgCornerRadii;
  /** Computed `background-color`, e.g. "rgba(0, 0, 0, 0)" or "rgb(255, 255, 255)". */
  backgroundColor: string;
  /** Computed `background-image`, e.g. "none" or a comma-separated gradient/url list. */
  backgroundImage: string;
  /** Computed `box-shadow`, e.g. "none" or a Chromium-normalized shadow list. */
  boxShadow: string;
  borderWidthPx: number;
  borderColor: string;
  borderStyle: string;
  borderNonUniform: boolean;
  backdropFilter: string;
  isLeafText: boolean;
  textLines?: RawFigmaSvgTextLine[];
  textStyle?: RawFigmaSvgTextStyle;
  imgSrc?: string;
  imgObjectFit?: string;
  /** Set when this node must be rasterized (video/canvas/iframe/backdrop-blur/other unsupported paint). */
  rasterReason?: string;
  /** Filled in by the orchestrator after a screenshot crop (data: URI or hosted URL). */
  rasterHref?: string;
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
export function buildFillLayersFromComputedStyle(
  backgroundColor: string,
  backgroundImage: string,
): FigmaSvgFillLayer[] {
  const layers: FigmaSvgFillLayer[] = [];

  if (backgroundImage && backgroundImage !== "none") {
    for (const part of splitTopLevelCommas(backgroundImage)) {
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
          layers.push({ kind: "radial-gradient", stops: parsed.stops });
      } else if (part.startsWith("url(")) {
        const hrefMatch = part.match(/url\((["']?)(.*?)\1\)/);
        if (hrefMatch)
          layers.push({ kind: "image", href: hrefMatch[2], fit: "cover" });
      }
    }
  }

  const bg = parseCssColorExtended(backgroundColor);
  if (bg && bg.a > 0) {
    layers.push({
      kind: "solid",
      color: `rgba(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)}, ${bg.a})`,
    });
  }

  return layers;
}

/** Pure hydration: `RawFigmaSvgNode` (browser-extracted computed strings + geometry) -> `FigmaSvgNode`. */
export function hydrateRawFigmaSvgNode(raw: RawFigmaSvgNode): FigmaSvgNode {
  const rotationDeg = raw.rotationDeg ? raw.rotationDeg : undefined;
  const opacity = raw.opacity !== 1 ? raw.opacity : undefined;

  if (raw.rasterReason) {
    return {
      id: raw.id,
      name: raw.name,
      kind: "raster",
      rect: raw.rect,
      rotationDeg,
      opacity,
      raster: { href: raw.rasterHref ?? "", reason: raw.rasterReason },
    };
  }

  if (raw.isLeafText && raw.textLines && raw.textStyle) {
    const textAlign =
      raw.textStyle.textAlign === "center" ||
      raw.textStyle.textAlign === "right" ||
      raw.textStyle.textAlign === "justify"
        ? raw.textStyle.textAlign
        : "left";
    return {
      id: raw.id,
      name: raw.name,
      kind: "text",
      rect: raw.rect,
      rotationDeg,
      opacity,
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
        },
      },
    };
  }

  if (raw.domTag === "IMG" && raw.imgSrc) {
    return {
      id: raw.id,
      name: raw.name,
      kind: "image",
      rect: raw.rect,
      rotationDeg,
      opacity,
      cornerRadii: isZeroRadii(raw.cornerRadiiRaw)
        ? undefined
        : raw.cornerRadiiRaw,
      image: { href: raw.imgSrc, fit: objectFitFromRaw(raw.imgObjectFit) },
    };
  }

  const fills = buildFillLayersFromComputedStyle(
    raw.backgroundColor,
    raw.backgroundImage,
  );
  const shadows = parseComputedBoxShadow(raw.boxShadow);
  const border =
    raw.borderWidthPx > 0
      ? {
          widthPx: raw.borderWidthPx,
          color: raw.borderColor,
          dashed: raw.borderStyle === "dashed" || raw.borderStyle === "dotted",
          nonUniform: raw.borderNonUniform || undefined,
        }
      : undefined;

  return {
    id: raw.id,
    name: raw.name,
    kind: "box",
    rect: raw.rect,
    rotationDeg,
    opacity,
    cornerRadii: isZeroRadii(raw.cornerRadiiRaw)
      ? undefined
      : raw.cornerRadiiRaw,
    fills: fills.length > 0 ? fills : undefined,
    border,
    shadows: shadows.length > 0 ? shadows : undefined,
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

interface RawFigmaSvgSceneResult {
  root: RawFigmaSvgNode;
  /** The export root's absolute page-space offset, so the orchestrator can
   *  convert a raster node's origin-relative rect back to page coordinates
   *  for `page.screenshot({ clip })`. */
  originOffset: { x: number; y: number };
}

function collectRawFigmaSvgScene(
  rootSelector: string | null,
): RawFigmaSvgSceneResult | null {
  const root = rootSelector
    ? document.querySelector(rootSelector)
    : document.body;
  if (!root) return null;
  const originRect = root.getBoundingClientRect();
  let autoId = 0;

  function nextId(): string {
    autoId += 1;
    return `n${autoId}`;
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

  function isVisible(el: Element, style: CSSStyleDeclaration): boolean {
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (el.getAttribute("data-agent-native-hidden") === "true") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function splitLineOffsets(
    node: Text,
    totalLength: number,
    lineCount: number,
  ): number[] {
    const offsets: number[] = [];
    let start = 0;
    const range = document.createRange();
    for (let line = 0; line < lineCount - 1; line++) {
      let lo = start;
      let hi = totalLength;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        range.setStart(node, start);
        range.setEnd(node, mid);
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

  function extractTextLines(el: Element): RawFigmaSvgTextLine[] | null {
    const textNode = Array.from(el.childNodes).find(
      (c) =>
        c.nodeType === Node.TEXT_NODE &&
        (c.textContent || "").trim().length > 0,
    ) as Text | undefined;
    if (!textNode || el.children.length > 0) return null;
    const full = textNode.textContent || "";
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rawRects = Array.from(range.getClientRects());
    if (rawRects.length === 0) return null;
    const lineRects = groupRectsByLine(rawRects);
    if (lineRects.length === 0) return null;

    const style = getComputedStyle(el);
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
    const anchorX = (rect: DOMRect) => {
      if (textAlign === "center") return rect.left + rect.width / 2;
      if (textAlign === "right" || textAlign === "end") return rect.right;
      return rect.left;
    };

    if (lineRects.length === 1) {
      const r = lineRects[0];
      return [
        {
          text: full.trim(),
          x: anchorX(r) - originRect.left,
          y: elRect.top + elRect.height / 2 - originRect.top,
        },
      ];
    }

    const offsets = splitLineOffsets(textNode, full.length, lineRects.length);
    let start = 0;
    return lineRects.map((r, i) => {
      const end = offsets[i] ?? full.length;
      const text = full.slice(start, end).trim();
      start = end;
      return {
        text,
        x: anchorX(r) - originRect.left,
        y: elRect.top + lineHeightPx * (i + 0.5) - originRect.top,
      };
    });
  }

  function walk(el: Element): RawFigmaSvgNode | null {
    const style = getComputedStyle(el);
    if (!isVisible(el, style)) return null;

    const rect = el.getBoundingClientRect();
    const relRect: FigmaSvgRect = {
      x: rect.left - originRect.left,
      y: rect.top - originRect.top,
      width: rect.width,
      height: rect.height,
    };
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
      rotationDeg: rotationFromTransform(style.transform),
      opacity: Number.parseFloat(style.opacity || "1"),
      cornerRadiiRaw: {
        tl: Number.parseFloat(style.borderTopLeftRadius) || 0,
        tr: Number.parseFloat(style.borderTopRightRadius) || 0,
        br: Number.parseFloat(style.borderBottomRightRadius) || 0,
        bl: Number.parseFloat(style.borderBottomLeftRadius) || 0,
      },
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      boxShadow: style.boxShadow,
      borderWidthPx: styles[0] === "none" ? 0 : widths[0],
      borderColor: colors[0],
      borderStyle: styles[0],
      borderNonUniform,
      backdropFilter:
        (style as CSSStyleDeclaration & { backdropFilter?: string })
          .backdropFilter || "none",
      isLeafText: false,
      children: [] as RawFigmaSvgNode[],
    };

    if (tag === "VIDEO" || tag === "CANVAS" || tag === "IFRAME") {
      return {
        ...base,
        rasterReason: `<${tag.toLowerCase()}> content has no SVG equivalent — rasterized via screenshot.`,
      };
    }
    if (base.backdropFilter !== "none") {
      return {
        ...base,
        rasterReason:
          "backdrop-filter cannot be expressed in SVG — rasterized this element's region via screenshot.",
      };
    }

    if (tag === "IMG") {
      const img = el as HTMLImageElement;
      return {
        ...base,
        imgSrc: img.currentSrc || img.src,
        imgObjectFit: getComputedStyle(img).objectFit,
      };
    }

    const lines = extractTextLines(el);
    if (lines) {
      return {
        ...base,
        isLeafText: true,
        textLines: lines,
        textStyle: {
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
        },
      };
    }

    const children: RawFigmaSvgNode[] = [];
    for (const child of Array.from(el.children)) {
      const childNode = walk(child);
      if (childNode) children.push(childNode);
    }
    return { ...base, children };
  }

  const rootNode = walk(root);
  if (!rootNode) return null;
  return {
    root: rootNode,
    originOffset: { x: originRect.left, y: originRect.top },
  };
}

// ---------------------------------------------------------------------------
// Orchestration — renders the design's HTML in headless Chromium (same
// launch/import pattern as take-design-screenshot.ts), walks the live DOM,
// hydrates the result into a FigmaSvgNode tree, and serializes it to SVG.
// ---------------------------------------------------------------------------

export interface RenderFigmaSvgOptions {
  html: string;
  width: number;
  height: number;
  title?: string | null;
  /** CSS selector to scope a subtree export (e.g. `[data-agent-native-node-id="..."]`). */
  rootSelector?: string | null;
  /** Fetch and inline http(s) image `src`/background-image URLs as data: URIs. */
  embedImages?: boolean;
}

export async function embedRemoteImages(
  node: FigmaSvgNode,
  fetchImage: (url: string) => Promise<string | null> = fetchImageAsDataUri,
): Promise<Array<{ node: string; reason: string }>> {
  const jobs: Array<Promise<void>> = [];
  const omitted: Array<{ node: string; reason: string }> = [];

  function visit(n: FigmaSvgNode) {
    if (n.kind === "image" && n.image && /^https?:\/\//i.test(n.image.href)) {
      jobs.push(
        fetchImage(n.image.href).then((dataUri) => {
          if (!n.image) return;
          if (dataUri) {
            n.image.href = dataUri;
          } else {
            n.image.href = "";
            omitted.push({
              node: n.name || n.id,
              reason: "Remote image could not be safely embedded",
            });
          }
        }),
      );
    }
    for (const fill of n.fills ?? []) {
      if (fill.kind === "image" && /^https?:\/\//i.test(fill.href)) {
        jobs.push(
          fetchImage(fill.href).then((dataUri) => {
            if (dataUri) {
              fill.href = dataUri;
            } else {
              fill.href = "";
              omitted.push({
                node: n.name || n.id,
                reason: "Remote background image could not be safely embedded",
              });
            }
          }),
        );
      }
    }
    for (const child of n.children ?? []) visit(child);
  }
  visit(node);
  await Promise.all(jobs);
  return omitted;
}

type SafeImageFetch = typeof ssrfSafeFetch;

export async function fetchImageAsDataUri(
  url: string,
  safeFetch: SafeImageFetch = ssrfSafeFetch,
): Promise<string | null> {
  try {
    const res = await safeFetch(
      url,
      { signal: AbortSignal.timeout(10_000) },
      { maxRedirects: 3 },
    );
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!EMBEDDED_IMAGE_MIME_TYPES.has(contentType)) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const advertisedLength = Number(res.headers.get("content-length") || 0);
    if (
      Number.isFinite(advertisedLength) &&
      advertisedLength > MAX_EMBEDDED_IMAGE_BYTES
    ) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const reader = res.body?.getReader();
    if (!reader) {
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength > MAX_EMBEDDED_IMAGE_BYTES) return null;
      return `data:${contentType};base64,${buffer.toString("base64")}`;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_EMBEDDED_IMAGE_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const buffer = Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk)),
      total,
    );
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function isAllowedFigmaSvgRenderRequest(
  url: string,
  isBlocked: typeof isBlockedExtensionUrlWithDns = isBlockedExtensionUrlWithDns,
): Promise<boolean> {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol === "data:" ||
      parsed.protocol === "blob:" ||
      parsed.protocol === "about:"
    ) {
      return true;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    return !(await isBlocked(parsed.href));
  } catch {
    return false;
  }
}

/**
 * Walks the RAW scene tree (before hydration) and, for every node flagged
 * `rasterReason` (video/canvas/iframe/backdrop-blur), takes a real cropped
 * screenshot of that element's exact bounds while the page is still live,
 * setting `rasterHref` to a `data:image/png` URI. Runs while `page` is still
 * open, since it needs the live rendered content — the same reason
 * `take-design-screenshot.ts` keeps its browser open for the whole capture.
 */
async function rasterizeUnsupportedNodes(
  page: import("@playwright/test").Page,
  node: RawFigmaSvgNode,
  originOffset: { x: number; y: number },
): Promise<void> {
  if (node.rasterReason && !node.rasterHref) {
    const clip = {
      x: Math.max(0, node.rect.x + originOffset.x),
      y: Math.max(0, node.rect.y + originOffset.y),
      width: Math.max(1, Math.round(node.rect.width)),
      height: Math.max(1, Math.round(node.rect.height)),
    };
    try {
      const png = await page.screenshot({ clip, type: "png" });
      node.rasterHref = `data:image/png;base64,${png.toString("base64")}`;
    } catch {
      // Leave rasterHref unset — hydrateRawFigmaSvgNode falls back to an
      // empty href, and the export report still names the node as
      // rasterized (with its reason) so the caller knows what's missing.
    }
  }
  for (const child of node.children) {
    await rasterizeUnsupportedNodes(page, child, originOffset);
  }
}

/**
 * Thrown when `rootSelector` doesn't match any element in the rendered page.
 * A dedicated, classifiable error (rather than a plain `Error` matched by
 * message text) so callers like `export-design-as-figma-svg`'s action can
 * fail SOFT — falling back to a whole-screen export with a warning — instead
 * of a raw 500, which is what happened when a caller passed a live-DOM
 * code-layer id (e.g. `html:<hash>`) that doesn't exist verbatim in the
 * persisted HTML this renders.
 */
export class FigmaSvgRootSelectorNotFoundError extends Error {
  readonly rootSelector: string;
  constructor(rootSelector: string) {
    super(`No element matched rootSelector "${rootSelector}"`);
    this.name = "FigmaSvgRootSelectorNotFoundError";
    this.rootSelector = rootSelector;
  }
}

export function isMissingRootSelectorError(
  err: unknown,
): err is FigmaSvgRootSelectorNotFoundError {
  return err instanceof FigmaSvgRootSelectorNotFoundError;
}

/**
 * Renders `html` in headless Chromium, walks the live DOM to build a
 * `FigmaSvgNode` scene, and serializes it into a genuinely vector SVG
 * document via `buildFigmaSvgDocument`. Throws when no Chromium binary is
 * available — callers should catch and fall back (mirrors
 * `take-design-screenshot.ts`'s `chromiumUnavailableReason` pattern). Throws
 * `FigmaSvgRootSelectorNotFoundError` when `rootSelector` matches nothing —
 * callers should catch that specific error and fail soft (see
 * `isMissingRootSelectorError`).
 */
export async function renderDesignToFigmaSvg(
  options: RenderFigmaSvgOptions,
): Promise<{ svg: string; report: FigmaSvgExportReport }> {
  const playwright = await importPlaywright();
  const browser = await launchChromium(playwright.chromium);
  try {
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
    });
    // `collectRawFigmaSvgScene` below is passed straight to `page.evaluate`,
    // which serializes it via `Function.prototype.toString()` and runs it
    // inside the page. Under esbuild's `keepNames` (on by default for
    // dev-time tsx runs of this action), every named helper function inside
    // it (`walk`, `extractTextLines`, `groupRectsByLine`, ...) gets rewritten
    // to `__name(function walk() {...}, "walk")`, and `__name` doesn't exist
    // in the page's isolated context — same root cause already fixed for
    // `packages/core/src/cli/recap.ts`'s `page.evaluate` calls (see
    // `RECAP_SHOT_NAME_SHIM`). Define it as a no-op identity function before
    // anything evaluates in the page; harmless on the tsc-built path, which
    // never emits `__name` in the first place.
    await context.addInitScript(
      "globalThis.__name = globalThis.__name || function (value) { return value; };",
    );
    // Stored HTML is untrusted input. Its <img>, CSS, font, script, and iframe
    // URLs must not turn headless Chromium into an SSRF primitive. Validate
    // every request, including redirects initiated by the browser, and fail
    // closed when DNS validation itself fails.
    await context.route("**/*", async (route) => {
      if (await isAllowedFigmaSvgRenderRequest(route.request().url())) {
        await route.continue();
      } else {
        await route.abort("blockedbyclient");
      }
    });
    const page = await context.newPage();
    try {
      await page.setContent(options.html, { waitUntil: "networkidle" });
      await page.waitForTimeout(300); // let Alpine.js / CDN Tailwind JIT settle.

      const scene = (await page.evaluate(
        collectRawFigmaSvgScene,
        options.rootSelector ?? null,
      )) as RawFigmaSvgSceneResult | null;
      if (!scene) {
        if (options.rootSelector) {
          throw new FigmaSvgRootSelectorNotFoundError(options.rootSelector);
        }
        throw new Error("Design screen has no renderable content");
      }

      // Capture a real cropped screenshot for every node the DOM walk
      // flagged as unsupported (video/canvas/iframe/backdrop-blur), while
      // the page is still live — this is the "rasterize instead of fight
      // it" fallback the property-mapping matrix promises for those cases.
      await rasterizeUnsupportedNodes(page, scene.root, scene.originOffset);

      const root = hydrateRawFigmaSvgNode(scene.root);
      const embeddedImageOmissions = options.embedImages
        ? await embedRemoteImages(root)
        : [];

      // The SVG document's own width/height/viewBox must reflect the
      // EXPORTED SUBTREE's real bounds, not the Chromium viewport used to
      // lay it out — a 400x300 screen was exporting a 1440x1200 root
      // whenever the caller's render viewport didn't happen to match the
      // screen's own frame size (e.g. the action's legacy 1440x1200
      // default). `root.rect` is always relative to itself (x=0, y=0 by
      // construction — see `collectRawFigmaSvgScene`'s `originRect`
      // subtraction), so its width/height are exactly the rendered root
      // element's own bounding box, honest regardless of viewport size.
      const result = buildFigmaSvgDocument({
        width: root.rect.width,
        height: root.rect.height,
        title: options.title,
        root,
      });
      result.report.omitted.push(...embeddedImageOmissions);
      return result;
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
}
