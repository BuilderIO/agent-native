// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import {
  canSubmitComposerContent,
  createTiptapComposerExtensions,
} from "./TiptapComposer.js";

describe("createTiptapComposerExtensions", () => {
  it("keeps the prompt composer schema minimal and restores legacy draft HTML", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: createTiptapComposerExtensions(() => "Message agent..."),
    });

    expect(Object.keys(editor.schema.marks)).toEqual([]);
    expect(Object.keys(editor.schema.nodes).sort()).toEqual([
      "doc",
      "fileReference",
      "hardBreak",
      "mentionReference",
      "paragraph",
      "skillReference",
      "text",
    ]);

    expect(() => {
      editor.commands.setContent(`
        <h1>Legacy heading</h1>
        <ul><li>Legacy list item</li></ul>
        <p><a href="https://example.com">Legacy link</a></p>
        <p><span data-type="file-reference" path="/tmp/example.ts"></span></p>
      `);
    }).not.toThrow();

    expect(editor.getText()).toContain("Legacy heading");
    expect(editor.getText()).toContain("Legacy list item");
    expect(editor.getText()).toContain("Legacy link");
    expect(editor.getHTML()).toContain('data-type="file-reference"');

    editor.destroy();
  });

  it("allows sending an attachment-only prompt", () => {
    expect(
      canSubmitComposerContent({
        hasEditorContent: false,
        attachmentCount: 1,
      }),
    ).toBe(true);
    expect(
      canSubmitComposerContent({
        hasEditorContent: false,
        attachmentCount: 1,
        disabled: true,
      }),
    ).toBe(false);
  });
});
