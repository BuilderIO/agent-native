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
  /** The mistyped word, lowercased. */
  term: string;
  /** Words from visible titles and descriptions it was also matched as. */
  replacements: string[];
}

/** Each normalized word, with the other spellings it has in stored text. */
export type SearchVocabulary = ReadonlyMap<string, readonly string[]>;

/** Closest words kept per mistyped word, and alternatives kept per term. */
const MAX_REPLACEMENTS = 5;

const EDGE_SEPARATORS = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const SEPARATORS_KEPT = /([^\p{L}\p{N}]+)/u;

/**
 * Splits stored title and description words into distinct normalized words.
 * The fallback scan matches stored text as written, so each word also keeps
 * the stored spellings that normalize to it: a correction to "billing" taken
 * from "Ｂｉｌｌｉｎｇ" searches for both.
 */
export function searchVocabulary(
  storedWords: Iterable<string>,
): SearchVocabulary {
  const spellings = new Map<string, Set<string>>();
  for (const stored of storedWords) {
    for (const word of normalizeSearchTitle(stored).split(WORD_SEPARATOR)) {
      if (word && !spellings.has(word)) spellings.set(word, new Set());
    }
    for (const piece of stored.split(WORD_SEPARATOR)) {
      const word = normalizeSearchTitle(piece);
      if (piece !== word) spellings.get(word)?.add(piece);
    }
  }
  return new Map(
    [...spellings].map(([word, forms]) => [word, [...forms]] as const),
  );
}

function closestWords(
  vocabulary: SearchVocabulary,
  needleChars: readonly string[],
): string[] {
  const needle = needleChars.join("");
  const scored: { word: string; score: number }[] = [];
  for (const word of vocabulary.keys()) {
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
 * The words of a term with the punctuation between them, at even and odd
 * indexes. Punctuation at either end ("roadmpa,") is dropped: alternatives
 * match as substrings, and "roadmap," would miss a page titled "Roadmap".
 */
function termPieces(term: SearchQueryTerm): string[] | null {
  if (term.phrase || term.negated) return null;
  const needle = normalizeSearchTitle(term.text).replace(EDGE_SEPARATORS, "");
  return needle ? needle.split(SEPARATORS_KEPT) : null;
}

/**
 * The query with each correctable word widened to "the word or its closest
 * visible words", or null when no word has a correction.
 */
export function correctSearchQueryTypos(
  parsed: ParsedSearchQuery,
  vocabulary: SearchVocabulary,
): { query: ParsedSearchQuery; corrections: SpellingCorrection[] } | null {
  const corrections = new Map<string, string[]>();
  const alternatives = (term: SearchQueryTerm): string[] => {
    const pieces = termPieces(term);
    if (!pieces) return [];
    const corrected = new Map<number, string[]>();
    for (let index = 0; index < pieces.length; index += 2) {
      const needleChars = Array.from(pieces[index]!);
      if (needleChars.length < FUZZY_MIN_QUERY_LENGTH) continue;
      const words = closestWords(vocabulary, needleChars);
      if (!words.length) continue;
      corrected.set(index, words);
      corrections.set(pieces[index]!, words);
    }
    if (!corrected.size) return [];
    if (pieces.length === 1) {
      return corrected
        .get(0)!
        .flatMap((word) => [word, ...(vocabulary.get(word) ?? [])]);
    }
    // A word inside punctuation ("q3-roadmpa") is replaced in place.
    let combinations = [pieces];
    for (const [index, words] of corrected) {
      combinations = combinations
        .flatMap((combination) =>
          words.map((word) =>
            combination.map((piece, at) => (at === index ? word : piece)),
          ),
        )
        .slice(0, MAX_REPLACEMENTS);
    }
    return combinations.map((combination) => combination.join(""));
  };
  const groups = parsed.groups.map((group) => ({
    terms: group.terms.flatMap((term) => [
      term,
      ...[...new Set(alternatives(term))].map((text) => ({
        text,
        phrase: false,
        negated: false,
        titleOnly: term.titleOnly,
      })),
    ]),
  }));
  return corrections.size
    ? {
        query: { ...parsed, groups },
        corrections: [...corrections].map(([term, replacements]) => ({
          term,
          replacements,
        })),
      }
    : null;
}
