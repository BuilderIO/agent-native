// @vitest-environment happy-dom
import { Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import {
  NotionToggle,
  outdentDirectToggleChild,
} from "./extensions/NotionExtensions";

const editors: Editor[] = [];

function createEditor(content: Record<string, unknown>) {
  const editor = new Editor({
    extensions: [StarterKit, NotionToggle],
    content,
  });
  editors.push(editor);
  return editor;
}

function applyWithoutViewPlugins<T>(
  editor: Editor,
  operation: (editor: Editor) => T,
) {
  let nextState: EditorState = editor.state;
  const testEditor = {
    state: editor.state,
    view: {
      dispatch(transaction: Transaction) {
        nextState = editor.state.apply(transaction);
      },
      focus() {},
    },
    isDestroyed: false,
  } as unknown as Editor;

  return { result: operation(testEditor), state: () => nextState };
}

function toggle(
  summary: string,
  open: boolean,
  content: Record<string, unknown>[] = [],
) {
  const value: Record<string, unknown> = {
    type: "notionToggle",
    attrs: { summary, color: null, headingLevel: null, open, indent: 0 },
  };
  if (content.length) value.content = content;
  return value;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

// oracle-change: a Toggle's title is page text now, so the old title input's
// Enter handling (applyToggleSummaryEnter, focusToggleSummaryAtPosition) is
// gone; NotionToggle.keys.test.ts covers Enter in a title.
// oracle-change(templates/content/app/components/editor/VisualEditor.toggle-summary-undo.test.tsx): an old Toggle's title input is read-only now and moves its text into the page when clicked, so it keeps no undo history of its own.
describe("Notion Toggle interactions", () => {
  it("outdents the active direct child and leaves an empty Toggle behind", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        toggle("Details", true, [
          { type: "paragraph", content: [{ type: "text", text: "Move me" }] },
        ]),
      ],
    });
    editor.commands.setTextSelection(3);

    const applied = applyWithoutViewPlugins(editor, outdentDirectToggleChild);
    expect(applied.result).toBe(true);
    expect(applied.state().doc.toJSON().content).toEqual([
      toggle("Details", true),
      {
        type: "paragraph",
        content: [{ type: "text", text: "Move me" }],
      },
      { type: "paragraph" },
    ]);
    expect(applied.state().selection.$from.parent.textContent).toBe("Move me");
  });

  it("does not intercept Shift-Tab outside a Toggle", () => {
    const editor = createEditor({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    editor.commands.setTextSelection(1);

    const applied = applyWithoutViewPlugins(editor, outdentDirectToggleChild);
    expect(applied.result).toBe(false);
  });

  it("outdents the current child after the Toggle without moving its siblings", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        toggle("Details", true, [
          { type: "paragraph", content: [{ type: "text", text: "Stay" }] },
          { type: "paragraph", content: [{ type: "text", text: "Move" }] },
        ]),
      ],
    });
    editor.commands.setTextSelection(9);

    const applied = applyWithoutViewPlugins(editor, outdentDirectToggleChild);
    expect(applied.result).toBe(true);
    expect(applied.state().doc.toJSON().content).toEqual([
      toggle("Details", true, [
        { type: "paragraph", content: [{ type: "text", text: "Stay" }] },
      ]),
      { type: "paragraph", content: [{ type: "text", text: "Move" }] },
      { type: "paragraph" },
    ]);
    expect(applied.state().selection.$from.parent.textContent).toBe("Move");
  });
});
