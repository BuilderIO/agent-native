// @vitest-environment happy-dom

import { Editor, Node } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createRichMarkdownExtensions } from "./RichMarkdownEditor.js";


const BlockAtom = Node.create({
  name: "blockAtom",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { blockId: { default: null } };
  },
  parseHTML() {
    return [{ tag: "div[data-block-atom]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-block-atom": "" }];
  },
});

function docOf(ids: string[]) {
  return {
    type: "doc",
    content: ids.map((id) => ({ type: "blockAtom", attrs: { blockId: id } })),
  };
}

function makeEditor(ids: string[]) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [...createRichMarkdownExtensions(), BlockAtom],
    content: docOf(ids),
  });
}

function atomOrder(editor: Editor): string[] {
  const ids: string[] = [];
  editor.state.doc.forEach((node) => {
    if (node.type.name === "blockAtom") ids.push(node.attrs.blockId as string);
  });
  return ids;
}

function reorderViaReplace(
  editor: Editor,
  ids: string[],
  addToHistory: boolean,
) {
  const view = editor.view;
  const next = view.state.schema.nodeFromJSON(docOf(ids));
  const tr = view.state.tr.replaceWith(
    0,
    view.state.doc.content.size,
    next.content,
  );
  if (!addToHistory) tr.setMeta("addToHistory", false);
  view.dispatch(tr);
}

function pressModZ(editor: Editor, opts: { shift?: boolean } = {}): boolean {
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iP(hone|ad|od)/.test(navigator.platform || "");
  const event = new KeyboardEvent("keydown", {
    key: opts.shift ? "Z" : "z",
    code: "KeyZ",
    keyCode: 90,
    which: 90,
    metaKey: isMac,
    ctrlKey: !isMac,
    shiftKey: !!opts.shift,
    bubbles: true,
    cancelable: true,
  } as KeyboardEventInit);
  return (
    editor.view.someProp("handleKeyDown", (f) => f(editor.view, event)) ?? false
  );
}

describe("structural block reorder undo", () => {
  it("OLD behavior: a non-historical reorder repaint is NOT undoable", () => {
    const editor = makeEditor(["a", "b", "c"]);
    expect(atomOrder(editor)).toEqual(["a", "b", "c"]);

    reorderViaReplace(editor, ["c", "a", "b"], /* addToHistory */ false);
    expect(atomOrder(editor)).toEqual(["c", "a", "b"]);

    pressModZ(editor);
    expect(atomOrder(editor)).toEqual(["c", "a", "b"]);
    editor.destroy();
  });

  it("FIX: a historical reorder repaint is reverted by cmd+z and redone by cmd+shift+z", () => {
    const editor = makeEditor(["a", "b", "c"]);
    expect(atomOrder(editor)).toEqual(["a", "b", "c"]);

    reorderViaReplace(editor, ["c", "a", "b"], /* addToHistory */ true);
    expect(atomOrder(editor)).toEqual(["c", "a", "b"]);

    const undid = pressModZ(editor);
    expect(undid).toBe(true);
    expect(atomOrder(editor)).toEqual(["a", "b", "c"]);

    const redid = pressModZ(editor, { shift: true });
    expect(redid).toBe(true);
    expect(atomOrder(editor)).toEqual(["c", "a", "b"]);
    editor.destroy();
  });
});
