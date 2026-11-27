// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import { DragHandle } from "./extensions/DragHandle";

// oracle-change: the NotionExtensions.tsx/DragHandle source greps became the drag below; VisualEditor.suggesting-toggle.test.tsx draws a read-only Toggle title as text, and the toolkit's DragHandle.spec.ts marks drag edits as user actions

function place(element: Element, top: number, left = 24, width = 640) {
  const rect = {
    x: left,
    y: top,
    left,
    top,
    width,
    height: 24,
    right: left + width,
    bottom: top + 24,
    toJSON: () => ({}),
  } as DOMRect;
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => rect,
  });
}

function mouse(type: string, target: EventTarget, clientY: number) {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: type === "mousemove" && target === document ? 32 : 12,
      clientY,
    }),
  );
}

function mountPage() {
  const wrapper = document.createElement("div");
  wrapper.className = "visual-editor-wrapper";
  document.body.append(wrapper);
  const element = document.createElement("div");
  wrapper.append(element);
  const editor = new Editor({
    element,
    extensions: [StarterKit, DragHandle],
    content: "<p>First</p><p>Second</p>",
  });
  place(editor.view.dom, 0);
  editor.state.doc.forEach((_node, offset, index) => {
    const dom = editor.view.nodeDOM(offset);
    if (dom instanceof Element) place(dom, index * 40);
  });
  mouse("mousemove", document, 12);
  const handle = wrapper.querySelector<HTMLElement>(".drag-handle");
  if (!handle) throw new Error("The page shows no drag grip.");
  place(handle, 2, 0, 24);
  return { editor, wrapper, handle };
}

function lines(editor: Editor) {
  return Array.from(
    { length: editor.state.doc.childCount },
    (_, index) => editor.state.doc.child(index).textContent,
  );
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("VisualEditor read-only mode", () => {
  it.each([
    { page: "editable", editable: true, drags: true },
    { page: "read-only", editable: false, drags: false },
  ])(
    "moves a line dragged by its grip only on an $page page",
    ({ editable, drags }) => {
      const { editor, wrapper, handle } = mountPage();
      try {
        editor.setEditable(editable);
        const first = editor.view.nodeDOM(0) as HTMLElement;

        mouse("mousedown", handle, 12);
        mouse("mousemove", document, 56);
        const midDrag = {
          dropLine: wrapper.querySelector(".notion-drop-indicator") !== null,
          lifted: first.classList.contains("notion-block--dragging"),
        };
        mouse("mouseup", document, 56);

        expect(midDrag).toEqual({ dropLine: drags, lifted: drags });
        expect(lines(editor)).toEqual(
          drags ? ["Second", "First"] : ["First", "Second"],
        );
      } finally {
        editor.destroy();
      }
    },
  );
});
