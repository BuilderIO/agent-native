/**
 * How much of the model's reasoning the chat surface shows.
 *
 * This is presentation only. It never changes what the engine requests or
 * what is persisted — a hidden thought was still thought, and switching back
 * to `expanded` reveals the same text on the same historical turns.
 */
export const THINKING_DISPLAY_MODES = [
  "expanded",
  "collapsed",
  "hidden",
] as const;

export type ThinkingDisplay = (typeof THINKING_DISPLAY_MODES)[number];

/**
 * Collapsed by default: a live reasoning cell that auto-opens pushes the
 * answer out of the viewport on every turn, which is the noise users report.
 * The label and its "Thought for Xs" timing stay visible, one click from the
 * full text.
 */
export const DEFAULT_THINKING_DISPLAY: ThinkingDisplay = "collapsed";

const modeSet = new Set<string>(THINKING_DISPLAY_MODES);

export function isThinkingDisplay(value: unknown): value is ThinkingDisplay {
  return typeof value === "string" && modeSet.has(value);
}

/**
 * Returns null for both "nothing stored" and "stored value is not a mode".
 * Callers substitute the default; the distinction does not survive here
 * because there is no repair a caller could make with it.
 */
export function parseThinkingDisplay(value: unknown): ThinkingDisplay | null {
  return isThinkingDisplay(value) ? value : null;
}
