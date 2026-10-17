import type { ColorMode } from "@shared/color-spaces";
import { rgbaToHex, type RgbaColor } from "@shared/color-utils";

/** Hex, RGB, HSL, HSB, Display P3, OKLCH: the one mode select. */
export type DesignColorMode = ColorMode;

export interface HsvaColor {
  h: number;
  s: number;
  v: number;
  a: number;
}

export function rgbaToHsv(color: RgbaColor): HsvaColor {
  const r = clampFloat(color.r / 255, 0, 1);
  const g = clampFloat(color.g / 255, 0, 1);
  const b = clampFloat(color.b / 255, 0, 1);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return {
    h: Math.round(h),
    s: max === 0 ? 0 : Math.round((delta / max) * 100),
    v: Math.round(max * 100),
    a: color.a,
  };
}

export function hsvToRgba(color: HsvaColor): RgbaColor {
  const h = ((color.h % 360) + 360) % 360;
  const s = clampFloat(color.s, 0, 100) / 100;
  const v = clampFloat(color.v, 0, 100) / 100;
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - chroma;

  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [chroma, x, 0];
  else if (h < 120) [r, g, b] = [x, chroma, 0];
  else if (h < 180) [r, g, b] = [0, chroma, x];
  else if (h < 240) [r, g, b] = [0, x, chroma];
  else if (h < 300) [r, g, b] = [x, 0, chroma];
  else [r, g, b] = [chroma, 0, x];

  return {
    r: clamp(Math.round((r + m) * 255), 0, 255),
    g: clamp(Math.round((g + m) * 255), 0, 255),
    b: clamp(Math.round((b + m) * 255), 0, 255),
    a: clampFloat(color.a, 0, 1),
  };
}

/** Rounds to a whole number: the picker's tracks and fields are integers. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/** Rounds to `decimals` places. */
export function roundTo(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

/** Clamps, then rounds to `decimals` places; a non-finite value becomes `min`. */
export function clampTo(
  value: number,
  min: number,
  max: number,
  decimals: number,
): number {
  if (!Number.isFinite(value)) return min;
  return roundTo(Math.max(min, Math.min(max, value)), decimals);
}

export function hasHexAlpha(value: string): boolean {
  return /^#?(?:[0-9a-f]{4}|[0-9a-f]{8})$/i.test(value.trim());
}

export function parseNumericDraft(draft: string): number | null {
  const trimmed = draft.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function expandHexShorthand(value: string): string {
  const trimmed = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]$/i.test(trimmed)) return trimmed.repeat(6);
  if (/^[0-9a-f]{2}$/i.test(trimmed)) return trimmed.repeat(3);
  if (/^[0-9a-f]{3}$/i.test(trimmed)) {
    return Array.from(trimmed)
      .map((digit) => digit.repeat(2))
      .join("");
  }
  return trimmed;
}

export function toDisplayHex(color: RgbaColor): string {
  return rgbaToHex(color).replace(/^#/, "").toUpperCase();
}
