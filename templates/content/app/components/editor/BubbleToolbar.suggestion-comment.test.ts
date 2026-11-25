// @vitest-environment happy-dom

import { nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import {
  draftSuggestionIdInRange,
  selectedSuggestionWidgetId,
  startCommentOnRange,
} from "./BubbleToolbar";
import { setSuggestionHighlights } from "./extensions/SuggestionHighlight";
import { createVisualEditorExtensions } from "./VisualEditor";

function found<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Not found");
  return value;
}

describe("commenting on suggested text", () => {
  it("names the draft suggestion whose suggested text the selection touches", () => {
    const text = "Keep this. Suggested words. Keep that.";
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: nfmToDoc(text),
    });
    const at = (needle: string) => 1 + text.indexOf(needle);
    try {
      setSuggestionHighlights(editor.view, {
        specs: [
          {
            suggestionId: "deleted",
            kind: "delete",
            from: at("Keep this."),
            to: at(" Suggested"),
            deletedText: "Keep this.",
          },
          {
            suggestionId: "suggested",
            kind: "mark",
            from: at("Suggested"),
            to: at(" Keep that."),
            editableText: true,
          },
          {
            suggestionId: "settling",
            kind: "insert",
            from: at("Keep that."),
            to: at("Keep that.") + "Keep that.".length,
            insertedText: "Keep that.",
            settling: true,
            editableText: true,
          },
        ],
      });
      const state = editor.state;

      expect(
        draftSuggestionIdInRange(state, at("words"), at(". Keep that")),
      ).toBe("suggested");
      expect(draftSuggestionIdInRange(state, at("this"), at("words"))).toBe(
        "suggested",
      );
      expect(
        draftSuggestionIdInRange(state, at("Keep this"), at(" Suggested")),
      ).toBeUndefined();
      expect(
        draftSuggestionIdInRange(state, at("that"), at("that") + 4),
      ).toBeUndefined();
    } finally {
      editor.destroy();
    }
  });

  it("names the suggestion whose inserted words a selection starts or ends in", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<p>Keep <span data-suggestion-widget="true" data-suggestion-id="s1" contenteditable="false">very sleepy</span> that.</p>';
    const outside = document.createElement("p");
    outside.innerHTML =
      '<span data-suggestion-widget="true" data-suggestion-id="s2">elsewhere</span>';
    document.body.append(root, outside);
    const selection = found(document.getSelection());
    const paragraph = found(root.querySelector("p"));
    const before = found(paragraph.firstChild);
    const after = found(paragraph.lastChild);
    const inserted = found(
      root.querySelector("[data-suggestion-id]")?.firstChild,
    );
    try {
      selection.setBaseAndExtent(inserted, 5, after, 5);
      expect(selectedSuggestionWidgetId(root)).toBe("s1");
      selection.setBaseAndExtent(after, 5, inserted, 0);
      expect(selectedSuggestionWidgetId(root)).toBe("s1");
      selection.setBaseAndExtent(before, 0, before, 4);
      expect(selectedSuggestionWidgetId(root)).toBeUndefined();
      const elsewhere = found(outside.firstChild?.firstChild);
      selection.setBaseAndExtent(elsewhere, 0, elsewhere, 4);
      expect(selectedSuggestionWidgetId(root)).toBeUndefined();
    } finally {
      selection.removeAllRanges();
      root.remove();
      outside.remove();
    }
  });

  it("posts a comment that runs into a suggestion's inserted words on that suggestion", () => {
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: nfmToDoc("Keep that."),
    });
    editor.view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
    const posted: { quote: string; suggestionId: string | undefined }[] = [];
    const onComment = (
      quote: string,
      _offsetTop: number,
      _anchor?: unknown,
      _range?: unknown,
      suggestionId?: string,
    ) => posted.push({ quote, suggestionId });
    try {
      startCommentOnRange(editor, onComment, { from: 1, to: 5 }, "s1");
      startCommentOnRange(editor, onComment, { from: 1, to: 5 });
      expect(posted).toEqual([
        { quote: "Keep", suggestionId: "s1" },
        { quote: "Keep", suggestionId: undefined },
      ]);
    } finally {
      editor.destroy();
    }
  });
});
