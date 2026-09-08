import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/**
 * A pure, in-place presentation of a persisted suggestion. This never creates
 * marks or changes document content: the canonical document stays canonical
 * until the suggestion lifecycle accepts it.
 */
export type SuggestionHighlightKind =
  | "delete"
  | "replace"
  | "insert"
  | "add_block"
  | "mark";

export interface SuggestionHighlightSpec {
  suggestionId: string;
  kind: SuggestionHighlightKind;
  from: number;
  to: number;
  insertedText?: string;
  deletedText?: string;
  editableBoundary?: boolean;
  editableText?: boolean;
}

export interface SuggestionHighlightState {
  specs: SuggestionHighlightSpec[];
  activeId: string | null;
  decorations: DecorationSet;
}

export interface SuggestionHighlightMeta {
  specs?: SuggestionHighlightSpec[];
  activeId?: string | null;
}

export const suggestionHighlightKey = new PluginKey<SuggestionHighlightState>(
  "suggestionHighlight",
);

interface Range {
  from: number;
  to: number;
}

function clampRange(from: number, to: number, size: number): Range | null {
  const start = Math.max(0, Math.min(from, size));
  const end = Math.max(0, Math.min(to, size));
  return end > start ? { from: start, to: end } : null;
}

function clampPosition(position: number, size: number): number {
  return Math.max(0, Math.min(position, size));
}

function classes(base: string, active: boolean): string {
  return active ? `${base} suggestion-highlight--active` : base;
}

function insertionWidget(spec: SuggestionHighlightSpec, active: boolean) {
  return () => {
    const widget = document.createElement("span");
    widget.className = classes(
      `${
        spec.kind === "add_block" ? "suggestion-add-block" : "suggestion-insert"
      } suggestion-proposed-text suggestion-inline-widget`,
      active,
    );
    widget.setAttribute("data-suggestion-id", spec.suggestionId);
    widget.setAttribute("data-suggestion-widget", "true");
    widget.setAttribute("role", "button");
    widget.setAttribute("tabindex", "0");
    widget.setAttribute("aria-label", "Inspect suggested insertion");
    // textContent deliberately keeps persisted proposal text out of HTML.
    widget.textContent = spec.insertedText?.replace(/\n/g, "↵") ?? "";
    return widget;
  };
}

function deletionWidget(spec: SuggestionHighlightSpec, active: boolean) {
  return () => {
    const widget = document.createElement("span");
    widget.className = classes(
      "suggestion-delete-widget suggestion-deleted-text suggestion-inline-widget",
      active,
    );
    widget.setAttribute("data-suggestion-id", spec.suggestionId);
    widget.setAttribute("data-suggestion-widget", "true");
    if (spec.editableBoundary) {
      widget.setAttribute("data-suggestion-edit-boundary", "true");
      widget.setAttribute("data-suggestion-position", String(spec.from));
    } else {
      widget.setAttribute("role", "button");
      widget.setAttribute("tabindex", "0");
      widget.setAttribute("aria-label", "Inspect suggested deletion");
    }
    widget.textContent = spec.deletedText?.replace(/\n/g, "↵") ?? "";
    return widget;
  };
}

function buildDecorations(
  doc: ProseMirrorNode,
  specs: SuggestionHighlightSpec[],
  activeId: string | null,
): DecorationSet {
  const decorations: Decoration[] = [];
  const size = doc.content.size;

  for (const spec of specs) {
    const active = activeId === spec.suggestionId;
    const range = clampRange(spec.from, spec.to, size);
    const attrs = {
      "data-suggestion-id": spec.suggestionId,
      ...(spec.editableText
        ? {}
        : {
            role: "button",
            tabindex: "0",
            "aria-label": "Inspect suggested change",
          }),
    };

    if (spec.kind === "delete" || spec.kind === "replace") {
      if (range) {
        decorations.push(
          Decoration.inline(range.from, range.to, {
            ...attrs,
            class: classes("suggestion-delete suggestion-deleted-text", active),
          }),
        );
      }
    } else if (spec.kind === "mark" && range) {
      decorations.push(
        Decoration.inline(range.from, range.to, {
          ...attrs,
          class: classes("suggestion-change suggestion-proposed-text", active),
        }),
      );
    }

    if (
      spec.kind === "replace" ||
      spec.kind === "insert" ||
      spec.kind === "add_block"
    ) {
      const anchor = clampPosition(
        spec.kind === "replace" && range ? range.to : spec.from,
        size,
      );
      decorations.push(
        Decoration.widget(anchor, insertionWidget(spec, active), {
          key: `${spec.suggestionId}:inserted`,
          side: 1,
          ...attrs,
        }),
      );
    }
    if (spec.deletedText) {
      decorations.push(
        Decoration.widget(
          clampPosition(spec.from, size),
          deletionWidget(spec, active),
          {
            key: JSON.stringify([
              spec.suggestionId,
              "deleted",
              spec.deletedText,
              active,
            ]),
            side: 1,
            ...attrs,
          },
        ),
      );
    }
  }

  return DecorationSet.create(doc, decorations);
}

export function createSuggestionHighlightPlugin(): Plugin<SuggestionHighlightState> {
  return new Plugin<SuggestionHighlightState>({
    key: suggestionHighlightKey,
    state: {
      init: () => ({
        specs: [],
        activeId: null,
        decorations: DecorationSet.empty,
      }),
      apply(tr, value, _oldState, newState) {
        const meta = tr.getMeta(suggestionHighlightKey) as
          | SuggestionHighlightMeta
          | undefined;
        let specs = value.specs;
        let activeId = value.activeId;

        if (meta) {
          if (meta.specs !== undefined) specs = meta.specs;
          if (meta.activeId !== undefined) activeId = meta.activeId;
        } else if (tr.docChanged) {
          specs = specs
            .map((spec) => ({
              ...spec,
              from: tr.mapping.map(spec.from, 1),
              to: tr.mapping.map(spec.to, -1),
            }))
            .filter((spec) =>
              spec.kind === "insert" ||
              spec.kind === "add_block" ||
              (spec.kind === "delete" && !!spec.deletedText)
                ? true
                : spec.to > spec.from,
            );
        } else {
          return value;
        }

        return {
          specs,
          activeId,
          decorations: buildDecorations(newState.doc, specs, activeId),
        };
      },
    },
    props: {
      decorations(state) {
        return suggestionHighlightKey.getState(state)?.decorations ?? null;
      },
    },
  });
}

export const SuggestionHighlight = Extension.create({
  name: "suggestionHighlight",

  addProseMirrorPlugins() {
    return [createSuggestionHighlightPlugin()];
  },
});

/** Push persisted suggestion specs and the centrally-managed active id. */
export function setSuggestionHighlights(
  view: EditorView,
  meta: SuggestionHighlightMeta,
): void {
  view.dispatch(view.state.tr.setMeta(suggestionHighlightKey, meta));
}
