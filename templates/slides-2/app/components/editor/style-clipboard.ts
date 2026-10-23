import { appStorageKey } from "@shared/app-storage";

import type { SlideStylePatch, SlideStyleSnapshot } from "./slide-style";

export interface CopiedStyle {
  color?: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
}

export let copiedStyle: CopiedStyle | null = null;

export function setCopiedStyle(s: CopiedStyle | null): void {
  copiedStyle = s;
}

export type CopiedElementStyle = Pick<
  SlideStylePatch,
  | "color"
  | "fontFamily"
  | "backgroundColor"
  | "fontSize"
  | "fontWeight"
  | "fontStyle"
  | "textDecoration"
  | "lineHeight"
  | "textAlign"
  | "opacity"
  | "borderRadius"
  | "borderWidth"
  | "borderColor"
  | "paddingLeft"
  | "paddingRight"
  | "paddingTop"
  | "paddingBottom"
>;

let copiedElementStyle: CopiedElementStyle | null = null;

function px(value: number): string {
  return `${Number.isInteger(value) ? value : Number(value.toFixed(2))}px`;
}

export function copiedElementStyleFromSnapshot(
  snapshot: SlideStyleSnapshot,
): CopiedElementStyle {
  return {
    color: snapshot.color,
    fontFamily: snapshot.fontFamily,
    backgroundColor: snapshot.backgroundColor,
    fontSize: px(snapshot.fontSize),
    fontWeight: snapshot.fontWeight,
    fontStyle: snapshot.fontStyle,
    textDecoration: snapshot.textDecoration,
    lineHeight: String(snapshot.lineHeight),
    textAlign: snapshot.textAlign,
    opacity: String(Math.max(0, Math.min(100, snapshot.opacity)) / 100),
    borderRadius: px(snapshot.borderRadius),
    borderWidth: px(snapshot.borderWidth),
    borderColor: snapshot.borderColor,
    paddingLeft: px(snapshot.paddingX),
    paddingRight: px(snapshot.paddingX),
    paddingTop: px(snapshot.paddingY),
    paddingBottom: px(snapshot.paddingY),
  };
}

export function getCopiedElementStyle(): CopiedElementStyle | null {
  return copiedElementStyle ? { ...copiedElementStyle } : null;
}

export function setCopiedElementStyle(style: CopiedElementStyle | null): void {
  copiedElementStyle = style ? { ...style } : null;
}

const STORAGE_KEY = appStorageKey("slide-brand-palette");

const DEFAULT_PALETTE = [
  "#00E5FF", // guard:allow-raw-color — editable slide canvas color preset.
  "#ffffff", // guard:allow-raw-color — editable slide canvas color preset.
  "#FF4D6D", // guard:allow-raw-color — editable slide canvas color preset.
  "#FFD166", // guard:allow-raw-color — editable slide canvas color preset.
  "#06D6A0", // guard:allow-raw-color — editable slide canvas color preset.
  "#8338EC", // guard:allow-raw-color — editable slide canvas color preset.
  "#FB5607", // guard:allow-raw-color — editable slide canvas color preset.
  "#3A86FF", // guard:allow-raw-color — editable slide canvas color preset.
];

export function getBrandPalette(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as string[];
  } catch {
    // coercion-ok: malformed optional palette storage falls back to built-in swatches.
  }
  return [...DEFAULT_PALETTE];
}

export function setBrandPalette(palette: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(palette));
}
