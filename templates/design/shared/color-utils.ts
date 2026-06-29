export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface HslaColor {
  h: number;
  s: number;
  l: number;
  a: number;
}

const RGB_PATTERN =
  /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+%?))?\s*\)$/i;
const HSL_PATTERN =
  /^hsla?\(\s*([0-9.]+)(?:deg)?\s*,\s*([0-9.]+)%\s*,\s*([0-9.]+)%(?:\s*,\s*([0-9.]+%?))?\s*\)$/i;

export function parseCssColor(value: string): RgbaColor | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("#")) return hexToRgba(trimmed);

  const rgb = trimmed.match(RGB_PATTERN);
  if (rgb) {
    return normalizeRgba({
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: parseAlpha(rgb[4]),
    });
  }

  const hsl = trimmed.match(HSL_PATTERN);
  if (hsl) {
    return hslToRgba({
      h: Number(hsl[1]),
      s: Number(hsl[2]),
      l: Number(hsl[3]),
      a: parseAlpha(hsl[4]),
    });
  }

  return null;
}

export function hexToRgba(value: string): RgbaColor | null {
  const raw = value.trim().replace(/^#/, "");
  const expanded =
    raw.length === 3 || raw.length === 4
      ? raw
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : raw;

  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(expanded)) return null;

  const r = Number.parseInt(expanded.slice(0, 2), 16);
  const g = Number.parseInt(expanded.slice(2, 4), 16);
  const b = Number.parseInt(expanded.slice(4, 6), 16);
  const alphaHex = expanded.slice(6, 8);
  const a = alphaHex ? Number.parseInt(alphaHex, 16) / 255 : 1;
  return normalizeRgba({ r, g, b, a });
}

export function rgbaToHex(color: RgbaColor, includeAlpha = false): string {
  const normalized = normalizeRgba(color);
  const alpha = includeAlpha
    ? channelToHex(Math.round(normalized.a * 255))
    : "";
  return `#${channelToHex(normalized.r)}${channelToHex(normalized.g)}${channelToHex(normalized.b)}${alpha}`;
}

export function rgbaToCss(color: RgbaColor): string {
  const normalized = normalizeRgba(color);
  if (normalized.a >= 1) return rgbaToHex(normalized);
  return `rgba(${normalized.r}, ${normalized.g}, ${normalized.b}, ${trimNumber(normalized.a)})`;
}

export function rgbaToHsl(color: RgbaColor): HslaColor {
  const normalized = normalizeRgba(color);
  const r = normalized.r / 255;
  const g = normalized.g / 255;
  const b = normalized.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / delta) % 6;
    if (max === g) h = (b - r) / delta + 2;
    if (max === b) h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
    a: normalized.a,
  };
}

export function hslToRgba(color: HslaColor): RgbaColor {
  const h = ((color.h % 360) + 360) % 360;
  const s = clamp(color.s, 0, 100) / 100;
  const l = clamp(color.l, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - chroma / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) [r, g, b] = [chroma, x, 0];
  else if (h < 120) [r, g, b] = [x, chroma, 0];
  else if (h < 180) [r, g, b] = [0, chroma, x];
  else if (h < 240) [r, g, b] = [0, x, chroma];
  else if (h < 300) [r, g, b] = [x, 0, chroma];
  else [r, g, b] = [chroma, 0, x];

  return normalizeRgba({
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
    a: color.a,
  });
}

export function normalizeRgba(color: RgbaColor): RgbaColor {
  return {
    r: Math.round(clamp(color.r, 0, 255)),
    g: Math.round(clamp(color.g, 0, 255)),
    b: Math.round(clamp(color.b, 0, 255)),
    a: clamp(color.a, 0, 1),
  };
}

export function opacityToAlpha(opacity: number): number {
  return clamp(opacity, 0, 100) / 100;
}

export function alphaToOpacity(alpha: number): number {
  return Math.round(clamp(alpha, 0, 1) * 100);
}

export function withColorOpacity(color: RgbaColor, opacity: number): RgbaColor {
  return normalizeRgba({ ...color, a: opacityToAlpha(opacity) });
}

function parseAlpha(value: string | undefined): number {
  if (!value) return 1;
  if (value.endsWith("%")) return Number(value.slice(0, -1)) / 100;
  return Number(value);
}

function channelToHex(value: number): string {
  return Math.round(clamp(value, 0, 255))
    .toString(16)
    .padStart(2, "0");
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function trimNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}
