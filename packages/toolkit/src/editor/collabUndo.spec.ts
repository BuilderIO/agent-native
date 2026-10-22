// @vitest-environment happy-dom

import { Editor, Extension } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { prosemirrorToYDoc, yUndoPluginKey } from "@tiptap/y-tiptap";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createRichMarkdownExtensions } from "./RichMarkdownEditor.js";

const PAGE = `Paragraph block

### Heading three

Last paragraph`;

const editors: Editor[] = [];

afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
});

/** Answers every change with a transaction of its own, as highlight plugins do. */
const AnswerEveryChange = Extension.create({
  name: "answerEveryChange",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        view: () => ({
          update: (view, previous) => {
            if (view.state.doc.eq(previous.doc)) return;
            view.dispatch(view.state.tr.setMeta("answered", true));
          },
        }),
      }),
    ];
  },
});

function pageUpdate(page: string) {
  const seed = new Editor({
    extensions: createRichMarkdownExtensions(),
    content: page,
  });
  const update = Y.encodeStateAsUpdate(
    prosemirrorToYDoc(seed.state.doc, "default"),
  );
  seed.destroy();
  return update;
}

function collabEditor(page = PAGE, extensions: Extension[] = []) {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, pageUpdate(page));
  const editor = new Editor({
    extensions: [...createRichMarkdownExtensions({ ydoc }), ...extensions],
  });
  editors.push(editor);
  return { editor, ydoc };
}

const LAST_HEADING = `Paragraph block

### Heading three`;

/** Opens a page ending in a heading, from Yjs or from a provider that syncs after. */
async function editorWithLastHeading(arrives: "before" | "after") {
  if (arrives === "before") return collabEditor(LAST_HEADING).editor;
  const ydoc = new Y.Doc();
  const editor = new Editor({
    extensions: createRichMarkdownExtensions({ ydoc }),
  });
  editors.push(editor);
  Y.applyUpdate(ydoc, pageUpdate(LAST_HEADING), "provider");
  await Promise.resolve();
  return editor;
}

/** Ends the undo manager's capture window, like a pause between edits. */
function pause(editor: Editor) {
  yUndoPluginKey.getState(editor.state)!.undoManager.stopCapturing();
}

function placeCaret(editor: Editor, pos: number) {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
  );
}

function type(editor: Editor, text: string) {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    editor.view.dispatch(editor.state.tr.insertText(char, from, to));
  }
}

function selectRange(editor: Editor, anchor: number, head: number) {
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, anchor, head),
    ),
  );
}

function selection(editor: Editor) {
  const { anchor, head } = editor.state.selection;
  return { anchor, head };
}

/** Applies a collaborator's change to the page. */
function fromPeer(ydoc: Y.Doc, change: (page: Y.XmlFragment) => void) {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(ydoc));
  change(peer.getXmlFragment("default"));
  Y.applyUpdate(
    ydoc,
    Y.encodeStateAsUpdate(peer, Y.encodeStateVector(ydoc)),
    "remote",
  );
}

function undoManager(editor: Editor) {
  return yUndoPluginKey.getState(editor.state)!.undoManager;
}

function firstBlock(editor: Editor) {
  const node = editor.state.doc.firstChild!;
  const level = node.attrs.level ? String(node.attrs.level) : "";
  return `${node.type.name}${level}: ${node.textContent}`;
}

describe("collaborative undo around block type changes", () => {
  it("keeps a block's text when undoing typing that a type change removed", () => {
    const { editor } = collabEditor();
    placeCaret(editor, 1);
    type(editor, "abc");
    pause(editor);
    editor.commands.deleteRange({ from: 1, to: 4 });
    editor.commands.setHeading({ level: 2 });
    expect(firstBlock(editor)).toBe("heading2: Paragraph block");

    editor.commands.undo();
    expect(firstBlock(editor)).toBe("paragraph: abcParagraph block");
    expect(editor.state.selection.head).toBe(4);
    editor.commands.undo();
    expect(firstBlock(editor)).toBe("paragraph: Paragraph block");
    expect(editor.state.selection.head).toBe(1);

    editor.commands.redo();
    editor.commands.redo();
    expect(firstBlock(editor)).toBe("heading2: Paragraph block");
  });

  it("keeps a block's text when an undo passes over an edit a collaborator removed", () => {
    const { editor, ydoc } = collabEditor();
    placeCaret(editor, 1);
    type(editor, "abc");
    pause(editor);
    editor.commands.deleteRange({ from: 22, to: 23 });
    pause(editor);
    editor.commands.deleteRange({ from: 1, to: 4 });
    editor.commands.setHeading({ level: 2 });
    editor.commands.undo();
    expect(firstBlock(editor)).toBe("paragraph: abcParagraph block");

    // The heading the second edit changed is gone, so that undo changes
    // nothing and Yjs goes on to undo the typing.
    fromPeer(ydoc, (page) => page.delete(1));
    editor.commands.undo();
    expect(firstBlock(editor)).toBe("paragraph: Paragraph block");
  });

  it("keeps a selected range through undo and redo of a type change", () => {
    const { editor } = collabEditor();
    selectRange(editor, 7, 2);
    pause(editor);
    editor.commands.setHeading({ level: 3 });

    editor.commands.undo();
    expect(firstBlock(editor)).toBe("paragraph: Paragraph block");
    expect(selection(editor)).toEqual({ anchor: 7, head: 2 });

    editor.commands.redo();
    expect(firstBlock(editor)).toBe("heading3: Paragraph block");
    expect(selection(editor)).toEqual({ anchor: 7, head: 2 });
  });

  it("keeps the caret in its block through undo and redo of a type change", () => {
    const { editor } = collabEditor();
    placeCaret(editor, 4);
    pause(editor);
    editor.commands.setHeading({ level: 3 });

    editor.commands.undo();
    expect(firstBlock(editor)).toBe("paragraph: Paragraph block");
    expect(editor.state.selection.head).toBe(4);

    editor.commands.redo();
    expect(firstBlock(editor)).toBe("heading3: Paragraph block");
    expect(editor.state.selection.head).toBe(4);
  });

  it("keeps the caret in its block when a plugin answers a redo", () => {
    const { editor } = collabEditor(PAGE, [AnswerEveryChange]);
    placeCaret(editor, 4);
    pause(editor);
    editor.commands.setHeading({ level: 3 });

    editor.commands.undo();
    editor.commands.redo();
    expect(firstBlock(editor)).toBe("heading3: Paragraph block");
    editor.commands.undo();
    expect(firstBlock(editor)).toBe("paragraph: Paragraph block");
    expect(editor.state.selection.head).toBe(4);
  });

  for (const arrives of ["before", "after"] as const) {
    it(`keeps the paragraph added after a last heading out of undo history when the page arrives ${arrives} the editor`, async () => {
      const editor = await editorWithLastHeading(arrives);
      expect(editor.state.doc.lastChild!.type.name).toBe("paragraph");
      expect(undoManager(editor).undoStack).toHaveLength(0);

      placeCaret(editor, 4);
      pause(editor);
      editor.commands.setHeading({ level: 2 });
      editor.commands.undo();
      editor.commands.undo();
      expect(editor.state.doc.lastChild!.type.name).toBe("paragraph");
      editor.commands.redo();
      expect(firstBlock(editor)).toBe("heading2: Paragraph block");
    });
  }

  it("leaves the caret alone when a collaborator edits after an undo", () => {
    const { editor, ydoc } = collabEditor();
    placeCaret(editor, 4);
    type(editor, "XY");
    placeCaret(editor, 12);
    pause(editor);
    editor.commands.undo();
    expect(editor.state.selection.head).toBe(10);

    fromPeer(ydoc, (page) => {
      const heading = page.get(1) as Y.XmlElement;
      (heading.get(0) as Y.XmlText).insert(0, "Remote ");
    });

    expect(editor.state.doc.child(1).textContent).toBe("Remote Heading three");
    expect(editor.state.selection.head).toBe(10);
  });
});
