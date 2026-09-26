
import type { ShaderDescriptor, ShaderPresetName } from "./shader-presets.js";
import { SHADER_PRESET_MAP } from "./shader-presets.js";


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
  if (CSS_BREAKOUT_RE.test(trimmed)) return false;
  return (
    /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed) ||
    /^rgba?\(\s*[0-9%,.\s/+-]+\)$/.test(trimmed) ||
    /^hsla?\(\s*[0-9%,.\s/+-]+(?:deg)?[0-9%,.\s/+-]*\)$/.test(trimmed) ||
    /^oklch\(\s*[0-9%.\s/+-]+\)$/.test(trimmed) ||
    /^[a-zA-Z]+$/.test(trimmed)
  );
}

function safeColor(value: string): string {
  return isSafeCssColor(value) ? value.trim() : SAFE_FALLBACK_COLOR;
}

function safePalette(colors: string[]): string[] {
  return colors.map(safeColor);
}

function safeSelector(selector: string): string {
  const trimmed = typeof selector === "string" ? selector.trim() : "";
  if (!trimmed || CSS_BREAKOUT_RE.test(trimmed)) return ":root";
  return trimmed;
}


function resolveColors(descriptor: ShaderDescriptor): string[] {
  if (descriptor.colors && descriptor.colors.length > 0) {
    return safePalette(descriptor.colors);
  }
  const presetDef = SHADER_PRESET_MAP[descriptor.preset];
  if (presetDef?.defaultColors && presetDef.defaultColors.length > 0) {
    return safePalette(presetDef.defaultColors);
  }
  return ["#e0e0e0", "#a0a0c0"];
}

function resolveBackColor(
  descriptor: ShaderDescriptor,
  palette: string[],
): string {
  const presetDef = SHADER_PRESET_MAP[descriptor.preset];
  if (presetDef?.defaultColorBack) return safeColor(presetDef.defaultColorBack);
  return palette[palette.length - 1] ?? "#000000";
}


function buildConicGradient(colors: string[], rotation = 0): string {
  const deg = Math.round((rotation * 180) / Math.PI);
  const n = colors.length;
  const stops = colors
    .map((c, i) => `${c} ${Math.round((i / n) * 360)}deg`)
    .join(", ");
  return `conic-gradient(from ${deg}deg at 50% 50%, ${stops}, ${colors[0]} 360deg)`;
}

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

function buildLinearGradient(colors: string[], angleDeg = 135): string {
  const n = colors.length;
  const stops = colors
    .map((c, i) => `${c} ${Math.round((i / Math.max(n - 1, 1)) * 100)}%`)
    .join(", ");
  return `linear-gradient(${angleDeg}deg, ${stops})`;
}


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
      return buildConicGradient(palette, rotation);

    case "Voronoi":
    case "Metaballs":
      return buildRadialGradient(palette, back);

    case "GodRays": {
      const godColors =
        palette.length > 0 ? palette : ["#6200ff", "#ffffff", "#a600ff"];
      return buildRadialGradient(godColors, back);
    }

    case "Warp":
    case "Dithering":
    case "PaperTexture":
    default:
      return buildLinearGradient(
        palette,
        Math.round((rotation * 180) / Math.PI) + 135,
      );
  }
}

export function generateShaderFillFallbackCss(
  descriptor: ShaderDescriptor,
): string {
  const palette = resolveColors(descriptor);
  const back = resolveBackColor(descriptor, palette);

  if (palette.length === 1) {
    return palette[0];
  }

  const stops = palette
    .map(
      (c, i) =>
        `${c} ${Math.round((i / Math.max(palette.length - 1, 1)) * 100)}%`,
    )
    .join(", ");

  const hasDistinctBack =
    SHADER_PRESET_MAP[descriptor.preset]?.defaultColorBack != null &&
    !palette.includes(back);

  if (hasDistinctBack) {
    return `linear-gradient(135deg, ${back} 0%, ${stops}, ${back} 100%)`;
  }

  return `linear-gradient(135deg, ${stops})`;
}

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

export function buildShaderFillBackground(descriptor: ShaderDescriptor): {
  background: string;
  colors: string[];
} {
  return {
    background: generateShaderFillPreviewCss(descriptor),
    colors: resolveColors(descriptor),
  };
}
