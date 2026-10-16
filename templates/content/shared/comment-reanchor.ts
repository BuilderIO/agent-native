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
  const dmp = new DiffMatchPatch();
  const { from, to } = mappedRange(
    dmp,
    dmp.diff_main(previousText, nextText),
    at,
    quote.quotedText.length,
  );
  const quotedText = nextText.slice(from, to);
  if (!quotedText.trim() || words(quotedText) !== words(quote.quotedText))
    return { kind: "blocked" };
  const next = anchorAt(nextText, from, to);
  return sameAnchor(next, quote)
    ? { kind: "unchanged" }
    : { kind: "rebased", quote: next };
}

type Diffs = ReturnType<DiffMatchPatch["diff_main"]>;

// Where [from, from + length) of the old text lands in the new one. The end
// follows the quote's last character, so text typed just after a quote stays
// outside it, as text typed just before it does.
function mappedRange(
  dmp: DiffMatchPatch,
  diffs: Diffs,
  from: number,
  length: number,
) {
  const start = dmp.diff_xIndex(diffs, from);
  return {
    from: start,
    to: length ? dmp.diff_xIndex(diffs, from + length - 1) + 1 : start,
  };
}

function anchorAt(text: string, from: number, to: number): CommentQuoteAnchor {
  return {
    quotedText: text.slice(from, to),
    prefix: text.slice(Math.max(0, from - CONTEXT_LEN), from),
    suffix: text.slice(to, to + CONTEXT_LEN),
    startOffset: from,
  };
}

function sameAnchor(left: CommentQuoteAnchor, right: CommentQuoteAnchor) {
  return (
    left.quotedText === right.quotedText &&
    left.prefix === right.prefix &&
    left.suffix === right.suffix &&
    left.startOffset === right.startOffset
  );
}

/**
 * Whether a quote's stored context is exactly the text around its offset in
 * `text`, as `commentQuoteFollower` leaves the quotes it moves.
 */
export function commentAnchorHoldsOn(quote: CommentQuoteAnchor, text: string) {
  if (!quote.quotedText || quote.startOffset == null) return false;
  const { startOffset } = quote;
  return sameAnchor(
    anchorAt(text, startOffset, startOffset + quote.quotedText.length),
    quote,
  );
}

export type CommentQuoteFollow =
  | { kind: "unchanged" }
  /** The quote's text is intact; its context or position moved. */
  | { kind: "moved"; quote: CommentQuoteAnchor }
  /**
   * The edit changed the quote's own text, or the quote didn't resolve to
   * one place before it. The stored anchor stays: only an accepted
   * suggestion re-anchors a quote.
   */
  | { kind: "left" };

/**
 * Follows comment quotes through one edit of a page, from `previousText` to
 * `nextText`, both `commentAnchorText` of the page's body. The stored context
 * then resolves to the same copy of a quote the editor's highlight is on,
 * even where the quoted words appear more than once.
 */
export function commentQuoteFollower(previousText: string, nextText: string) {
  const dmp = new DiffMatchPatch();
  // This runs on every commit of a page: a large rewrite settles for a
  // coarser diff, which can only leave more quotes where they were.
  dmp.Diff_Timeout = 0.1;
  let diffs: Diffs | undefined;
  return (quote: CommentQuoteAnchor): CommentQuoteFollow => {
    if (!quote.quotedText || previousText === nextText)
      return { kind: "unchanged" };
    const at = ownOccurrence(quote, previousText);
    if (at == null) return { kind: "left" };
    diffs ??= dmp.diff_main(previousText, nextText);
    const { from, to } = mappedRange(dmp, diffs, at, quote.quotedText.length);
    if (nextText.slice(from, to) !== quote.quotedText) return { kind: "left" };
    const next = anchorAt(nextText, from, to);
    return sameAnchor(next, quote)
      ? { kind: "unchanged" }
      : { kind: "moved", quote: next };
  };
}
