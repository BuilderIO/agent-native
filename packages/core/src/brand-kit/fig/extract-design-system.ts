/**
 * Walk a decoded Figma document (the kiwi `Message` tree produced by
 * `decodeFig`) and distil a rich brand profile from it: color roles + palette,
 * a full typographic system (families, weights, scale, letter-spacing, label
 * case), spacing rhythm, corner character, an elevation ramp, and — crucially —
 * the SIGNATURE GRADIENTS and a synthesized brand-character brief.
 *
 * The goal is on-brand generation: not just "use the right fonts and colors",
 * but capture what is distinctive about the brand (its gradient, density,
 * corner language, contrast, type personality) so generated designs feel
 * unmistakably on-brand. The brief is emitted as `customInstructions` (the
 * free-form guidance the generator follows) and the gradients/elevation as
 * `customCSS` tokens.
 *
 * Heuristic by necessity: Figma documents carry no canonical "design system",
 * so we cluster/weight observed values and assign roles by saturation,
 * lightness, contrast, and area. The result is reviewable before saving.
 */

import type { BrandKitData, BrandKitDefaults } from "../types.js";
import { guidKey, type FigNode } from "./fig-to-html.js";

interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface GradientStop {
  color: Color;
  position: number;
}

interface Paint {
  type?: string;
  color?: Color;
  opacity?: number;
  visible?: boolean;
  stops?: GradientStop[];
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
  const composite = (channel: number) => channel * a + 1 * (1 - a);
  const r = clamp255(composite(c.r) * 255);
  const g = clamp255(composite(c.g) * 255);
  const b = clamp255(composite(c.b) * 255);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Raw rgba() string for a Figma 0-1 color, preserving alpha (for gradients).
 * `alphaMul` folds in a paint-level opacity that scales every stop's alpha. */
function colorToRgba(c: Color | undefined, alphaMul = 1): string | null {
  if (!c) return null;
  if (![c.r, c.g, c.b].every((v) => typeof v === "number" && isFinite(v))) {
    return null;
  }
  const a = (typeof c.a === "number" ? c.a : 1) * alphaMul;
  return `rgba(${clamp255(c.r * 255)}, ${clamp255(c.g * 255)}, ${clamp255(c.b * 255)}, ${Number(a.toFixed(3))})`;
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

/** Hue in degrees (0..360) of a hex color. */
function hue(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** Human-readable hue name for a saturated color, for the brand brief. */
function hueName(hex: string): string {
  if (saturation(hex) < 0.12) {
    const l = luminance(hex);
    if (l > 0.8) return "near-white";
    if (l < 0.08) return "near-black";
    return "neutral grey";
  }
  const h = hue(hex);
  if (h < 15 || h >= 345) return "red";
  if (h < 45) return "orange";
  if (h < 70) return "amber/yellow";
  if (h < 160) return "green";
  if (h < 200) return "teal/cyan";
  if (h < 250) return "blue";
  if (h < 290) return "indigo/violet";
  if (h < 330) return "magenta/pink";
  return "rose";
}

function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// --- collection types -----------------------------------------------------

interface ColorStat {
  hex: string;
  count: number;
  area: number;
  name?: string;
}

interface TextStat {
  family: string;
  weights: Map<number, number>;
  sizes: Map<number, number>;
  lineHeights: number[];
  letterSpacings: number[];
  count: number;
  area: number;
}

interface GradientStat {
  css: string;
  /** A representative key (stop hexes) for dedupe. */
  key: string;
  area: number;
  count: number;
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

function weightWord(w: number): string {
  if (w <= 200) return "ultra-light";
  if (w <= 300) return "light";
  if (w === 400) return "regular";
  if (w === 500) return "medium";
  if (w === 600) return "semibold";
  if (w === 700) return "bold";
  return "heavy/black";
}

function nodeArea(node: FigNode): number {
  const x = node.size?.x ?? 0;
  const y = node.size?.y ?? 0;
  if (!isFinite(x) || !isFinite(y) || x <= 0 || y <= 0) return 0;
  return x * y;
}

function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

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

/** Build a CSS gradient string from a Figma gradient Paint. Angle is
 * approximated (the exact handle vector isn't always recoverable); the stop
 * colors — the brand-signature part — are captured faithfully. */
function gradientToCss(paint: Paint): { css: string; key: string } | null {
  const stops = (paint.stops ?? [])
    .filter((s) => s && s.color)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  if (stops.length < 2) return null;
  const parts: string[] = [];
  const keyParts: string[] = [];
  for (const s of stops) {
    // Fold the paint-level opacity into every stop's alpha.
    const rgba = colorToRgba(s.color, paint.opacity ?? 1);
    if (!rgba) return null;
    const pct = clampPct(s.position);
    parts.push(`${rgba} ${pct}%`);
    // Key on color AND position so two gradients with the same colors but
    // different stop placement aren't treated as duplicates.
    keyParts.push(`${colorToHex(s.color) ?? rgba}@${pct}`);
  }
  const body = parts.join(", ");
  let css: string;
  switch (paint.type) {
    case "GRADIENT_RADIAL":
      css = `radial-gradient(circle at 30% 30%, ${body})`;
      break;
    case "GRADIENT_ANGULAR":
      css = `conic-gradient(from 180deg, ${body})`;
      break;
    case "GRADIENT_DIAMOND":
      css = `radial-gradient(${body})`;
      break;
    default:
      css = `linear-gradient(135deg, ${body})`;
  }
  return { css, key: `${paint.type}:${keyParts.join("|")}` };
}

function clampPct(p: number | undefined): number {
  const v = typeof p === "number" ? p * 100 : 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function indexStyleNames(nodes: FigNode[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const n of nodes) {
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

// --- result type ----------------------------------------------------------

export interface ExtractedFigTokens extends Partial<BrandKitData> {
  /** Surface defaults inferred from the file. Templates map this to their
   * persisted defaults key, e.g. `defaults` or `slideDefaults`. */
  defaults?: BrandKitDefaults;
  /** Raw, de-duplicated color palette (most frequent first) for reference. */
  palette?: { hex: string; name?: string; count: number }[];
  /** Named color styles found in the file (key = style name). */
  namedColors?: Record<string, string>;
  /** Signature gradients found in the file, as ready-to-use CSS. */
  gradients?: string[];
  /**
   * A synthesized brand-character brief — the free-form guidance the generator
   * should follow to produce on-brand designs. Goes into the design system's
   * `customInstructions`.
   */
  customInstructions?: string;
  /** Count of nodes walked, for provenance/preview. */
  nodeCount?: number;
}

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
  const gradientStats = new Map<string, GradientStat>();
  // Gradient stop colors are collected separately and only folded into the
  // palette when SOLID fills are too sparse to derive roles — otherwise a
  // bright gradient stop can hijack the accent over the real solid brand color.
  const gradientStopColors: { hex: string; area: number; name?: string }[] = [];
  // Heuristic label-case signal: small text whose content is all-caps.
  let upperLabelHits = 0;
  let smallTextSamples = 0;

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

    const fillStyleName = resolveFillStyleName(node, styleNames);
    for (const paint of (node.fillPaints ?? []) as Paint[]) {
      if (paint.visible === false) continue;
      if (paint.type === "SOLID") {
        addColor(
          colorToHex(paint.color, paint.opacity ?? 1),
          area,
          fillStyleName,
        );
      } else if (paint.type?.startsWith("GRADIENT_")) {
        const grad = gradientToCss(paint);
        if (grad) {
          const existing = gradientStats.get(grad.key);
          if (existing) {
            existing.area += area;
            existing.count += 1;
          } else {
            gradientStats.set(grad.key, {
              css: grad.css,
              key: grad.key,
              area,
              count: 1,
            });
          }
          // Stash gradient stop colors; only used for roles if SOLID fills
          // turn out to be too sparse (handled after the walk).
          for (const s of paint.stops ?? []) {
            const hex = colorToHex(s.color);
            if (hex) gradientStopColors.push({ hex, area: area * 0.2 });
          }
        }
      }
    }
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
          letterSpacings: [],
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
      if (
        node.letterSpacing &&
        typeof node.letterSpacing.value === "number" &&
        size > 0
      ) {
        const ls =
          node.letterSpacing.units === "PERCENT"
            ? (node.letterSpacing.value / 100) * size
            : node.letterSpacing.value;
        stat.letterSpacings.push(ls / size); // em-relative
      }
      // Label-case heuristic: short, small text rendered in all caps.
      const chars = node.textData?.characters;
      if (size > 0 && size <= 18 && chars && chars.trim().length > 0) {
        smallTextSamples += 1;
        const letters = chars.replace(/[^a-z]/gi, "");
        if (letters.length >= 2 && letters === letters.toUpperCase()) {
          upperLabelHits += 1;
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
      // Skip artboard-scale shadows (giant blurs/offsets common on Figma frame
      // backgrounds) — keep only UI-plausible elevation.
      if (
        blur > 80 ||
        Math.abs(spread) > 64 ||
        Math.abs(ox) > 120 ||
        Math.abs(oy) > 120
      ) {
        continue;
      }
      shadows.push(`${inset}${ox}px ${oy}px ${blur}px ${spread}px ${rgb}`);
    }
  }

  // --- assign color roles -------------------------------------------------

  // Fold gradient stop colors into the palette only when solid fills are too
  // sparse to characterize the brand (e.g. a gradient-only file).
  if (colorStats.size < 4) {
    for (const g of gradientStopColors) addColor(g.hex, g.area, g.name);
  }

  const palette = Array.from(colorStats.values()).sort(
    (a, b) => b.count - a.count || b.area - a.area,
  );

  const result: ExtractedFigTokens = { nodeCount: nodes.length };
  let roles: BrandKitData["colors"] | null = null;

  if (palette.length > 0) {
    const byArea = [...palette].sort((a, b) => b.area - a.area);
    const background =
      byArea.find((c) => {
        const l = luminance(c.hex);
        return l > 0.85 || l < 0.08;
      }) ?? byArea[0]!;

    const accent =
      palette
        .filter((c) => c.hex !== background.hex)
        .sort((a, b) => saturation(b.hex) - saturation(a.hex))[0] ?? background;

    const text = palette
      .filter((c) => c.hex !== background.hex)
      .sort(
        (a, b) =>
          contrastRatio(b.hex, background.hex) -
          contrastRatio(a.hex, background.hex),
      )[0] ?? { hex: luminance(background.hex) > 0.5 ? "#111111" : "#ffffff" };

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

    const surface =
      byArea.find(
        (c) =>
          c.hex !== background.hex &&
          Math.abs(luminance(c.hex) - luminance(background.hex)) < 0.15,
      ) ?? background;

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

    roles = {
      primary: primary.hex,
      secondary: secondary.hex,
      accent: accent.hex,
      background: background.hex,
      surface: surface.hex,
      text: text.hex,
      textMuted: typeof textMuted === "string" ? textMuted : text.hex,
    };
    result.colors = roles;

    result.palette = palette
      .slice(0, 24)
      .map((c) => ({ hex: c.hex, name: c.name, count: c.count }));
    if (Object.keys(namedColors).length > 0) result.namedColors = namedColors;
  }

  // --- typography ---------------------------------------------------------

  let typo: {
    headingStat: TextStat;
    bodyStat: TextStat;
    headingWeight: number;
    bodyWeight: number;
    h1: number;
    body: number;
    headingTracking: number;
  } | null = null;

  if (textStats.size > 0) {
    const stats = Array.from(textStats.values());
    const byArea = [...stats].sort(
      (a, b) => b.area - a.area || b.count - a.count,
    );
    const bodyStat = byArea[0]!;
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

    // Web-plausible sizes only. Figma marketing boards carry display text at
    // hundreds/thousands of px, which is useless as a web type scale — keep
    // 8..200px and clamp the final scale into a sane web range.
    const webSizes = Array.from(
      new Set(stats.flatMap((s) => Array.from(s.sizes.keys()))),
    )
      .filter((n) => n >= 8 && n <= 200)
      .sort((a, b) => b - a);
    const clampHead = (n: number) => Math.min(72, Math.max(18, Math.round(n)));
    const h1 = clampHead(webSizes[0] ?? 48);
    const h2 = clampHead(webSizes.find((n) => n < h1) ?? Math.round(h1 * 0.72));
    const h3 = clampHead(webSizes.find((n) => n < h2) ?? Math.round(h2 * 0.72));

    const avgTracking =
      headingStat.letterSpacings.length > 0
        ? headingStat.letterSpacings.reduce((a, b) => a + b, 0) /
          headingStat.letterSpacings.length
        : 0;

    const rawBody =
      Array.from(bodyStat.sizes.entries())
        .filter(([s]) => s >= 8 && s <= 28)
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 16;
    const bodySize = Math.min(20, Math.max(14, Math.round(rawBody)));

    result.typography = {
      headingFont: headingStat.family,
      bodyFont: bodyStat.family,
      headingWeight: String(topWeight(headingStat)),
      bodyWeight: String(topWeight(bodyStat)),
      headingSizes: { h1: `${h1}px`, h2: `${h2}px`, h3: `${h3}px` },
    };
    typo = {
      headingStat,
      bodyStat,
      headingWeight: topWeight(headingStat),
      bodyWeight: topWeight(bodyStat),
      h1,
      body: bodySize,
      headingTracking: avgTracking,
    };
  }

  // --- spacing ------------------------------------------------------------

  let elementGapPx = 0;
  if (spacingValues.length > 0) {
    const step = inferSpacingStep(spacingValues);
    const rounded = spacingValues
      .map((v) => Math.round(v))
      .sort((a, b) => a - b);
    const median = rounded[Math.floor(rounded.length / 2)] ?? step * 2;
    const max = rounded[rounded.length - 1] ?? step * 3;
    const snap = (v: number) => Math.max(step, Math.round(v / step) * step);
    elementGapPx = snap(median);
    result.spacing = {
      pagePadding: `${snap(Math.min(max, step * 8))}px`,
      elementGap: `${elementGapPx}px`,
    };
  }

  // --- borders / corner character -----------------------------------------

  let radiusPx = 0;
  if (radii.length > 0) {
    const counts = new Map<number, number>();
    for (const r of radii) counts.set(r, (counts.get(r) ?? 0) + 1);
    radiusPx = Array.from(counts.entries()).sort(
      (a, b) => b[1] - a[1] || a[0] - b[0],
    )[0]![0];
    result.borders = { radius: `${radiusPx}px`, accentWidth: "2px" };
  }

  // --- gradients + elevation into customCSS -------------------------------

  // Rank by colorfulness first: a saturated brand gradient should beat the
  // big black/white scrim overlays that dominate by area in marketing files.
  const gradientColorfulness = (key: string): number => {
    const parts = key.split(":")[1]?.split("|") ?? [];
    let s = 0;
    for (const p of parts) {
      // Each part is "<hex>@<pos>" — score on the hex.
      const hex = p.split("@")[0]?.trim() ?? "";
      if (/^#[0-9a-f]{6}$/i.test(hex)) s += saturation(hex);
    }
    return s;
  };
  const topGradients = Array.from(gradientStats.values())
    .sort(
      (a, b) =>
        gradientColorfulness(b.key) - gradientColorfulness(a.key) ||
        b.area - a.area ||
        b.count - a.count,
    )
    .slice(0, 4);
  if (topGradients.length > 0) {
    result.gradients = topGradients.map((g) => g.css);
  }

  const cssVars: string[] = [];
  topGradients.forEach((g, i) => {
    cssVars.push(`  --gradient-${i === 0 ? "brand" : i}: ${g.css};`);
  });
  const uniqueShadows = Array.from(new Set(shadows)).slice(0, 6);
  uniqueShadows.forEach((s, i) => {
    cssVars.push(`  --shadow-${i + 1}: ${s};`);
  });
  if (cssVars.length > 0) {
    result.customCSS = `:root {\n${cssVars.join("\n")}\n}`;
  }

  // --- defaults -----------------------------------------------------------

  const bgHex = roles?.background;
  const isDark = bgHex ? luminance(bgHex) < 0.4 : false;
  const labelStyle: BrandKitDefaults["labelStyle"] =
    smallTextSamples >= 3 && upperLabelHits / smallTextSamples > 0.4
      ? "uppercase"
      : "none";
  result.defaults = {
    background: isDark ? "dark" : "light",
    labelStyle,
  };

  // --- synthesize the brand brief + imagery hint --------------------------

  const brief = synthesizeBrandBrief({
    roles,
    isDark,
    saturatedCount: palette.filter((c) => saturation(c.hex) > 0.2).length,
    gradients: result.gradients ?? [],
    typo,
    elementGapPx,
    radiusPx,
    hasShadows: uniqueShadows.length > 0,
    labelStyle,
    namedStyleCount: styleNames.size,
  });
  if (brief.instructions) result.customInstructions = brief.instructions;
  if (brief.imageryDescription) {
    result.imageStyle = {
      referenceUrls: [],
      styleDescription: brief.imageryDescription,
    };
  }

  result.notes = `Imported from a Figma .fig file — ${nodes.length.toLocaleString()} nodes, ${styleNames.size} named styles${
    result.gradients ? `, ${result.gradients.length} signature gradient(s)` : ""
  }. Tokens + brand brief were auto-extracted and are editable.`;

  return result;
}

// --- brand brief synthesis ------------------------------------------------

function synthesizeBrandBrief(input: {
  roles: BrandKitData["colors"] | null;
  isDark: boolean;
  saturatedCount: number;
  gradients: string[];
  typo: {
    headingStat: TextStat;
    bodyStat: TextStat;
    headingWeight: number;
    bodyWeight: number;
    h1: number;
    body: number;
    headingTracking: number;
  } | null;
  elementGapPx: number;
  radiusPx: number;
  hasShadows: boolean;
  labelStyle: string;
  namedStyleCount: number;
}): { instructions: string; imageryDescription: string } {
  const lines: string[] = [];
  const adjectives: string[] = [];

  // Theme + color character.
  if (input.roles) {
    const theme = input.isDark ? "dark-first" : "light/airy";
    adjectives.push(input.isDark ? "dark" : "bright");
    const colorChar =
      input.saturatedCount <= 1
        ? "restrained and largely monochromatic"
        : input.saturatedCount <= 3
          ? "focused — a tight palette with one or two signature hues"
          : "expressive and multi-color";
    adjectives.push(input.saturatedCount <= 1 ? "minimal" : "vivid");
    lines.push(
      `Palette: ${theme}, ${colorChar}. The signature accent is ${hueName(
        input.roles.accent,
      )} (${input.roles.accent}); background ${input.roles.background}, text ${
        input.roles.text
      }. Use the exact token colors above for every surface — never hardcode off-brand colors.`,
    );
  }

  // Signature gradient — usually the single most recognizable brand element.
  if (input.gradients.length > 0) {
    adjectives.push("gradient-forward");
    lines.push(
      `Signature gradient(s) are core to this brand — lead with them on hero backgrounds, primary buttons, and accents (available as \`--gradient-brand\` in customCSS): ${input.gradients
        .slice(0, 2)
        .join("  •  ")}.`,
    );
  }

  // Typography personality.
  if (input.typo) {
    const hw = weightWord(input.typo.headingWeight);
    const ratio = input.typo.body > 0 ? input.typo.h1 / input.typo.body : 2;
    const scaleChar =
      ratio >= 3
        ? "a dramatic, oversized display scale"
        : ratio >= 2
          ? "a confident, clear type scale"
          : "a restrained, editorial scale";
    adjectives.push(input.typo.headingWeight >= 700 ? "bold" : "refined");
    const tracking =
      input.typo.headingTracking <= -0.02
        ? " with tight, negative letter-spacing on headings"
        : input.typo.headingTracking >= 0.04
          ? " with wide, airy letter-spacing on headings"
          : "";
    lines.push(
      `Typography: headings in ${input.typo.headingStat.family} (${hw}, ~${input.typo.h1}px at the top of ${scaleChar})${tracking}; body in ${input.typo.bodyStat.family} (~${input.typo.body}px). Load these exact families from Google Fonts and honor the weight contrast.`,
    );
  }

  // Spacing rhythm.
  if (input.elementGapPx > 0) {
    const dense = input.elementGapPx <= 12;
    adjectives.push(dense ? "compact" : "spacious");
    lines.push(
      `Density: ${dense ? "tight and information-dense" : "generous, with confident whitespace"} — typical element gap ~${input.elementGapPx}px. Keep that rhythm consistent.`,
    );
  }

  // Corner language.
  if (input.radiusPx >= 0 && (input.radiusPx > 0 || input.roles)) {
    const corner =
      input.radiusPx <= 4
        ? "sharp, squared corners (precise / technical)"
        : input.radiusPx <= 12
          ? "softly rounded corners"
          : input.radiusPx <= 22
            ? "noticeably rounded, friendly corners"
            : "very round, pill-like corners";
    adjectives.push(input.radiusPx <= 4 ? "precise" : "approachable");
    lines.push(
      `Corner language: ${corner} (~${input.radiusPx}px). Apply it consistently to cards, buttons, and inputs.`,
    );
  }

  // Elevation.
  if (input.hasShadows) {
    adjectives.push("layered");
    lines.push(
      `Depth: uses layered, soft shadows (see \`--shadow-*\` tokens) — favor subtle elevation over hard borders.`,
    );
  } else {
    lines.push(
      `Depth: largely flat — prefer borders, tonal surfaces, and color over drop shadows.`,
    );
  }

  if (input.labelStyle === "uppercase") {
    lines.push(
      `Labels/eyebrows are set in UPPERCASE with letter-spacing — use that for small section labels.`,
    );
  }

  const character = Array.from(new Set(adjectives)).slice(0, 5).join(", ");
  const header = character
    ? `This brand reads as: ${character}. Generate every design so it feels unmistakably on-brand — a stranger should recognize it as the same brand as the source.`
    : `Generate designs that match the extracted tokens precisely so output stays on-brand.`;

  const instructions = [header, "", ...lines].join("\n");

  const imageryDescription = input.roles
    ? `${input.isDark ? "Dark, high-contrast" : "Bright, clean"} brand imagery; ${
        input.gradients.length > 0
          ? "lean on the signature gradient and bold color"
          : "lean on confident color blocking and whitespace"
      }. Avoid generic stock-photo clichés and off-brand color.`
    : "";

  return { instructions, imageryDescription };
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
