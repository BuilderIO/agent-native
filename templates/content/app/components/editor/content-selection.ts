import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { captureAnchor } from "./comment-anchors";

export const SELECTION_TEXT_LIMIT = 2000;
const BLOCK_TEXT_LIMIT = 200;

export interface ContentSelectionBlockContext {
  blockText: string;
  heading: string | null;
}

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
  collapsed: boolean;
  selectedText?: string;
  textTruncated?: boolean;
  prefix?: string;
  suffix?: string;
  position?: number;
  blockText: string;
  heading: string | null;
}

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
