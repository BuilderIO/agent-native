import {
  parseCssColor,
  rgbaToCss,
  withColorOpacity,
} from "@shared/color-utils";

export function cssLengthNumber(
  value: string | undefined,
  fallback = 0,
): number {
  const parsed = parseFloat(value || "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Round to one decimal place — matches the `precision={1}` ScrubInput controls advertise (e.g. stroke weight, font size) so 0.5-unit values aren't silently floored to whole numbers. */
export function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export function cssColorOrFallback(
  value: string | undefined,
  fallback: string,
) {
  const normalized = value?.trim();
  if (
    !normalized ||
    normalized === "transparent" ||
    normalized === "rgba(0, 0, 0, 0)"
  ) {
    return fallback;
  }
  return normalized;
}

export function strokeIsVisible(
  width: string | undefined,
  style: string | undefined,
) {
  return cssLengthNumber(width) > 0 && style !== "none";
}

/**
 * True when a stroke's own color is the reason it's invisible (alpha
 * zeroed) rather than its width/style. Used so the eye toggle can hide a
 * stroke by zeroing color alpha — preserving the original border-style
 * (solid/dashed/dotted/etc, which has no "unset" round-trip once written as
 * "none") — instead of forcing borderStyle back to "solid" on every show.
 */
export function strokeHiddenByColor(color: string | undefined): boolean {
  return Boolean(color) && !colorHasVisibleAlpha(color);
}

/**
 * R94 fix — Figma-parity text "Stroke": a real glyph outline, not a box
 * border. A text stroke is "on" whenever it has a non-zero width AND a
 * visible (non-zero-alpha) color — mirroring `strokeIsVisible` +
 * `!strokeHiddenByColor` for border/outline, but as one predicate since
 * `-webkit-text-stroke` has no separate "style: none" hide switch to check.
 */
export function textStrokeIsVisible(
  width: string | undefined,
  color: string | undefined,
): boolean {
  return cssLengthNumber(width) > 0 && colorHasVisibleAlpha(color);
}

/**
 * R94 fix — text stroke color must never fall back to the (possibly
 * transparent, possibly removed) fill color. Figma keeps a text node's
 * stroke and fill fully independent: hiding the fill must not turn a
 * configured stroke black or transparent. Falls back to opaque black only
 * when no stroke color has ever been set at all (brand-new stroke).
 */
export function resolveTextStrokeColor(
  strokeColor: string | undefined,
): string {
  return cssColorOrFallback(strokeColor, "#000000");
}

/**
 * The style patch the Stroke section's "Add layer" button commits for text
 * elements: seed a 1px glyph outline in the resolved stroke color.
 *
 * Keys MUST stay kebab-case: camelCase webkit props (webkitTextStrokeWidth)
 * get mangled by code-layer.ts normalizeStyleProperty — its camel→kebab pass
 * yields `webkit-text-stroke-width` WITHOUT the required leading dash, which
 * fails the style allow-list and silently persists nothing.
 */
export function textStrokeAddPatch(
  strokeColor: string | undefined,
): Record<string, string> {
  return {
    "-webkit-text-stroke-width": "1px",
    "-webkit-text-stroke-color": resolveTextStrokeColor(strokeColor),
  };
}

/**
 * R94 fix — reads a text stroke's width/color out of `element.computedStyles`
 * regardless of which of two shapes that map is in:
 *
 *   1. Live DOM selection (editor-chrome.bridge.ts `getElementInfo()`) reports
 *      the two longhands directly as `webkitTextStrokeWidth` /
 *      `webkitTextStrokeColor` (CSSOM always expands the shorthand).
 *   2. A projection-only selection (`elementInfoFromCodeLayerNode` in
 *      DesignEditor.tsx, used right after a reload/before the live bridge
 *      reports back) instead carries whatever was literally serialized in
 *      the inline `style` attribute — which for this property is *always*
 *      the shorthand `-webkit-text-stroke: <width> <color>` (browsers never
 *      write the longhands back out individually), aliased to camelCase
 *      `WebkitTextStroke` by DesignEditor's `cssStyleAliases` but never split
 *      into the two longhand keys.
 *
 * Without this fallback, TextStrokeProperties would only ever see a value
 * immediately after a same-session live edit and go blank again on any
 * reload/reselect — the panel would falsely show "no stroke" for a stroke
 * that is very much present and rendering.
 */
export function readTextStrokeStyle(styles: Record<string, string>): {
  width: string;
  color: string;
} {
  const longhandWidth = styles.webkitTextStrokeWidth;
  const longhandColor = styles.webkitTextStrokeColor;
  if (longhandWidth || longhandColor) {
    return { width: longhandWidth || "0px", color: longhandColor || "" };
  }
  const shorthand =
    styles["-webkit-text-stroke"] ??
    styles.WebkitTextStroke ??
    styles.webkitTextStroke;
  if (!shorthand) return { width: "0px", color: "" };
  return parseTextStrokeShorthand(shorthand);
}

/**
 * Splits a `-webkit-text-stroke` shorthand value ("<width> <color>", either
 * order per spec, browsers serialize width-then-color) into its two parts.
 * Cannot naively split on whitespace — `rgb(0, 0, 0)` / `rgba(...)` contain
 * internal commas but no spaces in the browser-serialized form, so a plain
 * "first token vs rest" split is safe for computed-style input; this is not
 * meant to validate arbitrary hand-authored shorthand values.
 */
function parseTextStrokeShorthand(shorthand: string): {
  width: string;
  color: string;
} {
  const trimmed = shorthand.trim();
  const match = /^(-?[\d.]+(?:px|em|rem|%))\s+(.+)$/.exec(trimmed);
  if (match) return { width: match[1]!, color: match[2]!.trim() };
  const reverseMatch = /^(.+?)\s+(-?[\d.]+(?:px|em|rem|%))$/.exec(trimmed);
  if (reverseMatch)
    return { width: reverseMatch[2]!, color: reverseMatch[1]!.trim() };
  return { width: "0px", color: "" };
}

/**
 * Reads a persisted `outline`'s position back from its offset: CSS `outline`
 * always paints just outside the border-box edge, so `outline-offset: 0`
 * (or unset) is Figma's "outside", and an offset of roughly `-width/2` (the
 * outline pulled back to straddle the edge) is Figma's "center". Tolerant of
 * float drift from repeated round-tripping (e.g. width/2 on an odd width).
 */
export function readStrokeOutlinePosition(
  width: string | undefined,
  offset: string | undefined,
): "outside" | "center" {
  const widthPx = cssLengthNumber(width);
  const offsetPx = cssLengthNumber(offset);
  const centerOffset = -widthPx / 2;
  return Math.abs(offsetPx - centerOffset) < 0.5 && offsetPx < 0
    ? "center"
    : "outside";
}

/** The `outline-offset` to persist for a given position + stroke width. */
export function outlineOffsetForPosition(
  position: "outside" | "center",
  width: string | undefined,
): string {
  if (position === "outside") return "0px";
  const widthPx = cssLengthNumber(width);
  return `${roundToOneDecimal(-widthPx / 2)}px`;
}

/**
 * Resolve the borderStyle/outlineStyle to persist when (re)creating or
 * restoring a stroke layer: preserve whatever real style was already set
 * (solid/dashed/dotted/etc), and only default to "solid" when there's none
 * yet or the legacy "none" hide value is still in place. Shared by both the
 * border and outline "restore" branches in the Stroke section's add-layer
 * handler so they stay in parity — previously only the outline branch did
 * this (`styles.outlineStyle === "none" ? "solid" : styles.outlineStyle ||
 * "solid"`); the border branch a few lines above it hardcoded `"solid"`
 * unconditionally, silently discarding a dashed/dotted style whenever a
 * hidden-but-existing border was restored via the section's + button
 * instead of its own eye toggle (which already preserves style correctly).
 */
export function resolveRestoredStrokeStyle(
  styleValue: string | undefined,
): string {
  return styleValue === "none" ? "solid" : styleValue || "solid";
}

/**
 * The style patch StrokeLayerControl's eye-toggle "show" click commits when
 * un-hiding a border/outline stroke: restores full alpha on the stashed RGB
 * color (see `strokeHiddenByColor`), guarantees a non-zero width, and only
 * forces the style back to "solid" when it was the legacy "none" hide value
 * (preserving a dashed/dotted style otherwise). Extracted as a pure function
 * — rather than three sequential `onStyleChange` calls — so the caller can
 * commit it as ONE atomic patch via `commitStylePatch`/`onStylesChange`
 * (a single undo/history step, matching every other multi-property commit
 * in this file, e.g. TextStrokeProperties' equivalent show handler).
 */
export function strokeShowPatch(
  prefix: "border" | "outline",
  color: string,
  width: string,
  styleValue: string,
): Record<string, string> {
  const parsed = parseCssColor(color);
  const restoredColor = parsed
    ? rgbaToCss(withColorOpacity(parsed, 100))
    : "#000000";
  const patch: Record<string, string> = {
    [`${prefix}Color`]: restoredColor,
    [`${prefix}Width`]: width === "0px" ? "1px" : width || "1px",
  };
  if (styleValue === "none") patch[`${prefix}Style`] = "solid";
  return patch;
}

export function swatchStyle(value: string | undefined) {
  return {
    background:
      value && value !== "none"
        ? value
        : "linear-gradient(135deg, hsl(var(--muted)) 0 45%, hsl(var(--border)) 45% 55%, hsl(var(--muted)) 55% 100%)",
  };
}

export function compactCssValue(value: string | undefined, fallback: string) {
  const normalized = value?.trim();
  if (!normalized || normalized === "none") return fallback;
  return normalized;
}

export function colorHasVisibleAlpha(value: string | undefined): boolean {
  const parsed = parseCssColor(value || "");
  if (!parsed) return Boolean(value && value !== "transparent");
  return parsed.a > 0;
}

/**
 * True when every value in a 4-sided/4-cornered box (padding top/right/
 * bottom/left, border-radius corners, etc.) is equal — used only to *seed*
 * a linked/unlinked (or uniform/independent) progressive-disclosure toggle
 * once per selection.
 *
 * Deliberately NOT meant to be read reactively on every render: computing
 * this from live per-render values and feeding it into a `useEffect` that
 * force-flips the toggle mid-gesture is exactly the bug this helper's
 * introduction fixed (STEVE TEST BATCH 4 #4) — scrubbing one axis of a
 * linked padding field (e.g. left/right while top/bottom stay put) makes
 * this false on the very first drag tick, and a reactive effect would
 * collapse the linked 2-field view into the unlinked 4-field view *during*
 * the gesture, destroying the drag. Call this only inside a `useState`
 * initializer on a component keyed per-selection (`elementIdentityKey`), so
 * it re-seeds on selection change and never re-fires within one gesture.
 */
export function fourValuesEqual(
  values: readonly [number, number, number, number],
): boolean {
  const [a, b, c, d] = values;
  return a === b && a === c && a === d;
}
