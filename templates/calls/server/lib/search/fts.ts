import { and, or, like, not, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";

export interface SearchTerms {
  positive: string[];
  negative: string[];
  phrases: string[];
}

export function buildSearchTerms(query: string): SearchTerms {
  const positive: string[] = [];
  const negative: string[] = [];
  const phrases: string[] = [];

  if (typeof query !== "string") return { positive, negative, phrases };
  const trimmed = query.trim();
  if (!trimmed) return { positive, negative, phrases };

  const phraseRe = /"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = phraseRe.exec(trimmed)) !== null) {
    const inner = match[1].trim();
    if (inner) phrases.push(inner);
  }
  const withoutPhrases = trimmed.replace(phraseRe, " ");

  const tokens = withoutPhrases
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  for (const tok of tokens) {
    if (tok.startsWith("-") && tok.length > 1) {
      negative.push(tok.slice(1));
    } else if (tok.startsWith("+") && tok.length > 1) {
      positive.push(tok.slice(1));
    } else {
      positive.push(tok);
    }
  }

  return { positive, negative, phrases };
}

function escapeLikeTerm(term: string): string {
  return term.replace(/([\\%_])/g, "\\$1");
}

function likePattern(term: string): string {
  return `%${escapeLikeTerm(term)}%`;
}

function anyColumnMatches(pattern: string, cols: AnyColumn[]): SQL | undefined {
  const parts = cols.map((c) => like(c, pattern));
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return or(...parts);
}

export function applySearchWhere(
  query: string,
  titleCol: AnyColumn,
  descCol: AnyColumn,
  transcriptFullTextCol: AnyColumn,
): SQL | undefined {
  const { positive, negative, phrases } = buildSearchTerms(query);
  if (!positive.length && !negative.length && !phrases.length) return undefined;

  const cols: AnyColumn[] = [titleCol, descCol, transcriptFullTextCol];
  const clauses: SQL[] = [];

  for (const term of [...positive, ...phrases]) {
    const m = anyColumnMatches(likePattern(term), cols);
    if (m) clauses.push(m);
  }

  for (const term of negative) {
    const m = anyColumnMatches(likePattern(term), cols);
    if (m) clauses.push(not(m));
  }

  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return and(...clauses);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function highlight(text: string, terms: string[], maxLen = 240): string {
  if (typeof text !== "string" || !text) return "";
  const cleanTerms = (terms || [])
    .filter((t) => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim());

  if (cleanTerms.length === 0) {
    const trimmed = text.slice(0, maxLen);
    return escapeHtml(trimmed) + (text.length > maxLen ? "…" : "");
  }

  const lowerText = text.toLowerCase();
  let firstIndex = -1;
  for (const term of cleanTerms) {
    const idx = lowerText.indexOf(term.toLowerCase());
    if (idx !== -1 && (firstIndex === -1 || idx < firstIndex)) firstIndex = idx;
  }

  let snippet: string;
  let prefix = "";
  let suffix = "";
  if (firstIndex === -1) {
    snippet = text.slice(0, maxLen);
    if (text.length > maxLen) suffix = "…";
  } else {
    const radius = Math.floor(maxLen / 2);
    const start = Math.max(0, firstIndex - radius);
    const end = Math.min(text.length, start + maxLen);
    snippet = text.slice(start, end);
    if (start > 0) prefix = "…";
    if (end < text.length) suffix = "…";
  }

  const escaped = escapeHtml(snippet);
  const pattern = new RegExp(
    `(${cleanTerms.map(escapeRegex).join("|")})`,
    "gi",
  );
  const highlighted = escaped.replace(pattern, "<mark>$1</mark>");

  return `${prefix}${highlighted}${suffix}`;
}

/**
 * Build a simple highlight snippet (plain text, no HTML) around the first
 * match of `query` in `fullText`. Returns null if not found.
 */
export function buildSnippet(
  fullText: string | null | undefined,
  query: string,
): string | null {
  if (!fullText || !query) return null;
  const lower = fullText.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return null;
  const radius = 80;
  const start = Math.max(0, idx - radius);
  const end = Math.min(fullText.length, idx + query.length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < fullText.length ? "…" : "";
  return `${prefix}${fullText.slice(start, end)}${suffix}`;
}
