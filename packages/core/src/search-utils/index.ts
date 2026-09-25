import safeRegex from "safe-regex2";

export type SearchMatchMode = "allTerms" | "anyTerm" | "phrase" | "regex";

export type TextSearchMode = "substring" | "glob" | "sql-like" | "regex";

export interface TextMatcher {
  matches(value: string): boolean;
  error?: string;
}

const MAX_TEXT_SEARCH_PATTERN_LENGTH = 240;

const STOPWORDS = new Set([
  "about",
  "and",
  "did",
  "does",
  "for",
  "from",
  "have",
  "our",
  "the",
  "what",
  "when",
  "where",
  "which",
  "while",
  "why",
  "with",
]);

export function escapeLikeTerm(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function normalizeSearchTerms(query: string): string[] {
  const phrase = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .map((token) => token.trim())
    .filter(Boolean)
    .join(" ");
  if (!phrase) return [];
  const tokens = phrase
    .split(/[^\p{L}\p{N}-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
  return Array.from(new Set([phrase, ...tokens])).slice(0, 12);
}

export function matchesSearchMode(
  value: string,
  query: string,
  mode: SearchMatchMode,
): boolean {
  const normalizedValue = normalizeText(value).toLowerCase();
  if (mode === "regex") {
    if (query.length > 240 || !safeRegex(query)) return false;
    try {
      return new RegExp(query, "iu").test(value);
    } catch {
      return false;
    }
  }
  const terms = normalizeSearchTerms(query);
  if (!terms.length) return false;
  if (mode === "phrase") return normalizedValue.includes(terms[0] ?? "");
  const tokens = terms.slice(1).length ? terms.slice(1) : terms;
  return mode === "allTerms"
    ? tokens.every((term) => normalizedValue.includes(term))
    : tokens.some((term) => normalizedValue.includes(term));
}

/**
 * Build a bounded, case-insensitive matcher for agent-facing text search.
 * Regexes are deliberately constrained because these matchers may scan a
 * packaged source corpus during a single agent turn.
 */
export function createTextMatcher(
  pattern: string,
  mode: TextSearchMode = "substring",
): TextMatcher {
  if (!pattern) {
    return { matches: () => false, error: "Search pattern cannot be empty." };
  }
  if (pattern.length > MAX_TEXT_SEARCH_PATTERN_LENGTH) {
    return {
      matches: () => false,
      error: `Search pattern is limited to ${MAX_TEXT_SEARCH_PATTERN_LENGTH} characters.`,
    };
  }

  if (mode === "substring") {
    const normalized = pattern.toLowerCase();
    return {
      matches: (value) => value.toLowerCase().includes(normalized),
    };
  }

  const regexSource =
    mode === "regex" ? pattern : wildcardPatternToRegex(pattern, mode);
  try {
    const matcher = new RegExp(regexSource, "isu");
    if (mode === "regex" && !safeRegex(pattern)) {
      return {
        matches: () => false,
        error: "Regex pattern is too complex for a bounded source search.",
      };
    }
    return { matches: (value) => matcher.test(value) };
  } catch {
    return {
      matches: () => false,
      error: `Invalid ${mode} search pattern.`,
    };
  }
}

function wildcardPatternToRegex(
  pattern: string,
  mode: Exclude<TextSearchMode, "substring" | "regex">,
): string {
  let source = "";
  let escaped = false;
  for (const character of pattern) {
    if (escaped) {
      source += escapeRegexCharacter(character);
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }

    const isMany = mode === "glob" ? character === "*" : character === "%";
    const isOne = mode === "glob" ? character === "?" : character === "_";
    if (isMany) {
      source += "[\\s\\S]*";
    } else if (isOne) {
      source += "[\\s\\S]";
    } else {
      source += escapeRegexCharacter(character);
    }
  }
  if (escaped) source += "\\\\";
  return source;
}

function escapeRegexCharacter(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

export function buildSearchSnippet(
  value: string,
  terms: string[],
  maxLength = 260,
): string {
  const text = normalizeText(value);
  if (text.length <= maxLength) return text;
  const lower = text.toLowerCase();
  const firstIndex = terms.reduce((best, term) => {
    const index = lower.indexOf(term.toLowerCase());
    return index >= 0 && (best < 0 || index < best) ? index : best;
  }, -1);
  const start = Math.max(
    0,
    (firstIndex < 0 ? 0 : firstIndex) - Math.floor(maxLength / 3),
  );
  const end = Math.min(text.length, start + maxLength);
  return `${start > 0 ? "..." : ""}${text.slice(start, end).trim()}${end < text.length ? "..." : ""}`;
}

export function scoreSearchText(
  fields: {
    title?: string | null;
    summary?: string | null;
    body?: string | null;
    metadata?: string | null;
  },
  terms: string[],
): number {
  const title = normalizeText(fields.title).toLowerCase();
  const summary = normalizeText(fields.summary).toLowerCase();
  const body = normalizeText(fields.body).toLowerCase();
  const metadata = normalizeText(fields.metadata).toLowerCase();
  let score = 0;
  terms.forEach((term, index) => {
    const phraseBoost = index === 0 ? 2 : 1;
    if (title.includes(term)) score += 40 * phraseBoost;
    if (summary.includes(term)) score += 20 * phraseBoost;
    if (body.includes(term)) score += 8 * phraseBoost;
    if (metadata.includes(term)) score += 6 * phraseBoost;
  });
  return score;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}
