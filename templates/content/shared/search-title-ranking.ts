import {
  parseSearchQuery,
  type SearchQueryGroup,
  type SearchQueryTerm,
} from "./search-query.js";

/**
 * Browser-side title ranking for the command search picker's instant lane.
 * Mirrors the title tiers `actions/_document-search-ranking.ts` computes in
 * SQL (exact, prefix, word-prefix, substring) so the two lanes agree on order
 * for the tiers they share, then adds one browser-only fuzzy tier below them.
 * Keep the tier numbers aligned with the server's `matchTier` (5/4/3/2) — the
 * parity test compares order, and matching numbers make mismatches obvious.
 */

export const TITLE_MATCH_TIER = {
  exact: 5,
  prefix: 4,
  wordPrefix: 3,
  substring: 2,
  fuzzy: 1,
} as const;

export type TitleMatchTier =
  (typeof TITLE_MATCH_TIER)[keyof typeof TITLE_MATCH_TIER];

export interface TitleSearchCandidate {
  id: string;
  title: string;
  updatedAt: string;
}

export interface NormalizedTitleCandidate<T extends TitleSearchCandidate> {
  candidate: T;
  normalizedTitle: string;
  /** Title words as code-point arrays, for the typo tier. */
  words: string[][];
  /** Parsed `updatedAt`, or NaN when unparseable. */
  updatedAtMs: number;
}

export interface TitleRankResult<T extends TitleSearchCandidate> {
  candidate: T;
  tier: TitleMatchTier;
  fuzzyScore: number;
}

const FUZZY_MIN_QUERY_LENGTH = 4;
const WORD_SEPARATOR = /[^\p{L}\p{N}]+/u;

/** Mirrors `regexp_replace(lower(trim(coalesce(title, ''))), '\s+', ' ', 'g')`. */
export function normalizeSearchTitle(title: string): string {
  return title
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");
}

export function buildTitleSearchIndex<T extends TitleSearchCandidate>(
  items: readonly T[],
): NormalizedTitleCandidate<T>[] {
  return items.map((candidate) => {
    const normalizedTitle = normalizeSearchTitle(candidate.title);
    return {
      candidate,
      normalizedTitle,
      words: normalizedTitle
        .split(WORD_SEPARATOR)
        .filter(Boolean)
        .map((word) => Array.from(word)),
      updatedAtMs: Date.parse(candidate.updatedAt),
    };
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termNeedle(term: SearchQueryTerm): string {
  return normalizeSearchTitle(term.text);
}

interface CompiledNeedle {
  needle: string;
  wordPrefix: RegExp | null;
}

function compileNeedle(term: SearchQueryTerm): CompiledNeedle {
  const needle = termNeedle(term);
  return {
    needle,
    wordPrefix: needle
      ? new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(needle)}`, "u")
      : null,
  };
}

function titleContainsNeedle(normalizedTitle: string, needle: string): boolean {
  return needle.length > 0 && normalizedTitle.includes(needle);
}

// Mirrors the server's `simpleQueries` in _document-search-ranking.ts: a
// single AND-of-single-terms query collapses to one joined string; a lone OR
// group compares each term individually.
function computeSimpleQueries(groups: readonly SearchQueryGroup[]): string[] {
  if (groups.length > 0 && groups.every((group) => group.terms.length === 1)) {
    return [groups.map((group) => group.terms[0]!.text.trim()).join(" ")];
  }
  if (groups.length === 1) {
    return groups[0]!.terms.map((term) => term.text.trim());
  }
  return [];
}

// Reused across calls: the typo tier runs this for thousands of words per
// keystroke, so it must not allocate per comparison.
let rowBefore = new Int32Array(0);
let rowPrevious = new Int32Array(0);
let rowCurrent = new Int32Array(0);

/**
 * Optimal string alignment distance between `a` and the first `bLength`
 * characters of `b`, stopping early once it exceeds `max`.
 */
function editDistanceWithin(
  a: readonly string[],
  b: readonly string[],
  bLength: number,
  max: number,
): number {
  if (Math.abs(a.length - bLength) > max) return max + 1;
  if (rowPrevious.length < bLength + 1) {
    rowBefore = new Int32Array(bLength + 1);
    rowPrevious = new Int32Array(bLength + 1);
    rowCurrent = new Int32Array(bLength + 1);
  }
  const unreachable = max + 1;
  let before = rowBefore;
  let previous = rowPrevious;
  let current = rowCurrent;
  const initialEnd = Math.min(bLength, max);
  for (let j = 0; j <= initialEnd; j += 1) previous[j] = j;
  if (initialEnd < bLength) previous[initialEnd + 1] = unreachable;
  for (let i = 1; i <= a.length; i += 1) {
    const start = Math.max(1, i - max);
    const end = Math.min(bLength, i + max);
    const previousEnd = Math.min(bLength, i - 1 + max);
    if (end > previousEnd) previous[end] = unreachable;
    current[0] = i <= max ? i : unreachable;
    if (start > 1) current[start - 1] = unreachable;
    if (end < bLength) current[end + 1] = unreachable;
    let rowMin = current[0]!;
    const ai = a[i - 1];
    for (let j = start; j <= end; j += 1) {
      const cost = ai === b[j - 1] ? 0 : 1;
      let value = previous[j]! + 1;
      const insertion = current[j - 1]! + 1;
      if (insertion < value) value = insertion;
      const substitution = previous[j - 1]! + cost;
      if (substitution < value) value = substitution;
      if (i > 1 && j > 1 && ai === b[j - 2] && a[i - 2] === b[j - 1]) {
        const transposition = before[j - 2]! + 1;
        if (transposition < value) value = transposition;
      }
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return unreachable;
    const recycled = before;
    before = previous;
    previous = current;
    current = recycled;
  }
  return previous[bLength]!;
}

/**
 * Typo tolerance for a single mistyped word: a title word, or the start of a
 * longer title word while the person is still typing, within one edit of the
 * needle (two for needles of eight or more characters). Higher is better;
 * null means no match.
 */
function typoTolerantWordScore(
  words: readonly string[][],
  needleChars: readonly string[],
): number | null {
  const needleLength = needleChars.length;
  const maxDistance = needleLength >= 8 ? 2 : 1;
  let best: number | null = null;
  for (const wordChars of words) {
    // A word shorter than the needle by more than the allowed distance can't
    // match in either form; skip the edit-distance work entirely.
    if (wordChars.length + maxDistance < needleLength) continue;
    const whole = editDistanceWithin(
      needleChars,
      wordChars,
      wordChars.length,
      maxDistance,
    );
    if (whole <= maxDistance) {
      const score = (maxDistance - whole + 1) * 10 + 1;
      if (best === null || score > best) best = score;
    }
    if (wordChars.length > needleLength) {
      // The start of a longer word, while the person is still typing.
      const start = editDistanceWithin(
        needleChars,
        wordChars,
        needleLength,
        maxDistance,
      );
      if (start <= maxDistance) {
        const score = (maxDistance - start + 1) * 10;
        if (best === null || score > best) best = score;
      }
    }
  }
  return best;
}

interface CompiledQuery {
  negatives: string[];
  groups: CompiledNeedle[][];
  simpleQueries: string[];
  fuzzyNeedleChars: string[] | null;
}

function compileQuery(rawQuery: string): CompiledQuery | null {
  const parsed = parseSearchQuery(rawQuery);
  if (parsed.empty) return null;
  // Fuzzy is a typo-tolerant fallback for a single mistyped word, not a
  // relaxation of an explicit phrase, OR-group, or multi-term AND — those
  // already state precisely what must appear, and fuzzy-matching their
  // scattered letters would quietly violate that.
  const soleTerm =
    parsed.groups.length === 1 && parsed.groups[0]!.terms.length === 1
      ? parsed.groups[0]!.terms[0]!
      : null;
  const fuzzyNeedle = soleTerm && !soleTerm.phrase ? termNeedle(soleTerm) : "";
  const fuzzyNeedleChars = Array.from(fuzzyNeedle);
  return {
    negatives: parsed.negatives.map(termNeedle),
    groups: parsed.groups.map((group) => group.terms.map(compileNeedle)),
    simpleQueries: computeSimpleQueries(parsed.groups)
      .map(normalizeSearchTitle)
      .filter(Boolean),
    fuzzyNeedleChars:
      fuzzyNeedleChars.length >= FUZZY_MIN_QUERY_LENGTH
        ? fuzzyNeedleChars
        : null,
  };
}

/** Exact, prefix, word-prefix and substring tiers; null when none apply. */
function rankSharedTiers(
  normalizedTitle: string,
  query: CompiledQuery,
): TitleMatchTier | null {
  if (query.groups.length === 0) {
    // Negatives-only query: everything not excluded matches, at a stable
    // single tier (mirrors the server falling through to matchTier 0 for this
    // shape rather than excluding the row).
    return TITLE_MATCH_TIER.substring;
  }
  const allSubstrings = query.groups.every((group) =>
    group.some((term) => titleContainsNeedle(normalizedTitle, term.needle)),
  );
  if (!allSubstrings) return null;
  if (query.simpleQueries.some((simple) => normalizedTitle === simple)) {
    return TITLE_MATCH_TIER.exact;
  }
  if (
    query.simpleQueries.some((simple) => normalizedTitle.startsWith(simple))
  ) {
    return TITLE_MATCH_TIER.prefix;
  }
  const allWordPrefixes = query.groups.every((group) =>
    group.some((term) => term.wordPrefix?.test(normalizedTitle) ?? false),
  );
  return allWordPrefixes
    ? TITLE_MATCH_TIER.wordPrefix
    : TITLE_MATCH_TIER.substring;
}

function isExcluded(normalizedTitle: string, query: CompiledQuery): boolean {
  return query.negatives.some((negative) =>
    titleContainsNeedle(normalizedTitle, negative),
  );
}

// Tie-breaks below the shared tiers must match the server's own
// `desc(updatedAt), asc(id)` exactly (search-documents.ts) — not recency —
// so that when the server lane answers, its order and the browser lane's
// order for the same tier agree and the top result never appears to move.
function compareTitleRankResults<T extends TitleSearchCandidate>(
  a: TitleRankResult<T> & { updatedAtMs: number },
  b: TitleRankResult<T> & { updatedAtMs: number },
): number {
  if (b.tier !== a.tier) return b.tier - a.tier;
  if (a.tier === TITLE_MATCH_TIER.fuzzy && b.fuzzyScore !== a.fuzzyScore) {
    return b.fuzzyScore - a.fuzzyScore;
  }
  const aValid = Number.isFinite(a.updatedAtMs);
  const bValid = Number.isFinite(b.updatedAtMs);
  if (aValid && bValid && a.updatedAtMs !== b.updatedAtMs) {
    return b.updatedAtMs - a.updatedAtMs;
  }
  if (aValid !== bValid) return aValid ? -1 : 1;
  if (a.candidate.id < b.candidate.id) return -1;
  if (a.candidate.id > b.candidate.id) return 1;
  return 0;
}

/**
 * Ranks a precomputed title index against a raw query string. Rebuild the
 * index once per document-list change (`buildTitleSearchIndex`); call this on
 * every keystroke — it only does cheap string operations, not renormalizing.
 *
 * Pass `limit` when only the first results are shown: typo matches always
 * rank below every shared-tier match, so when shared tiers alone fill the
 * limit the typo pass is skipped.
 */
export function rankTitlesByQuery<T extends TitleSearchCandidate>(
  index: readonly NormalizedTitleCandidate<T>[],
  rawQuery: string,
  options: { limit?: number } = {},
): TitleRankResult<T>[] {
  const query = compileQuery(rawQuery);
  if (!query) return [];

  type Ranked = TitleRankResult<T> & { updatedAtMs: number };
  const results: Ranked[] = [];
  const typoCandidates: NormalizedTitleCandidate<T>[] = [];
  for (const entry of index) {
    if (isExcluded(entry.normalizedTitle, query)) continue;
    const tier = rankSharedTiers(entry.normalizedTitle, query);
    if (tier !== null) {
      results.push({
        candidate: entry.candidate,
        tier,
        fuzzyScore: 0,
        updatedAtMs: entry.updatedAtMs,
      });
    } else if (query.fuzzyNeedleChars) {
      typoCandidates.push(entry);
    }
  }

  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  if (query.fuzzyNeedleChars && results.length < limit) {
    for (const entry of typoCandidates) {
      const score = typoTolerantWordScore(entry.words, query.fuzzyNeedleChars);
      if (score !== null) {
        results.push({
          candidate: entry.candidate,
          tier: TITLE_MATCH_TIER.fuzzy,
          fuzzyScore: score,
          updatedAtMs: entry.updatedAtMs,
        });
      }
    }
  }

  results.sort(compareTitleRankResults);
  return results.map(({ candidate, tier, fuzzyScore }) => ({
    candidate,
    tier,
    fuzzyScore,
  }));
}
