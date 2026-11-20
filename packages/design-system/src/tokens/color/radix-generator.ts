//

import * as RadixColors from "@radix-ui/colors";
import Color from "colorjs.io";

import { at } from "../at.js";
import { cubicBezier } from "./bezier.js";

export type Scale12<T = string> = [T, T, T, T, T, T, T, T, T, T, T, T];
export type Appearance = "light" | "dark";

const STEPS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

export const RADIX_GRAY_SCALE_NAMES = [
  "gray",
  "mauve",
  "slate",
  "sage",
  "olive",
  "sand",
] as const;

export const RADIX_SCALE_NAMES = [
  ...RADIX_GRAY_SCALE_NAMES,
  "tomato",
  "red",
  "ruby",
  "crimson",
  "pink",
  "plum",
  "purple",
  "violet",
  "iris",
  "indigo",
  "blue",
  "cyan",
  "teal",
  "jade",
  "green",
  "grass",
  "brown",
  "orange",
  "sky",
  "mint",
  "lime",
  "yellow",
  "amber",
] as const;

export type RadixScaleName = (typeof RADIX_SCALE_NAMES)[number];
type RadixGrayScaleName = (typeof RADIX_GRAY_SCALE_NAMES)[number];

const radixPalettes = RadixColors as unknown as Record<
  string,
  Record<string, string> | undefined
>;

function readScale(name: string, appearance: Appearance): Scale12<Color> {
  const key = appearance === "light" ? `${name}P3` : `${name}DarkP3`;
  const palette = radixPalettes[key];
  if (!palette) throw new Error(`Missing Radix scale ${key}`);
  return Object.values(palette).map((value) =>
    new Color(value).to("oklch"),
  ) as Scale12<Color>;
}

type ScaleTable<Name extends string> = Record<Name, Scale12<Color>>;

let cachedScales:
  | Record<
      Appearance,
      {
        all: ScaleTable<RadixScaleName>;
        grays: ScaleTable<RadixGrayScaleName>;
      }
    >
  | undefined;

function referenceScales(appearance: Appearance) {
  if (!cachedScales) {
    const build = (mode: Appearance) => ({
      all: Object.fromEntries(
        RADIX_SCALE_NAMES.map((name) => [name, readScale(name, mode)]),
      ) as ScaleTable<RadixScaleName>,
      grays: Object.fromEntries(
        RADIX_GRAY_SCALE_NAMES.map((name) => [name, readScale(name, mode)]),
      ) as ScaleTable<RadixGrayScaleName>,
    });
    cachedScales = { light: build("light"), dark: build("dark") };
  }
  return cachedScales[appearance];
}

const L = (color: Color) => color.coords[0] ?? 0;
const C = (color: Color) => color.coords[1] ?? 0;
const H = (color: Color) => color.coords[2];
const hasHue = (hue: number | null): hue is number =>
  hue !== null && !Number.isNaN(hue);

export interface RadixColorsInput {
  appearance: Appearance;
  accent: string;
  gray: string;
  background: string;
}

export interface RadixColorsOutput {
  accentScale: Scale12;
  accentScaleAlpha: Scale12;
  accentScaleWideGamut: Scale12;
  accentScaleAlphaWideGamut: Scale12;
  accentContrast: string;
  grayScale: Scale12;
  grayScaleAlpha: Scale12;
  grayScaleWideGamut: Scale12;
  grayScaleAlphaWideGamut: Scale12;
  graySurface: string;
  graySurfaceWideGamut: string;
  accentSurface: string;
  accentSurfaceWideGamut: string;
  background: string;
}

export function generateRadixColors({
  appearance,
  ...args
}: RadixColorsInput): RadixColorsOutput {
  const { all: allScales, grays: grayScales } = referenceScales(appearance);
  const backgroundColor = parseColor(args.background, "background").to("oklch");

  const grayBaseColor = parseColor(args.gray, "gray").to("oklch");
  const grayScaleColors = getScaleFromColor(
    grayBaseColor,
    grayScales,
    backgroundColor,
  );

  const accentBaseColor = parseColor(args.accent, "accent").to("oklch");
  let accentScaleColors = getScaleFromColor(
    accentBaseColor,
    allScales,
    backgroundColor,
  );

  const backgroundHex = toHex(backgroundColor);

  const accentBaseHex = toHex(accentBaseColor);
  if (accentBaseHex === "#000000" || accentBaseHex === "#ffffff") {
    accentScaleColors = grayScaleColors.map((color) =>
      color.clone(),
    ) as Scale12<Color>;
  }

  const [accent9Color, accentContrastColor] = getStep9Colors(
    accentScaleColors,
    accentBaseColor,
  );

  accentScaleColors[8] = accent9Color;
  accentScaleColors[9] = getButtonHoverColor(accent9Color, [accentScaleColors]);

  const textChromaCap = Math.max(
    C(accentScaleColors[8]),
    C(accentScaleColors[7]),
  );
  accentScaleColors[10].coords[1] = Math.min(
    textChromaCap,
    C(accentScaleColors[10]),
  );
  accentScaleColors[11].coords[1] = Math.min(
    textChromaCap,
    C(accentScaleColors[11]),
  );

  const accentScaleHex = accentScaleColors.map(toHex) as Scale12;
  const accentScaleWideGamut = accentScaleColors.map(toOklchString) as Scale12;
  const grayScaleHex = grayScaleColors.map(toHex) as Scale12;
  const grayScaleWideGamut = grayScaleColors.map(toOklchString) as Scale12;

  const surfaceAlpha = appearance === "light" ? 0.8 : 0.5;

  return {
    accentScale: accentScaleHex,
    accentScaleAlpha: accentScaleHex.map((color) =>
      getAlphaColorSrgb(color, backgroundHex),
    ) as Scale12,
    accentScaleWideGamut,
    accentScaleAlphaWideGamut: accentScaleHex.map((color) =>
      getAlphaColorP3(color, backgroundHex),
    ) as Scale12,
    accentContrast: toHex(accentContrastColor),

    grayScale: grayScaleHex,
    grayScaleAlpha: grayScaleHex.map((color) =>
      getAlphaColorSrgb(color, backgroundHex),
    ) as Scale12,
    grayScaleWideGamut,
    grayScaleAlphaWideGamut: grayScaleHex.map((color) =>
      getAlphaColorP3(color, backgroundHex),
    ) as Scale12,

    graySurface: appearance === "light" ? "#ffffffcc" : "rgba(0, 0, 0, 0.05)",
    graySurfaceWideGamut:
      appearance === "light"
        ? "color(display-p3 1 1 1 / 80%)"
        : "color(display-p3 0 0 0 / 5%)",

    accentSurface: getAlphaColorSrgb(
      accentScaleHex[1],
      backgroundHex,
      surfaceAlpha,
    ),
    accentSurfaceWideGamut: getAlphaColorP3(
      accentScaleWideGamut[1],
      backgroundHex,
      surfaceAlpha,
    ),

    background: backgroundHex,
  };
}

function parseColor(value: string, role: string): Color {
  try {
    return new Color(value);
  } catch (cause) {
    throw new TypeError(`Unsupported ${role} color: ${value}`, { cause });
  }
}

function getStep9Colors(
  scale: Scale12<Color>,
  accentBaseColor: Color,
): [Color, Color] {
  const distance = accentBaseColor.deltaEOK(scale[0]) * 100;
  if (distance < 25) return [scale[8], getTextColor(scale[8])];
  return [accentBaseColor, getTextColor(accentBaseColor)];
}

function getButtonHoverColor(source: Color, scales: Scale12<Color>[]): Color {
  const l = L(source);
  const c = C(source);
  const h = H(source);
  const newL = l > 0.4 ? l - 0.03 / (l + 0.1) : l + 0.03 / (l + 0.1);
  const newC = l > 0.4 && hasHue(h) ? c * 0.93 + 0 : c;
  const buttonHoverColor = new Color("oklch", [newL, newC, h]);

  let closestColor = buttonHoverColor;
  let minDistance = Infinity;
  for (const scale of scales) {
    for (const color of scale) {
      const distance = buttonHoverColor.deltaEOK(color);
      if (distance < minDistance) {
        minDistance = distance;
        closestColor = color;
      }
    }
  }

  buttonHoverColor.coords[1] = closestColor.coords[1];
  buttonHoverColor.coords[2] = closestColor.coords[2];
  return buttonHoverColor;
}

function getScaleFromColor<Name extends string>(
  source: Color,
  scales: ScaleTable<Name>,
  backgroundColor: Color,
): Scale12<Color> {
  const allColors: { scale: Name; color: Color; distance: number }[] = [];
  for (const name of Object.keys(scales) as Name[]) {
    for (const color of scales[name]) {
      allColors.push({ scale: name, distance: source.deltaEOK(color), color });
    }
  }
  allColors.sort((left, right) => left.distance - right.distance);

  const closestColors = allColors.filter(
    (color, index, array) =>
      index === array.findIndex((value) => value.scale === color.scale),
  );

  const grayNames = RADIX_GRAY_SCALE_NAMES as readonly string[];
  const allAreGrays = closestColors.every((color) =>
    grayNames.includes(color.scale),
  );
  if (!allAreGrays && grayNames.includes(at(closestColors, 0).scale)) {
    while (grayNames.includes(at(closestColors, 1).scale)) {
      closestColors.splice(1, 1);
    }
  }

  const colorA = at(closestColors, 0);
  const colorB = at(closestColors, 1);

  const a = colorB.distance;
  const b = colorA.distance;
  const c = colorA.color.deltaEOK(colorB.color);

  const cosA = (b ** 2 + c ** 2 - a ** 2) / (2 * b * c);
  const sinA = Math.sin(Math.acos(cosA));
  const cosB = (a ** 2 + c ** 2 - b ** 2) / (2 * a * c);
  const sinB = Math.sin(Math.acos(cosB));
  const tanC1 = cosA / sinA;
  const tanC2 = cosB / sinB;
  const ratio = Math.max(0, tanC1 / tanC2) * 0.5;

  const scaleA = scales[colorA.scale];
  const scaleB = scales[colorB.scale];
  const scale = STEPS.map((i) =>
    new Color(Color.mix(scaleA[i], scaleB[i], ratio)).to("oklch"),
  ) as Scale12<Color>;

  const baseColor = at(
    scale
      .slice()
      .sort((left, right) => source.deltaEOK(left) - source.deltaEOK(right)),
    0,
  );

  const ratioC = C(source) / C(baseColor);
  for (const color of scale) {
    const scaledChroma = C(color) * ratioC;
    color.coords[1] = Number.isNaN(scaledChroma)
      ? C(source) * 1.5
      : Math.min(C(source) * 1.5, scaledChroma);
    color.coords[2] = H(source);
  }

  if (L(scale[0]) > 0.5) {
    const lightnessScale = scale.map(L);
    const backgroundL = Math.max(0, Math.min(1, L(backgroundColor)));
    const newLightnessScale = transposeProgressionStart(
      backgroundL,
      [1, ...lightnessScale],
      LIGHT_MODE_EASING,
    );
    newLightnessScale.shift();
    newLightnessScale.forEach((lightness, i) => {
      at(scale, i).coords[0] = lightness;
    });
    return scale;
  }

  const ease: [number, number, number, number] = [...DARK_MODE_EASING];
  const referenceBackgroundL = L(scale[0]);
  const backgroundL = Math.max(0, Math.min(1, L(backgroundColor)));

  const ratioL = backgroundL / referenceBackgroundL;
  if (ratioL > 1) {
    const maxRatio = 1.5;
    for (let i = 0; i < ease.length; i++) {
      const metaRatio = (ratioL - 1) * (maxRatio / (maxRatio - 1));
      ease[i] =
        ratioL > maxRatio ? 0 : Math.max(0, at(ease, i) * (1 - metaRatio));
    }
  }

  const newLightnessScale = transposeProgressionStart(
    L(backgroundColor),
    scale.map(L),
    ease,
  );
  newLightnessScale.forEach((lightness, i) => {
    at(scale, i).coords[0] = lightness;
  });
  return scale;
}

function getTextColor(background: Color): Color {
  const white = new Color("oklch", [1, 0, 0]);
  if (Math.abs(white.contrastAPCA(background)) < 40) {
    return new Color("oklch", [
      0.25,
      Math.max(0.08 * C(background), 0.04),
      H(background),
    ]);
  }
  return white;
}

type Rgb = readonly [number | null, number | null, number | null];

function channels(rgb: Rgb, precision: number): [number, number, number] {
  const [r, g, b] = rgb;
  return [
    Math.round((r ?? 0) * precision),
    Math.round((g ?? 0) * precision),
    Math.round((b ?? 0) * precision),
  ];
}

function getAlphaColor(
  targetRgb: Rgb,
  backgroundRgb: Rgb,
  rgbPrecision: number,
  alphaPrecision: number,
  targetAlpha?: number,
): readonly [number, number, number, number] {
  const [tr, tg, tb] = channels(targetRgb, rgbPrecision);
  const [br, bg, bb] = channels(backgroundRgb, rgbPrecision);

  const desiredRgb = tr > br || tg > bg || tb > bb ? rgbPrecision : 0;

  const alphaR = (tr - br) / (desiredRgb - br);
  const alphaG = (tg - bg) / (desiredRgb - bg);
  const alphaB = (tb - bb) / (desiredRgb - bb);

  const isPureGray = [alphaR, alphaG, alphaB].every(
    (alpha) => alpha === alphaR,
  );
  if (!targetAlpha && isPureGray) {
    const v = desiredRgb / rgbPrecision;
    return [v, v, v, alphaR];
  }

  const clampRgb = (n: number) =>
    Number.isNaN(n) ? 0 : Math.min(rgbPrecision, Math.max(0, n));
  const clampA = (n: number) =>
    Number.isNaN(n) ? 0 : Math.min(alphaPrecision, Math.max(0, n));
  const maxAlpha = targetAlpha ?? Math.max(alphaR, alphaG, alphaB);

  const A = clampA(Math.ceil(maxAlpha * alphaPrecision)) / alphaPrecision;
  let R = Math.ceil(clampRgb(((br * (1 - A) - tr) / A) * -1));
  let G = Math.ceil(clampRgb(((bg * (1 - A) - tg) / A) * -1));
  let B = Math.ceil(clampRgb(((bb * (1 - A) - tb) / A) * -1));

  const blendedR = blendAlpha(R, A, br);
  const blendedG = blendAlpha(G, A, bg);
  const blendedB = blendAlpha(B, A, bb);

  if (desiredRgb === 0) {
    if (tr <= br && tr !== blendedR) R = tr > blendedR ? R + 1 : R - 1;
    if (tg <= bg && tg !== blendedG) G = tg > blendedG ? G + 1 : G - 1;
    if (tb <= bb && tb !== blendedB) B = tb > blendedB ? B + 1 : B - 1;
  }

  if (desiredRgb === rgbPrecision) {
    if (tr >= br && tr !== blendedR) R = tr > blendedR ? R + 1 : R - 1;
    if (tg >= bg && tg !== blendedG) G = tg > blendedG ? G + 1 : G - 1;
    if (tb >= bb && tb !== blendedB) B = tb > blendedB ? B + 1 : B - 1;
  }

  return [R / rgbPrecision, G / rgbPrecision, B / rgbPrecision, A];
}

function blendAlpha(foreground: number, alpha: number, background: number) {
  return Math.round(background * (1 - alpha)) + Math.round(foreground * alpha);
}

function getAlphaColorSrgb(
  targetColor: string,
  backgroundColor: string,
  targetAlpha?: number,
): string {
  const [r, g, b, a] = getAlphaColor(
    new Color(targetColor).to("srgb").coords,
    new Color(backgroundColor).to("srgb").coords,
    255,
    255,
    targetAlpha,
  );
  return formatHex(new Color("srgb", [r, g, b], a).toString({ format: "hex" }));
}

function getAlphaColorP3(
  targetColor: string,
  backgroundColor: string,
  targetAlpha?: number,
): string {
  const [r, g, b, a] = getAlphaColor(
    new Color(targetColor).to("p3").coords,
    new Color(backgroundColor).to("p3").coords,
    255,
    1000,
    targetAlpha,
  );
  return new Color("p3", [r, g, b], a)
    .toString({ precision: 4 })
    .replace("color(p3 ", "color(display-p3 ");
}

function toHex(color: Color): string {
  return formatHex(color.to("srgb").toString({ format: "hex" }));
}

/** Expands #rgb and #rgba to #rrggbb and #rrggbbaa. */
export function formatHex(value: string): string {
  if (!value.startsWith("#")) return value;
  if (value.length === 4 || value.length === 5) {
    return `#${[...value.slice(1)].map((digit) => digit + digit).join("")}`;
  }
  return value;
}

const DARK_MODE_EASING: [number, number, number, number] = [1, 0, 1, 0];
const LIGHT_MODE_EASING: [number, number, number, number] = [0, 2, 0, 2];

function transposeProgressionStart(
  to: number,
  values: number[],
  curve: [number, number, number, number],
): number[] {
  const ease = cubicBezier(...curve);
  const lastIndex = values.length - 1;
  const diff = at(values, 0) - to;
  return values.map((n, i) => n - diff * ease(1 - i / lastIndex));
}

function toOklchString(color: Color): string {
  const lightness = +(L(color) * 100).toFixed(1);
  return color
    .to("oklch")
    .toString({ precision: 4 })
    .replace(/(\S+)(.+)/, `oklch(${lightness}%$2`);
}
