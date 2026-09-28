import { DEFAULT_OCEAN_COLORS, type OceanColors } from "./ocean-colors";

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

function srgbToLinear(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

export function readOceanColors(element: Element): OceanColors {
  const style = getComputedStyle(element);
  return {
    fg:
      hexToLinearRgb(style.getPropertyValue(FG_TOKEN)) ??
      DEFAULT_OCEAN_COLORS.fg,
    bg:
      hexToLinearRgb(style.getPropertyValue(BG_TOKEN)) ??
      DEFAULT_OCEAN_COLORS.bg,
  };
}
