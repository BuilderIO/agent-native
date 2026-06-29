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

// CSS named colors → hex, so detection/round-tripping works for shadows, gradient
// stops, and the color picker (not just #hex/rgb()/hsl()). `transparent` is handled
// separately as fully transparent black.
const NAMED_COLOR_HEX: Record<string, string> = {
  aliceblue: "#f0f8ff",
  antiquewhite: "#faebd7",
  aqua: "#00ffff",
  aquamarine: "#7fffd4",
  azure: "#f0ffff",
  beige: "#f5f5dc",
  bisque: "#ffe4c4",
  black: "#000000",
  blanchedalmond: "#ffebcd",
  blue: "#0000ff",
  blueviolet: "#8a2be2",
  brown: "#a52a2a",
  burlywood: "#deb887",
  cadetblue: "#5f9ea0",
  chartreuse: "#7fff00",
  chocolate: "#d2691e",
  coral: "#ff7f50",
  cornflowerblue: "#6495ed",
  cornsilk: "#fff8dc",
  crimson: "#dc143c",
  cyan: "#00ffff",
  darkblue: "#00008b",
  darkcyan: "#008b8b",
  darkgoldenrod: "#b8860b",
  darkgray: "#a9a9a9",
  darkgreen: "#006400",
  darkgrey: "#a9a9a9",
  darkkhaki: "#bdb76b",
  darkmagenta: "#8b008b",
  darkolivegreen: "#556b2f",
  darkorange: "#ff8c00",
  darkorchid: "#9932cc",
  darkred: "#8b0000",
  darksalmon: "#e9967a",
  darkseagreen: "#8fbc8f",
  darkslateblue: "#483d8b",
  darkslategray: "#2f4f4f",
  darkslategrey: "#2f4f4f",
  darkturquoise: "#00ced1",
  darkviolet: "#9400d3",
  deeppink: "#ff1493",
  deepskyblue: "#00bfff",
  dimgray: "#696969",
  dimgrey: "#696969",
  dodgerblue: "#1e90ff",
  firebrick: "#b22222",
  floralwhite: "#fffaf0",
  forestgreen: "#228b22",
  fuchsia: "#ff00ff",
  gainsboro: "#dcdcdc",
  ghostwhite: "#f8f8ff",
  gold: "#ffd700",
  goldenrod: "#daa520",
  gray: "#808080",
  green: "#008000",
  greenyellow: "#adff2f",
  grey: "#808080",
  honeydew: "#f0fff0",
  hotpink: "#ff69b4",
  indianred: "#cd5c5c",
  indigo: "#4b0082",
  ivory: "#fffff0",
  khaki: "#f0e68c",
  lavender: "#e6e6fa",
  lavenderblush: "#fff0f5",
  lawngreen: "#7cfc00",
  lemonchiffon: "#fffacd",
  lightblue: "#add8e6",
  lightcoral: "#f08080",
  lightcyan: "#e0ffff",
  lightgoldenrodyellow: "#fafad2",
  lightgray: "#d3d3d3",
  lightgreen: "#90ee90",
  lightgrey: "#d3d3d3",
  lightpink: "#ffb6c1",
  lightsalmon: "#ffa07a",
  lightseagreen: "#20b2aa",
  lightskyblue: "#87cefa",
  lightslategray: "#778899",
  lightslategrey: "#778899",
  lightsteelblue: "#b0c4de",
  lightyellow: "#ffffe0",
  lime: "#00ff00",
  limegreen: "#32cd32",
  linen: "#faf0e6",
  magenta: "#ff00ff",
  maroon: "#800000",
  mediumaquamarine: "#66cdaa",
  mediumblue: "#0000cd",
  mediumorchid: "#ba55d3",
  mediumpurple: "#9370db",
  mediumseagreen: "#3cb371",
  mediumslateblue: "#7b68ee",
  mediumspringgreen: "#00fa9a",
  mediumturquoise: "#48d1cc",
  mediumvioletred: "#c71585",
  midnightblue: "#191970",
  mintcream: "#f5fffa",
  mistyrose: "#ffe4e1",
  moccasin: "#ffe4b5",
  navajowhite: "#ffdead",
  navy: "#000080",
  oldlace: "#fdf5e6",
  olive: "#808000",
  olivedrab: "#6b8e23",
  orange: "#ffa500",
  orangered: "#ff4500",
  orchid: "#da70d6",
  palegoldenrod: "#eee8aa",
  palegreen: "#98fb98",
  paleturquoise: "#afeeee",
  palevioletred: "#db7093",
  papayawhip: "#ffefd5",
  peachpuff: "#ffdab9",
  peru: "#cd853f",
  pink: "#ffc0cb",
  plum: "#dda0dd",
  powderblue: "#b0e0e6",
  purple: "#800080",
  rebeccapurple: "#663399",
  red: "#ff0000",
  rosybrown: "#bc8f8f",
  royalblue: "#4169e1",
  saddlebrown: "#8b4513",
  salmon: "#fa8072",
  sandybrown: "#f4a460",
  seagreen: "#2e8b57",
  seashell: "#fff5ee",
  sienna: "#a0522d",
  silver: "#c0c0c0",
  skyblue: "#87ceeb",
  slateblue: "#6a5acd",
  slategray: "#708090",
  slategrey: "#708090",
  snow: "#fffafa",
  springgreen: "#00ff7f",
  steelblue: "#4682b4",
  tan: "#d2b48c",
  teal: "#008080",
  thistle: "#d8bfd8",
  tomato: "#ff6347",
  turquoise: "#40e0d0",
  violet: "#ee82ee",
  wheat: "#f5deb3",
  white: "#ffffff",
  whitesmoke: "#f5f5f5",
  yellow: "#ffff00",
  yellowgreen: "#9acd32",
};

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

  const lower = trimmed.toLowerCase();
  if (lower === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const namedHex = NAMED_COLOR_HEX[lower];
  if (namedHex) return hexToRgba(namedHex);

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
