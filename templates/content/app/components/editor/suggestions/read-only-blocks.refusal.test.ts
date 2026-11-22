// @vitest-environment happy-dom

import { nfmToDoc } from "@shared/nfm";
import { getSchema } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, Plugin } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import { blockActionLocks } from "../block-actions";
import { createVisualEditorExtensions } from "../VisualEditor";
import { suggestingReadOnlyBlocksPlugin } from "./read-only-blocks";

const schema = getSchema(createVisualEditorExtensions());

const PAGE = [
  "Intro paragraph.",
  "",
  "![Diagram](https://example.com/diagram.png)",
  "",
  "Closing paragraph.",
].join("\n");

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  vi.useRealTimers();
});

function mount(suggesting = true, plugins: Plugin[] = []) {
  const onRefused = vi.fn();
  const state = EditorState.create({
    doc: schema.nodeFromJSON(nfmToDoc(PAGE)),
    plugins: [
      suggestingReadOnlyBlocksPlugin(() => suggesting, onRefused),
      ...plugins,
    ],
  });
  const mounted = new EditorView(document.createElement("div"), { state });
  view = mounted;
  return { view: mounted, onRefused };
}

function image(state: EditorState) {
  const nodes: { pos: number; node: ProseMirrorNode }[] = [];
  state.doc.descendants((node, pos) => {
    nodes.push({ pos, node });
  });
  const found = nodes.find(({ node }) => node.type.name === "image");
  if (!found) throw new Error("The page has no image");
  return found;
}

function pressBackspace(target: EditorView) {
  target.dom.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Backspace",
      code: "Backspace",
      keyCode: 8,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function deleteImage(target: EditorView) {
  const { pos, node } = image(target.state);
  target.dispatch(target.state.tr.delete(pos, pos + node.nodeSize));
}

describe("telling the page a suggestion was refused", () => {
  it("tells the page when a key press tries to delete the image", () => {
    const { view: editor, onRefused } = mount();
    pressBackspace(editor);
    deleteImage(editor);
    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(image(editor.state).node.type.name).toBe("image");
  });

  it("stays quiet when the refused change didn't follow any input", () => {
    const { view: editor, onRefused } = mount();
    deleteImage(editor);
    expect(onRefused).not.toHaveBeenCalled();
    expect(image(editor.state).node.type.name).toBe("image");
  });

  it("stays quiet once the input is a moment old", () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    const { view: editor, onRefused } = mount();
    pressBackspace(editor);
    vi.advanceTimersByTime(1000);
    deleteImage(editor);
    expect(onRefused).not.toHaveBeenCalled();
  });

  it("stays quiet when the key press makes an edit it allows", () => {
    const { view: editor, onRefused } = mount();
    pressBackspace(editor);
    editor.dispatch(editor.state.tr.insertText("X", 1));
    expect(onRefused).not.toHaveBeenCalled();
    expect(editor.state.doc.textContent).toContain("XIntro");
  });

  it("stays quiet when only another plugin's follow-up change is refused", () => {
    const tidy = new Plugin({
      appendTransaction(transactions, _before, state) {
        if (!transactions.some((transaction) => transaction.docChanged))
          return null;
        const { pos, node } = image(state);
        return state.tr.delete(pos, pos + node.nodeSize);
      },
    });
    const { view: editor, onRefused } = mount(true, [tidy]);
    pressBackspace(editor);
    editor.dispatch(editor.state.tr.insertText("X", 1));
    expect(onRefused).not.toHaveBeenCalled();
    expect(editor.state.doc.textContent).toContain("XIntro");
    expect(image(editor.state).node.type.name).toBe("image");
  });

  it("stays quiet while the block menu checks what it may do", () => {
    const { view: editor, onRefused } = mount();
    pressBackspace(editor);
    const { pos, node } = image(editor.state);
    expect(blockActionLocks(editor.state, pos, node).remove).toBe("suggesting");
    expect(onRefused).not.toHaveBeenCalled();
  });

  it("stays quiet outside Suggesting mode", () => {
    const { view: editor, onRefused } = mount(false);
    pressBackspace(editor);
    deleteImage(editor);
    expect(onRefused).not.toHaveBeenCalled();
    expect(() => image(editor.state)).toThrow("The page has no image");
  });
});
