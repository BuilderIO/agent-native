import { canonicalizeNfm, docToNfm } from "@shared/nfm";
import {
  suggestionTextPresentationForSource,
  suggestionTextPresentation,
  type SuggestionPresentationContext,
  type SuggestionPresentationNode,
} from "@shared/suggestion-text";
import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Selection } from "@tiptap/pm/state";
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
  insertedPresentation?: SuggestionPresentationContext;
  deletedPresentation?: SuggestionPresentationContext;
  editableBoundary?: boolean;
  editableText?: boolean;
  settling?: boolean;
  settlingBeforePresentation?: SuggestionPresentationContext;
  settlingAfterSource?: string;
  settlingReadbackContent?: string | null;
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

function appendPresentationNode(
  parent: HTMLElement,
  node: SuggestionPresentationNode,
  showLinkDestination: boolean,
): void {
  if (node.type === "text" || node.type === "indent") {
    parent.append(document.createTextNode(node.value));
    return;
  }

  const element = document.createElement(
    node.type === "strong"
      ? "strong"
      : node.type === "emphasis"
        ? "em"
        : node.type === "strike"
          ? "s"
          : node.type === "underline"
            ? "u"
            : node.type === "code"
              ? "code"
              : "span",
  );
  if (node.type === "code") {
    element.className = "rounded bg-muted px-1 font-mono text-[0.9em]";
  } else if (node.type === "link") {
    element.className = "underline underline-offset-2";
  }
  for (const child of node.children)
    appendPresentationNode(element, child, showLinkDestination);
  parent.append(element);

  if (node.type === "link" && showLinkDestination) {
    parent.append(document.createTextNode(` (${node.url})`));
  }
}

function appendSuggestionText(
  parent: HTMLElement,
  content: string,
  context?: SuggestionPresentationContext,
  showLinkDestination = true,
): void {
  const nodes = context
    ? suggestionTextPresentationForSource(content, context)
    : suggestionTextPresentation(content);
  if (!nodes) return;
  for (const node of nodes) {
    appendPresentationNode(parent, node, showLinkDestination);
  }
}

function insertionWidget(spec: SuggestionHighlightSpec, active: boolean) {
  return () => {
    const widget = document.createElement("span");
    if (spec.settling) {
      widget.className = "suggestion-settling-text suggestion-inline-widget";
      widget.setAttribute("data-suggestion-widget", "true");
      appendSuggestionText(
        widget,
        spec.insertedText ?? "",
        spec.insertedPresentation,
        false,
      );
      return widget;
    }
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
    appendSuggestionText(
      widget,
      spec.insertedText ?? "",
      spec.insertedPresentation,
    );
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
    appendSuggestionText(
      widget,
      spec.deletedText ?? "",
      spec.deletedPresentation,
    );
    return widget;
  };
}

function settledAtOperation(
  content: string,
  spec: SuggestionHighlightSpec,
): boolean {
  const before = spec.settlingBeforePresentation;
  const presentation = spec.insertedPresentation;
  const source = presentation?.source ?? spec.settlingAfterSource;
  if (!before || !presentation || source === undefined) return false;
  const { from, to } = presentation;
  if (
    from < 0 ||
    to < from ||
    to > source.length ||
    before.from < 0 ||
    before.to < before.from ||
    before.to > before.source.length
  )
    return false;

  // The persisted after-source locates the operation. Its nearby unchanged
  // text distinguishes this occurrence from identical text elsewhere.
  const left = source.slice(Math.max(0, from - 32), from);
  const right = source.slice(to, Math.min(source.length, to + 32));
  const localResult = source.slice(from, to);
  const needle = left + localResult + right;
  if (!needle) return false;
  const first = content.indexOf(needle);
  if (first === -1 || content.indexOf(needle, first + 1) !== -1) return false;
  if (from === 0 && first !== 0) return false;

  const originalLeft = before.source.slice(
    Math.max(0, before.from - 32),
    before.from,
  );
  const originalRight = before.source.slice(
    before.to,
    Math.min(before.source.length, before.to + 32),
  );
  const original =
    originalLeft + before.source.slice(before.from, before.to) + originalRight;
  return (
    original !== needle &&
    (original.length < needle.length || !content.startsWith(original, first))
  );
}

function buildDecorations(
  doc: ProseMirrorNode,
  specs: SuggestionHighlightSpec[],
  activeId: string | null,
): DecorationSet {
  const decorations: Decoration[] = [];
  const size = doc.content.size;
  const settledContent = specs.some((spec) => spec.settling)
    ? docToNfm(doc.toJSON())
    : null;

  for (const spec of specs) {
    if (
      spec.settling &&
      settledContent !== null &&
      (settledAtOperation(settledContent, spec) ||
        (spec.settlingReadbackContent !== null &&
          spec.settlingReadbackContent !== undefined &&
          canonicalizeNfm(settledContent) ===
            canonicalizeNfm(spec.settlingReadbackContent)))
    )
      continue;
    const active = activeId === spec.suggestionId;
    const range = clampRange(spec.from, spec.to, size);
    const attrs = spec.settling
      ? {}
      : {
          "data-suggestion-id": spec.suggestionId,
          ...(spec.editableText
            ? {}
            : {
                role: "button",
                tabindex: "0",
                "aria-label": "Inspect suggested change",
              }),
        };

    if (spec.settling) {
      if (range && range.to > range.from) {
        decorations.push(
          Decoration.inline(range.from, range.to, {
            class: "suggestion-settling-original",
          }),
        );
      }
      if (spec.kind !== "delete") {
        decorations.push(
          Decoration.widget(
            clampPosition(range ? range.to : spec.from, size),
            insertionWidget(spec, false),
            { key: `${spec.suggestionId}:settling`, marks: [], side: 1 },
          ),
        );
      }
      continue;
    }

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
          marks: [],
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
            marks: [],
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
  selection?: Selection,
): void {
  const transaction = view.state.tr.setMeta(suggestionHighlightKey, meta);
  if (selection) transaction.setSelection(selection);
  view.dispatch(transaction);
}
