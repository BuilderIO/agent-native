/** Shared style clipboard for copy/paste style (Cmd+Option+C / Cmd+Option+V) */

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

/** Appearance-only style payload used by the canvas editor. */
export type CopiedElementStyle = Pick<
  SlideStylePatch,
  | "color"
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

/** Converts the inspector's computed snapshot into an appearance-only patch. */
export function copiedElementStyleFromSnapshot(
  snapshot: SlideStyleSnapshot,
): CopiedElementStyle {
  return {
    color: snapshot.color,
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

// Brand palette — persisted in localStorage
const STORAGE_KEY = "slide-brand-palette";

const DEFAULT_PALETTE = [
  "#00E5FF",
  "#ffffff",
  "#FF4D6D",
  "#FFD166",
  "#06D6A0",
  "#8338EC",
  "#FB5607",
  "#3A86FF",
];

export function getBrandPalette(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as string[];
  } catch {
    // ignore
  }
  return [...DEFAULT_PALETTE];
}

export function setBrandPalette(palette: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(palette));
}
