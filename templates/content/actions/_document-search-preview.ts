import { and, inArray, sql, type SQL } from "drizzle-orm";

import type { getDb } from "../server/db/index.js";
import { schema } from "../server/db/index.js";
import { endsInHtmlComment } from "../shared/og-description.js";
import { SNIPPET_WINDOW_CONTEXT, searchSnippet } from "./_search-snippet.js";

/** How much of the page before a match window search reads for a comment. */
const COMMENT_SCAN_CHARS = 20_000;
const MAX_WINDOW_CHARS = 5_000;
/** How close a query's words must be for a passage to count as having them. */
const NEARBY_CHARS = 240;
/** Longest phrase matched flexibly, within what a regular expression can hold. */
const MAX_FLEXIBLE_PHRASE_CHARS = 1_000;

export interface DocumentSearchPreview {
  snippet: string;
  /** In characters, the way `Array.from` counts them. */
  contentLength: number;
}

interface FoundMatch {
  position: number;
  needle: string;
}

function lowerKeepingOffsets(text: string): string {
  const lowered = text.toLowerCase();
  if (lowered.length === text.length) return lowered;
  // A few characters grow in lower case ("İ" becomes "i" and a dot above).
  // Those keep only the letter, as the database's lower case does, so a
  // position in the lowered text is still one in the page.
  return text.replace(/./gsu, (character) => {
    const lower = character.toLowerCase();
    if (lower.length === character.length) return lower;
    const code = lower.codePointAt(0);
    const letter = code === undefined ? "" : String.fromCodePoint(code);
    return letter.length === character.length ? letter : character;
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

/** Whether `at` starts a word, splitting words as the search index does. */
function startsWord(text: string, at: number): boolean {
  return !/[\p{L}\p{N}\p{M}]$/u.test(text.slice(Math.max(0, at - 2), at));
}

function occurrencesOf(lowered: string, needle: string): number[] {
  const positions: number[] = [];
  if (/\s/.test(needle) && needle.length <= MAX_FLEXIBLE_PHRASE_CHARS) {
    // Words in a phrase may be split across lines or by several spaces.
    const pattern = escapeRegExp(needle).replace(/\s+/g, "\\s+");
    for (const match of lowered.matchAll(new RegExp(pattern, "g"))) {
      positions.push(match.index);
    }
  } else {
    for (
      let at = lowered.indexOf(needle);
      at >= 0;
      at = lowered.indexOf(needle, at + needle.length)
    ) {
      positions.push(at);
    }
  }
  // The index finds body words from their start, so a match there is why the
  // page was found. One inside a word ("cat" in "concatenate") counts only
  // when there's no other, as for a page found by its title.
  const wordStarts = positions.filter((at) => startsWord(lowered, at));
  return wordStarts.length ? wordStarts : positions;
}

/**
 * Where a page best shows the query: the start of the earliest passage with the
 * most of its words close together.
 */
export function findSearchMatch(
  body: string,
  needles: readonly string[],
): FoundMatch | null {
  const lowered = lowerKeepingOffsets(body);
  const hits = needles.flatMap((needle, order) =>
    occurrencesOf(lowered, lowerKeepingOffsets(needle)).map((position) => ({
      position,
      order,
    })),
  );
  if (!hits.length) return null;
  hits.sort((a, b) => a.position - b.position || a.order - b.order);

  const inPassage = new Array<number>(needles.length).fill(0);
  let distinct = 0;
  let mostDistinct = 0;
  let best: (typeof hits)[number] | undefined;
  // The passage's oldest hit, which trails the current one through `hits`.
  const passageStart = hits.values();
  let oldest = passageStart.next();
  for (const hit of hits) {
    const seen = inPassage[hit.order] ?? 0;
    inPassage[hit.order] = seen + 1;
    if (seen === 0) distinct += 1;
    while (
      !oldest.done &&
      hit.position - oldest.value.position > NEARBY_CHARS
    ) {
      const left = (inPassage[oldest.value.order] ?? 1) - 1;
      inPassage[oldest.value.order] = left;
      if (left === 0) distinct -= 1;
      oldest = passageStart.next();
    }
    if (distinct > mostDistinct && !oldest.done) {
      mostDistinct = distinct;
      best = oldest.value;
      if (distinct === needles.length) break;
    }
  }
  const needle = best && needles[best.order];
  return best && needle !== undefined
    ? { position: best.position, needle }
    : null;
}

/**
 * Whether text starting at `start` is inside an HTML comment. The nearest marker
 * before it has to open one, and may still be code, which takes Markdown to
 * tell. A marker too far back to read counts as one.
 */
function startsInComment(body: string, start: number): boolean {
  const open = start >= 4 ? body.lastIndexOf("<!--", start - 4) : -1;
  if (open < 0 || open < body.lastIndexOf("-->", Math.max(0, start - 3))) {
    return false;
  }
  const before = body.slice(Math.max(0, start - COMMENT_SCAN_CHARS), start);
  return !before.includes("<!--") || endsInHtmlComment(before);
}

function characterCount(text: string): number {
  let count = text.length;
  for (let index = 0; index < text.length - 1; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0xd800 || unit > 0xdbff) continue;
    const next = text.charCodeAt(index + 1);
    if (next >= 0xdc00 && next <= 0xdfff) count -= 1;
  }
  return count;
}

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/** The offset `count` characters before `offset`, or the top of the text. */
function charactersBefore(text: string, offset: number, count: number) {
  let at = offset;
  for (let left = count; left > 0 && at > 0; left -= 1) {
    at -= 1;
    if (
      at > 0 &&
      isLowSurrogate(text.charCodeAt(at)) &&
      isHighSurrogate(text.charCodeAt(at - 1))
    ) {
      at -= 1;
    }
  }
  return at;
}

/** The offset `count` characters after `offset`, or the end of the text. */
function charactersAfter(text: string, offset: number, count: number) {
  let at = offset;
  for (let left = count; left > 0 && at < text.length; left -= 1) {
    at +=
      isHighSurrogate(text.charCodeAt(at)) &&
      isLowSurrogate(text.charCodeAt(at + 1))
        ? 2
        : 1;
  }
  return at;
}

/**
 * `contentLength` is the whole page's when `body` is only its top (at least
 * `MAX_WINDOW_CHARS` of it), which is all a preview without words shows.
 */
export function documentSearchPreview(
  body: string,
  needles: readonly string[],
  contentLength = characterCount(body),
): DocumentSearchPreview {
  const match = needles.length ? findSearchMatch(body, needles) : null;
  if (!match) {
    const end = charactersAfter(body, 0, MAX_WINDOW_CHARS);
    return {
      snippet: searchSnippet(body.slice(0, end), "", {
        clippedEnd: characterCount(body.slice(0, end)) < contentLength,
      }),
      contentLength,
    };
  }
  // Window sizes count characters, not UTF-16 units, as the database did.
  const start = charactersBefore(body, match.position, SNIPPET_WINDOW_CONTEXT);
  const end = charactersAfter(
    body,
    start,
    Math.min(
      MAX_WINDOW_CHARS,
      2 * SNIPPET_WINDOW_CONTEXT + characterCount(match.needle),
    ),
  );
  return {
    snippet: searchSnippet(body.slice(start, end), match.needle, {
      clippedStart: start > 0,
      clippedEnd: end < body.length,
      startsInComment: startsInComment(body, start),
      matchOffset: characterCount(body.slice(start, match.position)),
    }),
    contentLength,
  };
}

/**
 * Snippets for a page of results, by document id. Each result's body is read
 * once and searched here, where a database would decompress it again for every
 * mention in its query and compare text more slowly. A page of results then
 * costs one pass over each body, whatever its size, and the database stays out
 * of it after handing the bodies over. Without words to find, a preview is the
 * top of the page, so only that much of each is read.
 */
export async function loadDocumentSearchPreviews({
  db,
  where,
  ids,
  needles,
}: {
  db: ReturnType<typeof getDb>;
  where: SQL | undefined;
  ids: string[];
  needles: string[];
}): Promise<Map<string, DocumentSearchPreview>> {
  if (!ids.length) return new Map();
  const content = sql<string>`coalesce(${schema.documents.content}, '')`;
  const topOnly = needles.length === 0;
  // guard:allow-unscoped — `where` is search-documents' access filter for this caller, and `ids` are rows it already returned.
  const rows: Array<{ id: string; body: string; length: number | null }> =
    await db
      .select({
        id: schema.documents.id,
        body: topOnly
          ? sql<string>`left(${content}, ${MAX_WINDOW_CHARS})`
          : content,
        length: topOnly
          ? sql<number>`char_length(${content})`
          : sql<null>`null`,
      })
      .from(schema.documents)
      .where(and(where, inArray(schema.documents.id, ids)));
  return new Map(
    rows.map((row) => [
      row.id,
      documentSearchPreview(row.body, needles, row.length ?? undefined),
    ]),
  );
}
