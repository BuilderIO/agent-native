// @vitest-environment happy-dom

import { nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { draftSuggestionIdInRange } from "./BubbleToolbar";
import { setSuggestionHighlights } from "./extensions/SuggestionHighlight";
import { createVisualEditorExtensions } from "./VisualEditor";

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
});
