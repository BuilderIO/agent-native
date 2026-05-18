// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import {
  canSubmitComposerContent,
  createTiptapComposerExtensions,
  displayableComposerModeMessage,
  getComposerSubmitIntentForEnterKey,
  handleComposerFileDrop,
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

  it("uses a visible fallback for attachment-only composer mode prompts", () => {
    expect(
      displayableComposerModeMessage({
        messagePrefix: "Create an extension: ",
        trimmedText: "",
        attachmentCount: 1,
      }),
    ).toBe("Create an extension: Use the attached context.");
  });

  it("maps Enter keybindings to immediate and queued submit intents", () => {
    const enter = {
      key: "Enter",
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
    };

    expect(getComposerSubmitIntentForEnterKey(enter, true)).toBe("immediate");
    expect(getComposerSubmitIntentForEnterKey(enter, false)).toBe("immediate");
    expect(
      getComposerSubmitIntentForEnterKey({ ...enter, metaKey: true }, true),
    ).toBe("queued");
    expect(
      getComposerSubmitIntentForEnterKey({ ...enter, ctrlKey: true }, false),
    ).toBe("queued");
    expect(
      getComposerSubmitIntentForEnterKey(
        { ...enter, shiftKey: true, metaKey: true },
        true,
      ),
    ).toBeNull();
    expect(
      getComposerSubmitIntentForEnterKey({ ...enter, ctrlKey: true }, true),
    ).toBeNull();
    expect(
      getComposerSubmitIntentForEnterKey({ ...enter, metaKey: true }, false),
    ).toBeNull();
  });

  it("consumes composer file drops so parent drop targets do not attach duplicates", () => {
    const file = new File(["fake"], "image.png", { type: "image/png" });
    const added: File[] = [];
    let prevented = false;
    let stopped = false;
    const handled = handleComposerFileDrop({
      event: {
        dataTransfer: { files: [file] },
        preventDefault: () => {
          prevented = true;
        },
        stopPropagation: () => {
          stopped = true;
        },
      } as unknown as DragEvent,
      addAttachment: async (attachment) => {
        added.push(attachment);
      },
    });

    expect(handled).toBe(true);
    expect(prevented).toBe(true);
    expect(stopped).toBe(true);
    expect(added).toHaveLength(1);
    expect(added[0]?.name).toMatch(/^\d+-[a-z0-9]+-image\.png$/);
  });
});
