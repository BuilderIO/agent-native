import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep, StepMap } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import DiffMatchPatch, {
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
} from "diff-match-patch";

import {
  commentAnchorBlockAt,
  commentAnchorBlockById,
} from "../comment-block-anchors";

export interface CommentHighlightSpec {
  threadId: string;
  from: number;
  to: number;
  /** The block the thread is on as a whole; its range is the block's. */
  blockId?: string;
}

interface PendingRange {
  from: number;
  to: number;
  blockId?: string;
}

export interface CommentHighlightState {
  specs: CommentHighlightSpec[];
  pending: PendingRange | null;
  activeId: string | null;
  hoveredId: string | null;
  decorations: DecorationSet;
}

interface CommentHighlightMeta {
  specs?: CommentHighlightSpec[];
  pending?: PendingRange | null;
  activeId?: string | null;
  hoveredId?: string | null;
}

export const commentHighlightKey = new PluginKey<CommentHighlightState>(
  "commentHighlight",
);

function clampRange(
  from: number,
  to: number,
  size: number,
): PendingRange | null {
  const a = Math.max(0, Math.min(from, size));
  const b = Math.max(0, Math.min(to, size));
  if (b <= a) return null;
  return { from: a, to: b };
}

// What each position of a document names, one character per position: its
// text, and a private-use character for each node boundary.
function positionText(doc: ProseMirrorNode, codes: Map<string, string>) {
  const parts: string[] = [];
  const boundary = (key: string) => {
    let code = codes.get(key);
    if (code === undefined) {
      code = String.fromCharCode(0xe000 + codes.size);
      codes.set(key, code);
    }
    parts.push(code);
  };
  const walk = (node: ProseMirrorNode) =>
    node.forEach((child) => {
      if (child.isText) {
        parts.push(child.text!);
      } else if (child.isLeaf) {
        boundary(`${child.type.name}/`);
      } else {
        boundary(child.type.name);
        walk(child);
        boundary(`/${child.type.name}`);
      }
    });
  walk(doc);
  return parts.join("");
}

// A collaborative update, a reconcile, or a decision readback swaps in the
// whole document, so its own mapping collapses every range inside it. Such a
// swap maps through a diff of the two documents' node types and text. A
// narrower change keeps its own mapping: deleting one of two identical words
// reads, by text alone, as deleting the other.
function swapMapping(
  tr: Transaction,
  before: ProseMirrorNode,
  after: ProseMirrorNode,
): StepMap | null {
  const codes = new Map<string, string>();
  const left = positionText(before, codes);
  const right = positionText(after, codes);
  if (left === right) return StepMap.empty;
  const swapsDocument = tr.steps.some(
    (step, index) =>
      step instanceof ReplaceStep &&
      step.from === 0 &&
      step.to === tr.docs[index].content.size,
  );
  if (!swapsDocument) return null;
  const differ = new DiffMatchPatch();
  // This runs on the main thread: a large rewrite settles for a coarser diff.
  differ.Diff_Timeout = 0.05;
  const ranges: number[] = [];
  let changed: [number, number, number] | null = null;
  let offset = 0;
  const diffs = differ.diff_main(left, right, false);
  // Letters a rewrite happens to share with the text it replaces are not that
  // text surviving.
  differ.diff_cleanupSemantic(diffs);
  for (const [kind, text] of diffs) {
    if (kind === DIFF_EQUAL) {
      if (changed) ranges.push(...changed);
      changed = null;
      offset += text.length;
      continue;
    }
    changed ??= [offset, 0, 0];
    if (kind === DIFF_DELETE) {
      changed[1] += text.length;
      offset += text.length;
    } else if (kind === DIFF_INSERT) {
      changed[2] += text.length;
    }
  }
  if (changed) ranges.push(...changed);
  return new StepMap(ranges);
}

// Text an earlier step of a change put inside a highlight is not its text.
function keepsText(maps: readonly StepMap[], from: number, to: number) {
  let parts = [[from, to]];
  for (const map of maps) {
    parts = parts.flatMap(([start, end]) => {
      const left: number[][] = [];
      let at = start;
      map.forEach((oldStart, oldEnd) => {
        if (oldStart >= end) return;
        if (oldStart > at) left.push([map.map(at, 1), map.map(oldStart, -1)]);
        at = Math.max(at, oldEnd);
      });
      if (at < end) left.push([map.map(at, 1), map.map(end, -1)]);
      return left;
    });
    if (!parts.length) return false;
  }
  return true;
}

// A highlight keeps only what is left of its text. Once a change replaces all
// of it, even with text in the same place, it is gone: only an accepted edit
// re-anchors the thread's quote, not a collaborator's rewrite.
function mapHighlight(
  maps: readonly StepMap[],
  from: number,
  to: number,
): PendingRange | null {
  if (!keepsText(maps, from, to)) return null;
  for (const map of maps) {
    from = map.map(from, 1);
    to = map.map(to, -1);
  }
  return to > from ? { from, to } : null;
}

// A thread on a block follows the block's id wherever an edit or a swap moves
// it, and goes when the block does. Where a pasted copy shares the id until
// the editor renumbers it, the block the thread was on keeps it.
function mapBlock(
  tr: Transaction,
  doc: ProseMirrorNode,
  blockId: string,
  from: number,
): PendingRange | null {
  const mapped = tr.mapping.map(from, 1);
  const at = doc.nodeAt(mapped);
  const pos =
    at?.attrs.blockId === blockId ||
    commentAnchorBlockAt(doc, mapped)?.blockId === blockId
      ? mapped
      : commentAnchorBlockById(doc, blockId)?.pos;
  if (pos === undefined) return null;
  return { from: pos, to: pos + doc.nodeAt(pos)!.nodeSize, blockId };
}

function buildDecorations(
  doc: ProseMirrorNode,
  specs: CommentHighlightSpec[],
  pending: PendingRange | null,
  activeId: string | null,
  hoveredId: string | null,
): DecorationSet {
  const decos: Decoration[] = [];
  const size = doc.content.size;
  // Several threads on one block share one mark: a node decoration's
  // attributes replace another's on the same node.
  const blocks = new Map<number, { to: number; threadIds: string[] }>();
  for (const spec of specs) {
    if (spec.blockId) {
      const block = blocks.get(spec.from);
      if (block) block.threadIds.push(spec.threadId);
      else blocks.set(spec.from, { to: spec.to, threadIds: [spec.threadId] });
      continue;
    }
    const r = clampRange(spec.from, spec.to, size);
    if (!r) continue;
    const emphasisClass =
      activeId === spec.threadId
        ? " comment-highlight--active"
        : hoveredId === spec.threadId
          ? " comment-highlight--hovered"
          : "";
    decos.push(
      Decoration.inline(r.from, r.to, {
        class: `comment-highlight${emphasisClass}`,
        "data-comment-thread": spec.threadId,
      }),
    );
  }
  for (const [from, { to, threadIds }] of blocks) {
    const r = clampRange(from, to, size);
    if (!r) continue;
    const emphasisClass =
      activeId && threadIds.includes(activeId)
        ? " comment-highlight--active"
        : hoveredId && threadIds.includes(hoveredId)
          ? " comment-highlight--hovered"
          : "";
    decos.push(
      Decoration.node(r.from, r.to, {
        class: `comment-highlight comment-highlight--block${emphasisClass}`,
        "data-comment-block-threads": threadIds.join(" "),
      }),
    );
  }
  if (pending) {
    const r = clampRange(pending.from, pending.to, size);
    if (r && pending.blockId) {
      decos.push(
        Decoration.node(r.from, r.to, {
          class:
            "comment-highlight comment-highlight--block comment-highlight--pending",
        }),
      );
    } else if (r) {
      decos.push(
        Decoration.inline(r.from, r.to, {
          class: "comment-highlight comment-highlight--pending",
        }),
      );
    }
  }
  return DecorationSet.create(doc, decos);
}

export interface CommentHighlightOptions {
  // Where a thread's quote is in a document, if anywhere.
  findQuote?: (threadId: string, doc: ProseMirrorNode) => PendingRange | null;
}

export function createCommentHighlightPlugin({
  findQuote,
}: CommentHighlightOptions = {}) {
  return new Plugin<CommentHighlightState>({
    key: commentHighlightKey,
    state: {
      init: () => ({
        specs: [],
        pending: null,
        activeId: null,
        hoveredId: null,
        decorations: DecorationSet.empty,
      }),
      apply(tr, value, oldState, newState) {
        const meta = tr.getMeta(commentHighlightKey) as
          | CommentHighlightMeta
          | undefined;

        let specs = value.specs;
        let pending = value.pending;
        let activeId = value.activeId;
        let hoveredId = value.hoveredId;

        if (meta) {
          if (meta.specs !== undefined) specs = meta.specs;
          if (meta.pending !== undefined) pending = meta.pending;
          if (meta.activeId !== undefined) activeId = meta.activeId;
          if (meta.hoveredId !== undefined) hoveredId = meta.hoveredId;
        } else if (tr.docChanged) {
          let swap: StepMap | null | undefined;
          specs = specs.flatMap((s) => {
            if (s.blockId) {
              const block = mapBlock(tr, newState.doc, s.blockId, s.from);
              return block ? [{ threadId: s.threadId, ...block }] : [];
            }
            let range = mapHighlight(tr.mapping.maps, s.from, s.to);
            if (!range) {
              if (swap === undefined)
                swap = swapMapping(tr, oldState.doc, newState.doc);
              // A swapped-in document with none of the highlight's text left
              // falls back to its quote, as on a fresh load: a rewrite too
              // large to diff in time drops text it never touched. A narrower
              // edit that deletes the text takes the highlight with it, even
              // where another copy of the quote remains.
              if (swap)
                range =
                  mapHighlight([swap], s.from, s.to) ??
                  findQuote?.(s.threadId, newState.doc) ??
                  null;
            }
            return range ? [{ threadId: s.threadId, ...range }] : [];
          });
          if (pending?.blockId) {
            pending = mapBlock(tr, newState.doc, pending.blockId, pending.from);
          } else if (pending) {
            const from = tr.mapping.map(pending.from, 1);
            const to = tr.mapping.map(pending.to, -1);
            pending = to > from ? { from, to } : null;
          }
        } else {
          return value;
        }

        return {
          specs,
          pending,
          activeId,
          hoveredId,
          decorations: buildDecorations(
            newState.doc,
            specs,
            pending,
            activeId,
            hoveredId,
          ),
        };
      },
    },
    props: {
      decorations(state) {
        return commentHighlightKey.getState(state)?.decorations ?? null;
      },
    },
  });
}

export const CommentHighlight = Extension.create<CommentHighlightOptions>({
  name: "commentHighlight",

  addOptions() {
    return { findQuote: undefined };
  },

  addProseMirrorPlugins() {
    return [createCommentHighlightPlugin(this.options)];
  },
});

export function setCommentHighlights(
  view: EditorView,
  meta: CommentHighlightMeta,
): void {
  view.dispatch(view.state.tr.setMeta(commentHighlightKey, meta));
}
