import {
  FUZZY_MIN_QUERY_LENGTH,
  normalizeSearchTitle,
  typoWordScore,
  WORD_SEPARATOR,
} from "../shared/search-title-ranking.js";
import type {
  ParsedSearchQuery,
  SearchQueryTerm,
} from "../shared/search-query.js";

/**
 * The server's typo pass for `search-documents`. When a query finds nothing,
 * each word that isn't in any title or description the caller can see is
 * also matched against the closest words that are, using the browser lane's
 * typo rule (`typoWordScore`). The vocabulary holds only words of pages the
 * caller's own search may return, so a correction never reveals a word from a
 * page they can't open. Phrases, excluded words, and words shorter than four
 * characters are never corrected.
 */

export interface SpellingCorrection {
  /** The query word as typed. */
  term: string;
  /** Words from visible titles and descriptions it was also matched as. */
  replacements: string[];
}

/** Closest words kept per mistyped word. */
const MAX_REPLACEMENTS = 5;

/** Splits titles and descriptions into distinct normalized words. */
export function searchVocabulary(texts: Iterable<string>): string[] {
  const words = new Set<string>();
  for (const text of texts) {
    for (const word of normalizeSearchTitle(text).split(WORD_SEPARATOR)) {
      if (word) words.add(word);
    }
  }
  return [...words];
}

function correctableNeedle(term: SearchQueryTerm): string[] | null {
  if (term.phrase || term.negated) return null;
  const needle = normalizeSearchTitle(term.text);
  if (!needle || needle.split(WORD_SEPARATOR).length !== 1) return null;
  const chars = Array.from(needle);
  return chars.length >= FUZZY_MIN_QUERY_LENGTH ? chars : null;
}

function closestWords(
  vocabulary: readonly string[],
  needleChars: readonly string[],
): string[] {
  const needle = needleChars.join("");
  const scored: { word: string; score: number }[] = [];
  for (const word of vocabulary) {
    // The word is already there as typed, so it isn't the misspelling.
    if (word.includes(needle)) return [];
    const score = typoWordScore(Array.from(word), needleChars);
    if (score !== null) scored.push({ word, score });
  }
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.word.length - b.word.length ||
        (a.word < b.word ? -1 : a.word > b.word ? 1 : 0),
    )
    .slice(0, MAX_REPLACEMENTS)
    .map(({ word }) => word);
}

/**
 * The query with each correctable word widened to "the word or its closest
 * visible words", or null when no word has a correction.
 */
export function correctSearchQueryTypos(
  parsed: ParsedSearchQuery,
  vocabulary: readonly string[],
): { query: ParsedSearchQuery; corrections: SpellingCorrection[] } | null {
  const corrections: SpellingCorrection[] = [];
  const groups = parsed.groups.map((group) => ({
    terms: group.terms.flatMap((term) => {
      const needleChars = correctableNeedle(term);
      const replacements = needleChars
        ? closestWords(vocabulary, needleChars)
        : [];
      if (!replacements.length) return [term];
      corrections.push({ term: term.text, replacements });
      return [
        term,
        ...replacements.map((text) => ({
          text,
          phrase: false,
          negated: false,
          titleOnly: term.titleOnly,
        })),
      ];
    }),
  }));
  return corrections.length
    ? { query: { ...parsed, groups }, corrections }
    : null;
}
