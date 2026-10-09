/**
 * Interact mode previews a design in Light or Dark. The editor owns the
 * preview document, so instead of changing the browser's real preference it
 * emulates `prefers-color-scheme` inside that document. Everything here is
 * pure so the in-iframe bridge and the editor share one definition.
 */

export type PreviewColorScheme = "light" | "dark";

export const INTERACT_THEME_MODES = ["light", "dark"] as const;

export type InteractThemeMode = (typeof INTERACT_THEME_MODES)[number];

export const DEFAULT_INTERACT_THEME_MODE: InteractThemeMode = "light";

export function isInteractThemeMode(
  value: unknown,
): value is InteractThemeMode {
  return (
    typeof value === "string" &&
    (INTERACT_THEME_MODES as readonly string[]).includes(value)
  );
}

/**
 * The mode a stored or requested value means. `system` was a third mode before
 * the picker went to Light and Dark; it reads as the default, Light.
 */
export function normalizeInteractThemeMode(
  value: unknown,
): InteractThemeMode | null {
  if (value === "system") return DEFAULT_INTERACT_THEME_MODE;
  return isInteractThemeMode(value) ? value : null;
}

const FRAME_NAME_PREFIX = "agent-native:preview-color-scheme:";

/**
 * A markup preview learns its starting scheme from its own `window.name`, which
 * is set on the iframe element and exists before the document's first script.
 * The srcdoc cannot carry it: srcdoc is the iframe's identity, so a different
 * string would reload the preview every time the scheme changed.
 */
export function previewColorSchemeFrameName(
  scheme: PreviewColorScheme | null,
): string | undefined {
  return scheme ? `${FRAME_NAME_PREFIX}${scheme}` : undefined;
}

export function parsePreviewColorSchemeFrameName(
  name: string | null | undefined,
): PreviewColorScheme | null {
  if (!name || !name.startsWith(FRAME_NAME_PREFIX)) return null;
  const scheme = name.slice(FRAME_NAME_PREFIX.length);
  return scheme === "light" || scheme === "dark" ? scheme : null;
}

const PREFERS_COLOR_SCHEME_FEATURE =
  /\(\s*prefers-color-scheme\s*(?::\s*(light|dark)\s*)?\)/gi;

// `(prefers-color-scheme)` alone is true whenever the user has a preference.
// Both fallbacks are valid in every engine that supports media queries: the
// true one always matches, the false one asks for two exclusive hover states.
const ALWAYS_TRUE_FEATURE = "(min-width: 0px)";
const ALWAYS_FALSE_FEATURE = "(hover: hover) and (hover: none)";

export function mentionsPrefersColorScheme(mediaText: string): boolean {
  PREFERS_COLOR_SCHEME_FEATURE.lastIndex = 0;
  return PREFERS_COLOR_SCHEME_FEATURE.test(mediaText);
}

function splitMediaQueryList(mediaText: string): string[] {
  const queries: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < mediaText.length; index += 1) {
    const char = mediaText[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) {
      queries.push(mediaText.slice(start, index));
      start = index + 1;
    }
  }
  queries.push(mediaText.slice(start));
  return queries;
}

function rewriteMediaQuery(query: string, scheme: PreviewColorScheme): string {
  PREFERS_COLOR_SCHEME_FEATURE.lastIndex = 0;
  const trimmed = query.trim();
  const only = /^\(\s*prefers-color-scheme\s*(?::\s*(light|dark)\s*)?\)$/i.exec(
    trimmed,
  );
  if (only) {
    const wanted = only[1]?.toLowerCase();
    return !wanted || wanted === scheme ? "all" : "not all";
  }
  return query.replace(
    PREFERS_COLOR_SCHEME_FEATURE,
    (_match, wanted: string | undefined) =>
      !wanted || wanted.toLowerCase() === scheme
        ? ALWAYS_TRUE_FEATURE
        : ALWAYS_FALSE_FEATURE,
  );
}

/**
 * Rewrites every `prefers-color-scheme` feature in a media query list so it
 * matches exactly when `scheme` is the forced scheme. Returns `null` when the
 * text has no such feature, so callers can tell "nothing to rewrite" from an
 * empty result.
 */
export function rewritePrefersColorSchemeMedia(
  mediaText: string,
  scheme: PreviewColorScheme,
): string | null {
  if (!mentionsPrefersColorScheme(mediaText)) return null;
  return splitMediaQueryList(mediaText)
    .map((query) => rewriteMediaQuery(query, scheme).trim())
    .join(", ");
}

export type DarkStyleSignal =
  | "prefers-color-scheme"
  | "color-scheme"
  | "light-dark"
  | "dark-class"
  | "dark-attribute"
  | "dark-variant-class";

/**
 * `yes`: the design visibly reacts to a dark scheme. `no`: it was read in full
 * and nothing does. `unknown`: part of it could not be read (cross-origin
 * stylesheet, scan cut short), so absence proves nothing.
 */
export type DarkStyleSupport = "yes" | "no" | "unknown";

export interface DarkStyleScanInput {
  /** CSS text, media query text and selectors; any mix is scanned as one. */
  css?: readonly string[];
  /** Markup whose `class` attributes are checked for Tailwind `dark:` variants. */
  html?: string;
  /** Stylesheets that exist but whose rules could not be read. */
  unreadableStylesheets?: number;
  /** True when the scan stopped before covering every rule. */
  truncated?: boolean;
}

export interface DarkStyleScanResult {
  support: DarkStyleSupport;
  signals: DarkStyleSignal[];
}

const CSS_SIGNALS: ReadonlyArray<readonly [DarkStyleSignal, RegExp]> = [
  ["prefers-color-scheme", /prefers-color-scheme\s*:\s*dark/i],
  ["color-scheme", /color-scheme\s*:[^;{}]*\bdark\b/i],
  ["light-dark", /\blight-dark\s*\(/i],
  ["dark-class", /\.dark(?![\w-])/],
  [
    "dark-attribute",
    /\[\s*data-[\w-]*(?:theme|mode|scheme)[\w-]*\s*[~|^$*]?=\s*["']?dark(?![\w-])/i,
  ],
];

const DARK_ATTRIBUTE_SELECTOR =
  /\[\s*(data-[\w-]*(?:theme|mode|scheme)[\w-]*)\s*[~|^$*]?=\s*["']?dark(?![\w-])/gi;

/** Attribute names the design's CSS keys a dark theme on, e.g. `data-theme`. */
export function findDarkAttributeNames(css: readonly string[]): string[] {
  const names = new Set<string>();
  const text = css.join("\n");
  DARK_ATTRIBUTE_SELECTOR.lastIndex = 0;
  for (
    let match = DARK_ATTRIBUTE_SELECTOR.exec(text);
    match;
    match = DARK_ATTRIBUTE_SELECTOR.exec(text)
  ) {
    names.add(match[1]!.toLowerCase());
  }
  return [...names];
}

const HREF_HOST = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i;

const FONT_STYLESHEET_HOSTS = [
  "fonts.googleapis.com",
  "fonts.bunny.net",
  "use.typekit.net",
  "p.typekit.net",
];

/**
 * Cross-origin stylesheets cannot be read, which makes a scan inconclusive.
 * Font-loading sheets carry no color rules, so they do not count against it.
 */
export function isFontStylesheetHref(href: string | null | undefined): boolean {
  const host = href ? HREF_HOST.exec(href)?.[1]?.toLowerCase() : undefined;
  return host !== undefined && FONT_STYLESHEET_HOSTS.includes(host);
}

const CLASS_ATTRIBUTE = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const DARK_VARIANT_TOKEN = /(?:^|:)dark:\S/;

function htmlHasDarkVariantClass(html: string): boolean {
  CLASS_ATTRIBUTE.lastIndex = 0;
  for (
    let match = CLASS_ATTRIBUTE.exec(html);
    match;
    match = CLASS_ATTRIBUTE.exec(html)
  ) {
    const value = match[1] ?? match[2] ?? "";
    if (value.split(/\s+/).some((token) => DARK_VARIANT_TOKEN.test(token))) {
      return true;
    }
  }
  return false;
}

export function detectDarkStyleSupport({
  css = [],
  html = "",
  unreadableStylesheets = 0,
  truncated = false,
}: DarkStyleScanInput): DarkStyleScanResult {
  const text = css.join("\n");
  const signals: DarkStyleSignal[] = [];
  for (const [signal, pattern] of CSS_SIGNALS) {
    if (pattern.test(text)) signals.push(signal);
  }
  if (html && htmlHasDarkVariantClass(html)) {
    signals.push("dark-variant-class");
  }
  if (signals.length > 0) return { support: "yes", signals };
  return {
    support: unreadableStylesheets > 0 || truncated ? "unknown" : "no",
    signals,
  };
}

/**
 * What the preview can do for the active screen. `pending` is the short window
 * before its first report; `unavailable` means the page never runs our bridge
 * (a URL screen the editor is not connected to).
 */
export type InteractThemeAvailability =
  | DarkStyleSupport
  | "pending"
  | "unavailable";

export interface InteractPreviewTheme {
  /** Scheme to force in the preview, or null to leave the document alone. */
  scheme: PreviewColorScheme | null;
  /** The choice to show as selected; never Dark when Dark cannot apply. */
  displayMode: InteractThemeMode;
  /** The picker itself can be used. */
  canPick: boolean;
  /**
   * Dark would change the preview. False only when the design was read and has
   * no dark styles, where choosing Dark asks the agent to add them.
   */
  darkAvailable: boolean;
}

export function resolveInteractPreviewTheme({
  mode,
  availability,
}: {
  mode: InteractThemeMode;
  availability: InteractThemeAvailability;
}): InteractPreviewTheme {
  if (availability === "unavailable") {
    return {
      scheme: null,
      displayMode: mode,
      canPick: false,
      darkAvailable: false,
    };
  }
  const darkAvailable = availability !== "no";
  // A design with no dark styles has nothing to show in dark, and forcing
  // `color-scheme: dark` on it would only invert the browser's defaults.
  const displayMode = !darkAvailable && mode === "dark" ? "light" : mode;
  return {
    scheme: displayMode,
    displayMode,
    canPick: true,
    darkAvailable,
  };
}
