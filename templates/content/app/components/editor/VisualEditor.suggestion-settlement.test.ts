// @vitest-environment happy-dom

import { docToNfm, nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { suggestionPresentations } from "./DocumentEditor";
import {
  acceptedSuggestionAtRange,
  setSuggestionHighlights,
} from "./extensions/SuggestionHighlight";
import { markdownSuggestionOperation } from "./suggestions/markdown-operation";
import {
  createVisualEditorExtensions,
  suggestionHighlightSpec,
  type VisualEditorSuggestion,
} from "./VisualEditor";

function project(editor: Editor, suggestion: VisualEditorSuggestion) {
  const spec = suggestionHighlightSpec(editor.state.doc, suggestion);
  setSuggestionHighlights(editor.view, { specs: spec ? [spec] : [] });
}

describe("accepted suggestion canonical handoff", () => {
  it.each([
    { name: "leading insertion", before: "Before", after: "AddedBefore" },
    { name: "trailing insertion", before: "Before", after: "BeforeAdded" },
    { name: "replacement", before: "Old tail", after: "New tail" },
    { name: "deletion", before: "Old tail", after: " tail" },
    {
      name: "marked insertion",
      before: "**Before**",
      after: "**AddedBefore**",
    },
  ])(
    "hands off a $name with an unrelated peer edit before readback",
    ({ before, after }) => {
      const baseline = `${before}\n\nPeer tail`;
      const accepted = `${after}\n\nPeer tail`;
      const [presentation] = suggestionPresentations(
        {
          id: "accepted",
          status: "pending",
          operations: [markdownSuggestionOperation(baseline, accepted)!],
        },
        baseline,
      );
      const settling: VisualEditorSuggestion = {
        ...presentation!,
        presentation: "settling",
        settlementReadbackContent: null,
      };
      const editor = new Editor({
        extensions: createVisualEditorExtensions(),
        content: nfmToDoc(baseline),
      });
      try {
        editor.view.dispatch(
          editor.state.tr.insertText(
            " retained",
            editor.state.doc.content.size - 1,
          ),
        );
        project(editor, settling);
        const spec = suggestionHighlightSpec(editor.state.doc, settling)!;
        expect(spec).not.toBeNull();
        editor.view.dispatch(
          editor.state.tr.insertText(settling.afterText, spec.from, spec.to),
        );

        const canonical = docToNfm(editor.getJSON() as any);
        expect(canonical).toBe(`${after}\nPeer tail retained`);
        expect(
          editor.view.dom.querySelector(".suggestion-settling-text"),
        ).toBeNull();
        expect(editor.view.dom.textContent).toBe(
          `${after.replace(/\*\*/g, "")}Peer tail retained`,
        );

        project(editor, settling);
        expect(
          editor.view.dom.querySelector(".suggestion-settling-text"),
        ).toBeNull();
        expect(editor.view.dom.textContent).toBe(
          `${after.replace(/\*\*/g, "")}Peer tail retained`,
        );
        expect(docToNfm(editor.getJSON() as any)).toBe(canonical);
      } finally {
        editor.destroy();
      }
    },
  );

  it.each([
    { before: "Before", after: "AddedBefore", current: "Before\nAddedBefore" },
    {
      before: "Before",
      after: "AddedBefore",
      current: "AddedBefore\nAddedBefore",
    },
    {
      before: "Before",
      after: "AddedBefore",
      current: "AddedBefore\nAddedBefore",
      context: "Peer Added",
    },
    {
      before: "NewYork tail",
      after: "New tail",
      current: "NewYork tail\nPeer tail retained",
    },
    {
      before: "Before",
      after: "AddedBefore",
      current: "Changed\nPeer tail retained",
    },
    { before: "Old tail", after: "New tail", current: "Peer tail\nNew tail" },
    { before: "foofoo", after: "foo", current: "foofoo\nPeer tail retained" },
    {
      before: "**Before**",
      after: "**AddedBefore**",
      current: "**Before**\n**AddedBefore**",
    },
  ])(
    "does not treat an unsafe target as accepted: $current",
    ({ before, after, current, context }) => {
      const baseline = `${before}\n\n${context ?? "Peer tail"}`;
      const [presentation] = suggestionPresentations(
        {
          id: "unsafe",
          status: "pending",
          operations: [
            markdownSuggestionOperation(
              baseline,
              `${after}\n\n${context ?? "Peer tail"}`,
            )!,
          ],
        },
        baseline,
      );
      const editor = new Editor({
        extensions: createVisualEditorExtensions(),
        content: nfmToDoc(current),
      });
      try {
        expect(
          acceptedSuggestionAtRange(
            editor.state.doc,
            {
              from: presentation!.beforePresentation!.from + 1,
              to: presentation!.beforePresentation!.to + 1,
            },
            presentation!.beforePresentation!,
            presentation!.afterPresentation!,
          ),
        ).toBe(false);
        project(editor, { ...presentation!, presentation: "settling" });
        expect(docToNfm(editor.getJSON() as any)).toBe(current);
      } finally {
        editor.destroy();
      }
    },
  );
});
