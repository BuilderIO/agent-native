import { formatDisplayP3Css, formatOklchCss } from "@shared/color-spaces";
import {
  isWideGamutNotation,
  normalizeCssColor,
  parseCssColor,
  parseCssColorExtended,
  rgbaToCss,
} from "@shared/color-utils";

import { readWideColor } from "./color-picker-model";
import {
  expandHexShorthand,
  hasHexAlpha,
  toDisplayHex,
} from "./color-picker-utils";
import type { DesignPaintType } from "./DesignColorPicker";

/**
 * What the inspector's Fill field says about a paint, in the paint's own
 * notation: hex in capitals, Display P3 and OKLCH as their numbers behind a
 * muted name, other CSS colors as written, a paint by its name.
 */
export type FillFieldReading =
  | { kind: "hex"; text: string }
  | { kind: "wide"; prefix: "P3" | "OKLCH"; text: string }
  | { kind: "css"; text: string }
  /** A fill bound to a token: its name, or the property it names when it cannot be resolved. */
  | { kind: "token"; name: string; unresolved: boolean }
  | { kind: "paint"; text: string }
  | { kind: "mixed" };

export interface FillFieldInput {
  /** What kind of paint the field stands for. */
  paint: "solid" | "gradient" | "image" | "shader" | "none";
  /** The paint's name when it is not a color: `Linear`, `Image`, `Mesh Gradient`. */
  paintName?: string;
  /** The solid color, resolved if it is a token. */
  value: string;
  /** The color as written in the design, when it is known. */
  authored?: string;
  token?: { name: string; unresolved: boolean } | null;
  mixed?: boolean;
}

export interface GradientNames {
  linear: string;
  radial: string;
  angular: string;
  diamond: string;
}

export const GRADIENT_NAMES: GradientNames = {
  linear: "Linear", // i18n-ignore paint type label
  radial: "Radial", // i18n-ignore paint type label
  angular: "Angular", // i18n-ignore paint type label
  diamond: "Diamond", // i18n-ignore paint type label
};

/** What a paint that is not a color calls itself in the Fill field. */
export function fillPaintName(
  type: DesignPaintType,
  gradients: GradientNames,
  shaderName?: string,
): string {
  switch (type) {
    case "linear":
    case "radial":
    case "angular":
    case "diamond":
      return gradients[type];
    case "image":
      return "Image"; // i18n-ignore paint type label
    case "shader":
      return shaderName ?? "Shader"; // i18n-ignore paint type label
    case "none":
      return "None"; // i18n-ignore paint type label
    default:
      return "";
  }
}

/** Colors the editor writes itself, so they read as hex and an opacity rather than as written. */
const WRITTEN_BY_EDITOR = /^(?:#|rgba?\()/i;
const HSL_OR_NAME = /^(?:hsla?\(|[a-z]+$)/i;

function trimmedNumber(value: number, decimals: number): string {
  return String(Number(value.toFixed(decimals)));
}

export function readFillField(input: FillFieldInput): FillFieldReading {
  if (input.mixed) return { kind: "mixed" };
  if (input.paint !== "solid") {
    return { kind: "paint", text: input.paintName ?? "" };
  }
  if (input.token) {
    return {
      kind: "token",
      name: input.token.name,
      unresolved: input.token.unresolved,
    };
  }
  const wide = readWideColor(input.value);
  if (wide?.notation === "display-p3") {
    return {
      kind: "wide",
      prefix: "P3",
      text: wide.p3.map((channel) => trimmedNumber(channel, 3)).join(" "),
    };
  }
  if (wide?.notation === "oklch") {
    return {
      kind: "wide",
      prefix: "OKLCH",
      text: [
        trimmedNumber(wide.oklch.l * 100, 1),
        trimmedNumber(wide.oklch.c, 3),
        trimmedNumber(wide.oklch.h, 1),
      ].join(" "),
    };
  }
  const authored = input.authored?.trim();
  if (
    authored &&
    !WRITTEN_BY_EDITOR.test(authored) &&
    HSL_OR_NAME.test(authored) &&
    parseCssColor(authored)
  ) {
    return { kind: "css", text: authored };
  }
  const parsed = parseCssColorExtended(input.value);
  if (wide || !parsed) return { kind: "css", text: input.value.trim() };
  return { kind: "hex", text: toDisplayHex(parsed) };
}

/** Whether the opacity is spelled out: Display P3 and OKLCH give its room to their numbers at 100%. */
export function showsOpacity(
  reading: FillFieldReading,
  opacity: number,
): boolean {
  if (reading.kind === "mixed") return false;
  return reading.kind === "wide" ? opacity !== 100 : true;
}

/** The text a field puts under the caret to edit, or null for a paint that is not typed in. */
export function fillFieldEditText(reading: FillFieldReading): string | null {
  switch (reading.kind) {
    case "hex":
    case "css":
      return reading.text;
    case "wide":
      return `${reading.prefix} ${reading.text}`;
    default:
      return null;
  }
}

function numbers(words: string[]): number[] | null {
  const parsed = words.map((word) => Number(word.replace(/%$/, "")));
  return parsed.every(Number.isFinite) ? parsed : null;
}

/**
 * What was typed into a Fill field, as the CSS to write, or null when it is
 * not a color. The field's own shorthand (`P3 0.09 0.09 0.09`,
 * `OKLCH 72.4 0.181 153`) is read as the notation it names; hex keeps the
 * opacity unless it carries its own; any other color the editor can read is
 * written as typed.
 */
export function parseFillFieldDraft(
  draft: string,
  alpha: number,
): string | null {
  const text = draft.trim();
  if (!text) return null;

  const words = text.split(/\s+/);
  const lead = words[0]!.toLowerCase();
  if (lead === "p3" && words.length === 4) {
    const channels = numbers(words.slice(1));
    if (!channels || channels.some((channel) => channel < 0 || channel > 1)) {
      return null;
    }
    return formatDisplayP3Css(channels as [number, number, number], alpha);
  }
  if (lead === "oklch" && words.length === 4) {
    const cells = numbers(words.slice(1));
    if (!cells) return null;
    const [lightness, chroma, hue] = cells as [number, number, number];
    const lightnessInRange = lightness >= 0 && lightness <= 100;
    if (!lightnessInRange || chroma < 0) return null;
    return formatOklchCss({ l: lightness / 100, c: chroma, h: hue }, alpha);
  }

  if (!text.includes("(") && /^#?[0-9a-f]+$/i.test(text)) {
    const hex = expandHexShorthand(text);
    const parsed = parseCssColor(`#${hex.replace(/^#/, "")}`);
    if (!parsed) return null;
    return rgbaToCss(hasHexAlpha(hex) ? parsed : { ...parsed, a: alpha });
  }

  if (isWideGamutNotation(text)) return normalizeCssColor(text);
  // What the writers accept, so a draft that passes here is never dropped after.
  return parseCssColor(text) ? text : null;
}
