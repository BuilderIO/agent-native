// @vitest-environment happy-dom

import { docToNfm, nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { suggestionPresentation } from "./DocumentEditor";
import { setSuggestionHighlights } from "./extensions/SuggestionHighlight";
import {
  draftSuggestionAnchors,
  markdownSuggestionOperations,
} from "./suggestions/markdown-operation";
import {
  createVisualEditorExtensions,
  suggestionHighlightSpec,
} from "./VisualEditor";

function mountedEditor(content: string) {
  const mount = document.createElement("div");
  document.body.append(mount);
  const editor = new Editor({
    element: mount,
    extensions: createVisualEditorExtensions(),
    content: nfmToDoc(content),
  });
  editor.view.dispatch(editor.state.tr);
  return {
    editor,
    dispose: () => {
      editor.destroy();
      mount.remove();
    },
  };
}

describe("saved structural outdent presentation", () => {
  it.each([
    ["Indent sample.\n## *Heading* sample.", "p", "canonical"],
    ["Indent sample.\n## *Heading* sample.", "p", "draft"],
    ["## *Heading* sample.\nTail sample.", "h2", "canonical"],
    ["## *Heading* sample.\nTail sample.", "h2", "draft"],
  ] as const)(
    "renders a real native Tab/ShiftTab %s %s proposal in %s state",
    (initial, tag, mode) => {
      const source = mountedEditor(initial);
      let rendered: ReturnType<typeof mountedEditor> | undefined;
      try {
        source.editor.commands.setTextSelection(1);
        expect(source.editor.commands.keyboardShortcut("Tab")).toBe(true);
        const canonical = docToNfm(source.editor.getJSON());
        expect(source.editor.state.doc.firstChild?.attrs.indent).toBe(1);
        expect(source.editor.commands.keyboardShortcut("Shift-Tab")).toBe(true);
        const draft = docToNfm(source.editor.getJSON());
        const operations = markdownSuggestionOperations(canonical, draft);
        expect(operations).toHaveLength(1);
        const operation = operations[0]!;
        expect(operation).toMatchObject({
          kind: "delete_text",
          before: { changedText: "\t" },
          after: { changedText: "" },
        });
        const saved = {
          id: "saved-outdent",
          status: "pending" as const,
          operations,
        };
        const savedBefore = JSON.stringify(saved);
        expect(operation.before.markdown).toBe(canonical);
        expect(operation.after.markdown).toBe(draft);
        const presentation = suggestionPresentation(saved, canonical);
        expect(presentation).not.toBeNull();
        rendered = mountedEditor(mode === "canonical" ? canonical : draft);
        const before = rendered.editor.getJSON();
        const spec = suggestionHighlightSpec(
          rendered.editor.state.doc,
          mode === "canonical"
            ? presentation!
            : {
                ...presentation!,
                presentation: "draft",
                anchor: draftSuggestionAnchors(operations, draft)[0]!,
              },
        );
        expect(spec).not.toBeNull();
        expect(spec).toMatchObject({ kind: "delete", from: 1, to: 1 });
        setSuggestionHighlights(rendered.editor.view, { specs: [spec!] });
        const marker = rendered.editor.view.dom.querySelector<HTMLElement>(
          '[data-suggestion-id="saved-outdent"]',
        );
        expect(marker?.textContent).toBe("⇥");
        expect(marker?.isConnected).toBe(true);
        expect(marker?.parentElement).toBe(
          rendered.editor.view.dom.querySelector(tag),
        );
        expect(rendered.editor.getJSON()).toEqual(before);
        expect(JSON.stringify(saved)).toBe(savedBefore);
        expect(rendered.editor.state.doc.firstChild?.attrs.indent).toBe(
          mode === "canonical" ? 1 : 0,
        );
      } finally {
        rendered?.dispose();
        source.dispose();
      }
    },
  );

  it("does not classify an ordinary internal tab as structural indentation", () => {
    const canonical = "Before\tAfter";
    const operations = markdownSuggestionOperations(canonical, "BeforeAfter");
    const presentation = suggestionPresentation(
      { id: "inline-tab", status: "pending", operations },
      canonical,
    );
    expect(presentation).not.toBeNull();
    const { editor, dispose } = mountedEditor(canonical);
    try {
      const spec = suggestionHighlightSpec(editor.state.doc, presentation!);
      expect(spec).not.toBeNull();
      expect(spec!.to).toBeGreaterThan(spec!.from);
      expect(spec!.deletedText).toBeUndefined();
      setSuggestionHighlights(editor.view, { specs: [spec!] });
      expect(
        editor.view.dom.querySelector(".suggestion-delete-widget"),
      ).toBeNull();
    } finally {
      dispose();
    }
  });

  it("rejects malformed presentation context and unavailable saved source anchors", () => {
    const canonical = "\tIndent sample.";
    const operations = markdownSuggestionOperations(
      canonical,
      "Indent sample.",
    );
    const saved = {
      id: "invalid-context",
      status: "pending" as const,
      operations,
    };
    const presentation = suggestionPresentation(saved, canonical)!;
    const { editor, dispose } = mountedEditor(canonical);
    try {
      expect(
        suggestionHighlightSpec(editor.state.doc, {
          ...presentation,
          beforePresentation: { source: "unrelated", from: 0, to: 1 },
        }),
      ).toBeNull();
      expect(suggestionPresentation(saved, "Different paragraph.")).toBeNull();
    } finally {
      dispose();
    }
  });
});
