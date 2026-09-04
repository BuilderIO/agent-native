/**
 * Shared "find literal text, replace it" matching engine for content-patch
 * style edits (extensions, slides). Pure and dependency-free so both server
 * packages and template code can import it without pulling in server code.
 *
 * Matching rungs, tried in order until one produces at least one match:
 *   (a) exact substring
 *   (b) whitespace-flexible — runs of whitespace (including CRLF/LF) in both
 *       `find` and `content` collapse to a single space for matching, but the
 *       returned match spans point at the ORIGINAL bytes so a caller splices
 *       the replacement over real content, not the normalized text
 *   (c) still nothing: return the closest-scoring regions in the file so the
 *       caller (and the model) can retarget without a re-read
 *
 * A find that matches more than once — at whichever rung resolved it — is
 * reported as "ambiguous" instead of silently applying to the first hit,
 * unless the caller passed `occurrence` or `all` to say which one(s) it wants.
 *
 * Never throws: every outcome is a discriminated result. Callers decide what
 * "not found" or "ambiguous" should mean for their op (fail loudly, no-op,
 * etc). An `occurrence` that isn't a positive integer is reported as
 * "invalid_occurrence" rather than silently coerced to 1. An `occurrence`
 * past the number of real matches is reported as "occurrence_out_of_range" —
 * a DIFFERENT reason than "not_found" — because matches exist; a caller's
 * zero-matches no-op (`expectedMatches: 0` / `required: false`) must not
 * treat "found some, just not that many" the same as "found none".
 */

export interface TargetedTextEditOptions {
  /** 1-based index of the match to use, when `find` may match more than once. */
  occurrence?: number;
  /** Apply to every match instead of exactly one. */
  all?: boolean;
}

export interface TargetedMatch {
  /** Byte offset into the original content where the match starts. */
  index: number;
  /** Byte offset into the original content where the match ends (exclusive). */
  end: number;
  /** 1-based line number the match starts on. */
  line: number;
  /** The exact original text at [index, end) — differs from `find` only for a
   * whitespace-flexible match. */
  text: string;
}

export interface TargetedCandidate {
  line: number;
  text: string;
  similarity: number;
}

export interface TargetedAmbiguousMatch {
  line: number;
  snippet: string;
}

export type TargetedMatchFailure =
  | { ok: false; reason: "not_found"; candidates: TargetedCandidate[] }
  | { ok: false; reason: "ambiguous"; matches: TargetedAmbiguousMatch[] }
  | { ok: false; reason: "invalid_occurrence"; occurrence: number }
  | {
      ok: false;
      reason: "occurrence_out_of_range";
      occurrence: number;
      matchCount: number;
      matches: TargetedMatch[];
    };

export type TargetedMatchesResult =
  | { ok: true; matches: TargetedMatch[] }
  | TargetedMatchFailure;

export type TargetedReplaceResult =
  | {
      ok: true;
      content: string;
      matchedText: string;
      index: number;
      matchCount: number;
    }
  | TargetedMatchFailure;

const MAX_CANDIDATES = 3;
const SNIPPET_MAX_CHARS = 160;

export function findTargetedMatches(
  content: string,
  find: string,
  opts: TargetedTextEditOptions = {},
): TargetedMatchesResult {
  if (!find) return { ok: false, reason: "not_found", candidates: [] };
  if (opts.occurrence !== undefined && !isPositiveInteger(opts.occurrence)) {
    return {
      ok: false,
      reason: "invalid_occurrence",
      occurrence: opts.occurrence,
    };
  }

  let raw = scanExactMatches(content, find);
  if (raw.length === 0) raw = scanFlexibleMatches(content, find);
  if (raw.length === 0) {
    return {
      ok: false,
      reason: "not_found",
      candidates: computeCandidates(content, find),
    };
  }

  const lineStarts = buildLineIndex(content);
  const matches = raw.map((m) => ({
    ...m,
    line: lineNumberFor(lineStarts, m.index),
  }));

  const wantsSpecificMatch = opts.occurrence !== undefined || opts.all === true;
  if (!wantsSpecificMatch && matches.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      matches: matches.map((m) => ({
        line: m.line,
        snippet: truncate(lineTextAt(content, lineStarts, m.index).trim(), 100),
      })),
    };
  }

  // A valid occurrence past the end of the real matches is a DIFFERENT
  // failure than zero matches — matches exist, so a caller's `expectedMatches:
  // 0` / `required: false` no-op must not swallow this as "not found".
  if (opts.occurrence !== undefined && opts.occurrence > matches.length) {
    return {
      ok: false,
      reason: "occurrence_out_of_range",
      occurrence: opts.occurrence,
      matchCount: matches.length,
      matches,
    };
  }

  return { ok: true, matches };
}

export function applyTargetedReplace(
  content: string,
  find: string,
  replacement: string,
  opts: TargetedTextEditOptions = {},
): TargetedReplaceResult {
  const result = findTargetedMatches(content, find, opts);
  if (!result.ok) return result;

  const { matches } = result;
  // occurrence wins when both are given — matches the pre-helper contract
  // (nthIndexOf/replaceNth ran before the `all` branch), so { occurrence: 2,
  // all: true } replaces only the second match, not every match.
  if (opts.occurrence === undefined && opts.all) {
    let next = content;
    for (const m of [...matches].reverse()) {
      next = next.slice(0, m.index) + replacement + next.slice(m.end);
    }
    return {
      ok: true,
      content: next,
      matchedText: matches[0]!.text,
      index: matches[0]!.index,
      matchCount: matches.length,
    };
  }

  // opts.occurrence, if given, was already validated (positive integer, and
  // in range) by findTargetedMatches above — an out-of-range value returns
  // "occurrence_out_of_range" before we get here, so this index always hits.
  const occurrence = opts.occurrence ?? 1;
  const match = matches[occurrence - 1]!;

  const next =
    content.slice(0, match.index) + replacement + content.slice(match.end);
  return {
    ok: true,
    content: next,
    matchedText: match.text,
    index: match.index,
    matchCount: matches.length,
  };
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

interface RawMatch {
  index: number;
  end: number;
  text: string;
}

function scanExactMatches(content: string, find: string): RawMatch[] {
  const matches: RawMatch[] = [];
  let from = 0;
  while (true) {
    const idx = content.indexOf(find, from);
    if (idx < 0) break;
    matches.push({ index: idx, end: idx + find.length, text: find });
    from = idx + find.length;
  }
  return matches;
}

interface NormalizedSpan {
  start: number;
  end: number;
}

/** Collapse every run of whitespace to a single space, recording the original
 * [start, end) span each normalized character came from. */
function normalizeForMatch(text: string): {
  normalized: string;
  spans: NormalizedSpan[];
} {
  const chars: string[] = [];
  const spans: NormalizedSpan[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (/\s/.test(text[i]!)) {
      const start = i;
      while (i < n && /\s/.test(text[i]!)) i += 1;
      chars.push(" ");
      spans.push({ start, end: i });
    } else {
      chars.push(text[i]!);
      spans.push({ start: i, end: i + 1 });
      i += 1;
    }
  }
  return { normalized: chars.join(""), spans };
}

function scanFlexibleMatches(content: string, find: string): RawMatch[] {
  const needle = find.replace(/\s+/g, " ");
  if (!needle) return [];

  const { normalized, spans } = normalizeForMatch(content);
  const matches: RawMatch[] = [];
  let from = 0;
  while (true) {
    const idx = normalized.indexOf(needle, from);
    if (idx < 0) break;
    const endIdx = idx + needle.length;
    const origStart = spans[idx]!.start;
    const origEnd = spans[endIdx - 1]!.end;
    matches.push({
      index: origStart,
      end: origEnd,
      text: content.slice(origStart, origEnd),
    });
    from = endIdx;
  }
  return matches;
}

function buildLineIndex(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineNumberFor(lineStarts: number[], index: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid]! <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function lineTextAt(
  content: string,
  lineStarts: number[],
  index: number,
): string {
  const lineIdx = lineNumberFor(lineStarts, index) - 1;
  const start = lineStarts[lineIdx]!;
  const nextStart = lineStarts[lineIdx + 1];
  const end = nextStart !== undefined ? nextStart - 1 : content.length;
  return content.slice(start, Math.max(start, end));
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function diceSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return (2 * overlap) / (a.size + b.size);
}

/** Cheap "closest region" search for the not-found case: score every window
 * of the file with the same line count as `find` by token overlap between its
 * first line and `find`'s first line, and return the top few. O(lines), no
 * dependency — good enough to point the model at the right neighborhood. */
function computeCandidates(content: string, find: string): TargetedCandidate[] {
  const needleLines = find.split(/\r\n|\r|\n/);
  const needleLineCount = needleLines.length;
  const needleTokens = tokenize(needleLines[0] ?? "");

  const contentLines = content.split(/\r\n|\r|\n/);
  const scored: TargetedCandidate[] = [];
  for (let i = 0; i + needleLineCount <= contentLines.length; i += 1) {
    const windowLines = contentLines.slice(i, i + needleLineCount);
    const similarity = diceSimilarity(
      needleTokens,
      tokenize(windowLines[0] ?? ""),
    );
    scored.push({
      line: i + 1,
      text: truncate(windowLines.join("\n"), SNIPPET_MAX_CHARS),
      similarity: Math.round(similarity * 100) / 100,
    });
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, MAX_CANDIDATES);
}
