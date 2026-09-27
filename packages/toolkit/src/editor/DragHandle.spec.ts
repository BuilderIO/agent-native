// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DragHandle,
  dragPreviewTransform,
  type DragHandleOptions,
} from "./DragHandle.js";

describe("dragPreviewTransform", () => {
  it("keeps the grabbed point under the pointer", () => {
    expect(
      dragPreviewTransform({
        clientX: 180,
        clientY: 240,
        pointerOffsetX: 32,
        pointerOffsetY: 9,
      }),
    ).toBe("translate3d(148px, 231px, 0)");
  });
});

function makeRect({
  left,
  top,
  width,
  height,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
}): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function setRect(element: Element, rect: DOMRect): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => rect,
  });
}

function mountEditor(
  content: string,
  options: Partial<DragHandleOptions> = {},
  rect: DOMRect = makeRect({ left: 24, top: 0, width: 640, height: 400 }),
  parent: HTMLElement = document.body,
  hoverPoint: { x: number; y: number } = { x: 32, y: rect.top + 12 },
): {
  editor: Editor;
  wrapper: HTMLElement;
  handle: HTMLElement;
} {
  const wrapper = document.createElement("div");
  wrapper.className = "visual-editor-wrapper";
  setRect(wrapper, rect);
  parent.appendChild(wrapper);

  const element = document.createElement("div");
  wrapper.appendChild(element);

  const editor = new Editor({
    element,
    extensions: [StarterKit, DragHandle.configure(options)],
    content,
  });

  setRect(editor.view.dom, rect);

  let index = 0;
  editor.state.doc.forEach((_node, offset) => {
    const dom = editor.view.nodeDOM(offset);
    if (dom instanceof HTMLElement) {
      setRect(
        dom,
        makeRect({
          left: 24,
          top: rect.top + index * 40,
          width: 640,
          height: 24,
        }),
      );
      index += 1;
    }
  });

  document.dispatchEvent(
    new MouseEvent("mousemove", {
      bubbles: true,
      clientX: hoverPoint.x,
      clientY: hoverPoint.y,
    }),
  );

  const handle = wrapper.querySelector<HTMLElement>(".drag-handle");
  if (!handle) throw new Error("Expected drag handle to mount");
  setRect(
    handle,
    makeRect({ left: 0, top: rect.top + 2, width: 24, height: 24 }),
  );

  return { editor, wrapper, handle };
}

function hoverAt(x: number, y: number): void {
  document.dispatchEvent(
    new MouseEvent("mousemove", {
      bubbles: true,
      clientX: x,
      clientY: y,
    }),
  );
}

function clickHandle(handle: HTMLElement): void {
  handle.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      clientX: 12,
      clientY: 12,
    }),
  );
  document.dispatchEvent(
    new MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      clientX: 12,
      clientY: 12,
    }),
  );
}

function getMenuItems(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(".an-rich-md-drag-menu__item"),
  );
}

function clickMenuItem(label: string): void {
  const item = getMenuItems().find((button) =>
    button.textContent?.includes(label),
  );
  if (!item) throw new Error(`Expected menu item "${label}"`);
  item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function childText(editor: Editor, index: number): string {
  return editor.state.doc.child(index).textContent;
}

function focusEditorWithNativeSelection(editor: Editor): void {
  editor.view.dom.focus();
  editor.commands.setTextSelection({ from: 1, to: 3 });
  const textNode = editor.view.dom.querySelector("p")?.firstChild;
  if (!(textNode instanceof Text)) {
    throw new Error("Expected a paragraph text node");
  }
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, Math.min(2, textNode.length));
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

afterEach(() => {
  document.body.innerHTML = "";
  document
    .querySelectorAll("#an-rich-md-drag-menu-styles")
    .forEach((node) => node.remove());
});

function getMenu(): HTMLElement {
  const menu = document.querySelector<HTMLElement>(".an-rich-md-drag-menu");
  if (!menu) throw new Error("Expected the drag menu to be open");
  return menu;
}

const ZERO_RECT = makeRect({ left: 0, top: 0, width: 0, height: 0 });

describe("DragHandle menu position", () => {
  const blockRect = makeRect({ left: 24, top: 200, width: 640, height: 400 });

  it("anchors the menu beside the grip", () => {
    const { editor, handle } = mountEditor(
      "<p>First</p><p>Second</p>",
      {},
      blockRect,
    );

    try {
      clickHandle(handle);

      const menu = getMenu();
      expect(menu.style.left).toBe("30px");
      expect(menu.style.top).toBe("198px");
    } finally {
      editor.destroy();
    }
  });

  it("falls back to the block when the grip reports a zero rect", () => {
    const { editor, handle } = mountEditor(
      "<p>First</p><p>Second</p>",
      {},
      blockRect,
    );

    try {
      setRect(handle, ZERO_RECT);
      clickHandle(handle);

      const menu = getMenu();
      expect(menu.style.left).not.toBe("8px");
      expect(menu.style.top).not.toBe("8px");
      expect(Number.parseFloat(menu.style.top)).toBeCloseTo(196, 0);
    } finally {
      editor.destroy();
    }
  });

  it("falls back to the block when the grip has been detached", () => {
    const { editor, handle } = mountEditor(
      "<p>First</p><p>Second</p>",
      {},
      blockRect,
    );

    try {
      const originalParent = handle.parentElement!;
      handle.addEventListener("mousedown", () => handle.remove(), {
        once: true,
      });
      clickHandle(handle);
      originalParent.appendChild(handle);

      const menu = getMenu();
      expect(menu.style.top).not.toBe("8px");
      expect(Number.parseFloat(menu.style.top)).toBeCloseTo(196, 0);
    } finally {
      editor.destroy();
    }
  });

  it("still opens the menu when every anchor candidate is degenerate", () => {
    const { editor, handle, wrapper } = mountEditor(
      "<p>First</p><p>Second</p>",
      {},
      blockRect,
    );

    try {
      setRect(handle, ZERO_RECT);
      wrapper.querySelectorAll("p").forEach((node) => setRect(node, ZERO_RECT));
      setRect(editor.view.dom, ZERO_RECT);

      clickHandle(handle);

      expect(document.querySelector(".an-rich-md-drag-menu")).toBeNull();
    } finally {
      editor.destroy();
    }
  });
});

describe("DragHandle menu", () => {
  it("opens the block menu on a single click", () => {
    const { editor, handle } = mountEditor("<p>First</p><p>Second</p>");

    try {
      clickHandle(handle);

      const items = getMenuItems();
      expect(items.map((item) => item.textContent)).toEqual([
        "Duplicate",
        "Delete",
        "Insert block below",
      ]);
      expect(document.activeElement).toBe(items[0]);
    } finally {
      editor.destroy();
    }
  });

  it("inserts an empty focused paragraph below the current block", () => {
    const { editor, handle } = mountEditor("<p>First</p><p>Second</p>");

    try {
      clickHandle(handle);
      clickMenuItem("Insert block below");

      expect(editor.state.doc.childCount).toBe(3);
      expect(childText(editor, 0)).toBe("First");
      expect(childText(editor, 1)).toBe("");
      expect(childText(editor, 2)).toBe("Second");
      expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
      expect(editor.state.selection.$from.parent.textContent).toBe("");
    } finally {
      editor.destroy();
    }
  });

  it("duplicates and deletes the current block from the menu", () => {
    const { editor, handle } = mountEditor("<p>First</p><p>Second</p>");

    try {
      clickHandle(handle);
      clickMenuItem("Duplicate");

      expect(editor.state.doc.childCount).toBe(3);
      expect(childText(editor, 0)).toBe("First");
      expect(childText(editor, 1)).toBe("First");
      expect(childText(editor, 2)).toBe("Second");

      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 32,
          clientY: 12,
        }),
      );
      clickHandle(handle);
      clickMenuItem("Delete");

      expect(editor.state.doc.childCount).toBe(2);
      expect(childText(editor, 0)).toBe("First");
      expect(childText(editor, 1)).toBe("Second");
    } finally {
      editor.destroy();
    }
  });

  it("keeps drag-to-reorder behavior when the handle is moved", () => {
    const { editor, handle } = mountEditor("<p>First</p><p>Second</p>");

    try {
      focusEditorWithNativeSelection(editor);
      expect(document.activeElement).toBe(editor.view.dom);
      expect(window.getSelection()?.toString()).toBe("Fi");
      handle.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          clientX: 12,
          clientY: 12,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 12,
          clientY: 56,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          button: 0,
          clientX: 12,
          clientY: 56,
        }),
      );

      expect(document.querySelector(".an-rich-md-drag-menu")).toBeNull();
      expect(editor.state.doc.childCount).toBe(2);
      expect(childText(editor, 0)).toBe("Second");
      expect(childText(editor, 1)).toBe("First");
      expect(editor.state.selection.empty).toBe(true);
      expect(editor.isFocused).toBe(false);
      expect(window.getSelection()?.toString()).toBe("");

      expect(editor.commands.undo()).toBe(true);
      expect(childText(editor, 0)).toBe("First");
      expect(childText(editor, 1)).toBe("Second");
    } finally {
      editor.destroy();
    }
  });

  it("preserves native selections outside the editor after a drop", () => {
    const outside = document.createElement("p");
    outside.textContent = "Keep this selection";
    document.body.append(outside);
    const { editor, handle } = mountEditor("<p>First</p><p>Second</p>");

    try {
      const textNode = outside.firstChild;
      if (!(textNode instanceof Text)) {
        throw new Error("Expected outside text");
      }
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 4);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      handle.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          clientX: 12,
          clientY: 12,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 12,
          clientY: 56,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          button: 0,
          clientX: 12,
          clientY: 56,
        }),
      );

      expect(childText(editor, 0)).toBe("Second");
      expect(childText(editor, 1)).toBe("First");
      expect(window.getSelection()?.toString()).toBe("Keep");
    } finally {
      editor.destroy();
    }
  });

  it("moves a block across registered editor regions and passes transfer payloads", () => {
    const transferData = { blockId: "source-block-1", extra: "side-map data" };
    const getDragTransferData = vi.fn(() => transferData);
    const receiveDragTransferData = vi.fn();
    const source = mountEditor(
      "<p>Move me</p><p>Keep source</p>",
      { getDragTransferData },
      makeRect({ left: 24, top: 0, width: 640, height: 120 }),
    );
    const target = mountEditor(
      "<p>Target first</p><p>Target second</p>",
      { receiveDragTransferData },
      makeRect({ left: 24, top: 160, width: 640, height: 120 }),
    );

    try {
      focusEditorWithNativeSelection(source.editor);
      hoverAt(32, 12);
      source.handle.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          clientX: 12,
          clientY: 12,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 32,
          clientY: 164,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          button: 0,
          clientX: 32,
          clientY: 164,
        }),
      );

      expect(getDragTransferData).toHaveBeenCalledTimes(1);
      expect(getDragTransferData).toHaveBeenCalledWith({
        view: source.editor.view,
        node: expect.objectContaining({ textContent: "Move me" }),
        pos: 0,
      });
      expect(receiveDragTransferData).toHaveBeenCalledTimes(1);
      expect(receiveDragTransferData).toHaveBeenCalledWith(transferData, {
        view: target.editor.view,
        node: expect.objectContaining({ textContent: "Move me" }),
        pos: 0,
        sourceView: source.editor.view,
      });
      expect(source.editor.state.doc.childCount).toBe(1);
      expect(childText(source.editor, 0)).toBe("Keep source");
      expect(target.editor.state.doc.childCount).toBe(3);
      expect(childText(target.editor, 0)).toBe("Move me");
      expect(childText(target.editor, 1)).toBe("Target first");
      expect(childText(target.editor, 2)).toBe("Target second");
      expect(source.editor.state.selection.empty).toBe(true);
      expect(target.editor.state.selection.empty).toBe(true);
      expect(source.editor.isFocused).toBe(false);
      expect(target.editor.isFocused).toBe(false);
      expect(window.getSelection()?.toString()).toBe("");
    } finally {
      source.editor.destroy();
      target.editor.destroy();
    }
  });

  it("lets a host handle left/right side drops without ProseMirror moving the node", () => {
    const transferData = { blockId: "source-block-1", extra: "side-map data" };
    const getDragTransferData = vi.fn(() => transferData);
    const handleDrop = vi.fn(() => true);
    const source = mountEditor(
      "<p>Move me</p><p>Keep source</p>",
      { getDragTransferData },
      makeRect({ left: 24, top: 0, width: 640, height: 120 }),
    );
    const target = mountEditor(
      "<p>Target first</p><p>Target second</p>",
      { handleDrop },
      makeRect({ left: 24, top: 160, width: 640, height: 120 }),
    );

    try {
      focusEditorWithNativeSelection(source.editor);
      hoverAt(32, 12);
      source.handle.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          clientX: 12,
          clientY: 12,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 660,
          clientY: 172,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          button: 0,
          clientX: 660,
          clientY: 172,
        }),
      );

      expect(getDragTransferData).toHaveBeenCalledTimes(1);
      expect(handleDrop).toHaveBeenCalledTimes(1);
      expect(handleDrop).toHaveBeenCalledWith(
        transferData,
        expect.objectContaining({
          view: target.editor.view,
          sourceView: source.editor.view,
          sourceNode: expect.objectContaining({ textContent: "Move me" }),
          targetNode: expect.objectContaining({ textContent: "Target first" }),
          placement: "right",
          targetPos: 0,
        }),
      );
      expect(source.editor.state.doc.childCount).toBe(2);
      expect(childText(source.editor, 0)).toBe("Move me");
      expect(childText(source.editor, 1)).toBe("Keep source");
      expect(target.editor.state.doc.childCount).toBe(2);
      expect(childText(target.editor, 0)).toBe("Target first");
      expect(childText(target.editor, 1)).toBe("Target second");
      expect(source.editor.state.selection.empty).toBe(true);
      expect(target.editor.state.selection.empty).toBe(true);
      expect(source.editor.isFocused).toBe(false);
      expect(target.editor.isFocused).toBe(false);
      expect(window.getSelection()?.toString()).toBe("");
    } finally {
      source.editor.destroy();
      target.editor.destroy();
    }
  });

  it("shows only the innermost drag grip when editor regions overlap", () => {
    const outer = mountEditor(
      "<p>Outer container</p>",
      {},
      makeRect({ left: 24, top: 0, width: 640, height: 320 }),
    );
    const outerBlock = outer.editor.view.nodeDOM(0);
    if (outerBlock instanceof HTMLElement) {
      setRect(
        outerBlock,
        makeRect({ left: 24, top: 0, width: 640, height: 280 }),
      );
    }
    const inner = mountEditor(
      "<p>Inner block</p>",
      {},
      makeRect({ left: 48, top: 160, width: 300, height: 90 }),
      outer.wrapper,
      { x: 60, y: 172 },
    );

    try {
      hoverAt(60, 172);

      expect(inner.handle.style.display).toBe("flex");
      expect(outer.handle.style.display).toBe("none");
    } finally {
      inner.editor.destroy();
      outer.editor.destroy();
    }
  });

  it("shows the outer container grip when hovering the shared left gutter", () => {
    const outer = mountEditor(
      "<p>Outer container</p>",
      {},
      makeRect({ left: 24, top: 0, width: 640, height: 320 }),
    );
    const outerBlock = outer.editor.view.nodeDOM(0);
    if (outerBlock instanceof HTMLElement) {
      setRect(
        outerBlock,
        makeRect({ left: 24, top: 0, width: 640, height: 280 }),
      );
    }
    const inner = mountEditor(
      "<p>Inner block</p>",
      {},
      makeRect({ left: 24, top: 160, width: 300, height: 90 }),
      outer.wrapper,
      { x: 60, y: 172 },
    );

    try {
      hoverAt(60, 172);
      expect(inner.handle.style.display).toBe("flex");
      expect(outer.handle.style.display).toBe("none");

      hoverAt(10, 172);
      expect(inner.handle.style.display).toBe("flex");
      expect(outer.handle.style.display).toBe("none");

      hoverAt(10, 40);
      expect(outer.handle.style.display).toBe("flex");
      expect(inner.handle.style.display).toBe("none");
    } finally {
      inner.editor.destroy();
      outer.editor.destroy();
    }
  });

  it("moves a block from a nested editor region out to the parent editor", () => {
    const target = mountEditor(
      "<p>Outer target</p>",
      {},
      makeRect({ left: 24, top: 0, width: 640, height: 320 }),
    );
    const targetBlock = target.editor.view.nodeDOM(0);
    if (targetBlock instanceof HTMLElement) {
      setRect(
        targetBlock,
        makeRect({ left: 24, top: 0, width: 640, height: 280 }),
      );
    }
    const source = mountEditor(
      "<p>Nested move</p><p>Nested keep</p>",
      {},
      makeRect({ left: 48, top: 160, width: 300, height: 120 }),
      target.wrapper,
      { x: 60, y: 172 },
    );

    try {
      hoverAt(60, 172);
      source.handle.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          clientX: 60,
          clientY: 172,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 32,
          clientY: 12,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          button: 0,
          clientX: 32,
          clientY: 12,
        }),
      );

      expect(source.editor.state.doc.childCount).toBe(1);
      expect(childText(source.editor, 0)).toBe("Nested keep");
      expect(target.editor.state.doc.childCount).toBe(2);
      expect(childText(target.editor, 0)).toBe("Nested move");
      expect(childText(target.editor, 1)).toBe("Outer target");
    } finally {
      source.editor.destroy();
      target.editor.destroy();
    }
  });

  it("keeps a non-left-aligned block's grip alive while the cursor approaches it", () => {
    const left = mountEditor(
      "<p>Left region</p>",
      {},
      makeRect({ left: 24, top: 160, width: 312, height: 90 }),
      document.body,
      { x: 100, y: 172 },
    );
    setRect(
      left.editor.view.nodeDOM(0) as HTMLElement,
      makeRect({ left: 24, top: 160, width: 312, height: 24 }),
    );
    const right = mountEditor(
      "<p>Right region</p>",
      {},
      makeRect({ left: 360, top: 160, width: 300, height: 90 }),
      document.body,
      { x: 500, y: 172 },
    );
    setRect(
      right.editor.view.nodeDOM(0) as HTMLElement,
      makeRect({ left: 360, top: 160, width: 300, height: 24 }),
    );
    setRect(
      right.handle,
      makeRect({ left: 320, top: 162, width: 24, height: 24 }),
    );

    try {
      hoverAt(500, 172);
      expect(right.handle.style.display).toBe("flex");

      hoverAt(330, 172);
      expect(right.handle.style.display).toBe("flex");
      expect(left.handle.style.display).toBe("none");
    } finally {
      right.editor.destroy();
      left.editor.destroy();
    }
  });
});
