import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/**
 * Robust text anchor for a comment thread, modeled on the W3C Web Annotation
 * TextQuoteSelector + TextPositionSelector. We store the exact quoted text plus
 * a little surrounding context and the approximate text offset, so the comment
 * can be re-located in the live document even after edits — and disambiguated
 * when the same text appears more than once. Nothing here is written into the
 * document content: anchors live in SQL and drive a decoration overlay, so the
 * markdown / NFM / Notion round-trip is untouched.
 */
export interface CommentTextAnchor {
  /** The exact text that was selected when the comment was created. */
  quotedText: string;
  /** Up to CONTEXT_LEN chars of document text immediately before the quote. */
  prefix: string;
  /** Up to CONTEXT_LEN chars of document text immediately after the quote. */
  suffix: string;
  /** Plain-text offset of the quote start within the document's text space. */
  startOffset: number;
}

/** How much surrounding context to capture / compare on each side. */
const CONTEXT_LEN = 32;

interface TextSegment {
  /** Offset of this text node's first char within the concatenated doc text. */
  textStart: number;
  /** ProseMirror position of this text node's first char. */
  pmFrom: number;
  /** Length of this text node's text. */
  length: number;
}

interface DocText {
  text: string;
  segments: TextSegment[];
}

/**
 * Flatten all text in the document into a single separator-free string, in
 * document order, while recording a map back to ProseMirror positions. Anchor
 * capture and resolution both operate in this same offset space so they stay
 * perfectly consistent (a quote captured here is found here).
 */
export function buildDocText(doc: ProseMirrorNode): DocText {
  let text = "";
  const segments: TextSegment[] = [];
  doc.descendants((node, pos) => {
    if (node.isText && typeof node.text === "string" && node.text.length > 0) {
      segments.push({
        textStart: text.length,
        pmFrom: pos,
        length: node.text.length,
      });
      text += node.text;
    }
    return true;
  });
  return { text, segments };
}

/** Map a text-space offset to a ProseMirror document position. */
function offsetToPos(docText: DocText, offset: number): number | null {
  const { segments } = docText;
  if (segments.length === 0) return null;
  for (const seg of segments) {
    if (offset >= seg.textStart && offset <= seg.textStart + seg.length) {
      return seg.pmFrom + (offset - seg.textStart);
    }
  }
  // Past the end — clamp to the last text node's end.
  const last = segments[segments.length - 1];
  return last.pmFrom + last.length;
}

/** Map a ProseMirror position to a text-space offset (best-effort). */
function posToOffset(docText: DocText, pos: number): number {
  let best = 0;
  for (const seg of docText.segments) {
    if (pos >= seg.pmFrom && pos <= seg.pmFrom + seg.length) {
      return seg.textStart + (pos - seg.pmFrom);
    }
    if (pos > seg.pmFrom) best = seg.textStart + seg.length;
  }
  return best;
}

/** Capture a robust anchor for the current selection range [from, to). */
export function captureAnchor(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): CommentTextAnchor {
  const docText = buildDocText(doc);
  const startOffset = posToOffset(docText, from);
  const endOffset = Math.max(startOffset, posToOffset(docText, to));
  return {
    quotedText: docText.text.slice(startOffset, endOffset),
    prefix: docText.text.slice(
      Math.max(0, startOffset - CONTEXT_LEN),
      startOffset,
    ),
    suffix: docText.text.slice(endOffset, endOffset + CONTEXT_LEN),
    startOffset,
  };
}

export interface ResolvedRange {
  from: number;
  to: number;
}

/** Length of the longest common suffix of `a` and `b`. */
function commonSuffixLen(a: string, b: string): number {
  let i = 0;
  while (
    i < a.length &&
    i < b.length &&
    a[a.length - 1 - i] === b[b.length - 1 - i]
  ) {
    i++;
  }
  return i;
}

/** Length of the longest common prefix of `a` and `b`. */
function commonPrefixLen(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Resolve an anchor against the current document, returning a ProseMirror range
 * — or null when the quoted text can no longer be found (an "orphaned" comment).
 *
 * When the quote occurs more than once we score each occurrence by how well its
 * surrounding text matches the stored prefix/suffix and how close it is to the
 * original offset, then take the best. Quote-only anchors (legacy rows, media
 * placeholders) simply fall back to the first occurrence.
 */
export function resolveAnchor(
  doc: ProseMirrorNode,
  anchor: {
    quotedText: string | null;
    prefix?: string;
    suffix?: string;
    startOffset?: number;
  },
): ResolvedRange | null {
  const quote = anchor.quotedText;
  if (!quote) return null;

  const docText = buildDocText(doc);
  const hay = docText.text;
  if (!hay.includes(quote)) return null;

  const occurrences: number[] = [];
  let idx = hay.indexOf(quote);
  while (idx !== -1) {
    occurrences.push(idx);
    idx = hay.indexOf(quote, idx + Math.max(1, quote.length));
    if (occurrences.length > 500) break; // safety valve for tiny quotes
  }

  let chosen = occurrences[0];
  if (occurrences.length > 1) {
    const prefix = anchor.prefix ?? "";
    const suffix = anchor.suffix ?? "";
    const target =
      typeof anchor.startOffset === "number" ? anchor.startOffset : null;
    let bestScore = -Infinity;
    for (const start of occurrences) {
      const before = hay.slice(Math.max(0, start - CONTEXT_LEN), start);
      const after = hay.slice(
        start + quote.length,
        start + quote.length + CONTEXT_LEN,
      );
      let score =
        commonSuffixLen(before, prefix) + commonPrefixLen(after, suffix);
      if (target != null) {
        // Tie-break toward the occurrence nearest the original offset.
        score -= Math.min(CONTEXT_LEN, Math.abs(start - target) / 8);
      }
      if (score > bestScore) {
        bestScore = score;
        chosen = start;
      }
    }
  }

  const from = offsetToPos(docText, chosen);
  const to = offsetToPos(docText, chosen + quote.length);
  if (from == null || to == null || to <= from) return null;
  return { from, to };
}
