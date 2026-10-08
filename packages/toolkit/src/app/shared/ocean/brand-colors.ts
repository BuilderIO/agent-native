import { HERO_FALLBACK_COLORS } from "./hero-layout.js";
// Type-only: importing DEFAULT_OCEAN_COLORS (a value) would pull tuning.ts in
// here -- see hero-layout.ts. Use HERO_FALLBACK_COLORS for the actual default.
import type { OceanColors } from "./ocean-colors.js";

// guard:allow-raw-color - These fixed values calibrate the standalone GPU shader to the docs brand.
const DARK_COLORS = { fg: "#aeadac", bg: "#0a0a0a" };
// guard:allow-raw-color - These fixed values calibrate the standalone GPU shader to the docs brand.
const LIGHT_COLORS = { fg: "#00677f", bg: "#faf9f5" };

/**
 * Returns null for anything that is not a full six-digit hex. Callers fall back
 * to the packaged defaults -- an unreadable token and a legitimately dark token
 * must not produce the same silent black.
 */
export function hexToLinearRgb(
  hex: string,
): readonly [number, number, number] | null {
  const normalized = hex.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const value = Number.parseInt(normalized, 16);
  return [
    srgbToLinear(((value >> 16) & 255) / 255),
    srgbToLinear(((value >> 8) & 255) / 255),
    srgbToLinear((value & 255) / 255),
  ];
}

function srgbToLinear(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

export function readOceanColors(element: Element): OceanColors {
  const styles = getComputedStyle(element);
  const fg = hexToLinearRgb(styles.getPropertyValue("--b-hero-shader-fg"));
  const bg = hexToLinearRgb(styles.getPropertyValue("--b-bg-page"));
  if (fg && bg) return { fg, bg };

  const root = document.documentElement;
  const dark = root.classList.contains("dark")
    ? true
    : root.classList.contains("light")
      ? false
      : root.getAttribute("data-theme") === "dark";
  const colors = dark ? DARK_COLORS : LIGHT_COLORS;
  return {
    fg: hexToLinearRgb(colors.fg) ?? HERO_FALLBACK_COLORS.fg,
    bg: hexToLinearRgb(colors.bg) ?? HERO_FALLBACK_COLORS.bg,
  };
}
