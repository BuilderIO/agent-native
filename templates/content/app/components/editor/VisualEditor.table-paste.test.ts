// @vitest-environment jsdom
// happy-dom can't parse a pasted table: it rejects one of the editor's parse
// rule selectors when it meets the table's <colgroup>.

import { docToNfm, nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import {
  createVisualEditorExtensions,
  parseMarkdownClipboardSlice,
} from "./VisualEditor";

function createEditor(content = "") {
  return new Editor({
    extensions: createVisualEditorExtensions(),
    content: content
      ? nfmToDoc(content)
      : { type: "doc", content: [{ type: "paragraph" }] },
  });
}

function headerCellTexts(editor: Editor) {
  const texts: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "tableHeader") texts.push(node.textContent);
  });
  return texts;
}

describe("pasted tables", () => {
  it("keep their header row through a save and reload", () => {
    const editor = createEditor();
    try {
      const slice = parseMarkdownClipboardSlice(
        editor,
        "| Item | State |\n| --- | --- |\n| Alpha | Draft |",
      );
      expect(slice).not.toBeNull();
      editor.view.dispatch(editor.state.tr.replaceSelection(slice!));
      expect(headerCellTexts(editor)).toEqual(["Item", "State"]);

      const saved = docToNfm(editor.state.doc.toJSON());
      expect(saved).toContain('<table header-row="true">');
      const reloaded = createEditor(saved);
      try {
        expect(headerCellTexts(reloaded)).toEqual(["Item", "State"]);
      } finally {
        reloaded.destroy();
      }
    } finally {
      editor.destroy();
    }
  });
});
