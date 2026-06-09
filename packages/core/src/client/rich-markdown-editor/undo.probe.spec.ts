// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Editor } from "@tiptap/core";
import { createRichMarkdownExtensions } from "./RichMarkdownEditor.js";

function makeEditor(opts?: Parameters<typeof createRichMarkdownExtensions>[0]) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: createRichMarkdownExtensions(opts),
  });
}

// Fire a Mod-z (undo) keydown THROUGH the ProseMirror keymap, exactly as a real
// keypress on the focused editor would. This tests the keyboard binding, not the
// command — i.e. "does pressing cmd+z actually trigger undo".
function pressModZ(editor: Editor, opts: { shift?: boolean } = {}): boolean {
  // prosemirror-keymap normalizes "Mod" to Meta on Mac, Ctrl elsewhere, using
  // navigator.platform. Match that so the synthetic event actually hits the
  // bound shortcut (real browsers send exactly one of meta/ctrl).
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iP(hone|ad|od)/.test(navigator.platform || "");
  const event = new KeyboardEvent("keydown", {
    key: opts.shift ? "Z" : "z",
    code: "KeyZ",
    metaKey: isMac,
    ctrlKey: !isMac,
    shiftKey: !!opts.shift,
    bubbles: true,
    cancelable: true,
  });
  return (
    editor.view.someProp("handleKeyDown", (f) => f(editor.view, event)) ?? false
  );
}

describe("undo probe", () => {
  it("non-collab: typing then undo reverts (StarterKit history)", () => {
    const editor = makeEditor();
    editor.commands.setContent("<p>hello</p>");
    editor.commands.insertContentAt(
      editor.state.doc.content.size - 1,
      " world",
    );
    const after = editor.getText();
    expect(after).toContain("world");
    const handled = pressModZ(editor);
    const reverted = editor.getText();
    // eslint-disable-next-line no-console
    console.log(
      "[non-collab] Mod-z handled:",
      handled,
      "text after undo:",
      JSON.stringify(reverted),
    );
    expect(handled).toBe(true);
    expect(reverted).not.toContain("world");
    editor.destroy();
  });

  it("collab: typing then undo reverts (Yjs UndoManager)", () => {
    const ydoc = new Y.Doc();
    const editor = makeEditor({ ydoc });
    // Seed some content into the shared doc.
    editor.commands.setContent("<p>hello</p>");
    // Simulate a user edit.
    editor.commands.insertContentAt(
      editor.state.doc.content.size - 1,
      " world",
    );
    const after = editor.getText();
    // eslint-disable-next-line no-console
    console.log("[collab] text after edit:", JSON.stringify(after));
    expect(after).toContain("world");
    const handled = pressModZ(editor);
    const reverted = editor.getText();
    // eslint-disable-next-line no-console
    console.log(
      "[collab] Mod-z handled:",
      handled,
      "text after undo:",
      JSON.stringify(reverted),
    );
    expect(handled).toBe(true);
    expect(reverted).not.toContain("world");
    editor.destroy();
    ydoc.destroy();
  });
});
