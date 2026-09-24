/**
 * A deck with no linked design system has no persisted source of truth for
 * its light/dark direction — the `--deck-*` wrapper contract described in the
 * `design-systems` and `create-deck` skills is natural-language guidance the
 * model re-derives on every write. This module makes that contract a real,
 * persisted value on the deck (`deck.themeContract`) so later writes can be
 * checked against it instead of relying on the model remembering what it
 * chose several turns ago. It only applies to unlinked decks: a linked design
 * system is already the deck's persisted, enforced contract.
 */

export interface DeckThemeVars {
  bg?: string;
  ink?: string;
  muted?: string;
  accent?: string;
  surface?: string;
  headingFont?: string;
  bodyFont?: string;
  radius?: string;
}

export type DeckThemeMode = "light" | "dark";

export interface DeckThemeContract {
  mode: DeckThemeMode;
  vars: DeckThemeVars;
  /** Slide whose wrapper produced this contract, for a legible mismatch message. */
  sourceSlideId: string;
  updatedAt: string;
}

const DECK_VAR_KEY_MAP: Record<string, keyof DeckThemeVars> = {
  bg: "bg",
  ink: "ink",
  muted: "muted",
  accent: "accent",
  surface: "surface",
  "heading-font": "headingFont",
  "body-font": "bodyFont",
  radius: "radius",
};

const DECK_VAR_PATTERN = /--deck-([a-z-]+)\s*:\s*([^;]+);?/gi;

/**
 * Only the outer `fmd-slide` wrapper carries the deck contract; nested
 * elements inherit through `var(--deck-*)` rather than redeclaring it, so the
 * first wrapper's style attribute is the whole contract.
 */
export function extractDeckThemeVars(html: string): DeckThemeVars | null {
  const wrapperMatch = html.match(
    /<div\b[^>]*class="[^"]*\bfmd-slide\b[^"]*"[^>]*>/i,
  );
  if (!wrapperMatch) return null;
  const styleMatch = wrapperMatch[0].match(
    /\sstyle\s*=\s*"([^"]*)"|\sstyle\s*=\s*'([^']*)'/i,
  );
  const style = styleMatch?.[1] ?? styleMatch?.[2];
  if (!style) return null;

  const vars: DeckThemeVars = {};
  for (const match of style.matchAll(DECK_VAR_PATTERN)) {
    const key = DECK_VAR_KEY_MAP[match[1].toLowerCase()];
    if (key) vars[key] = match[2].trim();
  }
  return Object.keys(vars).length > 0 ? vars : null;
}

/** A `var(--ds-*, ...)` reference belongs to a linked design system, not a chosen literal. */
export function isLiteralThemeValue(value: string): boolean {
  return !/^var\(/i.test(value.trim());
}

function parseCssColorToRgb(value: string): [number, number, number] | null {
  const trimmed = value.trim();
  const hexMatch = trimmed.match(
    /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
  );
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .slice(0, 3)
        .split("")
        .map((channel) => channel + channel)
        .join("");
    }
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  const rgbMatch = trimmed.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i,
  );
  if (rgbMatch) {
    return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  }
  return null;
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const toLinear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
  );
}

/**
 * Named colors and unrecognized functions (`oklch()`, gradients) return
 * `null` rather than a guessed mode — an unclassifiable background must not
 * silently pass or silently fail the contract check.
 */
export function classifyBackgroundMode(value: string): DeckThemeMode | null {
  const rgb = parseCssColorToRgb(value);
  if (!rgb) return null;
  return relativeLuminance(rgb) >= 0.5 ? "light" : "dark";
}

export function isDeckThemeContract(
  value: unknown,
): value is DeckThemeContract {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record.mode === "light" || record.mode === "dark") &&
    typeof record.vars === "object" &&
    record.vars !== null &&
    typeof (record.vars as DeckThemeVars).bg === "string" &&
    typeof record.sourceSlideId === "string"
  );
}

/**
 * Build the deck's baseline contract from the slide that establishes it.
 * Returns null when the wrapper has no literal, classifiable background —
 * e.g. a design-system-linked slide (`var(--ds-bg)`) or an unparsable color —
 * so callers never persist a contract they cannot later check anything
 * against.
 */
export function buildThemeContractFromSlide(
  slideId: string,
  html: string,
): DeckThemeContract | null {
  const vars = extractDeckThemeVars(html);
  if (!vars?.bg || !isLiteralThemeValue(vars.bg)) return null;
  const mode = classifyBackgroundMode(vars.bg);
  if (!mode) return null;
  return {
    mode,
    vars,
    sourceSlideId: slideId,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Returns a human-readable mismatch message when a slide's literal
 * background diverges in light/dark mode from the deck's stored contract, or
 * null when the slide matches, inherits from a design system, or has no
 * classifiable background of its own.
 */
export function themeContractMismatch(
  contract: DeckThemeContract,
  slideId: string,
  html: string,
): string | null {
  const vars = extractDeckThemeVars(html);
  if (!vars?.bg || !isLiteralThemeValue(vars.bg)) return null;
  const mode = classifyBackgroundMode(vars.bg);
  if (!mode || mode === contract.mode) return null;
  return (
    `Slide ${slideId} uses a ${mode} background (${vars.bg}), but this deck's ` +
    `theme contract is ${contract.mode} (set from slide ${contract.sourceSlideId}, ` +
    `background ${contract.vars.bg}). Match the deck's existing --deck-bg/--deck-ink ` +
    `direction, or restyle every slide together if the deck is intentionally changing theme.`
  );
}
