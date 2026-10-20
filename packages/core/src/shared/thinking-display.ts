export const THINKING_DISPLAY_MODES = [
  "expanded",
  "collapsed",
  "hidden",
] as const;

export type ThinkingDisplay = (typeof THINKING_DISPLAY_MODES)[number];

export const DEFAULT_THINKING_DISPLAY: ThinkingDisplay = "collapsed";

const modeSet = new Set<string>(THINKING_DISPLAY_MODES);

export function isThinkingDisplay(value: unknown): value is ThinkingDisplay {
  return typeof value === "string" && modeSet.has(value);
}

export function parseThinkingDisplay(value: unknown): ThinkingDisplay | null {
  return isThinkingDisplay(value) ? value : null;
}
