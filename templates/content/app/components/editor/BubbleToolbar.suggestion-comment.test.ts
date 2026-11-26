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
    const element = document.createElement("div");
    const outside = document.createElement("p");
    outside.textContent = "Elsewhere";
    document.body.append(element, outside);
    const editor = new Editor({
      element,
      extensions: createVisualEditorExtensions(),
      content: nfmToDoc("Keep that."),
    });
    const selection = found(document.getSelection());
    try {
      const at = 1 + "Keep ".length;
      setSuggestionHighlights(editor.view, {
        specs: [
          {
            suggestionId: "s1",
            kind: "insert",
            from: at,
            to: at,
            insertedText: "very sleepy ",
          },
        ],
      });
      const widget = found(
        element.querySelector<HTMLElement>('[data-suggestion-id="s1"]'),
      );
      const inserted = found(
        document.createTreeWalker(widget, NodeFilter.SHOW_TEXT).nextNode(),
      );
      const after = found(widget.nextSibling);
      const before = found(widget.previousSibling);
      const around = { from: at, to: at + 2 };

      selection.setBaseAndExtent(inserted, 5, after, 2);
      expect(selectedSuggestionWidgetId(editor.view, around)).toBe("s1");
      selection.setBaseAndExtent(after, 2, inserted, 0);
      expect(selectedSuggestionWidgetId(editor.view, around)).toBe("s1");
      expect(
        selectedSuggestionWidgetId(editor.view, { from: 1, to: 3 }),
      ).toBeUndefined();
      selection.setBaseAndExtent(before, 0, before, 4);
      expect(selectedSuggestionWidgetId(editor.view, around)).toBeUndefined();
      selection.setBaseAndExtent(inserted, 0, found(outside.firstChild), 4);
      expect(selectedSuggestionWidgetId(editor.view, around)).toBeUndefined();
    } finally {
      selection.removeAllRanges();
      editor.destroy();
      element.remove();
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
