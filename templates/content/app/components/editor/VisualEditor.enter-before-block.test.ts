// @vitest-environment happy-dom

import { docToNfm, nfmToDoc } from "@shared/nfm";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Editor } from "@tiptap/core";
import {
  act,
  createElement,
  type ComponentProps,
  type ComponentType,
} from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  documentEditorSuggestionPresentations,
  suggestionPresentation,
} from "./DocumentEditor";
import { setSuggestionHighlights } from "./extensions/SuggestionHighlight";
import {
  createSuggestionDraftSession,
  previewSuggestionDraft,
} from "./suggestions/draft-session";
import {
  createVisualEditorExtensions,
  suggestionHighlightSpec,
  VisualEditor,
  type VisualEditorSuggestion,
} from "./VisualEditor";

const canonical = [
  "Before heading.",
  "## Heading after",
  "Before bullet.",
  "- Bullet item",
  "Before ordered.",
  "1. Ordered item",
  "Before quote.",
  "> Quoted line",
  "Before code.",
  "```ts",
  "const x = 1;",
  "```",
  "Before paragraph.",
  "After paragraph.",
].join("\n");

const neighbors = [
  ["heading", "Before heading.", "Heading after"],
  ["bullet list", "Before bullet.", "Bullet item"],
  ["ordered list", "Before ordered.", "Ordered item"],
  ["blockquote", "Before quote.", "Quoted line"],
  ["code block", "Before code.", "const x = 1;"],
  ["paragraph", "Before paragraph.", "After paragraph."],
] as const;

type TooltipProviderProps = Omit<
  ComponentProps<typeof TooltipProvider>,
  "children"
>;
const TooltipProviderWithoutChildren =
  TooltipProvider as ComponentType<TooltipProviderProps>;

function mountedEditor(content: string) {
  const mount = document.createElement("div");
  document.body.append(mount);
  const editor = new Editor({
    element: mount,
    extensions: createVisualEditorExtensions(),
    content: nfmToDoc(content),
  });
  return {
    editor,
    dispose: () => {
      editor.destroy();
      mount.remove();
    },
  };
}

function pressEnterAndType(editor: Editor, paragraph: string) {
  let end = -1;
  editor.state.doc.descendants((node, pos) => {
    if (end < 0 && node.isTextblock && node.textContent === paragraph)
      end = pos + node.nodeSize - 1;
    return end < 0;
  });
  expect(end).toBeGreaterThan(0);
  editor.commands.setTextSelection(end);
  expect(editor.commands.splitBlock()).toBe(true);
  editor.view.dispatch(editor.state.tr.insertText("Inserted words"));
  return docToNfm(editor.getJSON());
}

function draftInsertion(draft: string) {
  const preview = previewSuggestionDraft(
    createSuggestionDraftSession({
      id: "enter-before-block",
      baseContent: canonical,
      baseRevision: "one",
      startedAt: "2026-10-05T00:00:00.000Z",
    }),
    draft,
    null,
  );
  if (preview.status !== "ready")
    throw new Error("Expected a representable block insertion");
  expect(preview.suggestions).toHaveLength(1);
  expect(preview.suggestions[0]!.operations).toMatchObject([
    {
      kind: "add_text_block",
      before: { changedText: "" },
      after: { changedText: "Inserted words\n" },
    },
  ]);
  return preview.suggestions;
}

function savedInsertion(paragraph: string): VisualEditorSuggestion {
  const source = mountedEditor(canonical);
  try {
    const [draft] = draftInsertion(pressEnterAndType(source.editor, paragraph));
    const presentation = suggestionPresentation(
      { id: "saved", status: "pending", operations: draft!.operations },
      canonical,
    );
    expect(presentation).not.toBeNull();
    return presentation!;
  } finally {
    source.dispose();
  }
}

function highlightedText(editor: Editor, suggestionId: string) {
  return Array.from(
    editor.view.dom.querySelectorAll(`[data-suggestion-id="${suggestionId}"]`),
    (element) => element.textContent,
  ).join("");
}

describe("Enter at the end of a paragraph before another block", () => {
  it.each(neighbors)(
    "highlights the drafted paragraph before a %s",
    (_label, paragraph) => {
      const { editor, dispose } = mountedEditor(canonical);
      try {
        const draft = pressEnterAndType(editor, paragraph);
        const presentations = documentEditorSuggestionPresentations({
          savedSuggestions: [],
          drafts: draftInsertion(draft),
          currentMarkdown: draft,
          editingSuggestionId: null,
          pendingSuggestionId: null,
          transitions: new Map(),
        });
        expect(presentations).toHaveLength(1);
        const spec = suggestionHighlightSpec(
          editor.state.doc,
          presentations[0]!,
        );
        expect(spec).not.toBeNull();
        setSuggestionHighlights(editor.view, { specs: [spec!] });
        expect(highlightedText(editor, presentations[0]!.id)).toBe(
          "Inserted words",
        );
        expect(docToNfm(editor.getJSON())).toBe(draft);
      } finally {
        dispose();
      }
    },
  );

  it.each(neighbors)(
    "shows the saved paragraph before a %s at that block",
    (_label, paragraph, neighborText) => {
      const presentation = savedInsertion(paragraph);
      const { editor, dispose } = mountedEditor(canonical);
      try {
        const spec = suggestionHighlightSpec(editor.state.doc, presentation);
        expect(spec).toMatchObject({ kind: "add_block" });
        const $from = editor.state.doc.resolve(spec!.from);
        expect($from.parent.textContent).toBe(neighborText);
        expect($from.parentOffset).toBe(0);
        setSuggestionHighlights(editor.view, { specs: [spec!] });
        expect(highlightedText(editor, "saved")).toContain("Inserted words");
        expect(docToNfm(editor.getJSON())).toBe(canonical);
      } finally {
        dispose();
      }
    },
  );

  it("leaves a suggestion it cannot place out of the anchored ids", async () => {
    const saved = savedInsertion("Before heading.");
    const stale: VisualEditorSuggestion = {
      ...saved,
      id: "stale",
      canonicalOperation: undefined,
      anchor: { from: 0, prefix: "No longer here.", suffix: "Gone." },
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const queryClient = new QueryClient();
    const onSuggestionAnchorsChange = vi.fn();
    try {
      await act(async () =>
        root.render(
          createElement(
            MemoryRouter,
            null,
            createElement(
              TooltipProviderWithoutChildren,
              { delayDuration: 0 },
              createElement(
                QueryClientProvider,
                { client: queryClient },
                createElement(VisualEditor, {
                  content: canonical,
                  onChange: () => {},
                  suggestions: [saved, stale],
                  onSuggestionAnchorsChange,
                }),
              ),
            ),
          ),
        ),
      );
      expect(onSuggestionAnchorsChange).toHaveBeenLastCalledWith(["saved"]);
    } finally {
      await act(async () => root.unmount());
      queryClient.clear();
      container.remove();
    }
  });
});
