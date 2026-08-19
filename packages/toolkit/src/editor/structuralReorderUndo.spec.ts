// @vitest-environment happy-dom

import { Editor, Node } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createRichMarkdownExtensions } from "./RichMarkdownEditor.js";

/**
 * Structural block reorder must be undoable with cmd+z (Notion parity).
 *
 * The plan editor renders the whole document as ONE ProseMirror doc; structured
 * blocks are atomic `planBlock` nodes. Dragging a block to reorder it repaints
 * the doc via a whole-document `replaceWith` (the plan editor's
 * `replaceEditorViewBlocks`). That repaint used to be dispatched with
 * `addToHistory: false`, so the editor's (already working) undo keymap had
 * nothing to revert — cmd+z after a drag did nothing. The fix makes a
 * single-editor drag repaint a HISTORICAL transaction, so the existing undo
 * stack captures the reorder and interleaves it with text edits, exactly like
 * Notion.
 *
 * This reproduces that exact mechanism headlessly: a minimal block-level ATOM
 * (the analog of `planBlock`, but with a plain-DOM render so no React NodeView
 * is needed) reordered by a whole-document `replaceWith`, dispatched the two
 * ways — and asserts cmd+z reverts ONLY the historical one.
 */

// Minimal stand-in for the plan's atomic `planBlock` node.
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

// Initial content goes through the constructor, NOT setContent, so the seed is
// the baseline doc and is NOT itself an undoable history entry — the first
// undoable step is whatever the test dispatches next.
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

/** Reorder by replacing the whole doc — the shape of `replaceEditorViewBlocks`. */
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

/** Fire a real Mod-z (or Shift-Mod-z) through the ProseMirror undo keymap. */
function pressModZ(editor: Editor, opts: { shift?: boolean } = {}): boolean {
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iP(hone|ad|od)/.test(navigator.platform || "");
  const event = new KeyboardEvent("keydown", {
    key: opts.shift ? "Z" : "z",
    code: "KeyZ",
    // prosemirror-keymap resolves a shifted letter (Shift-Mod-Z → redo) through
    // the physical key via `event.keyCode`; a real browser sends it, so the
    // synthetic event must too or the redo binding never matches.
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
    // Nothing to undo — the reorder was deliberately excluded from history.
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
