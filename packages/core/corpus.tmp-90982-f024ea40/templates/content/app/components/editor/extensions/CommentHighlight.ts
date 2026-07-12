import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/**
 * Inline comment highlights, rendered as ProseMirror decorations (NOT marks).
 *
 * The highlights are a pure presentation overlay derived from the comment
 * anchors stored in SQL — nothing is written into the document content, so the
 * NFM / markdown / Notion round-trip is completely untouched. The React layer
 * resolves each open thread's stored anchor to a `{ from, to }` range and pushes
 * the resolved specs in through `setCommentHighlights`; in between pushes the
 * plugin maps the ranges through every transaction so the highlights follow the
 * text live as the user types, exactly like Notion / Google Docs.
 */
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
  decorations: DecorationSet;
}

interface CommentHighlightMeta {
  specs?: CommentHighlightSpec[];
  pending?: PendingRange | null;
  activeId?: string | null;
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

function buildDecorations(
  doc: ProseMirrorNode,
  specs: CommentHighlightSpec[],
  pending: PendingRange | null,
  activeId: string | null,
): DecorationSet {
  const decos: Decoration[] = [];
  const size = doc.content.size;
  for (const spec of specs) {
    const r = clampRange(spec.from, spec.to, size);
    if (!r) continue;
    decos.push(
      Decoration.inline(r.from, r.to, {
        class:
          activeId === spec.threadId
            ? "comment-highlight comment-highlight--active"
            : "comment-highlight",
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

export const CommentHighlight = Extension.create({
  name: "commentHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<CommentHighlightState>({
        key: commentHighlightKey,
        state: {
          init: () => ({
            specs: [],
            pending: null,
            activeId: null,
            decorations: DecorationSet.empty,
          }),
          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(commentHighlightKey) as
              | CommentHighlightMeta
              | undefined;

            let specs = value.specs;
            let pending = value.pending;
            let activeId = value.activeId;

            if (meta) {
              if (meta.specs !== undefined) specs = meta.specs;
              if (meta.pending !== undefined) pending = meta.pending;
              if (meta.activeId !== undefined) activeId = meta.activeId;
            } else if (tr.docChanged) {
              // Map ranges through the edit. Bias the start right and the end
              // left so typing exactly at a boundary does not extend the
              // highlight (Notion behavior); typing inside grows it.
              specs = specs
                .map((s) => ({
                  threadId: s.threadId,
                  from: tr.mapping.map(s.from, 1),
                  to: tr.mapping.map(s.to, -1),
                }))
                .filter((s) => s.to > s.from);
              if (pending) {
                const from = tr.mapping.map(pending.from, 1);
                const to = tr.mapping.map(pending.to, -1);
                pending = to > from ? { from, to } : null;
              }
            } else {
              // No doc change and no meta — nothing to recompute.
              return value;
            }

            return {
              specs,
              pending,
              activeId,
              decorations: buildDecorations(
                newState.doc,
                specs,
                pending,
                activeId,
              ),
            };
          },
        },
        props: {
          decorations(state) {
            return commentHighlightKey.getState(state)?.decorations ?? null;
          },
        },
      }),
    ];
  },
});

/**
 * Push a fresh set of resolved highlight specs, a pending-selection range, and
 * the active thread id into the plugin. Any field left `undefined` is preserved.
 */
export function setCommentHighlights(
  view: EditorView,
  meta: CommentHighlightMeta,
): void {
  view.dispatch(view.state.tr.setMeta(commentHighlightKey, meta));
}
