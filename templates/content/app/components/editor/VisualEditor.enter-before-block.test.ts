// @vitest-environment happy-dom

import type { ResourceSuggestion } from "@agent-native/core/review";
import { docToNfm, nfmToDoc, type PMDoc } from "@shared/nfm";
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
import { markdownSuggestionOperation } from "./suggestions/markdown-operation";
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

  describe("after typing at the end of a paragraph", () => {
    const fixture = [
      "Alpha one has a few words.",
      "Bravo two sits in the middle.",
      "- First item",
      "Delta four closes it out.",
    ].join("\n");

    function typeAtEnd(editor: Editor, paragraph: string, text: string) {
      let end = -1;
      editor.state.doc.descendants((node, pos) => {
        if (end < 0 && node.isTextblock && node.textContent === paragraph)
          end = pos + node.nodeSize - 1;
        return end < 0;
      });
      expect(end).toBeGreaterThan(0);
      editor.commands.setTextSelection(end);
      if (text) editor.view.dispatch(editor.state.tr.insertText(text));
    }

    function draftSuggestions(draft: string) {
      const preview = previewSuggestionDraft(
        createSuggestionDraftSession({
          id: "typed-then-enter",
          baseContent: fixture,
          baseRevision: "one",
          startedAt: "2026-10-20T00:00:00.000Z",
        }),
        draft,
        null,
      );
      if (preview.status !== "ready")
        throw new Error(`Expected a ready draft, got ${preview.status}`);
      expect(preview.suggestions).toHaveLength(1);
      return preview.suggestions;
    }

    function draftSpec(editor: Editor) {
      const draft = docToNfm(editor.getJSON());
      const presentations = documentEditorSuggestionPresentations({
        savedSuggestions: [],
        drafts: draftSuggestions(draft),
        currentMarkdown: draft,
        editingSuggestionId: null,
        pendingSuggestionId: null,
        transitions: new Map(),
      });
      expect(presentations).toHaveLength(1);
      return {
        id: presentations[0]!.id,
        spec: suggestionHighlightSpec(editor.state.doc, presentations[0]!),
      };
    }

    it.each([1, 2])(
      "keeps highlighting the typed text after %s Enter press(es)",
      (enters) => {
        const { editor, dispose } = mountedEditor(fixture);
        try {
          typeAtEnd(editor, "Alpha one has a few words.", " More alpha.");
          for (let index = 0; index < enters; index += 1)
            expect(editor.commands.splitBlock()).toBe(true);
          const { id, spec } = draftSpec(editor);
          expect(spec).not.toBeNull();
          setSuggestionHighlights(editor.view, { specs: [spec!] });
          expect(highlightedText(editor, id)).toBe(" More alpha.");
        } finally {
          dispose();
        }
      },
    );

    it("highlights a list item added after another", () => {
      const { editor, dispose } = mountedEditor(fixture);
      try {
        typeAtEnd(editor, "First item", "");
        expect(editor.commands.splitListItem("listItem")).toBe(true);
        editor.view.dispatch(editor.state.tr.insertText("Inserted item"));
        const { id, spec } = draftSpec(editor);
        expect(spec).not.toBeNull();
        setSuggestionHighlights(editor.view, { specs: [spec!] });
        expect(highlightedText(editor, id)).toBe("Inserted item");
      } finally {
        dispose();
      }
    });

    it("shows a saved paragraph typed after a paragraph as its own block", () => {
      const source = mountedEditor(fixture);
      let presentation: VisualEditorSuggestion | null = null;
      try {
        typeAtEnd(source.editor, "Alpha one has a few words.", " More alpha.");
        source.editor.commands.splitBlock();
        source.editor.view.dispatch(
          source.editor.state.tr.insertText("Alpha follow-up paragraph."),
        );
        const [draft] = draftSuggestions(docToNfm(source.editor.getJSON()));
        presentation = suggestionPresentation(
          { id: "saved", status: "pending", operations: draft!.operations },
          fixture,
        );
      } finally {
        source.dispose();
      }
      expect(presentation).not.toBeNull();
      const { editor, dispose } = mountedEditor(fixture);
      try {
        const spec = suggestionHighlightSpec(editor.state.doc, presentation!);
        expect(spec).not.toBeNull();
        setSuggestionHighlights(editor.view, { specs: [spec!] });
        expect(
          Array.from(editor.view.dom.children, (child) => child.textContent),
        ).toEqual([
          "Alpha one has a few words. More alpha.",
          "Alpha follow-up paragraph.",
          "Bravo two sits in the middle.",
          "First item",
          "Delta four closes it out.",
        ]);
        expect(editor.view.dom.textContent).not.toContain("↵");
        expect(docToNfm(editor.getJSON())).toBe(fixture);
      } finally {
        dispose();
      }
    });
  });

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

describe("a numbered item added in the middle of a list", () => {
  const fixture = [
    "Packing list:",
    "1. Tent",
    "2. Stove",
    "3. Water filter",
    "4. Headlamp",
    "That is everything.",
  ].join("\n");

  function addItemAfter(editor: Editor, item: string, text: string) {
    let end = -1;
    editor.state.doc.descendants((node, pos) => {
      if (end < 0 && node.isTextblock && node.textContent === item)
        end = pos + node.nodeSize - 1;
      return end < 0;
    });
    editor.commands.setTextSelection(end);
    expect(editor.commands.splitListItem("listItem")).toBe(true);
    editor.view.dispatch(editor.state.tr.insertText(text));
  }

  function markdown(editor: Editor): string {
    return docToNfm(editor.getJSON() as PMDoc);
  }

  function required<T>(value: T | null | undefined): T {
    if (value === null || value === undefined)
      throw new Error("Expected a value");
    return value;
  }

  function draftPreview(draft: string) {
    const preview = previewSuggestionDraft(
      createSuggestionDraftSession({
        id: "list-item",
        baseContent: fixture,
        baseRevision: "one",
        startedAt: "2026-11-26T00:00:00.000Z",
      }),
      draft,
      null,
    );
    if (preview.status !== "ready")
      throw new Error(`Expected a ready draft, got ${preview.status}`);
    return preview;
  }

  it("is one suggestion, drawn as its own item where it was added", () => {
    const source = mountedEditor(fixture);
    let presentation: VisualEditorSuggestion | null = null;
    try {
      addItemAfter(source.editor, "Stove", "Rain jacket");
      const draft = markdown(source.editor);
      expect(draft).toContain("3. Rain jacket\n4. Water filter\n5. Headlamp");
      const preview = draftPreview(draft);
      expect(preview.suggestions).toHaveLength(1);
      const { operations } = required(preview.suggestions[0]);
      expect(operations).toMatchObject([
        {
          kind: "add_text_block",
          after: {
            changedText: expect.stringMatching(/^\n?3\. Rain jacket\n?$/),
          },
        },
      ]);

      const [drafted] = documentEditorSuggestionPresentations({
        savedSuggestions: [],
        drafts: preview.suggestions,
        currentMarkdown: draft,
        editingSuggestionId: null,
        pendingSuggestionId: null,
        transitions: new Map(),
      });
      const draftSpec = suggestionHighlightSpec(
        source.editor.state.doc,
        required(drafted),
      );
      expect(draftSpec).not.toBeNull();
      setSuggestionHighlights(source.editor.view, {
        specs: [required(draftSpec)],
      });
      expect(highlightedText(source.editor, required(drafted).id)).toBe(
        "Rain jacket",
      );

      presentation = suggestionPresentation(
        { id: "saved", status: "pending", operations },
        fixture,
      );
    } finally {
      source.dispose();
    }
    expect(presentation).not.toBeNull();
    const { editor, dispose } = mountedEditor(fixture);
    try {
      const spec = suggestionHighlightSpec(
        editor.state.doc,
        required(presentation),
      );
      expect(spec).toMatchObject({ kind: "add_block" });
      setSuggestionHighlights(editor.view, { specs: [required(spec)] });
      const list = required(editor.view.dom.querySelector("ol"));
      expect(Array.from(list.children, (item) => item.textContent)).toEqual([
        "Tent",
        "Stove",
        "Rain jacket",
        "Water filter",
        "Headlamp",
      ]);
      expect(markdown(editor)).toBe(fixture);
    } finally {
      dispose();
    }
  });

  it("keeps two items added in different places as two suggestions", () => {
    const source = mountedEditor(fixture);
    let saved: Array<VisualEditorSuggestion | null> = [];
    try {
      addItemAfter(source.editor, "Tent", "Rain jacket");
      addItemAfter(source.editor, "Stove", "Sunscreen");
      const draft = markdown(source.editor);
      expect(draft).toContain(
        "2. Rain jacket\n3. Stove\n4. Sunscreen\n5. Water filter",
      );
      const preview = draftPreview(draft);
      expect(
        preview.suggestions.flatMap(({ operations }) =>
          operations.map(({ kind }) => kind),
        ),
      ).toEqual(["add_text_block", "add_text_block"]);
      const drafted = documentEditorSuggestionPresentations({
        savedSuggestions: [],
        drafts: preview.suggestions,
        currentMarkdown: draft,
        editingSuggestionId: null,
        pendingSuggestionId: null,
        transitions: new Map(),
      });
      const specs = drafted.map((presentation) =>
        suggestionHighlightSpec(source.editor.state.doc, presentation),
      );
      expect(specs.every((spec) => spec !== null)).toBe(true);
      setSuggestionHighlights(source.editor.view, {
        specs: specs.map(required),
      });
      expect(
        preview.suggestions.map(({ id }) => highlightedText(source.editor, id)),
      ).toEqual(["Rain jacket", "Sunscreen"]);
      saved = preview.suggestions.map(({ id, operations }) =>
        suggestionPresentation({ id, status: "pending", operations }, fixture),
      );
    } finally {
      source.dispose();
    }
    const { editor, dispose } = mountedEditor(fixture);
    try {
      const specs = saved.map((presentation) =>
        suggestionHighlightSpec(editor.state.doc, required(presentation)),
      );
      expect(specs).toMatchObject([
        { kind: "add_block" },
        { kind: "add_block" },
      ]);
      setSuggestionHighlights(editor.view, { specs: specs.map(required) });
      const list = required(editor.view.dom.querySelector("ol"));
      expect(Array.from(list.children, (item) => item.textContent)).toEqual([
        "Tent",
        "Rain jacket",
        "Stove",
        "Sunscreen",
        "Water filter",
        "Headlamp",
      ]);
    } finally {
      dispose();
    }
  });

  it("keeps showing a saved edit to a later item while items are drafted", () => {
    const saved = {
      id: "saved",
      status: "pending",
      operations: [
        required(
          markdownSuggestionOperation(
            fixture,
            fixture.replace("Water filter", "Water filter and spare cartridge"),
          ),
        ),
      ],
    } as ResourceSuggestion;
    const { editor, dispose } = mountedEditor(fixture);
    try {
      addItemAfter(editor, "Tent", "Rain jacket");
      addItemAfter(editor, "Stove", "Sunscreen");
      const draft = markdown(editor);
      const preview = draftPreview(draft);
      const presentations = documentEditorSuggestionPresentations({
        savedSuggestions: [saved],
        drafts: preview.suggestions,
        currentMarkdown: draft,
        editingSuggestionId: null,
        pendingSuggestionId: null,
        transitions: new Map(),
      });
      expect(presentations.map(({ id }) => id)).toContain(saved.id);
      const specs = presentations.map((presentation) =>
        suggestionHighlightSpec(editor.state.doc, presentation),
      );
      expect(specs.every((spec) => spec !== null)).toBe(true);
      setSuggestionHighlights(editor.view, {
        specs: specs.map(required),
      });
      expect(highlightedText(editor, saved.id)).toContain("spare cartridge");
      expect(
        preview.suggestions.map(({ id }) => highlightedText(editor, id)),
      ).toEqual(["Rain jacket", "Sunscreen"]);
    } finally {
      dispose();
    }
  });
});
