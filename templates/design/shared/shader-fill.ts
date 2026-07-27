/**
 * shader-fill.ts — pure CSS mesh-gradient "shader fill" helpers.
 *
 * No DB, no side effects.  Deterministic output: same descriptor → same CSS.
 *
 * Two exports:
 * - `generateShaderFillPreviewCss`  — a CSS mesh-gradient that approximates the
 *   shader fill visually; safe to inject into the iframe via a bridge
 *   `tweak-values`-style message without any write commit.
 * - `generateShaderFillFallbackCss` — a static CSS fallback that can be placed
 *   in `<style>` blocks when the WebGL runtime is absent (export, SSR, PDF).
 *
 * The fallback is intentionally simpler than the preview (no animation, no
 * WebGL) so it stays safe at the container level.  Both return the string value
 * of a CSS `background` property — the caller wraps it in a rule.
 */

import type { ShaderDescriptor, ShaderPresetName } from "./shader-presets.js";
import { SHADER_PRESET_MAP } from "./shader-presets.js";

// ─── CSS-injection safety ────────────────────────────────────────────────────

/**
 * Neutral fallback used when a caller-supplied colour fails validation. Keeps
 * the rendered gradient deterministic and visually sane without ever echoing
 * untrusted text into a CSS `background` / gradient string.
 */
const SAFE_FALLBACK_COLOR = "#808080";

/**
 * Characters that must never appear inside a colour token or selector: they
 * can terminate the current declaration/rule (`;` `}`), open a new rule (`{`),
 * break out of `<style>` (`<` `>`), or pull in a remote resource (`url(`).
 */
const CSS_BREAKOUT_RE = /[;{}<>]|url\(/i;

/**
 * Strict allowlist for a single CSS colour token. Accepts only:
 * - hex: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`
 * - `rgb()` / `rgba()`
 * - `hsl()` / `hsla()`
 * - `oklch()`
 * - bare named colours (e.g. `rebeccapurple`, `transparent`)
 *
 * Anything containing CSS-breakout characters, whitespace that could break out
 * of the property value, or `url(` is rejected.
 */
function isSafeCssColor(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Reject declaration/rule/style/`url(` breakout characters outright.
  if (CSS_BREAKOUT_RE.test(trimmed)) return false;
  return (
    // Hex: 3, 4, 6, or 8 digits.
    /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed) ||
    // rgb() / rgba(): digits, %, commas, dots, slash, whitespace, sign only.
    /^rgba?\(\s*[0-9%,.\s/+-]+\)$/.test(trimmed) ||
    // hsl() / hsla(): same numeric charset plus an optional `deg` unit.
    /^hsla?\(\s*[0-9%,.\s/+-]+(?:deg)?[0-9%,.\s/+-]*\)$/.test(trimmed) ||
    // oklch(): digits, %, dots, slash, whitespace, sign only.
    /^oklch\(\s*[0-9%.\s/+-]+\)$/.test(trimmed) ||
    // Bare named colour (alphabetic only — `transparent`, `rebeccapurple`, …).
    /^[a-zA-Z]+$/.test(trimmed)
  );
}

/**
 * Coerce a caller-supplied colour to a safe value: returns the trimmed colour
 * if it passes the strict allowlist, otherwise a neutral fallback. This is the
 * single choke point every colour passes through before being interpolated
 * into a CSS string.
 */
function safeColor(value: string): string {
  return isSafeCssColor(value) ? value.trim() : SAFE_FALLBACK_COLOR;
}

/** Sanitise a whole palette, dropping nothing but neutralising unsafe entries. */
function safePalette(colors: string[]): string[] {
  return colors.map(safeColor);
}

/**
 * Validate a CSS selector before it is interpolated into a `selector { … }`
 * rule. Rejects anything containing declaration/rule/style/`url(` breakout
 * characters; falls back to a harmless `:root` when invalid so callers never
 * inject an attacker-controlled rule head.
 */
function safeSelector(selector: string): string {
  const trimmed = typeof selector === "string" ? selector.trim() : "";
  if (!trimmed || CSS_BREAKOUT_RE.test(trimmed)) return ":root";
  return trimmed;
}

// ─── Internal colour helpers ────────────────────────────────────────────────

/**
 * Resolve the primary colour palette for a descriptor.
 * Falls back to the preset defaults when the descriptor carries no colours.
 *
 * Every returned colour is run through the strict CSS-colour allowlist so the
 * downstream gradient/`background` strings can never carry a CSS-injection
 * payload from `descriptor.colors`.
 */
function resolveColors(descriptor: ShaderDescriptor): string[] {
  if (descriptor.colors && descriptor.colors.length > 0) {
    return safePalette(descriptor.colors);
  }
  const presetDef = SHADER_PRESET_MAP[descriptor.preset];
  if (presetDef?.defaultColors && presetDef.defaultColors.length > 0) {
    return safePalette(presetDef.defaultColors);
  }
  // Last-resort neutral palette.
  return ["#e0e0e0", "#a0a0c0"];
}

/**
 * Resolve the first "single back" color if the preset defines one, otherwise
 * fall back to the last entry in the palette.
 */
function resolveBackColor(
  descriptor: ShaderDescriptor,
  palette: string[],
): string {
  const presetDef = SHADER_PRESET_MAP[descriptor.preset];
  if (presetDef?.defaultColorBack) return safeColor(presetDef.defaultColorBack);
  return palette[palette.length - 1] ?? "#000000";
}

// ─── Gradient stop generators (per-preset family) ────────────────────────────

/**
 * Build a conic-gradient string that loosely mimics MeshGradient / GrainGradient
 * colour placement.  The stops are evenly distributed.
 */
function buildConicGradient(colors: string[], rotation = 0): string {
  const deg = Math.round((rotation * 180) / Math.PI);
  const n = colors.length;
  const stops = colors
    .map((c, i) => `${c} ${Math.round((i / n) * 360)}deg`)
    .join(", ");
  return `conic-gradient(from ${deg}deg at 50% 50%, ${stops}, ${colors[0]} 360deg)`;
}

/**
 * Build a radial-gradient with the supplied colours — good approximation of
 * Voronoi / Metaballs / GodRays where colour pools radiate from the centre.
 */
function buildRadialGradient(colors: string[], back: string): string {
  const n = colors.length;
  const stops = colors
    .map((c, i) => {
      const pct = Math.round(((i + 0.5) / n) * 100);
      return `${c} ${pct}%`;
    })
    .join(", ");
  return `radial-gradient(ellipse at 50% 50%, ${stops}, ${back} 100%)`;
}

/**
 * Build a linear-gradient — used for Warp / Dithering / PaperTexture
 * where a flat gradient is the closest safe approximation.
 */
function buildLinearGradient(colors: string[], angleDeg = 135): string {
  const n = colors.length;
  const stops = colors
    .map((c, i) => `${c} ${Math.round((i / Math.max(n - 1, 1)) * 100)}%`)
    .join(", ");
  return `linear-gradient(${angleDeg}deg, ${stops})`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate a deterministic CSS `background` value that previews the shader
 * fill without any WebGL runtime.
 *
 * The value is a multi-stop CSS gradient that approximates the shader's colour
 * scheme and general shape.  It is safe to inject into the iframe canvas via a
 * bridge message without persisting anything.
 *
 * Callers set this as the `background` property on the target element.
 *
 * @param descriptor - The ShaderDescriptor defining preset + params + colours.
 * @returns A CSS `background` property value string.
 */
export function generateShaderFillPreviewCss(
  descriptor: ShaderDescriptor,
): string {
  const palette = resolveColors(descriptor);
  const back = resolveBackColor(descriptor, palette);
  const preset: ShaderPresetName = descriptor.preset;
  const rotation = descriptor.rotation ?? 0;

  switch (preset) {
    case "MeshGradient":
    case "GrainGradient":
      // Conic gradient best captures the swirling multi-colour look.
      return buildConicGradient(palette, rotation);

    case "Voronoi":
    case "Metaballs":
      // Radial gradient captures the pooling/bubbling character.
      return buildRadialGradient(palette, back);

    case "GodRays": {
      // Radial for the central bloom, bias toward darker back colour.
      const godColors =
        palette.length > 0 ? palette : ["#6200ff", "#ffffff", "#a600ff"];
      return buildRadialGradient(godColors, back);
    }

    case "Warp":
    case "Dithering":
    case "PaperTexture":
    default:
      // Linear gradient is the safest approximation for these.
      return buildLinearGradient(
        palette,
        Math.round((rotation * 180) / Math.PI) + 135,
      );
  }
}

/**
 * Generate a static CSS `background` value intended as a permanent fallback
 * when the WebGL runtime is absent (export, PDF, SSR, e-mail).
 *
 * Deliberately simpler than the preview:
 * - No animation keyframes (would be stripped anyway).
 * - Single gradient stop per colour.
 * - Safe at any container size.
 *
 * Callers set this as the `background` property in a `<style>` fallback rule
 * that is overridden at runtime when the shader canvas mounts.
 *
 * @param descriptor - The ShaderDescriptor defining preset + params + colours.
 * @returns A CSS `background` property value string, suitable for a `<style>` block.
 */
export function generateShaderFillFallbackCss(
  descriptor: ShaderDescriptor,
): string {
  const palette = resolveColors(descriptor);
  const back = resolveBackColor(descriptor, palette);

  if (palette.length === 1) {
    return palette[0];
  }

  // For all presets: a simple linear-gradient is the most universally
  // compatible fallback.  135 deg gives a diagonal that reads as "designed".
  const stops = palette
    .map(
      (c, i) =>
        `${c} ${Math.round((i / Math.max(palette.length - 1, 1)) * 100)}%`,
    )
    .join(", ");

  // If the preset has a distinct back colour, bookend with it.
  const hasDistinctBack =
    SHADER_PRESET_MAP[descriptor.preset]?.defaultColorBack != null &&
    !palette.includes(back);

  if (hasDistinctBack) {
    return `linear-gradient(135deg, ${back} 0%, ${stops}, ${back} 100%)`;
  }

  return `linear-gradient(135deg, ${stops})`;
}

/**
 * Build the complete CSS block for injecting a shader-fill fallback on a
 * selector.  The block includes:
 * 1. A `background` fallback rule (static gradient).
 * 2. A CSS comment marking it as a shader-fill fallback so tooling can detect
 *    and replace it.
 *
 * @param selector - The CSS selector to target (e.g. `#hero`, `.card`).
 * @param descriptor - The ShaderDescriptor.
 * @returns A complete CSS block string, ready to embed in a `<style>` element.
 */
export function buildShaderFillFallbackBlock(
  selector: string,
  descriptor: ShaderDescriptor,
): string {
  const bg = generateShaderFillFallbackCss(descriptor);
  const safeSel = safeSelector(selector);
  return [
    `/* shader-fill-fallback: ${descriptor.preset} */`,
    `${safeSel} {`,
    `  background: ${bg};`,
    `}`,
  ].join("\n");
}

/**
 * Resolve the CSS `background` value to persist into the design source for a
 * shader fill.
 *
 * This is the single value `apply-shader-fill` writes onto the target element's
 * inline `style.background`.  It is identical to the value the live preview
 * renders (`generateShaderFillPreviewCss`) so "what you previewed is what you
 * get", and — like every other output of this module — every colour passes
 * through the strict CSS-colour allowlist before being interpolated, so a
 * `descriptor.colors` payload can never carry a CSS-injection string into the
 * persisted source.
 *
 * Returns the gradient string plus the sanitised palette that produced it so
 * callers can surface proof-of-persist (which colours were written, which were
 * neutralised) without re-deriving them.
 *
 * @param descriptor - The ShaderDescriptor defining preset + params + colours.
 * @returns `{ background, colors }` — the value to write and the safe palette.
 */
export function buildShaderFillBackground(descriptor: ShaderDescriptor): {
  background: string;
  colors: string[];
} {
  return {
    background: generateShaderFillPreviewCss(descriptor),
    colors: resolveColors(descriptor),
  };
}
