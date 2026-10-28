import type { PMNode } from "./nfm";

/** How much text on each side of a quote a comment keeps to find it again. */
export const COMMENT_QUOTE_CONTEXT_LENGTH = 32;

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
