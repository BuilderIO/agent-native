import safeRegex from "safe-regex2";

export type SearchMatchMode = "allTerms" | "anyTerm" | "phrase" | "regex";

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
