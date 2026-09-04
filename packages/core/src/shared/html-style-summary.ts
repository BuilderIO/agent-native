/**
 * Summarize the inline style vocabulary shared by a set of HTML fragments so
 * an agent editing one of them can match its siblings instead of inventing
 * values. A Slides deck, a set of design screens, or a document's sections all
 * have this shape: the fragment being edited is one item, and the style the
 * user expects is defined by the others.
 */

export interface HtmlStyleFragment {
  /** Short label used to name the fragments that deviate, e.g. "slide 1". */
  label: string;
  html: string;
}

export interface HtmlStyleValue {
  value: string;
  /** How many fragments use the value at least once. */
  fragments: number;
  /** Labels of the fragments that use it; kept only for rare values. */
  labels?: string[];
}

export interface HtmlStyleSummary {
  fragments: number;
  backgrounds: HtmlStyleValue[];
  textColors: HtmlStyleValue[];
  otherColors: HtmlStyleValue[];
  fontFamilies: HtmlStyleValue[];
  headingSizes: HtmlStyleValue[];
}

const COLOR_LITERAL_RE =
  /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|(?:oklch|oklab|color)\([^)]*\)/gi;
const BACKGROUND_RE = /background(?:-color|-image)?\s*:\s*([^;"'}]+)/gi;
const TEXT_COLOR_RE = /(?<![-\w])color\s*:\s*([^;"'}]+)/gi;
// Family names carry their own quotes, so these captures stop only at the
// declaration end.
const FONT_FAMILY_RE = /font-family\s*:\s*([^;}]+)/gi;
const FONT_SHORTHAND_RE =
  /(?<![-\w])font\s*:\s*[^;}]*?\d+(?:\.\d+)?(?:px|rem|em|%)(?:\s*\/\s*[\w.%]+)?\s+([^;}]+)/gi;
// Either attribute quote and any CSS length: a 2.5rem heading is still part
// of the vocabulary.
const HEADING_SIZE_RE =
  /<h[1-6]\b[^>]*style\s*=\s*(["'])[^"']*?font-size\s*:\s*([\d.]+(?:px|rem|em|%|vw|vh|pt))/gi;
const IGNORED_COLOR_WORDS = new Set([
  "inherit",
  "initial",
  "unset",
  "transparent",
  "none",
  "currentcolor",
]);
/** Below this share of fragments a value is a deviation and gets named. */
const RARE_VALUE_LIMIT = 2;

function normalizeColor(raw: string): string | undefined {
  const value = raw.trim().replace(/\s+/g, " ").toLowerCase();
  if (!value || IGNORED_COLOR_WORDS.has(value)) return undefined;
  if (value.startsWith("url(") || value.includes("gradient(")) {
    return value.includes("gradient(") ? "gradient" : "image";
  }
  const literal = value.match(COLOR_LITERAL_RE)?.[0];
  if (literal) return literal.replace(/\s*,\s*/g, ", ");
  // A bare named color such as "white" or a variable such as var(--bg).
  return /^[a-z-]+$/.test(value) || value.startsWith("var(")
    ? value
    : undefined;
}

function normalizeFamily(raw: string): string | undefined {
  const first = raw
    .split(",")[0]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  if (!first) return undefined;
  const generic = new Set([
    "sans-serif",
    "serif",
    "monospace",
    "system-ui",
    "inherit",
  ]);
  return generic.has(first.toLowerCase()) ? undefined : first;
}

function collectGroup(
  html: string,
  pattern: RegExp,
  group: number,
  normalize: (raw: string) => string | undefined,
): Set<string> {
  const values = new Set<string>();
  for (const match of html.matchAll(pattern)) {
    const value = normalize(match[group] ?? "");
    if (value) values.add(value);
  }
  return values;
}

function collect(
  html: string,
  pattern: RegExp,
  normalize: (raw: string) => string | undefined,
): Set<string> {
  return collectGroup(html, pattern, 1, normalize);
}

function tally(
  perFragment: Array<{ label: string; values: Set<string> }>,
  limit: number,
): HtmlStyleValue[] {
  const counts = new Map<string, string[]>();
  for (const { label, values } of perFragment) {
    for (const value of values) {
      const labels = counts.get(value) ?? [];
      labels.push(label);
      counts.set(value, labels);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, labels]) => ({
      value,
      fragments: labels.length,
      ...(labels.length <= RARE_VALUE_LIMIT ? { labels } : {}),
    }));
}

export function summarizeHtmlStyles(
  fragments: HtmlStyleFragment[],
  options: { limit?: number } = {},
): HtmlStyleSummary {
  const limit = options.limit ?? 4;
  const backgrounds: Array<{ label: string; values: Set<string> }> = [];
  const textColors: typeof backgrounds = [];
  const otherColors: typeof backgrounds = [];
  const fontFamilies: typeof backgrounds = [];
  const headingSizes: typeof backgrounds = [];
  for (const { label, html: raw } of fragments) {
    // Inline styles inside attributes carry their quotes HTML-escaped.
    const html = raw.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
    const background = collect(html, BACKGROUND_RE, normalizeColor);
    const text = collect(html, TEXT_COLOR_RE, normalizeColor);
    const every = new Set(
      [...html.matchAll(COLOR_LITERAL_RE)].map(
        (match) => normalizeColor(match[0]) ?? "",
      ),
    );
    every.delete("");
    for (const value of [...background, ...text]) every.delete(value);
    const families = new Set([
      ...collect(html, FONT_FAMILY_RE, normalizeFamily),
      ...collect(html, FONT_SHORTHAND_RE, normalizeFamily),
    ]);
    backgrounds.push({ label, values: background });
    textColors.push({ label, values: text });
    otherColors.push({ label, values: every });
    fontFamilies.push({ label, values: families });
    headingSizes.push({
      label,
      values: collectGroup(html, HEADING_SIZE_RE, 2, (raw) => raw.trim()),
    });
  }
  return {
    fragments: fragments.length,
    backgrounds: tally(backgrounds, limit),
    textColors: tally(textColors, limit),
    otherColors: tally(otherColors, limit),
    fontFamilies: tally(fontFamilies, limit),
    headingSizes: tally(headingSizes, limit),
  };
}

function describeValues(
  values: HtmlStyleValue[],
  noun: string,
): string | undefined {
  if (values.length === 0) return undefined;
  return values
    .map(({ value, fragments, labels }) => {
      const where = labels ? `: ${labels.join(", ")}` : "";
      return `${value} (${fragments} ${fragments === 1 ? noun : `${noun}s`}${where})`;
    })
    .join(", ");
}

/**
 * Render the summary as the lines a current-screen read prints, so an agent
 * sees the shared vocabulary next to the item it is about to edit.
 */
export function formatHtmlStyleSummary(
  summary: HtmlStyleSummary,
  options: { noun?: string } = {},
): string[] {
  const noun = options.noun ?? "fragment";
  const rows: Array<[string, HtmlStyleValue[]]> = [
    ["backgrounds", summary.backgrounds],
    ["text colors", summary.textColors],
    ["accent colors", summary.otherColors],
    ["fonts", summary.fontFamilies],
    ["heading sizes", summary.headingSizes],
  ];
  const lines: string[] = [];
  for (const [name, values] of rows) {
    const described = describeValues(values, noun);
    if (described) lines.push(`${name}: ${described}`);
  }
  if (lines.length === 0) return lines;
  lines.push(
    `Reuse these values for style changes so the edited ${noun} matches the others; a value used by one ${noun} is that ${noun}'s deviation, not the shared style.`,
  );
  return lines;
}
