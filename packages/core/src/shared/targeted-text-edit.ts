/**
 * Shared "find literal text, replace it" matching engine for content-patch
 * style edits (extensions, slides). Pure and dependency-free so both server
 * packages and template code can import it without pulling in server code.
 *
 * Only an EXACT substring match is ever applied. A whitespace-flexible match
 * (runs of whitespace, including CRLF/LF, collapsed to a single space, and
 * dropped next to `: ; , < >`, before comparing — so Prettier's `padding: 4px`
 * still finds the stored `padding:4px`) is never spliced in — collapsing
 * whitespace before applying an edit risks silently rewriting semantically
 * significant whitespace (`<pre>`, `white-space: pre`, embedded JS/CSS string
 * literals). Instead a whitespace-flexible hit is reported as the top
 * "not_found" candidate, with its exact current bytes, so the caller's next
 * attempt can copy the real text verbatim. Cheap token-overlap window candidates fill any remaining
 * slots when nothing matches at all, even loosely.
 *
 * A find that matches more than once is reported as "ambiguous" instead of
 * silently applying to the first hit, unless the caller passed `occurrence`
 * or `all` to say which one(s) it wants.
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
  occurrence?: number;
  all?: boolean;
}

export interface TargetedMatch {
  index: number;
  end: number;
  line: number;
  text: string;
}

export interface TargetedCandidate {
  line: number;
  text: string;
  similarity: number;
  /**
   * `text` is the complete stored text and equals the find text apart from
   * whitespace; false when truncated or when find's boundary whitespace was omitted.
   */
  whitespaceOnly?: boolean;
  /** The displayed text is only part of the candidate, not a complete find value. */
  excerpt?: boolean;
}

export interface TargetedAmbiguousMatch {
  line: number;
  occurrence: number;
  snippet: string;
}

export type TargetedMatchFailure =
  | { ok: false; reason: "not_found"; candidates: TargetedCandidate[] }
  | {
      ok: false;
      reason: "ambiguous";
      matchCount: number;
      matches: TargetedAmbiguousMatch[];
    }
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
const MAX_AMBIGUOUS_MATCHES = 5;
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

  const raw = scanExactMatches(content, find);
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
      matchCount: matches.length,
      matches: matches.slice(0, MAX_AMBIGUOUS_MATCHES).map((m, index) => ({
        line: m.line,
        occurrence: index + 1,
        snippet:
          m.end - m.index > 40
            ? `${excerptAround(content, m.index, 60)} ${excerptAround(content, m.end, 60)}`
            : excerptAround(content, (m.index + m.end) / 2, 100),
      })),
    };
  }

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

// A formatter adds or drops whitespace beside these, which must not hide a
// near-match. Not generally safe to ignore (`Hello, world` is not
// `Hello,world`): fine only because flexible hits are reported, never applied.
const PUNCTUATION_NEIGHBORS = new Set([":", ";", ",", "<", ">"]);

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
      const nextToPunctuation =
        PUNCTUATION_NEIGHBORS.has(chars.at(-1) ?? "") ||
        PUNCTUATION_NEIGHBORS.has(text.charAt(i));
      if (nextToPunctuation) continue;
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
  const needle = normalizeForMatch(find).normalized.trim();
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

function excerptAround(text: string, index: number, max: number): string {
  const start = Math.max(
    0,
    Math.min(index - Math.floor(max / 2), text.length - max),
  );
  const end = Math.min(text.length, start + max);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function firstDifference(a: string, b: string): number {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index])
    index += 1;
  return index;
}

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function diceSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of smaller) if (larger.has(token)) overlap += 1;
  return (2 * overlap) / (a.size + b.size);
}

/**
 * Build the "closest matches" list shown when nothing exact was found.
 * Whitespace-flexible hits come first at similarity 1 — they're the real
 * text with only whitespace differing, so the model can very likely just
 * copy the candidate's exact text verbatim on its next attempt. They are
 * reported here, never applied (see file header). Cheap token-overlap window
 * candidates fill any remaining slots up to MAX_CANDIDATES.
 */
function computeCandidates(content: string, find: string): TargetedCandidate[] {
  const lineStarts = buildLineIndex(content);
  const trimmedFind = find.trim();
  const flexibleMatches = scanFlexibleMatches(content, find).slice(
    0,
    MAX_CANDIDATES,
  );
  const flexible: TargetedCandidate[] = flexibleMatches.map((m) => {
    const truncated = m.text.length > SNIPPET_MAX_CHARS;
    const excerpt = truncated || find !== trimmedFind;
    return {
      line: lineNumberFor(lineStarts, m.index),
      text: truncated
        ? excerptAround(
            m.text,
            firstDifference(m.text, trimmedFind),
            SNIPPET_MAX_CHARS,
          )
        : m.text,
      similarity: 1,
      whitespaceOnly: !excerpt,
      ...(excerpt ? { excerpt: true } : {}),
    };
  });

  const remaining = MAX_CANDIDATES - flexible.length;
  if (remaining <= 0) return flexible;

  const scored = tokenOverlapCandidates(
    content,
    find,
    flexibleMatches,
    lineStarts,
  );
  const mismatch = longPrefixMismatch(content, find, lineStarts);
  if (
    mismatch &&
    !flexibleMatches.some(
      (match) => mismatch.start < match.end && mismatch.end > match.index,
    ) &&
    !scored
      .slice(0, remaining)
      .some(
        (candidate) =>
          candidate.start <= mismatch.point && candidate.end > mismatch.point,
      )
  ) {
    const distinct = scored.filter(
      (candidate) =>
        candidate.end <= mismatch.start || candidate.start >= mismatch.end,
    );
    const { point: _point, ...candidate } = mismatch;
    scored.splice(
      0,
      scored.length,
      ...distinct.slice(0, remaining - 1),
      candidate,
    );
  }

  return [
    ...flexible,
    ...scored
      .slice(0, remaining)
      .map(
        ({ start: _start, end: _end, rank: _rank, ...candidate }) => candidate,
      ),
  ];
}

interface ScoredCandidate extends TargetedCandidate {
  start: number;
  end: number;
  rank: number;
}

function longPrefixMismatch(
  content: string,
  find: string,
  lineStarts: number[],
): (ScoredCandidate & { point: number }) | undefined {
  if (find.length <= 8192) return undefined;
  const anchor = find.slice(0, 64);
  let from = 0;
  let before = content.length;
  let bestStart = -1;
  let bestLength = 0;
  for (let attempt = 0; attempt < 8 && from <= before; attempt += 1) {
    const forward = attempt % 2 === 0;
    const start = forward
      ? content.indexOf(anchor, from)
      : content.lastIndexOf(anchor, before);
    if (start < from || start > before) break;
    let length = anchor.length;
    while (
      length < find.length &&
      start + length < content.length &&
      content[start + length] === find[length]
    )
      length += 1;
    if (length > bestLength) {
      bestStart = start;
      bestLength = length;
    }
    if (forward) from = start + 1;
    else before = start - 1;
  }
  if (bestStart < 0 || bestLength < 256) return undefined;
  const point = bestStart + bestLength;
  const start = Math.max(
    0,
    Math.min(point - SNIPPET_MAX_CHARS / 2, content.length - SNIPPET_MAX_CHARS),
  );
  const end = Math.min(content.length, start + SNIPPET_MAX_CHARS);
  const findStart = Math.max(0, bestLength - SNIPPET_MAX_CHARS / 2);
  const rank = diceSimilarity(
    tokenize(find.slice(findStart, findStart + SNIPPET_MAX_CHARS)),
    tokenize(content.slice(start, end)),
  );
  const similarity =
    Math.round(rank * Math.min(1, (end - start) / find.length) * 100) / 100;
  return {
    start,
    end,
    rank,
    point,
    line: lineNumberFor(lineStarts, point),
    text: excerptAround(content, point, SNIPPET_MAX_CHARS),
    similarity,
    excerpt: true,
  };
}

function tokenOverlapCandidates(
  content: string,
  find: string,
  excluded: RawMatch[],
  lineStarts: number[],
): ScoredCandidate[] {
  // Bound the scoring work per window even for arbitrarily large find strings.
  const sampleSize = 4096;
  const middle = Math.max(0, Math.floor((find.length - sampleSize) / 2));
  const needleTokens = tokenize(
    find.slice(0, sampleSize) +
      " " +
      find.slice(middle, middle + sampleSize) +
      " " +
      find.slice(-sampleSize),
  );
  const lines = content.split(/(\r\n|\r|\n)/);
  const multilineFind = /[\r\n]/.test(find);
  const flexibleLines = new Set(
    excluded.map((match) => lineNumberFor(lineStarts, match.index)),
  );
  const scored: ScoredCandidate[] = [];
  let offset = 0;
  for (const [line, text] of lines.entries()) {
    if (line % 2 !== 0) continue;
    let segments = [{ start: 0, end: text.length }];
    for (const match of excluded) {
      const matchStart = match.index - offset;
      const matchEnd = match.end - offset;
      segments = segments.flatMap((segment) => {
        if (matchEnd <= segment.start || matchStart >= segment.end)
          return [segment];
        return [
          ...(matchStart > segment.start
            ? [{ start: segment.start, end: matchStart }]
            : []),
          ...(matchEnd < segment.end
            ? [{ start: matchEnd, end: segment.end }]
            : []),
        ];
      });
    }
    for (const segment of segments) {
      const lastStart = Math.max(
        segment.start,
        segment.end - SNIPPET_MAX_CHARS,
      );
      for (
        let start = segment.start;
        ;
        start = Math.min(start + SNIPPET_MAX_CHARS / 2, lastStart)
      ) {
        const window = text.slice(
          start,
          Math.min(start + SNIPPET_MAX_CHARS, segment.end),
        );
        const absoluteStart = offset + start;
        const windowTokens = tokenize(window);
        const rank = diceSimilarity(needleTokens, windowTokens);
        // A clipped gap between flexible hits is often markup, not another match.
        if (
          flexibleLines.has(line / 2 + 1) &&
          needleTokens.size > 0 &&
          [...windowTokens].filter((token) => needleTokens.has(token)).length <
            Math.ceil(needleTokens.size * 0.75)
        ) {
          if (start === lastStart) break;
          continue;
        }
        const similarity =
          Math.round(rank * Math.min(1, window.length / find.length) * 100) /
          100;
        const excerpt =
          multilineFind || start > 0 || start + window.length < text.length;
        const candidate = {
          line: line / 2 + 1,
          start: absoluteStart,
          end: absoluteStart + window.length,
          rank,
          text: `${start > 0 ? "…" : ""}${window}${start + window.length < text.length ? "…" : ""}`,
          similarity,
          ...(excerpt ? { excerpt: true } : {}),
        };
        const overlapping = scored.filter(
          (c) => c.start < candidate.end && c.end > candidate.start,
        );
        if (overlapping.some((prior) => prior.rank >= rank)) {
          if (start === lastStart) break;
          continue;
        }
        for (const prior of overlapping)
          scored.splice(scored.indexOf(prior), 1);
        scored.push(candidate);
        scored.sort(
          (a, b) =>
            Number(flexibleLines.has(a.line)) -
              Number(flexibleLines.has(b.line)) || b.rank - a.rank,
        );
        if (scored.length > MAX_CANDIDATES) scored.pop();
        if (start === lastStart) break;
      }
    }
    offset += text.length + (lines[line + 1]?.length ?? 0);
  }
  return scored;
}
