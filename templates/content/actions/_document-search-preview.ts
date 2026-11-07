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
  // A few characters change length in lower case ("İ"). Those stay as they
  // are, so a position in the lowered text is still one in the page.
  return text.replace(/./gsu, (character) => {
    const lower = character.toLowerCase();
    return lower.length === character.length ? lower : character;
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function occurrencesOf(lowered: string, needle: string): number[] {
  const positions: number[] = [];
  if (/\s/.test(needle) && needle.length <= MAX_FLEXIBLE_PHRASE_CHARS) {
    // Words in a phrase may be split across lines or by several spaces.
    const pattern = escapeRegExp(needle).replace(/\s+/g, "\\s+");
    for (const match of lowered.matchAll(new RegExp(pattern, "g"))) {
      positions.push(match.index);
    }
    return positions;
  }
  for (
    let at = lowered.indexOf(needle);
    at >= 0;
    at = lowered.indexOf(needle, at + needle.length)
  ) {
    positions.push(at);
  }
  return positions;
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
    occurrencesOf(lowered, needle.toLowerCase()).map((position) => ({
      position,
      order,
    })),
  );
  if (!hits.length) return null;
  hits.sort((a, b) => a.position - b.position || a.order - b.order);

  const inPassage = new Array<number>(needles.length).fill(0);
  let distinct = 0;
  let mostDistinct = 0;
  let best = hits[0]!;
  let first = 0;
  for (const hit of hits) {
    if (inPassage[hit.order]!++ === 0) distinct += 1;
    while (hit.position - hits[first]!.position > NEARBY_CHARS) {
      if (--inPassage[hits[first]!.order]! === 0) distinct -= 1;
      first += 1;
    }
    if (distinct > mostDistinct) {
      mostDistinct = distinct;
      best = hits[first]!;
      if (distinct === needles.length) break;
    }
  }
  return { position: best.position, needle: needles[best.order]! };
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

/** Moves an offset off the second half of a character. */
function onCharacterStart(text: string, offset: number): number {
  const unit = text.charCodeAt(offset);
  return unit >= 0xdc00 && unit <= 0xdfff ? offset - 1 : offset;
}

export function documentSearchPreview(
  body: string,
  needles: readonly string[],
): DocumentSearchPreview {
  const contentLength = characterCount(body);
  const match = needles.length ? findSearchMatch(body, needles) : null;
  if (!match) {
    const end = onCharacterStart(body, MAX_WINDOW_CHARS);
    return {
      snippet: searchSnippet(body.slice(0, end), "", {
        clippedEnd: end < body.length,
      }),
      contentLength,
    };
  }
  const start = onCharacterStart(
    body,
    Math.max(0, match.position - SNIPPET_WINDOW_CONTEXT),
  );
  const end = onCharacterStart(
    body,
    start +
      Math.min(
        MAX_WINDOW_CHARS,
        2 * SNIPPET_WINDOW_CONTEXT + match.needle.length,
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
 * of it after handing the bodies over.
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
  const rows: Array<{ id: string; body: string }> = await db
    .select({
      id: schema.documents.id,
      body: sql<string>`coalesce(${schema.documents.content}, '')`,
    })
    .from(schema.documents)
    .where(and(where, inArray(schema.documents.id, ids)));
  return new Map(
    rows.map((row) => [row.id, documentSearchPreview(row.body, needles)]),
  );
}
