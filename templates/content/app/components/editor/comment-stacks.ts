import type { CommentThread } from "@/hooks/use-comments";

import {
  commentTabKey,
  commentThreadFieldId,
} from "./block-field-comment-threads";
import { inHiddenBlockFieldPanel } from "./blockFieldTabs";

/** Where a thread's first highlight sits: its stack, and its document order. */
export type CommentBlockPlacement = { key: string; order: number };

/** Two or more open threads in one block, in document order. */
export type CommentStack<T> = { key: string; threads: T[] };

/**
 * The block a highlight is in, as child indexes down from its editor: the
 * innermost list item holding it, else the editor's top-level node. A
 * highlight outside an editor, such as a Property's, has no block.
 */
export function commentBlockKey(highlight: Element): string | null {
  const block = commentBlock(highlight);
  return block ? blockPath(block) : null;
}

function commentBlock(highlight: Element) {
  const editor = highlight.closest(".ProseMirror");
  if (!editor) return null;
  const item = highlight.closest("li");
  if (item && editor.contains(item)) return { editor, block: item };
  let block: Element | null = highlight;
  while (block && block.parentElement !== editor) block = block.parentElement;
  return block ? { editor, block } : null;
}

function blockPath({ editor, block }: { editor: Element; block: Element }) {
  const path: number[] = [];
  for (let node: Element = block; node !== editor; ) {
    const parent: Element | null = node.parentElement;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.children, node));
    node = parent;
  }
  return path.join(".");
}

/** Block keys repeat across Blocks field tabs, so a stack's key has both. */
export function commentStackKey(fieldId: string | null, blockKey: string) {
  return `${commentTabKey(fieldId)}:${blockKey}`;
}

/**
 * Each thread's first highlight on the page, in document order. A thread on a
 * whole block, such as a video, is placed by the block's own mark. Property
 * threads, threads not listed, and highlights in a closed tab are left out.
 */
export function measureCommentBlocks(
  container: ParentNode,
  threads: readonly CommentThread[],
): Map<string, CommentBlockPlacement> {
  const byId = new Map(
    threads
      .filter((thread) => !thread.property)
      .map((thread) => [thread.threadId, thread]),
  );
  const placements = new Map<string, CommentBlockPlacement>();
  // Highlights share blocks, and a block's path walks its siblings.
  const paths = new Map<Element, string | null>();
  for (const highlight of container.querySelectorAll(
    "[data-comment-thread], [data-comment-block-threads]",
  )) {
    const threadIds =
      highlight.getAttribute("data-comment-thread") ??
      highlight.getAttribute("data-comment-block-threads")!;
    for (const threadId of threadIds.split(" ")) {
      const thread = byId.get(threadId);
      if (!thread || placements.has(thread.threadId)) continue;
      if (inHiddenBlockFieldPanel(highlight)) continue;
      const found = commentBlock(highlight);
      if (!found) continue;
      let block = paths.get(found.block);
      if (block === undefined) {
        block = blockPath(found);
        paths.set(found.block, block);
      }
      if (block === null) continue;
      placements.set(thread.threadId, {
        key: commentStackKey(commentThreadFieldId(thread), block),
        order: placements.size,
      });
    }
  }
  return placements;
}

/** The blocks holding two or more open threads, in document order. */
export function groupCommentStacks<
  T extends Pick<CommentThread, "threadId" | "resolved" | "property">,
>(
  threads: readonly T[],
  placements: ReadonlyMap<string, CommentBlockPlacement>,
): CommentStack<T>[] {
  const groups = new Map<string, T[]>();
  for (const thread of threads) {
    if (thread.resolved || thread.property) continue;
    const placement = placements.get(thread.threadId);
    if (!placement) continue;
    const members = groups.get(placement.key) ?? [];
    members.push(thread);
    groups.set(placement.key, members);
  }
  const order = (thread: T) => placements.get(thread.threadId)?.order ?? 0;
  return [...groups]
    .filter(([, members]) => members.length >= 2)
    .map(([key, members]) => ({
      key,
      threads: members.sort((left, right) => order(left) - order(right)),
    }))
    .sort((left, right) => order(left.threads[0]) - order(right.threads[0]));
}

function latestCommentTime(thread: Pick<CommentThread, "comments">) {
  let latest = -Infinity;
  for (const comment of thread.comments) {
    const time = Date.parse(comment.created_at);
    if (time > latest) latest = time;
  }
  return latest;
}

/**
 * The thread a folded stack shows: the one last touched, else the one with
 * the newest comment. Ties go to the first in document order.
 */
export function commentStackFront<
  T extends Pick<CommentThread, "threadId" | "comments">,
>(threads: readonly T[], touches: ReadonlyMap<string, number>): T {
  let front = threads[0];
  let frontTouch = touches.get(front.threadId) ?? -Infinity;
  let frontTime = latestCommentTime(front);
  for (const thread of threads.slice(1)) {
    const touch = touches.get(thread.threadId) ?? -Infinity;
    const time = latestCommentTime(thread);
    if (touch > frontTouch || (touch === frontTouch && time > frontTime)) {
      front = thread;
      frontTouch = touch;
      frontTime = time;
    }
  }
  return front;
}
