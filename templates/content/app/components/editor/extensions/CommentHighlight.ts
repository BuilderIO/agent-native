import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep, StepMap } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

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

// What each position of a document names: a node boundary or one character.
function positionUnits(node: ProseMirrorNode, units: string[] = []): string[] {
  node.forEach((child) => {
    if (child.isText) {
      for (let index = 0; index < child.text!.length; index += 1)
        units.push(child.text!.charAt(index));
    } else if (child.isLeaf) {
      units.push(`<${child.type.name}/>`);
    } else {
      units.push(`<${child.type.name}>`);
      positionUnits(child, units);
      units.push(`</${child.type.name}>`);
    }
  });
  return units;
}

interface DocumentSwap {
  map: StepMap;
  // The old document's changed span, when the swap only rewrites text there.
  rewrite: { from: number; to: number } | null;
}

// A collaborative update, a reconcile, or a decision readback swaps in the
// whole document, so its own mapping collapses every range inside it. Such a
// swap maps through the one span where the documents stop naming the same
// node types and text. A narrower change keeps its own mapping: deleting one
// of two identical words reads, by text alone, as deleting the other.
function documentSwap(
  tr: Transaction,
  before: ProseMirrorNode,
  after: ProseMirrorNode,
): DocumentSwap | null {
  const left = positionUnits(before);
  const right = positionUnits(after);
  let start = 0;
  while (
    start < left.length &&
    start < right.length &&
    left[start] === right[start]
  )
    start += 1;
  if (start === left.length && start === right.length)
    return { map: StepMap.empty, rewrite: null };
  const swapsDocument = tr.steps.some(
    (step, index) =>
      step instanceof ReplaceStep &&
      step.from === 0 &&
      step.to === tr.docs[index].content.size,
  );
  if (!swapsDocument) return null;
  let endLeft = left.length;
  let endRight = right.length;
  while (
    endLeft > start &&
    endRight > start &&
    left[endLeft - 1] === right[endRight - 1]
  ) {
    endLeft -= 1;
    endRight -= 1;
  }
  const changed = [
    ...left.slice(start, endLeft),
    ...right.slice(start, endRight),
  ];
  return {
    map: new StepMap([start, endLeft - start, endRight - start]),
    rewrite: changed.some((unit) => unit.length > 1)
      ? null
      : { from: start, to: endLeft },
  };
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
          let swap: DocumentSwap | null | undefined;
          specs = specs.flatMap((s) => {
            const from = tr.mapping.map(s.from, 1);
            const to = tr.mapping.map(s.to, -1);
            if (to > from) return [{ threadId: s.threadId, from, to }];
            if (swap === undefined)
              swap = documentSwap(tr, oldState.doc, newState.doc);
            if (!swap) return [];
            // A rewrite that cuts into a highlight takes in all of its new
            // text, as an accepted edit re-anchors the thread's quote
            // (shared/comment-reanchor.ts). Typing at its edge does not, and
            // a change to blocks drops it to be found again by its quote.
            const { rewrite } = swap;
            const cuts =
              !!rewrite && s.from < rewrite.to && s.to > rewrite.from;
            const swappedFrom = swap.map.map(s.from, cuts ? -1 : 1);
            const swappedTo = swap.map.map(s.to, cuts ? 1 : -1);
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
