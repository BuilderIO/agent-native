// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureVisualEditorSelection,
  createVisualEditorExtensions,
  resolveVisualEditorSelection,
} from "./VisualEditor";

describe("visual editor selection handoff", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function createEditor() {
    editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Alpha beta gamma." }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Second paragraph." }],
          },
        ],
      },
    });
    return editor;
  }

  it("preserves an exact backward text selection across an identical remount", () => {
    const source = createEditor();
    source.view.dispatch(
      source.state.tr.setSelection(
        TextSelection.create(source.state.doc, 11, 7),
      ),
    );

    const snapshot = captureVisualEditorSelection(
      source.state.doc,
      source.state.selection,
    );
    expect(snapshot).not.toBeNull();

    const restored = resolveVisualEditorSelection(source.state.doc, snapshot!);
    expect(restored?.anchor).toBe(11);
    expect(restored?.head).toBe(7);
    expect(restored?.from).toBe(7);
    expect(restored?.to).toBe(11);
  });

  it("preserves a collapsed caret", () => {
    const source = createEditor();
    source.commands.setTextSelection(7);

    const snapshot = captureVisualEditorSelection(
      source.state.doc,
      source.state.selection,
    );
    const restored = resolveVisualEditorSelection(source.state.doc, snapshot!);

    expect(restored?.anchor).toBe(7);
    expect(restored?.head).toBe(7);
  });

  it("fails closed when the remounted document is not identical", () => {
    const source = createEditor();
    source.commands.setTextSelection({ from: 7, to: 11 });
    const snapshot = captureVisualEditorSelection(
      source.state.doc,
      source.state.selection,
    );
    source.view.dispatch(source.state.tr.insertText("Changed ", 1));

    expect(
      resolveVisualEditorSelection(source.state.doc, snapshot!),
    ).toBeNull();
  });

  it("serializes an unchanged ProseMirror document only once", () => {
    const source = createEditor();
    const toJson = vi.spyOn(source.state.doc, "toJSON");
    source.commands.setTextSelection(7);

    captureVisualEditorSelection(source.state.doc, source.state.selection);
    source.commands.setTextSelection(11);
    captureVisualEditorSelection(source.state.doc, source.state.selection);

    expect(toJson).toHaveBeenCalledTimes(1);
  });
});
