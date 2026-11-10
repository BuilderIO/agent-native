// @vitest-environment happy-dom

import { Editor, type JSONContent } from "@tiptap/core";
import { Plugin, type Transaction } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import {
  blockActionLocks,
  blockCommentRange,
  blockTitleKey,
  turnBlockInto,
  type TurnIntoTarget,
} from "./block-actions";
import { createVisualEditorExtensions } from "./VisualEditor";

const text = (value: string) => ({ type: "text", text: value });
const paragraph = (value: string) => ({
  type: "paragraph",
  content: [text(value)],
});

describe("block actions", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function mount(content: JSONContent[], { suggesting = false } = {}) {
    editor = new Editor({
      extensions: createVisualEditorExtensions({
        isSuggesting: () => suggesting,
      }),
      content: { type: "doc", content },
    });
    return editor;
  }

  const firstBlock = (target: Editor) => target.state.doc.child(0).toJSON();

  it.each<[TurnIntoTarget, JSONContent]>([
    ["text", { type: "paragraph" }],
    ["heading1", { type: "heading", attrs: { level: 1 } }],
    ["heading3", { type: "heading", attrs: { level: 3 } }],
    ["bulletedList", { type: "bulletList" }],
    ["numberedList", { type: "orderedList" }],
    ["todoList", { type: "taskList" }],
    ["quote", { type: "blockquote" }],
    ["codeBlock", { type: "codeBlock" }],
  ])("turns a heading into %s, keeping its text", (target, expected) => {
    const page = mount([
      {
        type: "heading",
        attrs: { level: 2 },
        content: [text("Plan")],
      },
      paragraph("After"),
    ]);
    const tr = page.state.tr;

    expect(turnBlockInto(tr, 0, target)).toBe(true);
    page.view.dispatch(tr);

    expect(firstBlock(page)).toMatchObject(expected);
    expect(page.state.doc.child(0).textContent).toBe("Plan");
    expect(page.state.doc.child(1).textContent).toBe("After");
  });

  it("refuses a block it can't turn", () => {
    const page = mount([
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [paragraph("Item")] }],
      },
    ]);
    const tr = page.state.tr;

    expect(turnBlockInto(tr, 0, "heading1")).toBe(false);
    expect(tr.docChanged).toBe(false);
  });

  it("titles a block with its kind", () => {
    const page = mount([
      { type: "heading", attrs: { level: 2 }, content: [text("Plan")] },
      { type: "horizontalRule" },
    ]);

    expect(blockTitleKey(page.state.doc.child(0))).toBe("editor.heading2");
    expect(blockTitleKey(page.state.doc.child(1))).toBe("editor.slash.divider");
  });

  it("quotes a block's text for a comment, and nothing from a blank or a divider", () => {
    const page = mount([
      paragraph("Hello"),
      { type: "paragraph" },
      { type: "horizontalRule" },
    ]);
    const { doc } = page.state;

    expect(blockCommentRange(doc.child(0), 0)).toEqual({ from: 1, to: 6 });
    expect(blockCommentRange(doc.child(1), 7)).toBeNull();
    expect(blockCommentRange(doc.child(2), 9)).toBeNull();
  });

  it("lets an ordinary block be duplicated and deleted", () => {
    const page = mount([paragraph("Hello"), paragraph("World")]);

    expect(blockActionLocks(page.state, 0, page.state.doc.child(0))).toEqual({
      duplicate: null,
      remove: null,
    });
  });

  it("asks the page about the edits the drag handle makes", () => {
    const page = mount([paragraph("Hello"), paragraph("World")]);
    const marked = (tr: Transaction) => tr.getMeta("uiEvent") !== undefined;
    let allows = marked;
    page.registerPlugin(
      new Plugin({ filterTransaction: (tr) => !tr.docChanged || allows(tr) }),
    );
    const locks = () =>
      blockActionLocks(page.state, 0, page.state.doc.child(0));

    expect(locks()).toEqual({ duplicate: null, remove: null });
    allows = (tr) => !marked(tr);
    expect(locks()).toEqual({ duplicate: "page", remove: "page" });
  });

  it("locks a component from the page's source", () => {
    const page = mount([
      paragraph("Hello"),
      {
        type: "registryBlock",
        attrs: { blockType: "source-component", blockId: "hero-1" },
      },
    ]);
    const component = page.state.doc.child(1);

    expect(blockActionLocks(page.state, 7, component)).toEqual({
      duplicate: "source",
      remove: "source",
    });
  });

  it("locks a block suggestions can't add or remove, only while suggesting", () => {
    const content = [
      paragraph("Hello"),
      { type: "video", attrs: { src: "https://example.com/clip.mp4" } },
    ];

    const suggesting = mount(content, { suggesting: true });
    expect(
      blockActionLocks(suggesting.state, 7, suggesting.state.doc.child(1)),
    ).toEqual({ duplicate: "suggesting", remove: "suggesting" });
    expect(
      blockActionLocks(suggesting.state, 0, suggesting.state.doc.child(0)),
    ).toEqual({ duplicate: null, remove: null });
    suggesting.destroy();

    const editing = mount(content);
    expect(
      blockActionLocks(editing.state, 7, editing.state.doc.child(1)),
    ).toEqual({ duplicate: null, remove: null });
  });
});
