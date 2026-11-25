import { blockIdentityIdOf } from "@shared/block-identity-ids";
import {
  CLIP_EMBED_BLOCK_TYPE,
  clipEmbedRecordingIdFromRaw,
} from "@shared/clip-embed-block";
import { interactiveHtmlTitle } from "@shared/interactive-html";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { captureAnchor } from "./comment-anchors";
import { isInteractiveHtmlCodeBlock } from "./extensions/CodeBlockNode";

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

/** A registry block selected whole, as the agent should find it in the body. */
export interface ContentSelectedBlock {
  blockType: string;
  blockId: string;
  /** For a Clip block, the Clips recording it plays. */
  recordingId?: string;
}

function selectedRegistryBlock(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): ContentSelectedBlock | null {
  const node = doc.nodeAt(from);
  if (node?.type.name !== "registryBlock" || from + node.nodeSize !== to) {
    return null;
  }
  const { blockType, blockId, __raw } = node.attrs;
  if (
    typeof blockType !== "string" ||
    typeof blockId !== "string" ||
    !blockId
  ) {
    return null;
  }
  const recordingId =
    blockType === CLIP_EMBED_BLOCK_TYPE
      ? clipEmbedRecordingIdFromRaw(__raw)
      : null;
  return { blockType, blockId, ...(recordingId ? { recordingId } : {}) };
}

export interface ContentSelectedInteractiveBlock {
  title: string | null;
  blockId: string | null;
  number: number;
  whole: boolean;
}

function selectedInteractiveBlock(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): ContentSelectedInteractiveBlock | null {
  let found: ContentSelectedInteractiveBlock | null = null;
  let number = 0;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (!isInteractiveHtmlCodeBlock(node)) return !node.isTextblock;
    number++;
    const end = pos + node.nodeSize;
    if (from >= pos && to <= end && from < end) {
      found = {
        title: interactiveHtmlTitle(node.textContent),
        blockId: blockIdentityIdOf(node),
        number,
        whole: from === pos && to === end,
      };
    }
    return false;
  });
  return found;
}

export interface ContentSelectionPayload {
  documentId: string;
  collapsed: boolean;
  selectedBlock?: ContentSelectedBlock;
  interactiveBlock?: ContentSelectedInteractiveBlock;
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
  const interactiveBlock = selectedInteractiveBlock(doc, from, to);
  const within = interactiveBlock ? { interactiveBlock } : {};
  if (from === to) {
    return { documentId, collapsed: true, ...within, blockText, heading };
  }
  if (interactiveBlock?.whole) {
    return { documentId, collapsed: false, ...within, blockText: "", heading };
  }
  const selectedBlock = selectedRegistryBlock(doc, from, to);
  if (selectedBlock) {
    return { documentId, collapsed: false, selectedBlock, blockText, heading };
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
    ...within,
    blockText,
    heading,
  };
}
