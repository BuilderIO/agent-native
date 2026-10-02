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
 * - A word longer than Postgres's 2,046-byte limit keeps its longest prefix
 *   that fits.
 * - Chinese, Japanese, and Korean runs become overlapping character pairs,
 *   because they have no spaces to split on. A query becomes the same pairs
 *   as a phrase, which matches exactly that substring. A run's last character
 *   starts no pair, so it is also indexed alone, and a one-character query
 *   finds every character as a prefix.
 */

const WORD = /[\p{L}\p{N}\p{M}]+/gu;
const CJK =
  /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}]/u;
const UPPERCASE = /\p{Lu}/u;
const CAMEL_LOWER_UPPER = /([\p{Ll}\p{N}])(\p{Lu})/gu;
const CAMEL_ACRONYM = /(\p{Lu})(\p{Lu}\p{Ll})/gu;

/** Postgres limits, from tsvector.h. */
const MAX_POSITION = 16_383;
const MAX_POSITIONS_PER_LEXEME = 255;
const MAX_LEXEME_BYTES = 2_046;
/**
 * Postgres evaluates a phrase recursively, one level per word, and a phrase
 * of about 10,000 words exhausts the stack: native Postgres errors and PGlite
 * silently returns no rows. `termTsquery` refuses a longer term.
 */
const MAX_QUERY_LEXEMES = 2_048;
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
  if (!CJK.test(word)) return [{ text: word, cjk: false }];
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
  if (!UPPERCASE.test(word)) return [word];
  return word
    .replace(CAMEL_LOWER_UPPER, "$1\u0000$2")
    .replace(CAMEL_ACRONYM, "$1\u0000$2")
    .split("\u0000")
    .filter(Boolean);
}

/** UTF-8 length without encoding: 1-3 bytes per UTF-16 unit, 4 per pair. */
export function utf8ByteLength(value: string): number {
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

/**
 * A word longer than Postgres allows keeps its longest prefix that fits, the
 * same in documents and queries, so it still matches and still holds its
 * place in a phrase.
 */
function fitLexeme(lexeme: string): string {
  if (lexeme.length * 3 <= MAX_LEXEME_BYTES) return lexeme;
  let bytes = 0;
  let end = 0;
  for (const char of lexeme) {
    bytes += utf8ByteLength(char);
    if (bytes > MAX_LEXEME_BYTES) break;
    end += char.length;
  }
  return lexeme.slice(0, end);
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
  const next = eachDocumentToken(text, start, (lexeme, position) => {
    tokens.push({ lexeme, position });
  });
  return { tokens, next };
}

/**
 * Calls `visit` with each document token, in order, without collecting
 * them: a large document has millions. Returns the next free position.
 */
function eachDocumentToken(
  text: string,
  start: number,
  visit: (lexeme: string, position: number) => void,
): number {
  let position = start;
  const push = (lexeme: string, at: number) => visit(fitLexeme(lexeme), at);
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
  return position;
}

interface QueryWord {
  lexeme: string;
  /** A camelCase word's parts; empty for any other word. */
  parts: string[];
}

function queryWords(text: string): QueryWord[] {
  const words: QueryWord[] = [];
  for (const match of text.normalize("NFKC").matchAll(WORD)) {
    for (const segment of segments(match[0])) {
      if (segment.cjk) {
        for (const pair of cjkPairs(segment.text)) {
          words.push({ lexeme: pair, parts: [] });
        }
        continue;
      }
      const parts = camelParts(segment.text);
      words.push({
        lexeme: fitLexeme(segment.text.toLowerCase()),
        parts:
          parts.length < 2
            ? []
            : parts.map((part) => fitLexeme(part.toLowerCase())),
      });
    }
  }
  return words;
}

/**
 * Query lexemes for one term, in order. Unlike documents, a query word is
 * never split on case: "camelCase" looks for the whole word, which documents
 * index alongside its parts.
 */
export function queryLexemes(text: string): string[] {
  return queryWords(text).map((word) => word.lexeme);
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

interface VectorPosition {
  position: number;
  weight: SearchWeight;
}

/** Whether this entry starts a run of one weight; entries are in field order. */
function startsWeightRun(list: readonly VectorPosition[], index: number) {
  return index === 0 || list[index]!.weight !== list[index - 1]!.weight;
}

/**
 * Adds a word's next position within Postgres's 255. The word's first
 * position in each field always stays, so it still counts as being in that
 * field. Returns false when a position had to be dropped.
 */
function addPosition(list: VectorPosition[], entry: VectorPosition): boolean {
  const previous = list[list.length - 1]!;
  if (previous.position === entry.position && previous.weight === entry.weight)
    return true;
  if (list.length < MAX_POSITIONS_PER_LEXEME) {
    list.push(entry);
    return true;
  }
  if (previous.weight === entry.weight) return false;
  for (let index = list.length - 1; index > 0; index -= 1) {
    if (!startsWeightRun(list, index)) {
      list.splice(index, 1);
      list.push(entry);
      return false;
    }
  }
  return false;
}

/**
 * A `tsvector` for the fields, in order, sharing one position space with a
 * gap between fields, so a phrase never spans two of them. Postgres keeps at
 * most 255 positions per word and none past 16,383. Past the last position,
 * each field's words collapse onto its own position, because Postgres merges
 * equal positions and keeps only the higher weight. A word over 255
 * positions keeps its first position in each field. A very large document
 * keeps one position per word in each field, and one with more distinct
 * words than fit keeps the words that come first, so the vector stays under
 * Postgres's size limit. Any of these makes `positionsComplete` false; each
 * keeps which fields hold each word.
 */
export function buildSearchVector(
  fields: readonly WeightedField[],
): SearchVector {
  const entries = new Map<string, VectorPosition[]>();
  let position = 1;
  let positionsComplete = true;
  // The smallest the vector can be: each word once. A word past the budget
  // can never be kept, so from then on new words aren't collected.
  let minimumBytes = 0;
  let full = false;
  fields.forEach((field, fieldIndex) => {
    if (!field.text) return;
    const ceiling = MAX_POSITION - (fields.length - 1 - fieldIndex);
    const next = eachDocumentToken(field.text, position, (lexeme, at) => {
      if (at > ceiling) positionsComplete = false;
      const entry = { position: Math.min(at, ceiling), weight: field.weight };
      const list = entries.get(lexeme);
      if (list) {
        if (!addPosition(list, entry)) positionsComplete = false;
        return;
      }
      const bytes =
        utf8ByteLength(lexeme) + LEXEME_OVERHEAD_BYTES + POSITION_BYTES;
      if (full || minimumBytes + bytes > MAX_VECTOR_BYTES) {
        full = true;
        return;
      }
      minimumBytes += bytes;
      entries.set(lexeme, [entry]);
    });
    if (next > position) position = next + 1;
  });
  let positionCount = 0;
  for (const positions of entries.values()) positionCount += positions.length;
  const keepAllPositions =
    minimumBytes + (positionCount - entries.size) * POSITION_BYTES <=
    MAX_VECTOR_BYTES;
  const parts: string[] = [];
  let total = 0;
  let keptEveryLexeme = !full;
  for (const [lexeme, positions] of entries) {
    const kept = keepAllPositions
      ? positions
      : positions.filter((_, index) => startsWeightRun(positions, index));
    total +=
      utf8ByteLength(lexeme) +
      LEXEME_OVERHEAD_BYTES +
      kept.length * POSITION_BYTES;
    if (total > MAX_VECTOR_BYTES) {
      keptEveryLexeme = false;
      break;
    }
    parts.push(
      `${quoteLexeme(lexeme)}:${kept
        .map((entry) => `${entry.position}${entry.weight}`)
        .join(",")}`,
    );
  }
  return {
    literal: parts.join(" "),
    positionsComplete: positionsComplete && keepAllPositions && keptEveryLexeme,
  };
}

/**
 * A term with more words than the index can match. The query can't be
 * answered from the index; the app's fallback search can answer it.
 */
export class SearchTermTooLongError extends RangeError {
  constructor() {
    super(`A search term can have at most ${MAX_QUERY_LEXEMES} words.`);
    this.name = "SearchTermTooLongError";
  }
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
 * lexemes. Returns null when the term has nothing to match. Throws
 * `SearchTermTooLongError` past `MAX_QUERY_LEXEMES`, which Postgres can't
 * evaluate.
 */
export function termTsquery(
  text: string,
  options: QueryPhraseOptions = {},
): string | null {
  const words = queryWords(text);
  if (!words.length) return null;
  const size = words.reduce((total, word) => total + 1 + word.parts.length, 0);
  if (size > MAX_QUERY_LEXEMES) throw new SearchTermTooLongError();
  const weights = options.weights ?? "";
  const operand = (lexeme: string, prefix: boolean) => {
    const flags = (prefix && options.prefix ? "*" : "") + weights;
    return flags ? `${quoteLexeme(lexeme)}:${flags}` : quoteLexeme(lexeme);
  };
  if (options.anyOrder) {
    return [
      ...new Set(
        words.map((word, index) =>
          operand(word.lexeme, index === words.length - 1),
        ),
      ),
    ].join(" & ");
  }
  if (words.length === 1) return operand(words[0]!.lexeme, true);
  // Inside a phrase a camelCase word is its whole lexeme or its parts: the
  // document holds the whole word only at its first and last part, so the
  // whole alone can't span the parts between its neighbors.
  return words
    .map((word, index) => {
      const last = index === words.length - 1;
      const whole = operand(word.lexeme, last);
      if (!word.parts.length) return whole;
      const parts = word.parts
        .map((part, partIndex) =>
          operand(part, last && partIndex === word.parts.length - 1),
        )
        .join(" <-> ");
      return `(${whole} | ${parts})`;
    })
    .join(" <-> ");
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
