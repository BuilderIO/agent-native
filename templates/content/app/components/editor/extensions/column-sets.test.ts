// @vitest-environment happy-dom
import { docToNfm, nfmToDoc, type PMDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { afterEach, describe, expect, it } from "vitest";

import { createVisualEditorExtensions } from "../VisualEditor";

const L = (...lines: string[]) => lines.join("\n");

function found<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected the page to have it");
  return value;
}

const TWO_COLUMNS = L(
  "<columns>",
  "\t<column>",
  "\t\tLeft",
  "\t</column>",
  "\t<column>",
  "\t\tRight",
  "\t</column>",
  "</columns>",
  "After",
);

const THREE_COLUMNS = L(
  "<columns>",
  '\t<column ratio="50">',
  "\t\tFirst",
  "\t</column>",
  '\t<column ratio="25">',
  "\t\tSecond",
  "\t</column>",
  '\t<column ratio="25">',
  "\t\tThird",
  "\t</column>",
  "</columns>",
);

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function openEditor(nfm: string) {
  const editor = new Editor({
    extensions: createVisualEditorExtensions(),
    content: nfmToDoc(nfm),
  });
  editors.push(editor);
  return editor;
}

/** Where the paragraph that reads `text` starts. */
function blockAt(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isTextblock && node.textContent === text) found = pos;
    return true;
  });
  if (found < 0) throw new Error(`No block reads "${text}"`);
  return found;
}

const nfmOf = (editor: Editor) => docToNfm(editor.getJSON() as PMDoc);

/** Replaces the page with what a paste of `html` reads. */
function pasteHtml(editor: Editor, html: string) {
  const element = document.createElement("div");
  element.innerHTML = html;
  const parsed = ProseMirrorDOMParser.fromSchema(editor.schema).parse(element);
  const { doc } = editor.state;
  editor.view.dispatch(
    editor.state.tr.replaceWith(0, doc.content.size, parsed.content),
  );
}

/** Drags the block that reads `text` to the start or the end of the page. */
function dragTo(editor: Editor, text: string, where: "start" | "end") {
  const pos = blockAt(editor, text);
  const block = found(editor.state.doc.nodeAt(pos));
  const tr = editor.state.tr.delete(pos, pos + block.nodeSize);
  tr.insert(where === "start" ? 0 : tr.doc.content.size, block);
  editor.view.dispatch(tr.setMeta("uiEvent", "drop"));
}

const dragToEnd = (editor: Editor, text: string) => dragTo(editor, text, "end");

/** Selects the block that reads `text` and deletes it. */
function deleteBlock(editor: Editor, text: string) {
  const { state } = editor;
  const tr = state.tr.setSelection(
    NodeSelection.create(state.doc, blockAt(editor, text)),
  );
  editor.view.dispatch(tr.deleteSelection());
}

describe("column sets after an edit", () => {
  it("becomes its last column's blocks when a drag empties the other", () => {
    const editor = openEditor(TWO_COLUMNS);

    dragToEnd(editor, "Right");

    expect(nfmOf(editor)).toBe(L("Left", "After", "Right"));
  });

  it("becomes its last column's blocks when the other's only block is deleted", () => {
    const editor = openEditor(TWO_COLUMNS);

    deleteBlock(editor, "Left");

    expect(nfmOf(editor)).toBe(L("Right", "After"));
  });

  it("drops an emptied column and shares its width among the rest", () => {
    const editor = openEditor(THREE_COLUMNS);

    dragToEnd(editor, "Second");

    expect(nfmOf(editor)).toBe(
      L(
        "<columns>",
        '\t<column ratio="66.67">',
        "\t\tFirst",
        "\t</column>",
        '\t<column ratio="33.33">',
        "\t\tThird",
        "\t</column>",
        "</columns>",
        "Second",
      ),
    );
  });

  it("repairs a set when the block lands right before it", () => {
    const editor = openEditor(THREE_COLUMNS);

    dragTo(editor, "First", "start");

    expect(nfmOf(editor)).toBe(
      L(
        "First",
        "<columns>",
        '\t<column ratio="50">',
        "\t\tSecond",
        "\t</column>",
        '\t<column ratio="50">',
        "\t\tThird",
        "\t</column>",
        "</columns>",
      ),
    );
  });

  it("keeps a column whose text was cleared", () => {
    const editor = openEditor(TWO_COLUMNS);
    const pos = blockAt(editor, "Right");

    editor.view.dispatch(
      editor.state.tr.delete(pos + 1, pos + 1 + "Right".length),
    );

    const set = found(editor.state.doc.firstChild);
    expect(set.type.name).toBe("notionColumns");
    expect(set.childCount).toBe(2);
  });

  it("leaves a one-column set someone wrote as it is", () => {
    const editor = openEditor(
      L("<columns>", "\t<column>", "\t\tOnly", "\t</column>", "</columns>"),
    );
    const pos = blockAt(editor, "Only");

    editor.view.dispatch(
      editor.state.tr
        .setSelection(TextSelection.create(editor.state.doc, pos + 5))
        .insertText("!"),
    );

    expect(nfmOf(editor)).toBe(
      L("<columns>", "\t<column>", "\t\tOnly!", "\t</column>", "</columns>"),
    );
  });

  it("leaves another tab's change for that tab to repair", () => {
    const editor = openEditor(TWO_COLUMNS);
    const pos = blockAt(editor, "Right");
    const block = found(editor.state.doc.nodeAt(pos));

    editor.view.dispatch(
      editor.state.tr
        .delete(pos, pos + block.nodeSize)
        .setMeta(ySyncPluginKey, { isChangeOrigin: true }),
    );

    expect(editor.state.doc.firstChild?.childCount).toBe(2);
  });

  it("leaves a page that can't be edited alone", () => {
    const editor = openEditor(TWO_COLUMNS);
    editor.setEditable(false);

    dragToEnd(editor, "Right");

    expect(editor.state.doc.firstChild?.type.name).toBe("notionColumns");
  });
});

describe("column widths in the editor", () => {
  it("reads widths from pasted columns and draws them", () => {
    const editor = openEditor("Start");

    pasteHtml(
      editor,
      [
        "<div data-notion-columns>",
        '<div data-notion-column data-ratio="70"><p>Wide</p></div>',
        '<div data-notion-column data-ratio="30"><p>Narrow</p></div>',
        "</div>",
      ].join(""),
    );

    const set = found(editor.state.doc.firstChild);
    expect([set.child(0).attrs.ratio, set.child(1).attrs.ratio]).toEqual([
      70, 30,
    ]);
    const columns = editor.view.dom.querySelectorAll<HTMLElement>(
      "[data-notion-column]",
    );
    expect([...columns].map((column) => column.style.flexGrow)).toEqual([
      "70",
      "30",
    ]);
  });

  it("gives pasted columns without a width equal ones", () => {
    const editor = openEditor("Start");

    pasteHtml(
      editor,
      [
        "<div data-notion-columns>",
        '<div data-notion-column data-ratio="50"><p>Half</p></div>',
        "<div data-notion-column><p>Quarter</p></div>",
        "<div data-notion-column><p>Quarter</p></div>",
        "</div>",
      ].join(""),
    );

    const set = found(editor.state.doc.firstChild);
    const ratios: unknown[] = [];
    set.forEach((column) => ratios.push(column.attrs.ratio));
    expect(ratios).toEqual([50, 25, 25]);
  });
});
