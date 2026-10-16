import DiffMatchPatch from "diff-match-patch";

import { nfmToDoc, type PMNode } from "./nfm";

const CONTEXT_LEN = 32;

export type CommentQuoteAnchor = {
  quotedText: string;
  prefix: string | null;
  suffix: string | null;
  startOffset: number | null;
};

/**
 * The text comment anchors are captured from and resolved against: every text
 * node joined with no separator, as `buildDocText` reads the editor document.
 * Markdown syntax, list markers, and line breaks are not part of it.
 */
function editorText(markdown: string) {
  let text = "";
  const walk = (node: PMNode) => {
    if (typeof node.text === "string") text += node.text;
    node.content?.forEach(walk);
  };
  walk(nfmToDoc(markdown));
  return text;
}

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
 * Where the comment's own copy of its quote starts, scored as the editor's
 * `resolveAnchor` scores it. Null when two copies fit equally well, where the
 * editor would fall back to the first.
 */
function ownOccurrence(quote: CommentQuoteAnchor, text: string) {
  const { quotedText } = quote;
  const found: { at: number; score: number }[] = [];
  for (
    let at = text.indexOf(quotedText);
    at >= 0;
    at = text.indexOf(quotedText, at + quotedText.length)
  ) {
    const end = at + quotedText.length;
    let score =
      commonSuffixLength(
        text.slice(Math.max(0, at - CONTEXT_LEN), at),
        quote.prefix ?? "",
      ) +
      commonPrefixLength(
        text.slice(end, end + CONTEXT_LEN),
        quote.suffix ?? "",
      );
    if (quote.startOffset != null)
      score -= Math.min(CONTEXT_LEN, Math.abs(at - quote.startOffset) / 8);
    found.push({ at, score });
  }
  if (found.length < 2) return found[0]?.at ?? null;
  found.sort((left, right) => right.score - left.score);
  return found[0]!.score === found[1]!.score ? null : found[0]!.at;
}

/**
 * The quote a comment should anchor to after an accepted edit rewrote the text
 * it quoted, given the page's Markdown before and after. Returns null when the
 * edit did not cut into the comment's own copy of the quote, or when that copy
 * is ambiguous.
 */
export function reanchoredCommentQuote(
  quote: CommentQuoteAnchor,
  beforeMarkdown: string,
  afterMarkdown: string,
): CommentQuoteAnchor | null {
  const { quotedText } = quote;
  if (!quotedText) return null;
  const before = editorText(beforeMarkdown);
  const after = editorText(afterMarkdown);
  if (before === after) return null;
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
  const at = ownOccurrence(quote, before);
  const quoteEnd = at == null ? 0 : at + quotedText.length;
  // A quote that only touches the edit is still intact.
  if (at == null || !(at < to && quoteEnd > from)) return null;
  const start = Math.min(at, from);
  const end = Math.max(quoteEnd, to) + after.length - before.length;
  const next = after.slice(start, end);
  if (!next.trim()) return null;
  return {
    quotedText: next,
    prefix: after.slice(Math.max(0, start - CONTEXT_LEN), start),
    suffix: after.slice(end, end + CONTEXT_LEN),
    startOffset: start,
  };
}

/** The text comment anchors in a page with this Markdown are resolved against. */
export function commentAnchorText(markdown: string) {
  return editorText(markdown);
}

export type CommentQuoteRebaseline =
  /** The quote resolves on the new text as it did. */
  | { kind: "unchanged" }
  | { kind: "rebased"; quote: CommentQuoteAnchor }
  /** The quote didn't resolve to one place before either; left as is. */
  | { kind: "orphaned" }
  /**
   * The quote's text would change into different words, so the new text
   * can't be claimed as the same target. Convert the page only once this is
   * resolved.
   */
  | { kind: "blocked" };

const words = (text: string) => text.replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Moves a comment's quote from the text a page showed to the text the same
 * page shows after its body was rewritten into an equivalent form, where only
 * formatting syntax may differ. The quote follows the diff between the two
 * texts, and must keep every letter and digit it had.
 */
export function rebaselinedCommentQuote(
  quote: CommentQuoteAnchor,
  previousText: string,
  nextText: string,
): CommentQuoteRebaseline {
  if (!quote.quotedText) return { kind: "unchanged" };
  if (previousText === nextText) return { kind: "unchanged" };
  const at = ownOccurrence(quote, previousText);
  if (at == null)
    return nextText.includes(quote.quotedText)
      ? { kind: "unchanged" }
      : { kind: "orphaned" };
  const diffs = new DiffMatchPatch().diff_main(previousText, nextText);
  const dmp = new DiffMatchPatch();
  const from = dmp.diff_xIndex(diffs, at);
  const to = dmp.diff_xIndex(diffs, at + quote.quotedText.length);
  const quotedText = nextText.slice(from, to);
  if (!quotedText.trim() || words(quotedText) !== words(quote.quotedText))
    return { kind: "blocked" };
  const next = {
    quotedText,
    prefix: nextText.slice(Math.max(0, from - CONTEXT_LEN), from),
    suffix: nextText.slice(to, to + CONTEXT_LEN),
    startOffset: from,
  };
  return next.quotedText === quote.quotedText &&
    next.prefix === quote.prefix &&
    next.suffix === quote.suffix &&
    next.startOffset === quote.startOffset
    ? { kind: "unchanged" }
    : { kind: "rebased", quote: next };
}
