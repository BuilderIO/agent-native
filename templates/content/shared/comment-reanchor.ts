// Markdown syntax makes source offsets differ from the editor text that
// comment anchors are matched against, so such ranges are left alone.
const SOURCE_SYNTAX = /[\\*_`~[\]<>#|\n]/;

export type CommentQuoteAnchor = {
  quotedText: string;
  prefix: string | null;
  suffix: string | null;
};

/**
 * The quote a comment should anchor to after an accepted edit rewrote the text
 * it quoted. Returns null when the edit did not cut into the quote, or when
 * the new text cannot be expressed as an editor-text quote.
 */
export function reanchoredCommentQuote(
  quote: CommentQuoteAnchor,
  before: string,
  after: string,
): CommentQuoteAnchor | null {
  const { quotedText } = quote;
  if (!quotedText || before === after) return null;
  let from = 0;
  while (from < before.length && before[from] === after[from]) from += 1;
  let common = 0;
  while (
    common < before.length - from &&
    common < after.length - from &&
    before[before.length - common - 1] === after[after.length - common - 1]
  )
    common += 1;
  const to = before.length - common;
  const inserted = after.slice(from, after.length - common);
  // A quote that only touches the edit is still intact.
  let at = before.indexOf(quotedText);
  while (at >= 0 && !(at < to && at + quotedText.length > from))
    at = before.indexOf(quotedText, at + 1);
  if (at < 0) return null;
  const quoteEnd = at + quotedText.length;
  const start = Math.min(at, from);
  const end = Math.max(quoteEnd, to);
  const next = before.slice(start, from) + inserted + before.slice(to, end);
  if (!next.trim() || SOURCE_SYNTAX.test(next)) return null;
  const sourcePrefix = after.slice(Math.max(0, start - 32), start);
  const nextEnd = start + next.length;
  const sourceSuffix = after.slice(nextEnd, nextEnd + 32);
  return {
    quotedText: next,
    prefix:
      start === at
        ? quote.prefix
        : SOURCE_SYNTAX.test(sourcePrefix)
          ? null
          : sourcePrefix,
    suffix:
      end === quoteEnd
        ? quote.suffix
        : SOURCE_SYNTAX.test(sourceSuffix)
          ? null
          : sourceSuffix,
  };
}
