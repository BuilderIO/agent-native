import type { useT } from "@agent-native/core/client/i18n";
import {
  commentAnchorBlockNamer,
  isCommentAnchorBlockType,
  type CommentAnchorBlockType,
} from "@shared/comment-block-anchor";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import type { CommentThread } from "@/hooks/use-comments";

export type CommentAnchorBlock = {
  blockId: string;
  blockType: CommentAnchorBlockType;
  pos: number;
};

/** A comment being started on a whole block, and where the block is. */
export type CommentBlockTarget = {
  blockId: string;
  blockType: CommentAnchorBlockType;
  from: number;
  to: number;
};

type AnchorBlocks = {
  byId: Map<string, CommentAnchorBlock>;
  byPos: Map<number, CommentAnchorBlock>;
};

const anchorBlocksByDoc = new WeakMap<ProseMirrorNode, AnchorBlocks>();

function anchorBlocks(doc: ProseMirrorNode): AnchorBlocks {
  const known = anchorBlocksByDoc.get(doc);
  if (known) return known;
  const blocks: AnchorBlocks = { byId: new Map(), byPos: new Map() };
  const name = commentAnchorBlockNamer();
  doc.descendants((node, pos) => {
    const type = node.type.name;
    if (!isCommentAnchorBlockType(type)) return true;
    const blockId = name(type, node.attrs);
    if (blockId) {
      const block = { blockId, blockType: type, pos };
      blocks.byId.set(blockId, block);
      blocks.byPos.set(pos, block);
    }
    return false;
  });
  anchorBlocksByDoc.set(doc, blocks);
  return blocks;
}

/** The anchorable block that starts at `pos`, by the id comments use. */
export function commentAnchorBlockAt(doc: ProseMirrorNode, pos: number) {
  return anchorBlocks(doc).byPos.get(pos) ?? null;
}

export function commentAnchorBlockById(doc: ProseMirrorNode, blockId: string) {
  return anchorBlocks(doc).byId.get(blockId) ?? null;
}

export function commentAnchorBlockList(doc: ProseMirrorNode) {
  return [...anchorBlocks(doc).byId.values()];
}

/**
 * What a comment on a video quoted before videos had ids: the video's label in
 * its author's language, with no text around it.
 */
export const LEGACY_VIDEO_COMMENT_QUOTES: ReadonlySet<string> = new Set([
  "Video",
  "Video [de-DE]",
  "Vídeo",
  "Vidéo",
  "فيديو",
  "वीडियो",
  "ビデオ",
  "影片",
  "비디오",
  "视频",
]);

/**
 * The block a thread is on as a whole, if it is on one in this document. A
 * thread from before videos had ids is on the page's video when the page has
 * exactly one; with more, nothing says which.
 */
export function threadCommentBlock(
  doc: ProseMirrorNode,
  thread: Pick<CommentThread, "block" | "quotedText" | "prefix" | "suffix">,
) {
  if (thread.block) return commentAnchorBlockById(doc, thread.block.blockId);
  if (
    !LEGACY_VIDEO_COMMENT_QUOTES.has(thread.quotedText ?? "") ||
    thread.prefix != null ||
    thread.suffix != null
  )
    return null;
  const videos = commentAnchorBlockList(doc).filter(
    (block) => block.blockType === "video",
  );
  return videos.length === 1 ? videos[0] : null;
}

/**
 * The line a thread shows as its quote. A thread on a whole block quotes no
 * text, so it shows the block's name in the reader's language.
 */
export function commentThreadQuote(
  thread: Pick<CommentThread, "block" | "quotedText">,
  t: ReturnType<typeof useT>,
) {
  if (!thread.block) return thread.quotedText;
  return thread.block.blockType === "video" ? t("editor.media.video") : null;
}

function cssEscape(value: string) {
  return globalThis.CSS?.escape
    ? globalThis.CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}

/**
 * The editor mark for a thread: a text highlight carries the thread's id, and
 * a block carries the ids of every thread on it.
 */
export function commentThreadMarkSelector(threadId: string) {
  const id = cssEscape(threadId);
  return `[data-comment-thread="${id}"], [data-comment-block-threads~="${id}"]`;
}
