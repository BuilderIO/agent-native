/**
 * Walk a decoded Figma document (the kiwi `Message` tree produced by
 * `decodeFig`) and distil a `DesignSystemData` token set from it: colors from
 * SOLID fills, typography from text styles, corner radii, spacing, and effects
 * (shadows). Named Figma styles (`STYLE` nodes / `styleIdForFill` references)
 * are preferred for token naming where available.
 *
 * This is heuristic: Figma documents carry no canonical "design system"
 * structure, so we cluster/dedupe collected values and assign roles by
 * saturation/lightness/contrast and frequency. The result is a
 * `Partial<DesignSystemData>` the agent can review and pass to
 * `create-design-system`.
 */

import type { DesignSystemData } from "../../../shared/api.js";
import { guidKey, type FigNode } from "./fig-to-html.js";

interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface Paint {
  type?: string;
  color?: Color;
  opacity?: number;
  visible?: boolean;
}

interface Effect {
  type?: string;
  visible?: boolean;
  color?: Color;
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
}

// --- color helpers --------------------------------------------------------

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** Convert a Figma 0-1 RGBA color (folding paint opacity into the channels
 * over white) to a `#rrggbb` hex string. Returns null on invalid input. */
function colorToHex(c: Color | undefined, alphaMul = 1): string | null {
  if (!c) return null;
  if (![c.r, c.g, c.b].every((v) => typeof v === "number" && isFinite(v))) {
    return null;
  }
  const a = (typeof c.a === "number" ? c.a : 1) * alphaMul;
  // Fold opacity by compositing over white so the captured token is a flat,
  // usable hex (design-system tokens are opaque hex strings).
  const composite = (channel: number) => channel * a + 1 * (1 - a);
  const r = clamp255(composite(c.r) * 255);
  const g = clamp255(composite(c.g) * 255);
  const b = clamp255(composite(c.b) * 255);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1]!, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

/** Relative luminance (0 dark .. 1 light) per WCAG. */
function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

/** HSL saturation (0..1) of a hex color. */
function saturation(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// --- collection -----------------------------------------------------------

interface ColorStat {
  hex: string;
  count: number;
  /** Total area (px^2) of nodes painted with this color, for role weighting. */
  area: number;
  /** A named Figma style this color came from, if any. */
  name?: string;
}

interface TextStat {
  family: string;
  weights: Map<number, number>;
  sizes: Map<number, number>;
  lineHeights: number[];
  count: number;
  /** Total node area, used to pick the dominant body family. */
  area: number;
}

function fontWeightFromStyle(style: string | undefined): number {
  if (!style) return 400;
  const s = style.toLowerCase();
  if (s.includes("thin")) return 100;
  if (s.includes("extralight") || s.includes("ultralight")) return 200;
  if (s.includes("light")) return 300;
  if (s.includes("medium")) return 500;
  if (s.includes("semibold") || s.includes("demibold")) return 600;
  if (s.includes("extrabold") || s.includes("ultrabold")) return 800;
  if (s.includes("black") || s.includes("heavy")) return 900;
  if (s.includes("bold")) return 700;
  return 400;
}

function nodeArea(node: FigNode): number {
  const x = node.size?.x ?? 0;
  const y = node.size?.y ?? 0;
  if (!isFinite(x) || !isFinite(y) || x <= 0 || y <= 0) return 0;
  return x * y;
}

/** Greatest common divisor of two integers. */
function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

/**
 * Infer a base spacing step from a set of observed spacing values. We snap to
 * the conventional 4/8px grid: if most values are divisible by 8 -> 8, else if
 * most are divisible by 4 -> 4, otherwise fall back to the GCD of the values.
 */
function inferSpacingStep(values: number[]): number {
  const positives = values
    .map((v) => Math.round(v))
    .filter((v) => v > 0 && v <= 256);
  if (positives.length === 0) return 8;
  const divisibleBy = (d: number) =>
    positives.filter((v) => v % d === 0).length / positives.length;
  if (divisibleBy(8) >= 0.6) return 8;
  if (divisibleBy(4) >= 0.6) return 4;
  let g = positives[0]!;
  for (const v of positives.slice(1)) g = gcd(g, v);
  return g >= 2 ? g : 4;
}

/**
 * Build a map of Figma STYLE nodes keyed by their node guid, so a node's
 * `styleIdForFill` / `styleIdForText` reference can be resolved back to a
 * human-authored style name (e.g. "Brand/Primary", "Heading/H1").
 */
function indexStyleNames(nodes: FigNode[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const n of nodes) {
    // Figma encodes shared styles as nodes with a `styleType` and a name.
    if ((n.styleType || n.type === "STYLE") && n.name) {
      out.set(guidKey(n.guid), n.name.trim());
    }
  }
  return out;
}

function resolveFillStyleName(
  node: FigNode,
  styleNames: Map<string, string>,
): string | undefined {
  const g = node.styleIdForFill?.guid;
  if (!g) return undefined;
  return styleNames.get(guidKey(g));
}

function resolveTextStyleName(
  node: FigNode,
  styleNames: Map<string, string>,
): string | undefined {
  const g = node.styleIdForText?.guid;
  if (!g) return undefined;
  return styleNames.get(guidKey(g));
}

// --- main walk ------------------------------------------------------------

export interface ExtractedFigTokens extends Partial<DesignSystemData> {
  /** Raw, de-duplicated color palette (most frequent first) for reference. */
  palette?: { hex: string; name?: string; count: number }[];
  /** Named color styles found in the file (key = style name). */
  namedColors?: Record<string, string>;
}

/**
 * Extract a partial design system from a decoded Figma document. `document`
 * is the value returned in `DecodedFig.document` (the kiwi `Message` with a
 * `nodeChanges` array). Returns `{}` when the document is empty/malformed.
 */
export function extractDesignSystemFromFig(
  document: unknown,
): ExtractedFigTokens {
  const doc = document as { nodeChanges?: FigNode[] } | null | undefined;
  const nodes = doc?.nodeChanges ?? [];
  if (nodes.length === 0) return {};

  const styleNames = indexStyleNames(nodes);

  const colorStats = new Map<string, ColorStat>();
  const namedColors: Record<string, string> = {};
  const textStats = new Map<string, TextStat>();
  const radii: number[] = [];
  const spacingValues: number[] = [];
  const shadows: string[] = [];

  const addColor = (hex: string | null, area: number, name?: string): void => {
    if (!hex) return;
    const existing = colorStats.get(hex);
    if (existing) {
      existing.count += 1;
      existing.area += area;
      if (!existing.name && name) existing.name = name;
    } else {
      colorStats.set(hex, { hex, count: 1, area, name });
    }
    if (name && !namedColors[name]) namedColors[name] = hex;
  };

  for (const node of nodes) {
    if (node.visible === false) continue;
    const area = nodeArea(node);

    // Colors from SOLID fill paints.
    const fillStyleName = resolveFillStyleName(node, styleNames);
    for (const paint of (node.fillPaints ?? []) as Paint[]) {
      if (paint.visible === false) continue;
      if (paint.type !== "SOLID") continue;
      addColor(
        colorToHex(paint.color, paint.opacity ?? 1),
        area,
        fillStyleName,
      );
    }
    // Colors from SOLID stroke paints (no area weight — strokes are accents).
    for (const paint of (node.strokePaints ?? []) as Paint[]) {
      if (paint.visible === false) continue;
      if (paint.type !== "SOLID") continue;
      addColor(colorToHex(paint.color, paint.opacity ?? 1), 0);
    }

    // Typography from TEXT nodes.
    if (node.type === "TEXT" && node.fontName?.family) {
      const family = node.fontName.family;
      const weight = fontWeightFromStyle(node.fontName.style);
      const size =
        typeof node.fontSize === "number" ? Math.round(node.fontSize) : 0;
      const textStyleName = resolveTextStyleName(node, styleNames);
      const key = textStyleName ? `style:${textStyleName}|${family}` : family;
      let stat = textStats.get(key);
      if (!stat) {
        stat = {
          family,
          weights: new Map(),
          sizes: new Map(),
          lineHeights: [],
          count: 0,
          area: 0,
        };
        textStats.set(key, stat);
      }
      stat.count += 1;
      stat.area += area;
      stat.weights.set(weight, (stat.weights.get(weight) ?? 0) + 1);
      if (size > 0) stat.sizes.set(size, (stat.sizes.get(size) ?? 0) + 1);
      if (node.lineHeight && typeof node.lineHeight.value === "number") {
        if (node.lineHeight.units === "PIXELS") {
          stat.lineHeights.push(node.lineHeight.value);
        } else if (node.lineHeight.units === "PERCENT" && size > 0) {
          stat.lineHeights.push((node.lineHeight.value / 100) * size);
        }
      }
    }

    // Corner radii.
    const corner =
      node.cornerRadius ??
      node.rectangleTopLeftCornerRadius ??
      node.rectangleTopRightCornerRadius;
    if (typeof corner === "number" && corner > 0 && corner <= 200) {
      radii.push(Math.round(corner));
    }

    // Spacing: auto-layout gaps and padding.
    if (node.stackMode && node.stackMode !== "NONE") {
      if (typeof node.stackSpacing === "number")
        spacingValues.push(node.stackSpacing);
      for (const pad of [
        node.stackPaddingLeft,
        node.stackPaddingRight,
        node.stackPaddingTop,
        node.stackPaddingBottom,
        node.stackHorizontalPadding,
        node.stackVerticalPadding,
      ]) {
        if (typeof pad === "number" && pad > 0) spacingValues.push(pad);
      }
    }

    // Effects -> shadows.
    for (const effect of (node.effects ?? []) as Effect[]) {
      if (effect.visible === false) continue;
      if (effect.type !== "DROP_SHADOW" && effect.type !== "INNER_SHADOW")
        continue;
      const c = effect.color;
      const a = c && typeof c.a === "number" ? c.a : 0.25;
      const rgb = c
        ? `rgba(${clamp255(c.r * 255)}, ${clamp255(c.g * 255)}, ${clamp255(c.b * 255)}, ${Number(a.toFixed(3))})`
        : "rgba(0, 0, 0, 0.25)";
      const inset = effect.type === "INNER_SHADOW" ? "inset " : "";
      const ox = Math.round(effect.offset?.x ?? 0);
      const oy = Math.round(effect.offset?.y ?? 0);
      const blur = Math.round(effect.radius ?? 0);
      const spread = Math.round(effect.spread ?? 0);
      shadows.push(`${inset}${ox}px ${oy}px ${blur}px ${spread}px ${rgb}`);
    }
  }

  // --- assign color roles -------------------------------------------------

  const palette = Array.from(colorStats.values()).sort(
    (a, b) => b.count - a.count || b.area - a.area,
  );

  const result: ExtractedFigTokens = {};

  if (palette.length > 0) {
    // Background: the most-used near-extreme (lightest or darkest) color by
    // area — large flat regions are almost always the canvas/surface.
    const byArea = [...palette].sort((a, b) => b.area - a.area);
    const background =
      byArea.find((c) => {
        const l = luminance(c.hex);
        return l > 0.85 || l < 0.08;
      }) ?? byArea[0]!;

    // Accent: the most saturated color (excluding the background).
    const accentCandidates = palette
      .filter((c) => c.hex !== background.hex)
      .sort((a, b) => saturation(b.hex) - saturation(a.hex));
    const accent = accentCandidates[0] ?? background;

    // Text: the color with the highest contrast against the background.
    const text = palette
      .filter((c) => c.hex !== background.hex)
      .sort(
        (a, b) =>
          contrastRatio(b.hex, background.hex) -
          contrastRatio(a.hex, background.hex),
      )[0] ?? { hex: luminance(background.hex) > 0.5 ? "#111111" : "#ffffff" };

    // Primary/secondary: top frequent saturated colors after accent.
    const saturated = palette
      .filter(
        (c) =>
          saturation(c.hex) > 0.15 &&
          c.hex !== background.hex &&
          c.hex !== text.hex,
      )
      .sort((a, b) => b.count - a.count);
    const primary = saturated[0] ?? accent;
    const secondary = saturated[1] ?? saturated[0] ?? primary;

    // Surface: a color near the background luminance but not identical (cards).
    const surface =
      byArea.find(
        (c) =>
          c.hex !== background.hex &&
          Math.abs(luminance(c.hex) - luminance(background.hex)) < 0.15,
      ) ?? background;

    // Muted text: a mid-contrast color between text and background, else a
    // blend toward the background.
    const textMuted =
      palette
        .filter((c) => {
          const cr = contrastRatio(c.hex, background.hex);
          return c.hex !== text.hex && cr >= 2 && cr <= 7;
        })
        .sort(
          (a, b) =>
            contrastRatio(b.hex, background.hex) -
            contrastRatio(a.hex, background.hex),
        )[0]?.hex ?? mixHex(text.hex, background.hex, 0.45);

    result.colors = {
      primary: primary.hex,
      secondary: secondary.hex,
      accent: accent.hex,
      background: background.hex,
      surface: surface.hex,
      text: text.hex,
      textMuted: typeof textMuted === "string" ? textMuted : text.hex,
    };

    result.palette = palette
      .slice(0, 24)
      .map((c) => ({ hex: c.hex, name: c.name, count: c.count }));
    if (Object.keys(namedColors).length > 0) result.namedColors = namedColors;
  }

  // --- typography ---------------------------------------------------------

  if (textStats.size > 0) {
    const stats = Array.from(textStats.values());
    // Body font: largest total text area (the prose that fills the page).
    const byArea = [...stats].sort(
      (a, b) => b.area - a.area || b.count - a.count,
    );
    const bodyStat = byArea[0]!;
    // Heading font: the family used on the largest font size; falls back to
    // the most frequent family distinct from the body font.
    const maxSizeOf = (s: TextStat) =>
      Math.max(0, ...Array.from(s.sizes.keys()));
    const byMaxSize = [...stats].sort((a, b) => maxSizeOf(b) - maxSizeOf(a));
    const headingStat =
      byMaxSize.find((s) => s.family !== bodyStat.family) ??
      byMaxSize[0] ??
      bodyStat;

    const topWeight = (s: TextStat): number => {
      let best = 400;
      let bestCount = -1;
      for (const [w, c] of s.weights) {
        if (c > bestCount) {
          best = w;
          bestCount = c;
        }
      }
      return best;
    };

    // Distinct font sizes across everything, descending — for h1/h2/h3.
    const allSizes = Array.from(
      new Set(stats.flatMap((s) => Array.from(s.sizes.keys()))),
    )
      .filter((n) => n > 0)
      .sort((a, b) => b - a);

    result.typography = {
      headingFont: headingStat.family,
      bodyFont: bodyStat.family,
      headingWeight: String(topWeight(headingStat)),
      bodyWeight: String(topWeight(bodyStat)),
      headingSizes: {
        h1: `${allSizes[0] ?? 32}px`,
        h2: `${allSizes[1] ?? allSizes[0] ?? 24}px`,
        h3: `${allSizes[2] ?? allSizes[1] ?? allSizes[0] ?? 20}px`,
      },
    };
  }

  // --- spacing ------------------------------------------------------------

  if (spacingValues.length > 0) {
    const step = inferSpacingStep(spacingValues);
    const rounded = spacingValues
      .map((v) => Math.round(v))
      .sort((a, b) => a - b);
    const median = rounded[Math.floor(rounded.length / 2)] ?? step * 2;
    const max = rounded[rounded.length - 1] ?? step * 3;
    // pagePadding leans toward the largest observed padding; elementGap toward
    // a typical gap (median), both snapped to the inferred step.
    const snap = (v: number) => Math.max(step, Math.round(v / step) * step);
    result.spacing = {
      pagePadding: `${snap(Math.min(max, step * 8))}px`,
      elementGap: `${snap(median)}px`,
    };
  }

  // --- borders ------------------------------------------------------------

  if (radii.length > 0) {
    // Use the most common radius as the system default.
    const counts = new Map<number, number>();
    for (const r of radii) counts.set(r, (counts.get(r) ?? 0) + 1);
    const mostCommon = Array.from(counts.entries()).sort(
      (a, b) => b[1] - a[1] || a[0] - b[0],
    )[0]![0];
    result.borders = {
      radius: `${mostCommon}px`,
      accentWidth: "2px",
    };
  }

  // --- effects (shadows) into customCSS -----------------------------------

  if (shadows.length > 0) {
    const uniqueShadows = Array.from(new Set(shadows)).slice(0, 6);
    const lines = uniqueShadows.map((s, i) => `  --shadow-${i + 1}: ${s};`);
    result.customCSS = `:root {\n${lines.join("\n")}\n}`;
  }

  return result;
}

/** Linear blend of two hex colors. `t` = weight of `a` (0..1). */
function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return a;
  const mix = (x: number, y: number) => clamp255(x * t + y * (1 - t));
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(mix(ca.r, cb.r))}${hex(mix(ca.g, cb.g))}${hex(mix(ca.b, cb.b))}`;
}
