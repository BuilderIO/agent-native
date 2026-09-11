// @vitest-environment happy-dom

import { docToNfm, nfmToDoc } from "@shared/nfm";
import { suggestionFormattingSourceRange } from "@shared/suggestion-formatting";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { suggestionPresentation } from "./DocumentEditor";
import { setSuggestionHighlights } from "./extensions/SuggestionHighlight";
import {
  createSuggestionDraftSession,
  previewSuggestionDraft,
  suggestionSessionVisuals,
} from "./suggestions/draft-session";
import type { MarkdownSuggestionOperation } from "./suggestions/markdown-operation";
import {
  createVisualEditorExtensions,
  suggestionHighlightSpec,
  type VisualEditorSuggestion,
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

describe("live heading indentation after a paragraph", () => {
  it.each([
    ["Heading sample.", "draft"],
    ["*Heading* sample.", "draft"],
    ["Heading sample.", "canonical"],
    ["*Heading* sample.", "canonical"],
  ] as const)("renders %s indentation in %s presentation", (heading, mode) => {
    const source = mountedEditor(`Indent sample.\n## ${heading}`);
    let canonicalEditor: ReturnType<typeof mountedEditor> | undefined;
    try {
      const canonical = docToNfm(source.editor.getJSON());
      const headingStart = source.editor.state.doc.firstChild!.nodeSize + 1;
      source.editor.commands.setTextSelection(headingStart);
      expect(source.editor.commands.keyboardShortcut("Tab")).toBe(true);
      const draft = docToNfm(source.editor.getJSON());
      const preview = previewSuggestionDraft(
        createSuggestionDraftSession({
          id: "live-heading-indent",
          baseContent: canonical,
          baseRevision: "one",
          startedAt: "2026-09-09T00:00:00.000Z",
        }),
        draft,
        null,
      );
      expect(preview.status).toBe("ready");
      if (preview.status !== "ready")
        throw new Error("Expected a representable native indent");
      const visuals = suggestionSessionVisuals(preview.suggestions, new Map());
      expect(visuals).toHaveLength(1);
      const visual = visuals[0]!;
      const operation = visual.operations[0]! as MarkdownSuggestionOperation;
      expect(operation).toMatchObject({
        kind: "insert_text",
        before: { changedText: "" },
        after: { changedText: "\t" },
      });
      const snapshot = JSON.stringify(visual);
      // These are DocumentEditor's live-session adapter fields, not its saved adapter.
      const live: VisualEditorSuggestion = {
        id: visual.id,
        kind: operation.kind,
        beforeText: operation.before.changedText,
        afterText: operation.after.changedText,
        beforePresentation: {
          source: operation.before.markdown,
          from: operation.anchor.from,
          to: operation.anchor.to,
        },
        afterPresentation: {
          source: operation.after.markdown,
          from: operation.anchor.from,
          to: operation.anchor.from + operation.after.changedText.length,
        },
        anchor: visual.anchor,
        presentation: "draft",
      };
      const mapped = suggestionFormattingSourceRange(
        draft,
        visual.anchor.from,
        visual.anchor.to,
      );
      expect(mapped).toMatchObject({
        from: "Indent sample.".length,
        to: "Indent sample.".length,
        fromAffinity: "right",
        toAffinity: "left",
      });
      canonicalEditor =
        mode === "canonical" ? mountedEditor(canonical) : undefined;
      const editor = canonicalEditor?.editor ?? source.editor;
      const presentation =
        mode === "draft"
          ? live
          : suggestionPresentation(
              {
                id: visual.id,
                status: "pending",
                operations: visual.operations,
              },
              canonical,
            );
      expect(presentation).not.toBeNull();
      const before = editor.getJSON();
      const spec = suggestionHighlightSpec(editor.state.doc, presentation!);
      expect(spec).toMatchObject({
        kind: "insert",
        from: headingStart,
        to: headingStart,
      });
      setSuggestionHighlights(editor.view, { specs: [spec!] });
      const marker = editor.view.dom.querySelector<HTMLElement>(
        "[data-suggestion-id]",
      );
      expect(marker?.textContent).toBe("⇥");
      expect(marker?.isConnected).toBe(true);
      expect(marker?.parentElement).toBe(editor.view.dom.querySelector("h2"));
      expect(editor.getJSON()).toEqual(before);
      expect(editor.state.doc.child(1).attrs.indent).toBe(
        mode === "draft" ? 1 : 0,
      );
      expect(JSON.stringify(visual)).toBe(snapshot);
    } finally {
      canonicalEditor?.dispose();
      source.dispose();
    }
  });

  it("keeps nonzero cross-block ranges and neighboring marked text directional", () => {
    const source = "Before\n\t## *Heading* tail";
    const tab = source.indexOf("\t");
    const headingText = source.indexOf("*Heading*");
    const heading = suggestionFormattingSourceRange(
      source,
      headingText,
      headingText + "*Heading*".length,
    );
    expect(heading).toMatchObject({ from: 6, to: 13 });
    const crossing = suggestionFormattingSourceRange(
      source,
      0,
      headingText + "*Heading*".length,
    );
    expect(crossing).toMatchObject({ from: 0, to: 13 });
    const indent = suggestionFormattingSourceRange(source, tab, tab + 1);
    expect(indent).toMatchObject({
      from: 6,
      to: 6,
      fromAffinity: "right",
      toAffinity: "left",
    });
    expect(
      suggestionFormattingSourceRange("Before\n## Heading", 7, 10),
    ).toBeNull();
    expect(suggestionFormattingSourceRange("**Bold**", 1, 1)).toBeNull();
    expect(suggestionFormattingSourceRange("One\nTwo", 3, 3)).toMatchObject({
      from: 3,
      fromAffinity: "left",
    });
    expect(suggestionFormattingSourceRange("One\nTwo", 4, 4)).toMatchObject({
      from: 3,
      fromAffinity: "right",
    });
  });
});
