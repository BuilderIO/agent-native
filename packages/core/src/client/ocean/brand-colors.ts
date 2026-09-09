import { DEFAULT_OCEAN_COLORS, type OceanColors } from "./ocean-colors.js";

/** Auth shells without docs tokens still use these values as the fallback. */
// guard:allow-raw-color - These fixed values calibrate the standalone GPU shader to the docs brand.
const DARK_COLORS = { fg: "#aeadac", bg: "#0a0a0a" };
// guard:allow-raw-color - These fixed values calibrate the standalone GPU shader to the docs brand.
const LIGHT_COLORS = { fg: "#00677f", bg: "#faf9f5" };
const FG_TOKEN = "--b-text-secondary";
const BG_TOKEN = "--b-bg-page";

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

// The present pass encodes to sRGB on the way out, so the token has to enter
// the shader linear or every mix lands too dark.
function srgbToLinear(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

export function readOceanColors(element: Element): OceanColors {
  const root = document.documentElement;
  const dark = root.classList.contains("dark")
    ? true
    : root.classList.contains("light")
      ? false
      : root.getAttribute("data-theme") === "dark"
        ? true
        : root.getAttribute("data-theme") === "light"
          ? false
          : window.matchMedia?.("(prefers-color-scheme: dark)").matches ===
              true ||
            window.matchMedia?.("(prefers-color-scheme: light)").matches !==
              true;
  const colors = dark ? DARK_COLORS : LIGHT_COLORS;
  const style = getComputedStyle(element);
  return {
    fg:
      hexToLinearRgb(style.getPropertyValue(FG_TOKEN)) ??
      hexToLinearRgb(colors.fg) ??
      DEFAULT_OCEAN_COLORS.fg,
    bg:
      hexToLinearRgb(style.getPropertyValue(BG_TOKEN)) ??
      hexToLinearRgb(colors.bg) ??
      DEFAULT_OCEAN_COLORS.bg,
  };
}
