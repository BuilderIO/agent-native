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
  ellipse?: boolean;
}

export const ZERO_RADII: FigmaSvgCornerRadii = { tl: 0, tr: 0, br: 0, bl: 0 };

export interface FigmaSvgColorStop {
  offset: number;
  // guard:allow-raw-color — exported SVG paint read from the design's own computed styles, never app UI
  color: string;
}

export type FigmaSvgFillLayer =
  | { kind: "solid"; color: string }
  | { kind: "linear-gradient"; angleDeg: number; stops: FigmaSvgColorStop[] }
  | {
      kind: "radial-gradient";
      stops: FigmaSvgColorStop[];
      geometry?: ParsedRadialGradient;
      cx?: number;
      cy?: number;
      r?: number;
    }
  | {
      kind: "image";
      href: string;
      fit: "cover" | "contain" | "stretch";
      sizePx?: { width: number; height: number };
      offsetPx?: { x: number; y: number };
      repeat?: boolean;
      repeatAxis?: string;
      singleAxisSize?: string;
      positionRaw?: string;
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
  castFromContent?: boolean;
}

export interface FigmaSvgBorder {
  widthPx: number;
  color: string;
  paint?: FigmaSvgFillLayer;
  dashed?: boolean;
  nonUniform?: boolean;
  sides?: Array<{ widthPx: number; color: string; dashed: boolean } | null>;
}

export interface FigmaSvgOutline {
  widthPx: number;
  color: string;
  offsetPx: number;
  dashed?: boolean;
}

export interface FigmaSvgTextLine {
  text: string;
  x: number;
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
  resolvedFontFamily?: string;
  lineHeightPx?: number;
}

export interface FigmaSvgLayoutFacts {
  display: string;
  flexDirection: string;
  flexWrap: string;
  justifyContent: string;
  alignItems: string;
  rowGapPx: number;
  columnGapPx: number;
  paddingPx: [number, number, number, number];
  position: string;
  flexGrow: number;
  flexShrink: number;
  flexBasis: string;
  alignSelf: string;
}

export interface FigmaSvgNode {
  id: string;
  name?: string;
  kind: "box" | "text" | "image" | "raster" | "vector";
  rect: FigmaSvgRect;
  rotationDeg?: number;
  reflection?: [number, number, number, number];
  opacity?: number;
  blurPx?: number;
  blendMode?: string;
  imageRendering?: string;
  cornerRadii?: FigmaSvgCornerRadii;
  fills?: FigmaSvgFillLayer[];
  border?: FigmaSvgBorder;
  outline?: FigmaSvgOutline;
  shadows?: FigmaSvgShadow[];
  clipsContent?: boolean;
  text?: { lines: FigmaSvgTextLine[]; style: FigmaSvgTextStyle };
  image?: {
    href: string;
    fit: "cover" | "contain" | "stretch";
    position?: string;
  };
  raster?: { href: string; reason: string };
  vector?: { markup: string };
  layout?: FigmaSvgLayoutFacts;
  children?: FigmaSvgNode[];
}

export interface FigmaSvgExportReport {
  vectorized: string[];
  approximated: Array<{ node: string; note: string }>;
  rasterized: Array<{ node: string; reason: string }>;
  omitted: Array<{ node: string; reason: string }>;
  warnings: string[];
  vectorizedTextCaveat: string;
}


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


export function roundedRectPath(
  rect: FigmaSvgRect,
  radii: FigmaSvgCornerRadii,
): string {
  const { x, y, width, height } = rect;
  if (radii.ellipse) {
    const rx = width / 2;
    const ry = height / 2;
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


export function gradientAngleToRotation(angleDeg: number): number {
  return (((angleDeg - 90) % 360) + 360) % 360;
}

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

export function linearGradientEndpoints(
  angleDeg: number,
  width: number,
  height: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const radians = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
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
  if (opts?.rx !== undefined && opts?.ry !== undefined && opts.rx > 0) {
    const scaleY = opts.ry / opts.rx;
    const transform = `translate(0 ${n(cy * (1 - scaleY))}) scale(1 ${n(scaleY)})`;
    return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(cx)}" cy="${n(cy)}" r="${n(opts.rx)}" gradientTransform="${transform}">${stopMarkup(stops)}</radialGradient>`;
  }
  const r = opts?.r ?? 0.5;
  const units = opts?.r !== undefined ? ` gradientUnits="userSpaceOnUse"` : "";
  return `<radialGradient id="${id}"${units} cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}">${stopMarkup(stops)}</radialGradient>`;
}


// guard:allow-raw-color — exported SVG paint read from the design's own computed styles, never app UI
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

export function parseComputedLinearGradient(
  value: string,
): ParsedGradient | null {
  const match = value.match(/linear-gradient\((.*)\)\s*$/s);
  if (!match) return null;
  const parts = splitTopLevelCommas(match[1]);
  let angleDeg = 180;
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
  size?: { x: string; y?: string };
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

function resolveLengthPercentage(value: string, basis: number): number {
  if (value.endsWith("%")) return (Number.parseFloat(value) / 100) * basis;
  return Number.parseFloat(value);
}

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
  const [sideX, sideY] =
    gradient.extent === "closest-corner" ? [nearX, nearY] : [farX, farY];
  if (!sideX || !sideY) return { cx, cy, rx: sideX, ry: sideY };
  const scale = Math.SQRT2;
  return { cx, cy, rx: sideX * scale, ry: sideY * scale };
}


export function objectFitToPreserveAspectRatio(
  fit: "cover" | "contain" | "stretch" | "none" | "scale-down",
  position?: string,
): string {
  if (fit === "stretch" || fit === "none") return "none";
  const align = isTopLeftObjectPosition(position) ? "xMinYMin" : "xMidYMid";
  if (fit === "contain" || fit === "scale-down") return `${align} meet`;
  return `${align} slice`;
}

function isTopLeftObjectPosition(position: string | undefined): boolean {
  if (!position) return false;
  const [x, y] = position.trim().split(/\s+/);
  const atStart = (v: string | undefined) =>
    v === "0px" || v === "0%" || v === "0" || v === "left" || v === "top";
  return atStart(x) && atStart(y ?? x);
}


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

function borderPaintLayer(raw: {
  borderPaintImage?: string;
}): FigmaSvgFillLayer | undefined {
  if (!raw.borderPaintImage) return undefined;
  return buildFillLayersFromComputedStyle(
    "rgba(0, 0, 0, 0)", // guard:allow-raw-color — transparent base so only the stroke gradient is read
    raw.borderPaintImage,
  )[0];
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
  if (fill.repeatAxis) {
    ctx.report.approximated.push({
      node: node.name || node.id,
      note:
        `Image fill uses background-repeat: ${fill.repeatAxis}, which an SVG ` +
        `pattern cannot express; exported as a single non-repeating image.`,
    });
  }
  if (fill.singleAxisSize) {
    ctx.report.approximated.push({
      node: node.name || node.id,
      note:
        `Image fill has a one-dimensional background-size (${fill.singleAxisSize}), ` +
        `meaning that width with a proportional height; the image's intrinsic ` +
        `ratio is not known at export time, so it was fitted to the box instead.`,
    });
  }
  if (fill.repeat) {
    if (!fill.sizePx) {
      ctx.report.approximated.push({
        node: node.name || node.id,
        note:
          "Tiled (TILE) image fill exported as a single covering image: the " +
          "computed background-size was `auto`, so the tile's intrinsic size " +
          "is unknown at export time and the repeat could not be reproduced.",
      });
    } else {
      let phase = fill.offsetPx ?? { x: 0, y: 0 };
      if (!fill.offsetPx && fill.positionRaw) {
        const pcts = Array.from(fill.positionRaw.matchAll(/(-?[\d.]+)%/g)).map(
          (m) => Number(m[1]) / 100,
        );
        if (pcts.length === 2 && !/calc\(/i.test(fill.positionRaw)) {
          phase = {
            x: pcts[0]! * (node.rect.width - fill.sizePx.width),
            y: pcts[1]! * (node.rect.height - fill.sizePx.height),
          };
        } else {
          ctx.report.approximated.push({
            node: node.name || node.id,
            note:
              `Tiled image fill has a background-position this export cannot ` +
              `resolve (${fill.positionRaw}); the tiling was anchored at the ` +
              `box origin, so its phase may differ.`,
          });
        }
      }
      ctx.defs.push(
        `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${n(node.rect.x + phase.x)}" y="${n(node.rect.y + phase.y)}" width="${n(fill.sizePx.width)}" height="${n(fill.sizePx.height)}">` +
          `<image href="${escapeXmlAttr(fill.href)}" x="0" y="0" width="${n(fill.sizePx.width)}" height="${n(fill.sizePx.height)}" preserveAspectRatio="none"${
            node.imageRendering
              ? ` image-rendering="${node.imageRendering}"`
              : ""
          }/></pattern>`,
      );
      return `url(#${id})`;
    }
  }
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

export function buildBlurFilterDef(id: string, stdDeviation: number): string {
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${n(stdDeviation)}"/></filter>`;
}

export function inflateRect(rect: FigmaSvgRect, by: number): FigmaSvgRect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: Math.max(0, rect.width + by * 2),
    height: Math.max(0, rect.height + by * 2),
  };
}

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
      const bleed =
        Math.abs(shadow.offsetX) +
        Math.abs(shadow.offsetY) +
        shadow.blur * 1.5 +
        Math.abs(shadow.spread) +
        2;
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

  const outer = shadows.filter((s) => !s.inset && !s.castFromContent);
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

  const reversedLayers = fills.slice().reverse();
  let body =
    shadowMarkup.behind +
    reversedLayers
      .map((f) => fillTag(rect, radii, resolveFillPaint(f, node, ctx), ""))
      .join("");

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
    const strokePaint = node.border.paint
      ? resolveFillPaint(node.border.paint, node, ctx)
      : node.border.color;
    body += isUniformRadius(insetRadii)
      ? `<rect x="${n(insetRect.x)}" y="${n(insetRect.y)}" width="${n(insetRect.width)}" height="${n(insetRect.height)}"${insetRadii.tl ? ` rx="${n(insetRadii.tl)}"` : ""} fill="none" ${paintAttributes("stroke", strokePaint)} stroke-width="${n(node.border.widthPx)}"${dash}/>`
      : `<path d="${roundedRectPath(insetRect, insetRadii)}" fill="none" ${paintAttributes("stroke", strokePaint)} stroke-width="${n(node.border.widthPx)}"${dash}/>`;
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

  const ownText = node.text ? renderTextMarkup(node, ctx) : "";
  const contentShadow = contentShadowMarkup(
    node,
    ctx,
    childrenMarkup + ownText,
  );
  return wrapGroup(contentShadow + body + childrenMarkup + ownText, node, ctx);
}

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
  resolvedFontFamily?: string;
  lineHeightPx?: number;
}

export interface RawFigmaSvgNode {
  id: string;
  name?: string;
  domTag: string;
  rect: FigmaSvgRect;
  rotationDeg: number;
  reflection?: [number, number, number, number];
  opacity: number;
  cornerRadiiRaw: FigmaSvgCornerRadii;
  // guard:allow-raw-color — exported SVG paint read from the design's own computed styles, never app UI
  backgroundColor: string;
  backgroundImage: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  backgroundRepeat?: string;
  boxShadow: string;
  contentShadow?: string;
  borderWidthPx: number;
  borderColor: string;
  backgroundClip?: string;
  borderStyle: string;
  borderNonUniform: boolean;
  clipsContent?: boolean;
  outlineWidthPx?: number;
  outlineColor?: string;
  outlineOffsetPx?: number;
  outlineDashed?: boolean;
  borderWidths?: [number, number, number, number];
  borderColors?: [string, string, string, string];
  borderStyles?: [string, string, string, string];
  backdropFilter: string;
  filter: string;
  mixBlendMode: string;
  imageRendering: string;
  isLeafText: boolean;
  textLines?: RawFigmaSvgTextLine[];
  textStyle?: RawFigmaSvgTextStyle;
  imgSrc?: string;
  imgObjectFit?: string;
  imgObjectPosition?: string;
  rasterReason?: string;
  rasterHref?: string;
  svgMarkup?: string;
  layout?: FigmaSvgLayoutFacts;
  children: RawFigmaSvgNode[];
}

function objectFitFromRaw(raw?: string): "cover" | "contain" | "stretch" {
  if (raw === "cover") return "cover";
  if (raw === "contain" || raw === "none" || raw === "scale-down")
    return "contain";
  return "stretch";
}

function imageFitFromSize(
  size: string | undefined,
  position: string | undefined,
  repeat?: string,
): {
  fit: "cover" | "contain" | "stretch";
  sizePx?: { width: number; height: number };
  offsetPx?: { x: number; y: number };
  repeat?: boolean;
  repeatAxis?: string;
  singleAxisSize?: string;
  positionRaw?: string;
} {
  const value = (size ?? "").trim();
  const repeatValue = (repeat ?? "").trim();
  const oneAxisRepeat =
    repeatValue === "repeat-x" || repeatValue === "repeat-y";
  const unsupportedRepeat =
    /\b(round|space)\b/.test(repeatValue) && repeatValue !== "";
  const px = Array.from(value.matchAll(/(-?[\d.]+)px/g)).map((m) =>
    Number(m[1]),
  );
  const explicitPx =
    px.length === 2 && px[0]! > 0 && px[1]! > 0
      ? { width: px[0]!, height: px[1]! }
      : undefined;
  const singleAxisPx = px.length === 1 && px[0]! > 0;
  const fillsBox = value === "cover" || /^100%\s+100%$/.test(value);
  const canShowRepeat = !fillsBox && value !== "";
  if (repeatValue === "repeat" && canShowRepeat) {
    if (explicitPx) {
      const offsets = Array.from(
        (position ?? "").matchAll(/(-?[\d.]+)px/g),
      ).map((m) => Number(m[1]));
      const raw = (position ?? "").trim();
      return {
        fit: "stretch",
        sizePx: explicitPx,
        offsetPx:
          offsets.length === 2 ? { x: offsets[0]!, y: offsets[1]! } : undefined,
        positionRaw:
          raw && offsets.length !== 2 && !/^0%\s+0%$/.test(raw)
            ? raw
            : undefined,
        repeat: true,
      };
    }
    return { fit: value === "contain" ? "contain" : "cover", repeat: true };
  }
  if (unsupportedRepeat || (oneAxisRepeat && canShowRepeat)) {
    return {
      fit: value === "contain" ? "contain" : "cover",
      repeatAxis: repeatValue,
    };
  }
  if (singleAxisPx) return { fit: "cover", singleAxisSize: value };
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

function gradientLayerHasUnreadableStop(layer: string): boolean {
  const open = layer.indexOf("(");
  if (open < 0) return false;
  const inner = layer.slice(open + 1, layer.lastIndexOf(")"));
  const parts = splitTopLevelCommas(inner);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!.trim();
    if (!part) continue;
    const hasColor =
      /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i.test(
        part,
      ) ||
      /(^|\s)(transparent|currentcolor)(\s|$)/i.test(part) ||
      /#[0-9a-f]{3,8}(\s|$)/i.test(part);
    if (!hasColor) {
      if (i === 0) continue;
      return true;
    }
    const residue = part
      .replace(
        /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\([^()]*(?:\([^()]*\)[^()]*)*\)|#[0-9a-f]{3,8}\b|\b(?:transparent|currentcolor)\b/gi,
        "",
      )
      .replace(/\s*(-?[\d.]+)%\s*$/, "")
      .trim();
    if (residue) return true;
  }
  return false;
}

export function splitBorderAreaLayer(style: {
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
  backgroundRepeat: string;
  backgroundClip: string;
}): {
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
  backgroundRepeat: string;
  borderPaintImage?: string;
} {
  const images = splitTopLevelCommas(style.backgroundImage || "");
  const clips = splitTopLevelCommas(style.backgroundClip || "");
  const index = images.findIndex(
    (_, i) => clips[i % Math.max(clips.length, 1)]?.trim() === "border-area",
  );
  if (index < 0) {
    return {
      backgroundImage: style.backgroundImage,
      backgroundSize: style.backgroundSize,
      backgroundPosition: style.backgroundPosition,
      backgroundRepeat: style.backgroundRepeat,
    };
  }
  const without = (value: string) => {
    const parts = splitTopLevelCommas(value || "");
    const aligned = images.map((_, i) => parts[i % Math.max(parts.length, 1)]);
    return aligned.filter((_, i) => i !== index).join(", ");
  };
  return {
    backgroundImage: without(style.backgroundImage) || "none",
    backgroundSize: without(style.backgroundSize),
    backgroundPosition: without(style.backgroundPosition),
    backgroundRepeat: without(style.backgroundRepeat),
    borderPaintImage: images[index],
  };
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
      if (part === "none") continue;
      if (/gradient\(/i.test(part) && gradientLayerHasUnreadableStop(part)) {
        layers.push({ kind: "unsupported", css: part.trim() });
        continue;
      }
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
            ...imageFitFromSize(
              sizes.length ? sizes[layerIndex % sizes.length] : undefined,
              positions.length
                ? positions[layerIndex % positions.length]
                : undefined,
              repeats.length ? repeats[layerIndex % repeats.length] : undefined,
            ),
          });
      } else {
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

export function hydrateRawFigmaSvgNode(
  captured: RawFigmaSvgNode,
): FigmaSvgNode {
  const layers = splitBorderAreaLayer({
    backgroundImage: captured.backgroundImage,
    backgroundSize: captured.backgroundSize ?? "",
    backgroundPosition: captured.backgroundPosition ?? "",
    backgroundRepeat: captured.backgroundRepeat ?? "",
    backgroundClip: captured.backgroundClip ?? "",
  });
  const raw = { ...captured, ...layers };
  const rotationDeg = raw.rotationDeg ? raw.rotationDeg : undefined;
  const reflection = raw.reflection;
  const opacity = raw.opacity !== 1 ? raw.opacity : undefined;
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
              paint: borderPaintLayer(raw),
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
          paint: borderPaintLayer(raw),
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


export interface RawFigmaSvgSceneResult {
  root: RawFigmaSvgNode;
  originOffset: { x: number; y: number };
}

export function collectRawFigmaSvgScene(
  rootSelector: string | null,
  rootOverride?: Element | null,
): RawFigmaSvgSceneResult | null {
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

  function layerNameForElement(el: Element): string | undefined {
    const attributes = [
      "data-agent-native-layer-name",
      "data-layer-name",
      "layer-name",
    ];
    for (const attribute of attributes) {
      const value = el.getAttribute(attribute)?.trim();
      if (value) return value;
    }
    return undefined;
  }

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

  /**
   * Does any stop in a computed gradient carry a position the exporter's
   * parser cannot read? `parseColorStop` understands percentages only and
   * otherwise returns the whole unsplit token as the COLOUR, which becomes an
   * invalid `stop-color` and paints BLACK. The universal hard-stop idiom
   * `<colour> 0 50%, <colour> 50% 100%` computes with a bare `0` and hits it.
   *
   * Self-contained on purpose: this function is serialized into the page with
   * the rest of the walk, so it cannot call the module-level helpers — they do
   * not exist in that context.
   */
  function gradientHasUnreadableStop(backgroundImage: string): boolean {
    const splitTop = (value: string): string[] => {
      const out: string[] = [];
      let depth = 0;
      let current = "";
      for (const ch of value) {
        if (ch === "(") depth += 1;
        else if (ch === ")") depth -= 1;
        if (ch === "," && depth === 0) {
          out.push(current);
          current = "";
          continue;
        }
        current += ch;
      }
      if (current.trim()) out.push(current);
      return out;
    };
    for (const layer of splitTop(backgroundImage)) {
      if (!/gradient\(/i.test(layer)) continue;
      const open = layer.indexOf("(");
      if (open < 0) continue;
      const inner = layer.slice(open + 1, layer.lastIndexOf(")"));
      const parts = splitTop(inner);
      for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i]!.trim();
        if (!part) continue;
        const hasColor =
          /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i.test(
            part,
          ) ||
          /(^|\s)(transparent|currentcolor)(\s|$)/i.test(part) ||
          /#[0-9a-f]{3,8}(\s|$)/i.test(part);
        if (!hasColor) {
          if (i === 0) continue;
          return true;
        }
        const residue = part
          .replace(
            /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\([^()]*(?:\([^()]*\)[^()]*)*\)|#[0-9a-f]{3,8}\b|\b(?:transparent|currentcolor)\b/gi,
            "",
          )
          .replace(/\s*(-?[\d.]+)%\s*$/, "")
          .trim();
        if (residue) return true;
      }
    }
    return false;
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
    if (rect.width > 0 && rect.height > 0) return true;
    return Array.from(el.children).some((child) => {
      const box = child.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
  }

  function splitLineOffsets(
    charAt: Array<{ node: Text; offset: number }>,
    lineCount: number,
  ): number[] {
    const totalLength = charAt.length;
    const offsets: number[] = [];
    let start = 0;
    const range = doc.createRange();
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

  type TextExtraction = {
    lines: RawFigmaSvgTextLine[];
    partial: boolean;
  } | null;

  function extractTextLines(
    el: Element,
    toLocal: Affine,
    rotationActive: boolean,
  ): TextExtraction {
    const own = view.getComputedStyle(el);
    const absorbable = (childEl: Element): boolean => {
      if (childEl.tagName.toUpperCase() === "BR") return true;
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
    const charAt: Array<{ node: Text; offset: number }> = [];
    let full = "";
    for (const node of textNodes) {
      const value = node.textContent || "";
      for (let i = 0; i < value.length; i++) charAt.push({ node, offset: i });
      full += value;
    }
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

    const rotatedStride =
      Number.parseFloat(style.lineHeight) ||
      (lineRects.length > 1
        ? lineRects[1].top - lineRects[0].top
        : contentHeight);
    const lineBaseline = (r: DOMRect, index: number) =>
      rotationActive
        ? contentTop + rotatedStride * (index + 0.5) + baselineFromCentre
        : applyAffine(toLocal, 0, r.top + r.height / 2)[1] + baselineFromCentre;

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
    const movesBox = !!decomposed && !decomposed.mirror;
    const rotationActive = rotatedAncestor || ownRotation !== 0 || movesBox;

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

    const name = layerNameForElement(el);
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
      reflection: ownReflection ?? undefined,
      clipsContent:
        style.overflow !== "visible" && style.overflow !== ""
          ? true
          : undefined,
      opacity: Number.parseFloat(style.opacity || "1"),
      cornerRadiiRaw: (() => {
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
      backgroundClip: style.backgroundClip,
      boxShadow: style.boxShadow,
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
      filter: style.filter || "none",
      mixBlendMode: style.mixBlendMode || "normal",
      imageRendering: style.imageRendering || "auto",
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
    // rather than calling a module-scope helper that is not defined there.
    const filterText = base.filter.trim();
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

    if (
      el.children.length === 0 &&
      /gradient\(/i.test(base.backgroundImage || "") &&
      gradientHasUnreadableStop(base.backgroundImage || "")
    ) {
      return {
        ...base,
        ...rasterGeometry,
        rasterReason:
          "gradient has a stop position this exporter cannot resolve (a length or colour hint rather than a percentage) — rasterized this element's region via screenshot.",
      };
    }

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
          lineHeightPx:
            style.lineHeight === "normal"
              ? undefined
              : Number.parseFloat(style.lineHeight) || undefined,
        }
      : undefined;

    if (lines && textStyle && !extracted!.partial) {
      return { ...base, isLeafText: true, textLines: lines, textStyle };
    }

    const children: RawFigmaSvgNode[] = [];
    let childToLocal = ownRotation
      ? composeAffine(rotationAbout(-ownRotation, centreX, centreY), toLocal)
      : toLocal;
    if (ownReflection) {
      const [ra, rb, rc, rd] = ownReflection;
      const det = ra * rd - rc * rb;
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
