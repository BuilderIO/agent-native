// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
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

function collabEditor() {
  const seed = new Editor({
    extensions: createRichMarkdownExtensions(),
    content: PAGE,
  });
  const ydoc = new Y.Doc();
  Y.applyUpdate(
    ydoc,
    Y.encodeStateAsUpdate(prosemirrorToYDoc(seed.state.doc, "default")),
  );
  seed.destroy();
  const editor = new Editor({
    extensions: createRichMarkdownExtensions({ ydoc }),
  });
  editors.push(editor);
  return { editor, ydoc };
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

  it("leaves the caret alone when a collaborator edits after an undo", () => {
    const { editor, ydoc } = collabEditor();
    placeCaret(editor, 4);
    type(editor, "XY");
    placeCaret(editor, 12);
    pause(editor);
    editor.commands.undo();
    expect(editor.state.selection.head).toBe(10);

    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(ydoc));
    const heading = peer.getXmlFragment("default").get(1) as Y.XmlElement;
    (heading.get(0) as Y.XmlText).insert(0, "Remote ");
    Y.applyUpdate(
      ydoc,
      Y.encodeStateAsUpdate(peer, Y.encodeStateVector(ydoc)),
      "remote",
    );

    expect(editor.state.doc.child(1).textContent).toBe("Remote Heading three");
    expect(editor.state.selection.head).toBe(10);
  });
});
