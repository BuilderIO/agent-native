// @vitest-environment happy-dom

import { nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
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

  it("names the suggestion whose inserted words a selection starts, ends or stops beside", () => {
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
    const select = (
      [anchorNode, anchorOffset]: readonly [Node, number],
      [focusNode, focusOffset]: readonly [Node, number],
      anchor: number,
      head: number,
    ) => {
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, anchor, head),
        ),
      );
      selection.setBaseAndExtent(
        anchorNode,
        anchorOffset,
        focusNode,
        focusOffset,
      );
      return selectedSuggestionWidgetId(editor.view);
    };
    try {
      const at = 1 + "Keep ".length;
      const end = 1 + "Keep that".length;
      setSuggestionHighlights(editor.view, {
        specs: [
          {
            suggestionId: "d1",
            kind: "delete",
            from: 1,
            to: 1,
            deletedText: "Gone ",
          },
          {
            suggestionId: "s1",
            kind: "insert",
            from: at,
            to: at,
            insertedText: "very sleepy ",
          },
          {
            suggestionId: "s2",
            kind: "insert",
            from: end,
            to: end,
            insertedText: " now",
          },
        ],
      });
      const widget = (id: string) =>
        found(
          element.querySelector<HTMLElement>(`[data-suggestion-id="${id}"]`),
        );
      const textIn = (id: string) =>
        found(
          document
            .createTreeWalker(widget(id), NodeFilter.SHOW_TEXT)
            .nextNode(),
        );
      const inserted = [textIn("s1"), 5] as const;
      const after = [found(widget("s1").nextSibling), 2] as const;
      const before = found(widget("s1").previousSibling);

      expect(select(inserted, after, at, at + 2)).toBe("s1");
      expect(select(after, inserted, at + 2, at)).toBe("s1");
      expect(select(inserted, after, 1, 3)).toBeUndefined();
      expect(select([before, 0], [before, 4], 1, 5)).toBeUndefined();
      expect(
        select(inserted, [found(outside.firstChild), 4], at, at),
      ).toBeUndefined();
      expect(select([textIn("d1"), 2], inserted, 1, at)).toBe("s1");
      expect(select(inserted, [textIn("d1"), 2], at, 1)).toBe("s1");
      expect(select([textIn("d1"), 2], [before, 2], 1, 3)).toBeUndefined();
      expect(select(inserted, [textIn("s2"), 2], at, end)).toBeUndefined();

      const beside = [before, "Keep ".length] as const;
      expect(select(after, beside, at + 2, at)).toBe("s1");
      expect(select(beside, after, at, at + 2)).toBe("s1");
      expect(select([before, 0], beside, 1, at)).toBeUndefined();
      expect(select([before, 0], after, 1, at + 2)).toBeUndefined();
      expect(select(after, beside, 1, 3)).toBeUndefined();
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
