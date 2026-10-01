/**
 * Search tokens, computed in JavaScript for both the index and the query.
 *
 * Postgres's text parser depends on the database's locale: on some locales it
 * drops Japanese text entirely, and PGlite and Neon don't agree. So core never
 * asks Postgres to tokenize. It builds `tsvector` and `tsquery` literals
 * itself, and the database only stores, indexes, and matches them. The same
 * code tokenizes documents and queries, so they always agree.
 *
 * Rules:
 * - Text is NFKC-normalized and lowercased. There is no stemming and there are
 *   no stopwords.
 * - A word is a run of letters, numbers, and combining marks. Everything else
 *   separates words, so `snake_case`, `kebab-case`, URLs, and paths become
 *   their parts at consecutive positions, and a query for the same text
 *   matches them as a phrase.
 * - A camelCase or PascalCase word is indexed whole and as its parts, so
 *   "camelCase", "camel", and "case camel" all find it.
 * - Chinese, Japanese, and Korean runs become overlapping character pairs,
 *   because they have no spaces to split on. A query becomes the same pairs
 *   as a phrase, which matches exactly that substring. A run's last character
 *   starts no pair, so it is also indexed alone, and a one-character query
 *   finds every character as a prefix.
 */

const WORD = /[\p{L}\p{N}\p{M}]+/gu;
const CJK =
  /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}]/u;
const CAMEL_LOWER_UPPER = /([\p{Ll}\p{N}])(\p{Lu})/gu;
const CAMEL_ACRONYM = /(\p{Lu})(\p{Lu}\p{Ll})/gu;

/** Postgres limits, from tsvector.h. */
const MAX_POSITION = 16_383;
const MAX_POSITIONS_PER_LEXEME = 255;
const MAX_LEXEME_BYTES = 2_047;
/**
 * Budget for a vector's estimated size. Postgres rejects a vector whose
 * lexemes alone take 1 MB, so this stays well under that.
 */
const MAX_VECTOR_BYTES = 900_000;
/** Per-lexeme overhead: its entry and position count. */
const LEXEME_OVERHEAD_BYTES = 6;
/** One stored position. */
const POSITION_BYTES = 2;

export type SearchWeight = "A" | "B" | "C" | "D";

/** Normalized form used for title and summary comparisons. */
export function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

interface Segment {
  text: string;
  cjk: boolean;
}

function segments(word: string): Segment[] {
  const out: Segment[] = [];
  for (const char of word) {
    const cjk = CJK.test(char);
    const last = out[out.length - 1];
    if (last && last.cjk === cjk) last.text += char;
    else out.push({ text: char, cjk });
  }
  return out;
}

function cjkPairs(text: string): string[] {
  const chars = Array.from(text);
  if (chars.length < 2) return chars;
  const pairs: string[] = [];
  for (let index = 0; index < chars.length - 1; index += 1) {
    pairs.push(chars[index]! + chars[index + 1]!);
  }
  return pairs;
}

function camelParts(word: string): string[] {
  return word
    .replace(CAMEL_LOWER_UPPER, "$1\u0000$2")
    .replace(CAMEL_ACRONYM, "$1\u0000$2")
    .split("\u0000")
    .filter(Boolean);
}

const encoder = new TextEncoder();

/** UTF-8 length without encoding: 1-3 bytes per UTF-16 unit, 4 per pair. */
function utf8Bytes(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function usable(lexeme: string): boolean {
  return (
    lexeme.length > 0 &&
    (lexeme.length * 3 <= MAX_LEXEME_BYTES ||
      encoder.encode(lexeme).length <= MAX_LEXEME_BYTES)
  );
}

export interface SearchToken {
  lexeme: string;
  position: number;
}

/**
 * Document tokens with positions starting at `start`. Returns the next free
 * position so several fields can share one position space.
 */
export function documentTokens(
  text: string,
  start = 1,
): { tokens: SearchToken[]; next: number } {
  const tokens: SearchToken[] = [];
  let position = start;
  const push = (lexeme: string, at: number) => {
    if (usable(lexeme)) tokens.push({ lexeme, position: at });
  };
  for (const match of text.normalize("NFKC").matchAll(WORD)) {
    for (const segment of segments(match[0])) {
      if (segment.cjk) {
        const pairs = cjkPairs(segment.text);
        for (const pair of pairs) push(pair, position++);
        // The last character also stands alone, at the last pair's position.
        const last = Array.from(segment.text).at(-1)!;
        if (pairs.at(-1) !== last) push(last, position - 1);
        continue;
      }
      const parts = camelParts(segment.text);
      const whole = segment.text.toLowerCase();
      if (parts.length < 2) {
        push(whole, position++);
        continue;
      }
      // The whole word sits at its first and last part's positions, so a
      // phrase can reach it from either side.
      const first = position;
      for (const part of parts) push(part.toLowerCase(), position++);
      push(whole, first);
      push(whole, position - 1);
    }
  }
  return { tokens, next: position };
}

/**
 * Query lexemes for one term, in order. Unlike documents, a query word is
 * never split on case: "camelCase" looks for the whole word, which documents
 * index alongside its parts.
 */
export function queryLexemes(text: string): string[] {
  const lexemes: string[] = [];
  for (const match of text.normalize("NFKC").matchAll(WORD)) {
    for (const segment of segments(match[0])) {
      if (segment.cjk) lexemes.push(...cjkPairs(segment.text));
      else lexemes.push(segment.text.toLowerCase());
    }
  }
  return lexemes.filter(usable);
}

function quoteLexeme(lexeme: string): string {
  return `'${lexeme.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

export interface WeightedField {
  text: string | null | undefined;
  weight: SearchWeight;
}

export interface SearchVector {
  /** A `tsvector` literal. */
  literal: string;
  /**
   * False when Postgres's limits made the vector drop or merge word
   * positions, so phrase matching can't be exact for this document.
   */
  positionsComplete: boolean;
}

/**
 * A `tsvector` for the fields, in order, sharing one position space with a
 * gap between fields, so a phrase never spans two of them. Postgres keeps at
 * most 255 positions per word and none past 16,383: later ones are dropped
 * or collapse onto the last. A very large document keeps one position per
 * word in each field, and one with more distinct words than fit keeps the
 * words that come first, so the vector stays under Postgres's size limit.
 * Any of these makes `positionsComplete` false.
 */
export function buildSearchVector(
  fields: readonly WeightedField[],
): SearchVector {
  const entries = new Map<string, string[]>();
  let position = 1;
  let positionsComplete = true;
  for (const field of fields) {
    if (!field.text) continue;
    const { tokens, next } = documentTokens(field.text, position);
    if (tokens.length) position = next + 1;
    for (const token of tokens) {
      const list = entries.get(token.lexeme) ?? [];
      if (
        list.length >= MAX_POSITIONS_PER_LEXEME ||
        token.position > MAX_POSITION
      ) {
        positionsComplete = false;
      }
      if (list.length < MAX_POSITIONS_PER_LEXEME) {
        list.push(`${Math.min(token.position, MAX_POSITION)}${field.weight}`);
      }
      entries.set(token.lexeme, list);
    }
  }
  let lexemeBytes = 0;
  let positionCount = 0;
  const sized: { lexeme: string; positions: string[]; bytes: number }[] = [];
  for (const [lexeme, positions] of entries) {
    const bytes = utf8Bytes(lexeme) + LEXEME_OVERHEAD_BYTES;
    sized.push({ lexeme, positions, bytes });
    lexemeBytes += bytes;
    positionCount += positions.length;
  }
  const keepAllPositions =
    lexemeBytes + positionCount * POSITION_BYTES <= MAX_VECTOR_BYTES;
  const parts: string[] = [];
  let total = 0;
  let keptEveryLexeme = true;
  for (const { lexeme, positions, bytes } of sized) {
    // Positions are in field order, so this keeps each field's first one.
    const kept = keepAllPositions
      ? positions
      : positions.filter(
          (entry, index) =>
            index === 0 || entry.at(-1) !== positions[index - 1]!.at(-1),
        );
    total += bytes + kept.length * POSITION_BYTES;
    if (total > MAX_VECTOR_BYTES) {
      keptEveryLexeme = false;
      break;
    }
    parts.push(`${quoteLexeme(lexeme)}:${kept.join(",")}`);
  }
  return {
    literal: parts.join(" "),
    positionsComplete: positionsComplete && keepAllPositions && keptEveryLexeme,
  };
}

export interface QueryPhraseOptions {
  /** Treat the last lexeme as a prefix. */
  prefix?: boolean;
  /** Restrict every lexeme to these weights. */
  weights?: string;
  /**
   * Match the lexemes anywhere, in any order, instead of as a phrase. For
   * documents whose positions aren't complete.
   */
  anyOrder?: boolean;
}

/**
 * One term as a `tsquery` literal: a single lexeme, or a phrase of adjacent
 * lexemes. Returns null when the term has nothing to match.
 */
export function termTsquery(
  text: string,
  options: QueryPhraseOptions = {},
): string | null {
  const lexemes = queryLexemes(text);
  if (!lexemes.length) return null;
  const weights = options.weights ?? "";
  const parts = lexemes.map((lexeme, index) => {
    const prefix = options.prefix && index === lexemes.length - 1 ? "*" : "";
    const flags = prefix + weights;
    return flags ? `${quoteLexeme(lexeme)}:${flags}` : quoteLexeme(lexeme);
  });
  return options.anyOrder
    ? [...new Set(parts)].join(" & ")
    : parts.join(" <-> ");
}

/** Whether a term is more than one lexeme, so it matches as a phrase. */
export function isPhraseTerm(text: string): boolean {
  return queryLexemes(text).length > 1;
}

export function anyOfTsquery(parts: readonly (string | null)[]): string | null {
  const present = parts.filter((part): part is string => !!part);
  if (!present.length) return null;
  return present.length === 1
    ? present[0]!
    : present.map((part) => `(${part})`).join(" | ");
}
