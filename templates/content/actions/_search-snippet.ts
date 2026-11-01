import { stripMarkdownForPreview } from "../shared/og-description.js";

/**
 * How much of the stored page search reads on each side of a body match. The
 * page is stored with its markup, so this is more than the snippet shows.
 */
export const SNIPPET_WINDOW_CONTEXT = 400;

/** How much text a snippet keeps on each side of the match. */
const SNIPPET_RADIUS = 120;

/**
 * The rest of a tag the window starts inside: the end of a tag name, attribute
 * or quoted value, then whole `name="value"` attributes and `>`. Text such as
 * `Score = 5 > 3` doesn't have that shape.
 */
const LEADING_TAG_REST =
  /^(?:\/?[\w-]*(?:="[^"<>\n]*")?|"?[^"<>\n]*")(?:\s+[\w-]+="[^"<>\n]*")*\s*\/?>/;

/**
 * The start of a tag the text ends inside: `<`, `</`, or a tag name, whole
 * `name="value"` attributes and at most one cut short. A `<` followed by a
 * space, as in `a < b`, or by words that aren't attributes, is text.
 */
const TRAILING_TAG_START =
  /<(?:\/?[A-Za-z][\w-]*(?:\s+[\w-]+="[^"<>\n]*")*(?:\s+[\w-]*(?:="?[^"<>\n]*)?)?|\/)?$/;

/**
 * A Markdown link destination, allowing one level of balanced parentheses, as
 * in `https://en.wikipedia.org/wiki/Launch_(rocketry)`.
 */
const LINK_DESTINATION = String.raw`\((?:[^()\n]|\([^()\n]*\))*`;

/** A link whose destination the text ends inside. */
const TRAILING_LINK = new RegExp(
  String.raw`\[([^\]\n]*)\]${LINK_DESTINATION}(?:\([^()\n]*)?$`,
);

/**
 * The rest of an HTML comment the window starts inside, through its `-->`, or
 * the whole window when the comment doesn't close in it.
 */
const LEADING_COMMENT_REST = /^[\s\S]*?(?:-->|$)/;

/** Drops what the window starts inside: the rest of a comment, or of a tag. */
function withoutLeadingRest(
  source: string,
  clippedStart: boolean,
  startsInComment: boolean,
): string {
  if (startsInComment) return source.replace(LEADING_COMMENT_REST, "");
  return clippedStart ? source.replace(LEADING_TAG_REST, "") : source;
}

/** Where `needle` occurs in `text` nearest to `near`, or -1. */
function nearestIndex(text: string, needle: string, near: number): number {
  let best = -1;
  for (
    let at = text.indexOf(needle);
    at >= 0;
    at = text.indexOf(needle, at + 1)
  ) {
    if (best >= 0 && Math.abs(at - near) >= Math.abs(best - near)) break;
    best = at;
  }
  return best;
}

/**
 * Where a match at `matchOffset` in the stored window falls in its text: the
 * length of the text before it. A tag or link target the match sits inside
 * counts as nothing, since the text doesn't show it.
 */
function textOffset(
  window: string,
  matchOffset: number,
  clippedStart: boolean,
  startsInComment: boolean,
): number {
  let before = withoutLeadingRest(
    Array.from(window).slice(0, matchOffset).join(""),
    clippedStart,
    startsInComment,
  );
  before = before.replace(TRAILING_TAG_START, "").replace(TRAILING_LINK, "$1");
  const text = stripMarkdownForPreview(before);
  return text ? text.length + 1 : 0;
}

/**
 * A search result's snippet: the page's text around the match, without markup,
 * cut at word breaks. `window` is a slice of the stored page; `clippedStart`
 * and `clippedEnd` say whether the page goes on before or after it, so a word
 * or tag it cuts through can be dropped, and `startsInComment` says that it
 * starts inside an HTML comment, whose text the page doesn't show. `matchOffset`, counted in characters
 * as `Array.from` counts them, is where the database found the match in
 * `window`; the snippet centres on the query nearest to it, or on it when the
 * query isn't in the text, such as a match in a link's address.
 */
export function searchSnippet(
  window: string,
  query: string,
  {
    clippedStart = false,
    clippedEnd = false,
    startsInComment = false,
    matchOffset,
  }: {
    clippedStart?: boolean;
    clippedEnd?: boolean;
    startsInComment?: boolean;
    matchOffset?: number | undefined;
  } = {},
): string {
  let source = withoutLeadingRest(window, clippedStart, startsInComment);
  // A tag the window ends inside.
  if (clippedEnd) source = source.replace(TRAILING_TAG_START, "");
  const text = stripMarkdownForPreview(source);
  if (!text) return "";

  const needle = query.replace(/\s+/g, " ").trim().toLowerCase();
  // Where the database found the match, as a position in the text.
  const found =
    matchOffset === undefined
      ? null
      : Math.min(
          text.length,
          textOffset(window, matchOffset, clippedStart, startsInComment),
        );
  // The query where it appears closest to that, which may not be first.
  const index = needle
    ? nearestIndex(text.toLowerCase(), needle, found ?? 0)
    : -1;
  const anchor = index < 0 ? found : null;
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
