// Markdown syntax makes source offsets differ from the editor text that
// comment anchors are matched against, so such ranges are left alone.
const SOURCE_SYNTAX = /[\\*_`~[\]<>#|\n]/;
const CONTEXT_LEN = 32;

export type CommentQuoteAnchor = {
  quotedText: string;
  prefix: string | null;
  suffix: string | null;
  startOffset: number | null;
};

function commonSuffixLength(left: string, right: string) {
  let length = 0;
  while (
    length < left.length &&
    length < right.length &&
    left[left.length - 1 - length] === right[right.length - 1 - length]
  )
    length += 1;
  return length;
}

function commonPrefixLength(left: string, right: string) {
  let length = 0;
  while (
    length < left.length &&
    length < right.length &&
    left[length] === right[length]
  )
    length += 1;
  return length;
}

/**
 * Where the comment's own copy of its quote starts in the Markdown, scored the
 * way the editor resolves the anchor. Anchors are captured from editor text,
 * which joins blocks with no separator, so line breaks are dropped from the
 * context first. Null when two copies fit equally well, or when Markdown syntax
 * beside a copy keeps its context from being compared with editor text.
 */
function ownOccurrence(quote: CommentQuoteAnchor, text: string) {
  const { quotedText } = quote;
  const found: { at: number; score: number }[] = [];
  let syntax = 0;
  let counted = 0;
  let marked = false;
  for (
    let at = text.indexOf(quotedText);
    at >= 0;
    at = text.indexOf(quotedText, at + 1)
  ) {
    for (; counted < at; counted += 1)
      if (SOURCE_SYNTAX.test(text[counted]!)) syntax += 1;
    const end = at + quotedText.length;
    const lead = text
      .slice(Math.max(0, at - CONTEXT_LEN * 2), at)
      .replace(/\n/g, "")
      .slice(-CONTEXT_LEN);
    const tail = text
      .slice(end, end + CONTEXT_LEN * 2)
      .replace(/\n/g, "")
      .slice(0, CONTEXT_LEN);
    marked ||= SOURCE_SYNTAX.test(lead) || SOURCE_SYNTAX.test(tail);
    let score =
      commonSuffixLength(lead, quote.prefix ?? "") +
      commonPrefixLength(tail, quote.suffix ?? "");
    if (quote.startOffset != null)
      score -= Math.min(
        CONTEXT_LEN,
        Math.abs(at - syntax - quote.startOffset) / 8,
      );
    found.push({ at, score });
  }
  if (found.length < 2) return found[0]?.at ?? null;
  if (marked) return null;
  found.sort((left, right) => right.score - left.score);
  return found[0]!.score === found[1]!.score ? null : found[0]!.at;
}

/**
 * The quote a comment should anchor to after an accepted edit rewrote the text
 * it quoted. Returns null when the edit did not cut into the comment's own
 * copy of the quote, when that copy is ambiguous, or when the new text cannot
 * be expressed as an editor-text quote.
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
  const at = ownOccurrence(quote, before);
  const quoteEnd = at == null ? 0 : at + quotedText.length;
  // A quote that only touches the edit is still intact.
  if (at == null || !(at < to && quoteEnd > from)) return null;
  const start = Math.min(at, from);
  const end = Math.max(quoteEnd, to);
  const next = before.slice(start, from) + inserted + before.slice(to, end);
  if (!next.trim() || SOURCE_SYNTAX.test(next)) return null;
  const sourcePrefix = after.slice(Math.max(0, start - CONTEXT_LEN), start);
  const nextEnd = start + next.length;
  const sourceSuffix = after.slice(nextEnd, nextEnd + CONTEXT_LEN);
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
    startOffset:
      start === at || quote.startOffset == null
        ? quote.startOffset
        : SOURCE_SYNTAX.test(before.slice(start, at))
          ? null
          : quote.startOffset - (at - start),
  };
}
