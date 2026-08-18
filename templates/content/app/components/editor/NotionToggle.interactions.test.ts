// @vitest-environment happy-dom
import { Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NotionToggle,
  applyToggleSummaryEnter,
  focusToggleSummaryAtPosition,
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

describe("Notion Toggle interactions", () => {
  it("replaces a completely empty Toggle with a paragraph on Enter", () => {
    const editor = createEditor({
      type: "doc",
      content: [toggle("", true)],
    });
    expect(editor.getJSON().content?.[0]?.type).toBe("notionToggle");

    const applied = applyWithoutViewPlugins(editor, (testEditor) =>
      applyToggleSummaryEnter(testEditor, 0, ""),
    );
    expect(applied.result).toBe("paragraph");
    expect(applied.state().doc.toJSON().content).toEqual([
      { type: "paragraph" },
    ]);
    expect(applied.state().selection.$from.parent.type.name).toBe("paragraph");
  });

  it("commits the summary and enters a new body paragraph when expanded", () => {
    const editor = createEditor({
      type: "doc",
      content: [toggle("", true)],
    });
    expect(editor.getJSON().content?.[0]?.type).toBe("notionToggle");

    const applied = applyWithoutViewPlugins(editor, (testEditor) =>
      applyToggleSummaryEnter(testEditor, 0, "Project notes"),
    );
    expect(applied.result).toBe("toggle-body");
    expect(applied.state().doc.toJSON().content).toEqual([
      toggle("Project notes", true, [{ type: "paragraph" }]),
      { type: "paragraph" },
    ]);
    expect(applied.state().selection.$from.parent.type.name).toBe("paragraph");
    expect(applied.state().selection.$from.node(1).type.name).toBe(
      "notionToggle",
    );
  });

  it("commits the summary and creates an empty collapsed sibling", () => {
    const editor = createEditor({
      type: "doc",
      content: [toggle("Draft", false, [{ type: "paragraph" }])],
    });

    const applied = applyWithoutViewPlugins(editor, (testEditor) =>
      applyToggleSummaryEnter(testEditor, 0, "Final"),
    );
    expect(applied.result).toBe("sibling-toggle");
    expect(applied.state().doc.toJSON().content).toEqual([
      toggle("Final", false, [{ type: "paragraph" }]),
      toggle("", false),
      { type: "paragraph" },
    ]);
  });

  it("focuses the inserted sibling by document position past nested Toggles", () => {
    const nestedInput = document.createElement("input");
    const siblingInput = document.createElement("input");
    const siblingDom = document.createElement("div");
    siblingDom.appendChild(siblingInput);
    siblingInput.className = "notion-toggle__summary";
    const nodeDOM = (pos: number) => (pos === 9 ? siblingDom : nestedInput);
    const focus = vi.spyOn(siblingInput, "focus");
    const select = vi.spyOn(siblingInput, "select");

    focusToggleSummaryAtPosition(
      { view: { nodeDOM } } as unknown as Pick<Editor, "view">,
      9,
    );

    expect(nodeDOM(1)).toBe(nestedInput);
    expect(focus).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledOnce();
  });

  it("removes only the new empty sibling when Enter is pressed again", () => {
    const editor = createEditor({
      type: "doc",
      content: [toggle("", false)],
    });
    let state = editor.state;
    const testEditor = {
      get state() {
        return state;
      },
      view: {
        dispatch(transaction: Transaction) {
          state = state.apply(transaction);
        },
        focus() {},
      },
      isDestroyed: false,
    } as unknown as Editor;

    expect(applyToggleSummaryEnter(testEditor, 0, "Keep me")).toBe(
      "sibling-toggle",
    );
    const siblingPos = state.doc.child(0).nodeSize;
    expect(applyToggleSummaryEnter(testEditor, siblingPos, "")).toBe(
      "paragraph",
    );
    expect(state.doc.toJSON().content).toEqual([
      toggle("Keep me", false),
      { type: "paragraph" },
      { type: "paragraph" },
    ]);
  });

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
