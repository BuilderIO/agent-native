import type { PMNode } from "./nfm";

/** How much text on each side of a quote a comment keeps to find it again. */
export const COMMENT_QUOTE_CONTEXT_LENGTH = 32;

/**
 * How many characters of the text a comment kept beside its quote, both sides
 * together, a copy must still have beside it to be the comment's own, or all
 * of that text where the comment kept less, as on a short page. That is more
 * than the space and short word on each side other text often shares with it,
 * and less than one side of the quote, so a quote whose text on one side was
 * rewritten can still be found by the other.
 */
const OWN_CONTEXT_LENGTH = 12;

/**
 * Whether a copy of a quote can be the comment's own, given how many
 * characters of the text the comment kept before and after its quote still
 * sit beside that copy. The same words elsewhere on the page, with other text
 * around them, are other text: a comment whose own copy was deleted stays
 * without a highlight rather than moving onto them. A comment that kept no
 * text beside its quote can't tell its copy from another, so any copy can be
 * its own.
 */
export function keepsQuoteContext(
  anchor: {
    prefix?: string | null | undefined;
    suffix?: string | null | undefined;
  },
  matched: { prefix: number; suffix: number },
): boolean {
  const kept = (anchor.prefix ?? "").length + (anchor.suffix ?? "").length;
  return matched.prefix + matched.suffix >= Math.min(kept, OWN_CONTEXT_LENGTH);
}

/** Every text run in order with nothing between blocks, as the editor counts. */
const anchorText = (node: PMNode): string =>
  node.text ?? node.content?.map(anchorText).join("") ?? "";

/**
 * Where a quote sits in a saved page, as the editor anchors a selection: the
 * text on each side of its first copy, and that copy's offset. Null when the
 * page doesn't contain the quote.
 */
export function nfmQuoteAnchor(root: PMNode, quote: string) {
  const text = anchorText(root);
  const start = quote ? text.indexOf(quote) : -1;
  if (start < 0) return null;
  const end = start + quote.length;
  return {
    prefix: text.slice(
      Math.max(0, start - COMMENT_QUOTE_CONTEXT_LENGTH),
      start,
    ),
    suffix: text.slice(end, end + COMMENT_QUOTE_CONTEXT_LENGTH),
    startOffset: start,
  };
}
