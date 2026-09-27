import {
  parseSearchQuery,
  type ParsedSearchQuery,
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
}

export interface TitleRankResult<T extends TitleSearchCandidate> {
  candidate: T;
  tier: TitleMatchTier;
  fuzzyScore: number;
}

const FUZZY_MIN_QUERY_LENGTH = 4;

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
  return items.map((candidate) => ({
    candidate,
    normalizedTitle: normalizeSearchTitle(candidate.title),
  }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termNeedle(term: SearchQueryTerm): string {
  return normalizeSearchTitle(term.text);
}

function titleContainsNeedle(normalizedTitle: string, needle: string): boolean {
  return needle.length > 0 && normalizedTitle.includes(needle);
}

function titleHasWordPrefix(normalizedTitle: string, needle: string): boolean {
  if (!needle) return false;
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}_])${escapeRegExp(needle)}`,
    "u",
  );
  return pattern.test(normalizedTitle);
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

/** Optimal string alignment distance, stopping early once it exceeds `max`. */
function editDistanceWithin(a: string[], b: string[], max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previousPrevious: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, previousPrevious[j - 2]! + 1);
      }
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    previousPrevious = previous;
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * Typo tolerance for a single mistyped word: a title word, or the start of a
 * longer title word while the person is still typing, within one edit of the
 * needle (two for needles of eight or more characters). Higher is better;
 * null means no match.
 */
function typoTolerantWordScore(
  normalizedTitle: string,
  needle: string,
): number | null {
  if (!needle) return null;
  const needleChars = Array.from(needle);
  const maxDistance = needleChars.length >= 8 ? 2 : 1;
  let best: number | null = null;
  for (const word of normalizedTitle.split(/[^\p{L}\p{N}]+/u)) {
    if (!word) continue;
    const wordChars = Array.from(word);
    const forms =
      wordChars.length > needleChars.length
        ? [wordChars, wordChars.slice(0, needleChars.length)]
        : [wordChars];
    forms.forEach((form, formIndex) => {
      const distance = editDistanceWithin(needleChars, form, maxDistance);
      if (distance > maxDistance) return;
      const score =
        (maxDistance - distance + 1) * 10 + (formIndex === 0 ? 1 : 0);
      if (best === null || score > best) best = score;
    });
  }
  return best;
}

interface SingleTitleOutcome {
  tier: TitleMatchTier;
  fuzzyScore: number;
}

function rankSingleTitle(
  normalizedTitle: string,
  parsed: ParsedSearchQuery,
  fuzzy: { allowed: boolean; needle: string },
): SingleTitleOutcome | null {
  for (const negative of parsed.negatives) {
    if (titleContainsNeedle(normalizedTitle, termNeedle(negative))) return null;
  }

  if (parsed.groups.length === 0) {
    // Negatives-only query: everything not excluded above matches, at a
    // stable single tier (mirrors the server falling through to matchTier 0
    // for this shape rather than excluding the row).
    return { tier: TITLE_MATCH_TIER.substring, fuzzyScore: 0 };
  }

  const allSubstrings = parsed.groups.every((group) =>
    group.terms.some((term) =>
      titleContainsNeedle(normalizedTitle, termNeedle(term)),
    ),
  );

  if (!allSubstrings) {
    if (fuzzy.allowed && fuzzy.needle) {
      const score = typoTolerantWordScore(normalizedTitle, fuzzy.needle);
      if (score !== null)
        return { tier: TITLE_MATCH_TIER.fuzzy, fuzzyScore: score };
    }
    return null;
  }

  const simpleQueries = computeSimpleQueries(parsed.groups)
    .map(normalizeSearchTitle)
    .filter(Boolean);
  if (simpleQueries.some((query) => normalizedTitle === query)) {
    return { tier: TITLE_MATCH_TIER.exact, fuzzyScore: 0 };
  }
  if (simpleQueries.some((query) => normalizedTitle.startsWith(query))) {
    return { tier: TITLE_MATCH_TIER.prefix, fuzzyScore: 0 };
  }

  const allWordPrefixes = parsed.groups.every((group) =>
    group.terms.some((term) =>
      titleHasWordPrefix(normalizedTitle, termNeedle(term)),
    ),
  );
  if (allWordPrefixes) {
    return { tier: TITLE_MATCH_TIER.wordPrefix, fuzzyScore: 0 };
  }

  return { tier: TITLE_MATCH_TIER.substring, fuzzyScore: 0 };
}

// Tie-breaks below the shared tiers must match the server's own
// `desc(updatedAt), asc(id)` exactly (search-documents.ts) — not recency —
// so that when the server lane answers, its order and the browser lane's
// order for the same tier agree and the top result never appears to move.
function compareTitleRankResults<T extends TitleSearchCandidate>(
  a: TitleRankResult<T>,
  b: TitleRankResult<T>,
): number {
  if (b.tier !== a.tier) return b.tier - a.tier;
  if (a.tier === TITLE_MATCH_TIER.fuzzy && b.fuzzyScore !== a.fuzzyScore) {
    return b.fuzzyScore - a.fuzzyScore;
  }
  const aTime = Date.parse(a.candidate.updatedAt);
  const bTime = Date.parse(b.candidate.updatedAt);
  const aValid = Number.isFinite(aTime);
  const bValid = Number.isFinite(bTime);
  if (aValid && bValid && aTime !== bTime) return bTime - aTime;
  if (aValid !== bValid) return aValid ? -1 : 1;
  if (a.candidate.id < b.candidate.id) return -1;
  if (a.candidate.id > b.candidate.id) return 1;
  return 0;
}

/**
 * Ranks a precomputed title index against a raw query string. Rebuild the
 * index once per document-list change (`buildTitleSearchIndex`); call this on
 * every keystroke — it only does cheap string operations, not renormalizing.
 */
export function rankTitlesByQuery<T extends TitleSearchCandidate>(
  index: readonly NormalizedTitleCandidate<T>[],
  rawQuery: string,
): TitleRankResult<T>[] {
  const parsed = parseSearchQuery(rawQuery);
  if (parsed.empty) return [];

  // Fuzzy is a typo-tolerant fallback for a single mistyped word, not a
  // relaxation of an explicit phrase, OR-group, or multi-term AND — those
  // already state precisely what must appear, and fuzzy-matching their
  // scattered letters would quietly violate that.
  const soleTerm =
    parsed.groups.length === 1 && parsed.groups[0]!.terms.length === 1
      ? parsed.groups[0]!.terms[0]!
      : null;
  const fuzzyNeedle = soleTerm && !soleTerm.phrase ? termNeedle(soleTerm) : "";
  const fuzzy = {
    allowed: Array.from(fuzzyNeedle).length >= FUZZY_MIN_QUERY_LENGTH,
    needle: fuzzyNeedle,
  };

  const results: TitleRankResult<T>[] = [];
  for (const entry of index) {
    const outcome = rankSingleTitle(entry.normalizedTitle, parsed, fuzzy);
    if (outcome) {
      results.push({
        candidate: entry.candidate,
        tier: outcome.tier,
        fuzzyScore: outcome.fuzzyScore,
      });
    }
  }
  results.sort((a, b) => compareTitleRankResults(a, b));
  return results;
}
