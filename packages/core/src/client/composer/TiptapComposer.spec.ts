// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import {
  canSubmitComposerContent,
  createTiptapComposerExtensions,
  displayableComposerModeMessage,
  getComposerSubmitIntentForEnterKey,
  getComposerPopoverPosition,
  getOversizedDocumentAttachmentError,
  handleComposerFileDrop,
  insertComposerHardBreakAndScrollIntoView,
  MODEL_SELECTOR_POPOVER_STYLE,
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

  it("detects oversized PDF attachments before submit", () => {
    const file = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "large.pdf", {
      type: "application/pdf",
    });

    expect(
      getOversizedDocumentAttachmentError([
        {
          type: "document",
          name: "large.pdf",
          contentType: "application/pdf",
          file,
        },
      ]),
    ).toContain('"large.pdf" is 4.0 MB — PDFs are capped at 4 MB');
    expect(
      getOversizedDocumentAttachmentError([
        {
          type: "image",
          name: "large.png",
          contentType: "image/png",
          file,
        },
      ]),
    ).toBeNull();
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

  it("scrolls the composer caret into view for Shift+Enter line breaks", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: createTiptapComposerExtensions(() => "Message agent..."),
      content: "<p>Hello</p>",
    });
    editor.commands.setTextSelection(editor.state.doc.content.size);

    const view = editor.view;
    const scrolledTransactions: boolean[] = [];
    const dispatch = view.dispatch.bind(view);
    view.dispatch = (transaction) => {
      scrolledTransactions.push(transaction.scrolledIntoView);
      dispatch(transaction);
    };

    expect(insertComposerHardBreakAndScrollIntoView(view)).toBe(true);
    expect(scrolledTransactions).toEqual([true]);
    expect(editor.getText()).toBe("Hello\n");

    editor.destroy();
  });

  it("guards popover positioning when the editor cannot resolve coordinates", () => {
    expect(
      getComposerPopoverPosition(
        {
          coordsAtPos: () => ({ top: 12, bottom: 20, left: 34, right: 34 }),
        },
        1,
      ),
    ).toEqual({ top: 12, left: 34 });
    expect(
      getComposerPopoverPosition(
        {
          coordsAtPos: () => {
            throw new TypeError("node.getBoundingClientRect is not a function");
          },
        },
        1,
      ),
    ).toBeNull();
    expect(
      getComposerPopoverPosition(
        {
          coordsAtPos: () => ({
            top: Number.NaN,
            bottom: 20,
            left: 34,
            right: 34,
          }),
        },
        1,
      ),
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

  it("caps the model picker height without forcing empty vertical space", () => {
    expect(MODEL_SELECTOR_POPOVER_STYLE).toMatchObject({
      fontSize: 13,
      maxHeight:
        "min(500px, var(--radix-popover-content-available-height, 500px))",
    });
    expect(MODEL_SELECTOR_POPOVER_STYLE).not.toHaveProperty("height");
  });
});
