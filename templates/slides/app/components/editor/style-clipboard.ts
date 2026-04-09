/** Shared style clipboard for copy/paste style (Cmd+Option+C / Cmd+Option+V) */

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
