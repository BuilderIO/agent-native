// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createSharedEditorExtensions } from "./extensions.js";

/**
 * The `disableHistory` lever turns OFF StarterKit's prosemirror-history for a
 * controlled (non-collab) editor whose host owns its own undo authority — the
 * plan editor, whose authoritative `blocks[]` tree holds block data the
 * ProseMirror doc never stores, so PM history can't be the undo authority.
 *
 * Contract:
 *  - default (history ON): cmd+z reverts a text edit (every existing embedder).
 *  - disableHistory: true: the Mod-z keymap is not bound, so cmd+z is NOT
 *    handled and the edit is NOT reverted — leaving the host's own cmd+z
 *    handler (a capture-phase listener, in the plan editor) as the sole undo.
 */

function makeEditor(disableHistory: boolean): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: createSharedEditorExtensions({ disableHistory }),
    // Seed via a PM JSON doc (not an HTML/markdown string) so the baseline is a
    // real paragraph "hello" and the first undoable step is the edit below.
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hello" }] },
      ],
    },
  });
}

function typeAtEnd(editor: Editor, text: string): void {
  editor.chain().focus("end").insertContent(text).run();
}

function pressModZ(editor: Editor): boolean {
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iP(hone|ad|od)/.test(navigator.platform || "");
  const event = new KeyboardEvent("keydown", {
    key: "z",
    code: "KeyZ",
    keyCode: 90,
    which: 90,
    metaKey: isMac,
    ctrlKey: !isMac,
    bubbles: true,
    cancelable: true,
  } as KeyboardEventInit);
  return (
    editor.view.someProp("handleKeyDown", (f) => f(editor.view, event)) ?? false
  );
}

describe("disableHistory editor lever", () => {
  it("default (history ON): cmd+z reverts a text edit", () => {
    const editor = makeEditor(false);
    typeAtEnd(editor, " world");
    expect(editor.getText()).toBe("hello world");

    const handled = pressModZ(editor);
    expect(handled).toBe(true);
    expect(editor.getText()).toBe("hello");
    editor.destroy();
  });

  it("disableHistory: true — cmd+z is NOT handled and the edit is NOT reverted", () => {
    const editor = makeEditor(true);
    typeAtEnd(editor, " world");
    expect(editor.getText()).toBe("hello world");

    const handled = pressModZ(editor);
    // No history plugin → no Mod-z binding → the keymap does not consume it,
    // and the document is unchanged. The host's own undo authority handles cmd+z.
    expect(handled).toBe(false);
    expect(editor.getText()).toBe("hello world");
    editor.destroy();
  });
});
