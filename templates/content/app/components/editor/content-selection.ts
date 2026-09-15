import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { captureAnchor } from "./comment-anchors";

/** Max chars of selected text sent to application state. `edit-document`'s
 *  `find` round-trips this verbatim, so longer selections are truncated with
 *  a flag rather than silently sent in full. */
export const SELECTION_TEXT_LIMIT = 2000;
/** Max chars of the containing block's text used as disambiguating context. */
const BLOCK_TEXT_LIMIT = 200;

export interface ContentSelectionBlockContext {
  /** Plain text of the block (paragraph/heading/list item/etc.) the position
   *  sits in, capped to BLOCK_TEXT_LIMIT chars. */
  blockText: string;
  /** Nearest preceding heading text (the section the position sits under), if any. */
  heading: string | null;
}

/**
 * Cheap block/heading lookup — no full-document anchor math, so it's safe to
 * run on every collapsed-cursor move as well as every real selection.
 */
export function captureBlockContext(
  doc: ProseMirrorNode,
  pos: number,
): ContentSelectionBlockContext {
  const clamped = Math.min(Math.max(pos, 0), doc.content.size);
  const resolved = doc.resolve(clamped);
  let blockNode: ProseMirrorNode | null = null;
  for (let depth = resolved.depth; depth >= 0; depth--) {
    const node = resolved.node(depth);
    if (node.isTextblock) {
      blockNode = node;
      break;
    }
  }
  // Headings are top-level document blocks; scanning only the doc's direct
  // children (not the full descendant tree) is enough to find the nearest one
  // preceding the position, and stays cheap on a large document.
  let heading: string | null = null;
  doc.forEach((node, offset) => {
    if (offset > clamped) return;
    if (node.type.name === "heading") {
      heading = node.textContent.trim() || null;
    }
  });
  return {
    blockText: (blockNode?.textContent ?? "").trim().slice(0, BLOCK_TEXT_LIMIT),
    heading,
  };
}

export interface ContentSelectionPayload {
  documentId: string;
  /** True when the selection is just a cursor (no highlighted text). */
  collapsed: boolean;
  /** Verbatim selected text, capped to SELECTION_TEXT_LIMIT. Absent when collapsed. */
  selectedText?: string;
  /** True when `selectedText` was truncated from a longer selection. */
  textTruncated?: boolean;
  /** Up to 32 chars of document text immediately before/after the selection,
   *  for disambiguating a repeated phrase. Absent when collapsed. */
  prefix?: string;
  suffix?: string;
  /** ProseMirror plain-text offset of the selection start. Informational only
   *  — it is not an offset into the Markdown `get-document` returns; use
   *  `selectedText` / `blockText` / `heading` to locate the edit instead. */
  position?: number;
  blockText: string;
  heading: string | null;
}

/**
 * Pure builder for the app-state payload written on every selection change.
 * Kept separate from the editor wiring so it's testable without mounting
 * tiptap.
 */
export function buildContentSelectionPayload(
  doc: ProseMirrorNode,
  documentId: string,
  from: number,
  to: number,
): ContentSelectionPayload {
  const { blockText, heading } = captureBlockContext(doc, from);
  if (from === to) {
    return { documentId, collapsed: true, blockText, heading };
  }
  const anchor = captureAnchor(doc, from, to);
  return {
    documentId,
    collapsed: false,
    selectedText: anchor.quotedText.slice(0, SELECTION_TEXT_LIMIT),
    textTruncated: anchor.quotedText.length > SELECTION_TEXT_LIMIT,
    prefix: anchor.prefix,
    suffix: anchor.suffix,
    position: anchor.startOffset,
    blockText,
    heading,
  };
}
