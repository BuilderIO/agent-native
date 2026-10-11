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

export interface CommentHighlightSpec {
  threadId: string;
  from: number;
  to: number;
}

interface PendingRange {
  from: number;
  to: number;
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
  for (const [kind, text] of differ.diff_main(left, right, false)) {
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

function buildDecorations(
  doc: ProseMirrorNode,
  specs: CommentHighlightSpec[],
  pending: PendingRange | null,
  activeId: string | null,
  hoveredId: string | null,
): DecorationSet {
  const decos: Decoration[] = [];
  const size = doc.content.size;
  for (const spec of specs) {
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
  if (pending) {
    const r = clampRange(pending.from, pending.to, size);
    if (r) {
      decos.push(
        Decoration.inline(r.from, r.to, {
          class: "comment-highlight comment-highlight--pending",
        }),
      );
    }
  }
  return DecorationSet.create(doc, decos);
}

export function createCommentHighlightPlugin() {
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
            const from = tr.mapping.map(s.from, 1);
            const to = tr.mapping.map(s.to, -1);
            if (to > from) return [{ threadId: s.threadId, from, to }];
            if (swap === undefined)
              swap = swapMapping(tr, oldState.doc, newState.doc);
            if (!swap) return [];
            // An end inside text the swap replaced moves out to take in the
            // replacement, as accepting an edit re-anchors the thread's quote.
            const start = swap.mapResult(s.from, 1);
            const end = swap.mapResult(s.to, -1);
            const swappedFrom = start.deletedAcross
              ? swap.map(s.from, -1)
              : start.pos;
            const swappedTo = end.deletedAcross ? swap.map(s.to, 1) : end.pos;
            return swappedTo > swappedFrom
              ? [{ threadId: s.threadId, from: swappedFrom, to: swappedTo }]
              : [];
          });
          if (pending) {
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

export const CommentHighlight = Extension.create({
  name: "commentHighlight",

  addProseMirrorPlugins() {
    return [createCommentHighlightPlugin()];
  },
});

export function setCommentHighlights(
  view: EditorView,
  meta: CommentHighlightMeta,
): void {
  view.dispatch(view.state.tr.setMeta(commentHighlightKey, meta));
}
