import type { useT } from "@agent-native/core/client/i18n";
import {
  commentAnchorBlockNames,
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
  /** Every block that goes by an id, each of several sharing one included. */
  list: CommentAnchorBlock[];
  byId: Map<string, CommentAnchorBlock>;
  byPos: Map<number, CommentAnchorBlock>;
  /** Ids more than one block goes by, which name none of them. */
  shared: Set<string>;
  videos: number;
};

const anchorBlocksByDoc = new WeakMap<ProseMirrorNode, AnchorBlocks>();

function anchorBlocks(doc: ProseMirrorNode): AnchorBlocks {
  const known = anchorBlocksByDoc.get(doc);
  if (known) return known;
  const blocks: AnchorBlocks = {
    list: [],
    byId: new Map(),
    byPos: new Map(),
    shared: new Set(),
    videos: 0,
  };
  const found: {
    type: CommentAnchorBlockType;
    attrs: ProseMirrorNode["attrs"];
    pos: number;
  }[] = [];
  doc.descendants((node, pos) => {
    const type = node.type.name;
    if (!isCommentAnchorBlockType(type)) return true;
    found.push({ type, attrs: node.attrs, pos });
    if (type === "video") blocks.videos++;
    return false;
  });
  commentAnchorBlockNames(found).forEach(({ id, holders }, index) => {
    if (!id) return;
    const block = {
      blockId: id,
      blockType: found[index].type,
      pos: found[index].pos,
    };
    blocks.list.push(block);
    if (holders > 1) return void blocks.shared.add(id);
    blocks.byId.set(id, block);
    blocks.byPos.set(block.pos, block);
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

/**
 * Every anchorable block that goes by an id, in document order, including
 * each of several that share one.
 */
export function commentAnchorBlockList(doc: ProseMirrorNode) {
  return [...anchorBlocks(doc).list];
}

export function sharedCommentAnchorBlockIds(
  doc: ProseMirrorNode,
): ReadonlySet<string> {
  return anchorBlocks(doc).shared;
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
  thread: Pick<
    CommentThread,
    "block" | "quotedText" | "prefix" | "suffix" | "startOffset"
  >,
) {
  if (thread.block) return commentAnchorBlockById(doc, thread.block.blockId);
  if (
    !LEGACY_VIDEO_COMMENT_QUOTES.has(thread.quotedText ?? "") ||
    thread.prefix != null ||
    thread.suffix != null ||
    thread.startOffset != null
  )
    return null;
  if (anchorBlocks(doc).videos !== 1) return null;
  return (
    commentAnchorBlockList(doc).find((block) => block.blockType === "video") ??
    null
  );
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

/**
 * The thread a pointer on `target` is on: a text highlight's, or on a block,
 * `current` when it is one of the block's threads and the first otherwise, so
 * clicking or resting on the block keeps the thread already open.
 */
export function commentThreadAt(
  target: EventTarget | null,
  current?: string | null,
) {
  const mark = (target as Element | null)?.closest?.(
    "[data-comment-thread], [data-comment-block-threads]",
  );
  if (!mark) return null;
  const threadId = mark.getAttribute("data-comment-thread");
  if (threadId) return threadId;
  const threadIds =
    mark.getAttribute("data-comment-block-threads")?.split(" ") ?? [];
  return current && threadIds.includes(current)
    ? current
    : (threadIds[0] ?? null);
}

/**
 * Reports the thread under the pointer as it rests on a mark, and null once it
 * leaves for anything but another mark of that thread.
 */
export function commentThreadHoverHandlers(
  current: string | null,
  onHover: (threadId: string | null) => void,
) {
  return {
    onPointerOverCapture(event: { target: EventTarget | null }) {
      const threadId = commentThreadAt(event.target, current);
      if (threadId) onHover(threadId);
    },
    onPointerOutCapture(event: {
      target: EventTarget | null;
      relatedTarget: EventTarget | null;
    }) {
      const threadId = commentThreadAt(event.target, current);
      if (
        threadId &&
        commentThreadAt(event.relatedTarget, current) !== threadId
      )
        onHover(null);
    },
  };
}
