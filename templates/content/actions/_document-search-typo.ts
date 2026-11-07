import type {
  ParsedSearchQuery,
  SearchQueryTerm,
} from "../shared/search-query.js";
import {
  FUZZY_MIN_QUERY_LENGTH,
  normalizeSearchTitle,
  typoWordScore,
  WORD_SEPARATOR,
} from "../shared/search-title-ranking.js";

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

/**
 * Most distinct title and description words the typo pass reads. A library
 * with more keeps its most-used words, so every request of a search reads the
 * same ones.
 */
export const TYPO_VOCABULARY_LIMIT = 50_000;

/** Closest words kept per mistyped word. */
const MAX_REPLACEMENTS = 5;
/** Other stored spellings kept per word. */
const MAX_SPELLINGS = 3;
/** Alternatives kept per term: each word in each of its spellings. */
const MAX_ALTERNATIVES = MAX_REPLACEMENTS * (1 + MAX_SPELLINGS);

const EDGE_SEPARATORS = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const SEPARATORS_KEPT = /([^\p{L}\p{N}]+)/u;
const ASCII = /^\p{ASCII}*$/u;
const WORD_CHARACTER = /[\p{L}\p{N}]/u;
const MARK = /^\p{M}$/u;

/**
 * The runs of a stored word that normalize to letters or digits. A circled
 * "Ⓖ" or a combining accent isn't a letter until it is normalized, so
 * splitting on WORD_SEPARATOR would cut the stored spelling apart.
 */
function storedPieces(stored: string): string[] {
  const pieces: string[] = [];
  let piece = "";
  for (const character of stored) {
    if (
      MARK.test(character) ||
      WORD_CHARACTER.test(character.normalize("NFKC"))
    ) {
      piece += character;
    } else if (piece) {
      pieces.push(piece);
      piece = "";
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/**
 * Splits stored title and description words into distinct normalized words.
 * The fallback scan matches stored text as written, so each word also keeps
 * the stored spellings that normalize to it: a correction to "billing" taken
 * from "Ｂｉｌｌｉｎｇ" searches for both.
 *
 * Stored words come most-used first. One can split into many words here
 * ("north—south"), so the limit applies again after splitting.
 */
export function searchVocabulary(
  storedWords: Iterable<string>,
): SearchVocabulary {
  const spellings = new Map<string, Set<string>>();
  for (const stored of storedWords) {
    for (const word of normalizeSearchTitle(stored).split(WORD_SEPARATOR)) {
      if (
        word &&
        !spellings.has(word) &&
        spellings.size < TYPO_VOCABULARY_LIMIT
      ) {
        spellings.set(word, new Set());
      }
    }
    // Lowercase ASCII is stored as it normalizes.
    if (ASCII.test(stored)) continue;
    for (const piece of storedPieces(stored)) {
      const word = normalizeSearchTitle(piece);
      const forms = spellings.get(word);
      if (forms && piece !== word && forms.size < MAX_SPELLINGS) {
        forms.add(piece);
      }
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

/** Whether a piece of `termPieces` is a word long enough to correct. */
function correctable(piece: string, index: number): boolean {
  // Odd indexes are the punctuation between words.
  return !(index % 2) && Array.from(piece).length >= FUZZY_MIN_QUERY_LENGTH;
}

/**
 * Whether the typo pass could correct any word of the query, so a search of
 * phrases or short words doesn't read the vocabulary for nothing.
 */
export function hasCorrectableWord(parsed: ParsedSearchQuery): boolean {
  return parsed.groups.some((group) =>
    group.terms.some((term) => termPieces(term)?.some(correctable)),
  );
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
    // Each close word and its stored spellings share the word's rank.
    type Option = { text: string; rank: number };
    const corrected = new Map<number, { typed: Option; words: Option[] }>();
    for (const [index, piece] of pieces.entries()) {
      if (!correctable(piece, index)) continue;
      const words = closestWords(vocabulary, Array.from(piece));
      if (!words.length) continue;
      corrected.set(index, {
        typed: { text: piece, rank: words.length },
        words: words.flatMap((word, rank) =>
          [word, ...(vocabulary.get(word) ?? [])].map((text) => ({
            text,
            rank,
          })),
        ),
      });
      corrections.set(piece, words);
    }
    if (!corrected.size) return [];
    // A word inside punctuation ("q3-roadmpa") is replaced in place, by each
    // close word in each of its stored spellings. With two mistyped words,
    // the combinations with the best ranks in total are kept, so the second
    // closest word for one can pair with the closest for the other.
    const combine = (keepTyped: boolean) => {
      let combinations = [{ pieces, rank: 0 }];
      for (const [index, { typed, words }] of corrected) {
        const options = keepTyped ? [...words, typed] : words;
        combinations = combinations
          .flatMap((combination) =>
            options.map((option) => ({
              pieces: combination.pieces.map((piece, at) =>
                at === index ? option.text : piece,
              ),
              rank: combination.rank + option.rank,
            })),
          )
          // Keeping the best ranks at each step keeps the best overall.
          .sort((a, b) => a.rank - b.rank)
          .slice(0, MAX_ALTERNATIVES);
      }
      return combinations.map((combination) => combination.pieces.join(""));
    };
    // With two mistyped words, each is also kept as typed while the other is
    // corrected, after every full correction: a body can say "billng-launch",
    // and corrections only come from titles and descriptions. Every word as
    // typed is the term itself.
    const asTyped = pieces.join("");
    return [...new Set([...combine(false), ...combine(true)])]
      .filter((text) => text !== asTyped)
      .slice(0, MAX_ALTERNATIVES);
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
