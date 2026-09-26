// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createSharedEditorExtensions } from "./extensions.js";

function makeEditor(disableHistory: boolean): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: createSharedEditorExtensions({ disableHistory }),
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
    expect(handled).toBe(false);
    expect(editor.getText()).toBe("hello world");
    editor.destroy();
  });
});
