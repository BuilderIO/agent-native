import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface CommentTextAnchor {
  quotedText: string;
  prefix: string;
  suffix: string;
  startOffset: number;
}

const CONTEXT_LEN = 32;

interface TextSegment {
  textStart: number;
  pmFrom: number;
  length: number;
}

interface DocText {
  text: string;
  segments: TextSegment[];
}

export function buildDocText(
  doc: ProseMirrorNode,
  blockSeparator = "",
  hardBreakSeparator: "" | "\n" = "",
): DocText {
  let text = "";
  let hasTextblock = false;
  const segments: TextSegment[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (hasTextblock) text += blockSeparator;
      hasTextblock = true;
    }
    if (node.isText && typeof node.text === "string" && node.text.length > 0) {
      segments.push({
        textStart: text.length,
        pmFrom: pos,
        length: node.text.length,
      });
      text += node.text;
    }
    if (node.type.name === "hardBreak" && hardBreakSeparator) {
      segments.push({ textStart: text.length, pmFrom: pos, length: 1 });
      text += hardBreakSeparator;
    }
    return true;
  });
  return { text, segments };
}

function offsetToPos(docText: DocText, offset: number): number | null {
  const { segments } = docText;
  if (segments.length === 0) return null;
  for (const seg of segments) {
    if (offset >= seg.textStart && offset <= seg.textStart + seg.length) {
      return seg.pmFrom + (offset - seg.textStart);
    }
  }
  const last = segments[segments.length - 1];
  if (offset < last.textStart + last.length) return null;
  return last.pmFrom + last.length;
}

export function resolveAnchorPoint(
  doc: ProseMirrorNode,
  anchor: {
    prefix?: string;
    suffix?: string;
    startOffset?: number;
  },
  blockSeparator = "",
  hardBreakSeparator: "" | "\n" = "",
): number | null {
  const docText = buildDocText(doc, blockSeparator, hardBreakSeparator);
  const prefix = anchor.prefix ?? "";
  const suffix = anchor.suffix ?? "";
  if (!prefix && !suffix) return null;

  const candidates: number[] = [];
  for (let offset = 0; offset <= docText.text.length; offset += 1) {
    const beforeMatches =
      !prefix ||
      docText.text.slice(Math.max(0, offset - prefix.length), offset) ===
        prefix;
    const afterMatches =
      !suffix || docText.text.slice(offset, offset + suffix.length) === suffix;
    if (beforeMatches && afterMatches) candidates.push(offset);
  }
  if (candidates.length === 0) return null;

  let chosen = candidates[0]!;
  if (candidates.length > 1) {
    if (typeof anchor.startOffset !== "number") return null;
    const ranked = candidates
      .map((offset) => ({
        offset,
        distance: Math.abs(offset - anchor.startOffset!),
      }))
      .sort((left, right) => left.distance - right.distance);
    if (ranked[0]!.distance === ranked[1]!.distance) return null;
    chosen = ranked[0]!.offset;
  }
  return offsetToPos(docText, chosen);
}

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

function commonPrefixLen(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

export function resolveAnchor(
  doc: ProseMirrorNode,
  anchor: {
    quotedText: string | null;
    prefix?: string;
    suffix?: string;
    startOffset?: number;
  },
  blockSeparator = "",
  hardBreakSeparator: "" | "\n" = "",
): ResolvedRange | null {
  const quote = anchor.quotedText;
  if (!quote) return null;

  const docText = buildDocText(doc, blockSeparator, hardBreakSeparator);
  const hay = docText.text;
  if (!hay.includes(quote)) return null;

  const occurrences: number[] = [];
  let idx = hay.indexOf(quote);
  while (idx !== -1) {
    occurrences.push(idx);
    idx = hay.indexOf(quote, idx + Math.max(1, quote.length));
    if (occurrences.length > 500) break;
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
