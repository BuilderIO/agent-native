import { cssColorChannels, type Rgba } from "./design-system-color-mode.js";
import { summarizeHtmlStyles } from "./html-style-summary.js";

/**
 * Catch generated markup that nobody can read.
 *
 * Stating a design system's color mode in the prompt fixes the case where the
 * agent picks the wrong canvas. It does not fix the case where the canvas is
 * right and the agent pairs it with a foreground token of the same lightness,
 * which is how a light design kit produced light-on-light slides. That failure
 * is only visible in the markup that was actually written, so it is checked
 * after the write instead of asked for in the prompt.
 */

/** WCAG 2.1 minimum for normal body text. The target to author against. */
export const MIN_TEXT_CONTRAST_RATIO = 4.5;
/**
 * WCAG 2.1 minimum for large text, and the floor this check reports against.
 *
 * Reporting at 4.5 would flag a compliant 56px display heading at 3.5:1,
 * because the declared font size is not resolved here. A warning an agent
 * learns to dismiss is worse than a narrower one it trusts, so anything below
 * this floor is broken at every size and gets reported; 3.0-4.49 is left to
 * the authoring target above.
 */
export const MIN_LARGE_TEXT_CONTRAST_RATIO = 3;

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([r, g, b]: Rgba): number {
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

/** Flatten a translucent foreground onto its background, the way the browser
 *  paints it. Without this, black text at 10% alpha over white scores a
 *  perfect 21:1 while rendering as near-invisible grey. */
function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground[3];
  if (alpha >= 1) return foreground;
  return [
    foreground[0] * alpha + background[0] * (1 - alpha),
    foreground[1] * alpha + background[1] * (1 - alpha),
    foreground[2] * alpha + background[2] * (1 - alpha),
    1,
  ];
}

/**
 * WCAG contrast ratio between two CSS colors, or null when either side is not
 * a readable literal. Null means "not checked" and must never be reported as
 * a pass.
 *
 * A translucent background is "not checked": what sits behind it is outside
 * this string, so compositing it against an assumed canvas would invent a
 * result rather than measure one.
 */
export function contrastRatio(
  foreground: unknown,
  background: unknown,
): number | null {
  const fg = cssColorChannels(foreground);
  const bg = cssColorChannels(background);
  if (!fg || !bg || bg[3] < 1) return null;
  const a = relativeLuminance(composite(fg, bg));
  const b = relativeLuminance(bg);
  const [light, dark] = a >= b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

export interface UnreadableTextColor {
  /** The declared text color that fails. */
  text: string;
  /** The background it comes closest to being readable on. */
  background: string;
  /** Contrast ratio against that background, rounded to 2 decimals. */
  ratio: number;
}

export interface SlideContrastReport {
  /** Every declared text color that fails against every candidate background. */
  unreadable: UnreadableTextColor[];
  /** Backgrounds the check could read, in the order it considered them. */
  checkedBackgrounds: string[];
}

/**
 * Report text colors in one slide's HTML that fail contrast against *every*
 * background available to them.
 *
 * Deliberately conservative: light text sitting on a dark card inside a light
 * slide is legitimate, and the card's background is declared in the same
 * markup, so that pairing passes. Only a text color with no readable
 * background anywhere in the slide is reported. That keeps the check free of
 * the false positives that would train an agent to ignore it, while still
 * catching the whole-slide light-on-light failure exactly.
 */
export function findUnreadableTextColors({
  html,
  slideBackground,
  minRatio = MIN_LARGE_TEXT_CONTRAST_RATIO,
}: {
  html: string;
  /** The slide's own background, set outside the HTML. */
  slideBackground?: string | null;
  minRatio?: number;
}): SlideContrastReport {
  // Unbounded on purpose. summarizeHtmlStyles exists to show an agent the
  // common vocabulary, so it truncates; this is an audit and a capped list
  // silently drops the one unreadable color past the cut.
  const summary = summarizeHtmlStyles([{ label: "slide", html }], {
    limit: Number.MAX_SAFE_INTEGER,
  });

  const candidateBackgrounds = [
    ...(slideBackground ? [slideBackground] : []),
    ...summary.backgrounds.map((entry) => entry.value),
  ].filter((value) => cssColorChannels(value) !== null);

  // No readable background anywhere means the canvas is a gradient, an image,
  // or a CSS variable this cannot resolve. Report nothing rather than guess.
  if (candidateBackgrounds.length === 0) {
    return { unreadable: [], checkedBackgrounds: [] };
  }

  const unreadable: UnreadableTextColor[] = [];
  for (const { value: text } of summary.textColors) {
    if (cssColorChannels(text) === null) continue;
    let best: { background: string; ratio: number } | null = null;
    for (const background of candidateBackgrounds) {
      const ratio = contrastRatio(text, background);
      if (ratio === null) continue;
      if (!best || ratio > best.ratio) best = { background, ratio };
    }
    if (best && best.ratio < minRatio) {
      unreadable.push({
        text,
        background: best.background,
        ratio: Math.round(best.ratio * 100) / 100,
      });
    }
  }

  return { unreadable, checkedBackgrounds: candidateBackgrounds };
}

/**
 * The warning an action returns when a slide it just wrote is unreadable.
 * Returns null when there is nothing to report, so callers can spread it into
 * a result without inventing an empty "all good" field.
 */
export function formatSlideContrastWarning(
  report: SlideContrastReport,
): string | null {
  if (report.unreadable.length === 0) return null;
  const pairs = report.unreadable
    .map(
      (entry) =>
        `${entry.text} on ${entry.background} (contrast ${entry.ratio}:1)`,
    )
    .join("; ");
  return (
    `This slide is unreadable as written: ${pairs}. ` +
    `Each of those falls below ${MIN_LARGE_TEXT_CONTRAST_RATIO}:1, which fails even for large display text; author body text to ${MIN_TEXT_CONTRAST_RATIO}:1. ` +
    "Re-read the linked design system's Color mode line and its paired foreground token, then update this slide so the text uses the foreground that belongs to the background you chose. Do not report the deck as done while this warning stands."
  );
}
