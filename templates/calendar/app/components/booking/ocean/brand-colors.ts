import { DEFAULT_OCEAN_COLORS, type OceanColors } from "./ocean-colors";

const DARK_COLORS = { fg: "#aeadac", bg: "#0a0a0a" };
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

// The present pass encodes to sRGB on the way out, so the token has to enter
// the shader linear or every mix lands too dark.
function srgbToLinear(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

export function readOceanColors(element: Element): OceanColors {
  void element;
  const root = document.documentElement;
  const dark = root.classList.contains("dark")
    ? true
    : root.classList.contains("light")
      ? false
      : root.getAttribute("data-theme") === "dark";
  const colors = dark ? DARK_COLORS : LIGHT_COLORS;
  return {
    fg: hexToLinearRgb(colors.fg) ?? DEFAULT_OCEAN_COLORS.fg,
    bg: hexToLinearRgb(colors.bg) ?? DEFAULT_OCEAN_COLORS.bg,
  };
}
