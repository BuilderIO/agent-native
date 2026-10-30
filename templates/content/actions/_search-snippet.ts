import { stripMarkdownForPreview } from "../shared/og-description.js";

/**
 * How much of the stored page search reads on each side of a body match. The
 * page is stored with its markup, so this is more than the snippet shows.
 */
export const SNIPPET_WINDOW_CONTEXT = 400;

/** How much text a snippet keeps on each side of the match. */
const SNIPPET_RADIUS = 120;

/** The rest of a tag the window starts inside: a tag name or attributes. */
const LEADING_TAG_REST = /^(?:\/?[\w-]*|[^<>\n]*["=][^<>\n]*)\/?>/;

/**
 * Where a match at `matchOffset` in the stored window falls in its text: the
 * length of the text before it. A tag or link target the match sits inside
 * counts as nothing, since the text doesn't show it.
 */
function textOffset(
  window: string,
  matchOffset: number,
  clippedStart: boolean,
): number {
  let before = Array.from(window).slice(0, matchOffset).join("");
  if (clippedStart) before = before.replace(LEADING_TAG_REST, "");
  before = before
    .replace(/<[^>\n]*$/, "")
    .replace(/\[([^\]\n]*)\]\([^)\n]*$/, "$1");
  const text = stripMarkdownForPreview(before);
  return text ? text.length + 1 : 0;
}

/**
 * A search result's snippet: the page's text around the match, without markup,
 * cut at word breaks. `window` is a slice of the stored page; `clippedStart`
 * and `clippedEnd` say whether the page goes on before or after it, so a word
 * or tag it cuts through can be dropped. `matchOffset`, counted in characters
 * as `Array.from` counts them, is where the database found the match in
 * `window`; the snippet centres on it when the query isn't in the text, such
 * as a match in a link's address.
 */
export function searchSnippet(
  window: string,
  query: string,
  {
    clippedStart = false,
    clippedEnd = false,
    matchOffset,
  }: {
    clippedStart?: boolean;
    clippedEnd?: boolean;
    matchOffset?: number | undefined;
  } = {},
): string {
  let source = window;
  if (clippedStart) source = source.replace(LEADING_TAG_REST, "");
  // A tag the window ends inside.
  if (clippedEnd) source = source.replace(/<[^>\n]*$/, "");
  const text = stripMarkdownForPreview(source);
  if (!text) return "";

  const needle = query.replace(/\s+/g, " ").trim().toLowerCase();
  const index = needle ? text.toLowerCase().indexOf(needle) : -1;
  const anchor =
    index < 0 && matchOffset !== undefined
      ? Math.min(text.length, textOffset(window, matchOffset, clippedStart))
      : null;
  const matchStart = anchor ?? Math.max(0, index);
  const matchEnd = anchor ?? (index < 0 ? 0 : index + needle.length);
  let start = Math.max(0, matchStart - SNIPPET_RADIUS);
  // Without the match or where it was found, the window's first lines, with
  // room for a leading "..." inside the same budget.
  let end = Math.min(
    text.length,
    index < 0 && anchor === null
      ? 2 * SNIPPET_RADIUS - (clippedStart ? 3 : 0)
      : matchEnd + SNIPPET_RADIUS,
  );
  const cutBefore = start > 0 || clippedStart;
  const cutAfter = end < text.length || clippedEnd;
  // Drop a word the cut splits, but never the match.
  if (cutBefore) {
    const space = text.indexOf(" ", start);
    if (space >= 0 && space < matchStart) start = space + 1;
  }
  if (cutAfter && text[end] !== " ") {
    const space = text.lastIndexOf(" ", end);
    if (space >= matchEnd && space > start) end = space;
  }
  return `${cutBefore ? "..." : ""}${text.slice(start, end).trim()}${
    cutAfter ? "..." : ""
  }`;
}
