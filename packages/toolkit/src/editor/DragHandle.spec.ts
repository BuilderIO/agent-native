// @vitest-environment happy-dom

import { type AnyExtension, Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  DRAG_HANDLE_UI_EVENT,
  DragHandle,
  dragPreviewTransform,
  type DragHandleMenuRequest,
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
  extensions: AnyExtension[] = [StarterKit],
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
    extensions: [...extensions, DragHandle.configure(options)],
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

  it("leaves its block selected once the editor reads back its page", async () => {
    const { editor, handle } = mountEditor("<p>First</p><p>Second</p>");

    try {
      clickHandle(handle);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(editor.state.selection.toJSON()).toEqual({
        type: "node",
        anchor: 0,
      });
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

  it("marks menu and drag edits as user actions", () => {
    const { editor, handle } = mountEditor("<p>First</p><p>Second</p>");
    const uiEvents: unknown[] = [];
    editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) uiEvents.push(transaction.getMeta("uiEvent"));
    });

    try {
      for (const label of ["Insert block below", "Duplicate", "Delete"]) {
        hoverAt(32, 12);
        clickHandle(handle);
        clickMenuItem(label);
      }
      hoverAt(32, 12);
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

      expect(uiEvents).toEqual(Array(4).fill(DRAG_HANDLE_UI_EVENT));
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

describe("DragHandle app menu", () => {
  it("opens the app's menu in place of the built-in one", () => {
    const close = vi.fn();
    const requests: DragHandleMenuRequest[] = [];
    const { editor, handle } = mountEditor("<p>First</p><p>Second</p>", {
      openMenu: (request) => {
        requests.push(request);
        return close;
      },
    });
    const uiEvents: unknown[] = [];
    editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) uiEvents.push(transaction.getMeta("uiEvent"));
    });

    try {
      clickHandle(handle);

      expect(document.querySelector(".an-rich-md-drag-menu")).toBeNull();
      expect(requests).toHaveLength(1);
      const [request] = requests;
      expect(request.getBlock()?.node.textContent).toBe("First");
      expect(request.anchorRect.top).toBe(2);
      expect(handle.getAttribute("aria-expanded")).toBe("true");

      // The grip stays on its block while the menu is open.
      hoverAt(32, 52);
      expect(handle.style.top).toBe("2px");

      editor.commands.insertContentAt(0, "<p>Zero</p>");
      expect(request.getBlock()?.pos).toBe(editor.state.doc.child(0).nodeSize);
      request.duplicate();
      expect(childText(editor, 1)).toBe("First");
      expect(childText(editor, 2)).toBe("First");
      expect(uiEvents.at(-1)).toBe(DRAG_HANDLE_UI_EVENT);

      request.onClose();
      expect(handle.getAttribute("aria-expanded")).toBe("false");
      expect(handle.style.display).toBe("none");
      expect(close).not.toHaveBeenCalled();
    } finally {
      editor.destroy();
    }
  });

  it("finds no block once the menu's block is deleted", () => {
    const requests: DragHandleMenuRequest[] = [];
    const { editor, handle } = mountEditor("<p>First</p><p>Second</p>", {
      openMenu: (request) => {
        requests.push(request);
        return () => {};
      },
    });

    try {
      clickHandle(handle);
      const [request] = requests;
      const first = editor.state.doc.child(0);
      editor.view.dispatch(editor.state.tr.delete(0, first.nodeSize));

      expect(request.getBlock()).toBeNull();
      request.duplicate();
      request.remove();
      request.insertBelow();
      expect(editor.state.doc.childCount).toBe(1);
      expect(childText(editor, 0)).toBe("Second");
    } finally {
      editor.destroy();
    }
  });

  it("finds no block once it is deleted, though the same block after it takes its DOM", () => {
    const requests: DragHandleMenuRequest[] = [];
    const { editor, handle } = mountEditor("<p>Same</p><p>Same</p>", {
      openMenu: (request) => {
        requests.push(request);
        return () => {};
      },
    });

    try {
      clickHandle(handle);
      const [request] = requests;
      const first = editor.view.nodeDOM(0);
      editor.view.dispatch(
        editor.state.tr
          .delete(0, editor.state.doc.child(0).nodeSize)
          .insertText("!", 2),
      );
      expect(editor.view.nodeDOM(0)).toBe(first);

      expect(request.getBlock()).toBeNull();
      request.remove();
      expect(childText(editor, 0)).toBe("S!ame");
    } finally {
      editor.destroy();
    }
  });

  it("finds no block once the page's content is replaced", () => {
    const requests: DragHandleMenuRequest[] = [];
    const { editor, handle } = mountEditor("<p>Same</p><p>Other</p>", {
      openMenu: (request) => {
        requests.push(request);
        return () => {};
      },
    });

    try {
      clickHandle(handle);
      editor.commands.setContent("<p>Same</p><p>Other</p>");
      expect(requests[0].getBlock()).toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it("finds no block once the menu's own edit deletes it", () => {
    const requests: DragHandleMenuRequest[] = [];
    const { editor, handle } = mountEditor("<p>First</p><p>Second</p>", {
      openMenu: (request) => {
        requests.push(request);
        return () => {};
      },
    });

    try {
      clickHandle(handle);
      const [request] = requests;
      request.dispatch(
        editor.state.tr.delete(0, editor.state.doc.child(0).nodeSize),
      );

      expect(request.getBlock()).toBeNull();
      request.remove();
      expect(childText(editor, 0)).toBe("Second");
    } finally {
      editor.destroy();
    }
  });

  it("keeps its block through the menu's own edits, even one that wraps it", () => {
    const requests: DragHandleMenuRequest[] = [];
    const { editor, handle } = mountEditor("<p>First</p><p>Second</p>", {
      openMenu: (request) => {
        requests.push(request);
        return () => {};
      },
    });

    try {
      clickHandle(handle);
      const [request] = requests;
      const { schema } = editor.state;
      request.dispatch(
        editor.state.tr.setNodeMarkup(0, schema.nodes.heading, { level: 2 }),
      );
      expect(request.getBlock()?.node.type.name).toBe("heading");

      const { doc } = editor.state;
      const range = doc
        .resolve(1)
        .blockRange(doc.resolve(doc.child(0).nodeSize - 1))!;
      request.dispatch(
        editor.state.tr.wrap(range, [{ type: schema.nodes.blockquote }]),
      );
      expect(request.getBlock()).toMatchObject({ pos: 0 });
      expect(request.getBlock()?.node.type.name).toBe("blockquote");

      editor.commands.insertContentAt(
        editor.state.doc.content.size,
        "<p>Third</p>",
      );
      expect(request.getBlock()?.node.textContent).toBe("First");

      editor.view.dispatch(editor.state.tr.insertText("!", 3));
      expect(request.getBlock()).toBeNull();
    } finally {
      editor.destroy();
    }
  });

  // Two collaborators: the page is mounted for the first, and the second
  // edits it through a Yjs document synced with the first's. The second's
  // edits reach the first together, when `deliver` is called.
  function mountCollaborative(content: string) {
    const local = new Y.Doc();
    const remote = new Y.Doc();
    const pending: Uint8Array[] = [];
    local.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== "sync") Y.applyUpdate(remote, update, "sync");
    });
    remote.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== "sync") pending.push(update);
    });
    const deliver = () =>
      Y.applyUpdate(local, Y.mergeUpdates(pending.splice(0)), "sync");
    const starterKit = StarterKit.configure({ undoRedo: false });
    const peer = new Editor({
      extensions: [starterKit, Collaboration.configure({ document: remote })],
    });
    peer.commands.setContent(content);
    deliver();

    const requests: DragHandleMenuRequest[] = [];
    const close = vi.fn();
    const mounted = mountEditor(
      "",
      {
        openMenu: (request) => {
          requests.push(request);
          return close;
        },
      },
      undefined,
      undefined,
      undefined,
      [starterKit, Collaboration.configure({ document: local })],
    );
    return { ...mounted, close, deliver, peer, requests };
  }

  it("finds no block once a peer deletes it, though the next block takes its element", () => {
    const { deliver, editor, handle, peer, requests } = mountCollaborative(
      "<p>First</p><p>Second</p>",
    );

    try {
      clickHandle(handle);
      const [request] = requests;
      expect(request.getBlock()?.node.textContent).toBe("First");

      const first = editor.view.nodeDOM(0);
      peer.view.dispatch(
        peer.state.tr.delete(0, peer.state.doc.child(0).nodeSize),
      );
      peer.commands.insertContentAt(
        peer.state.doc.child(0).nodeSize - 1,
        " edited",
      );
      deliver();

      expect(childText(editor, 0)).toBe("Second edited");
      expect(editor.view.nodeDOM(0)).toBe(first);
      expect(request.getBlock()).toBeNull();
      request.remove();
      expect(childText(editor, 0)).toBe("Second edited");
    } finally {
      editor.destroy();
      peer.destroy();
    }
  });

  it("keeps its block when a peer changes another", () => {
    const { close, deliver, editor, handle, peer, requests } =
      mountCollaborative("<p>First</p><p>Second</p>");

    try {
      clickHandle(handle);
      const [request] = requests;

      peer.commands.insertContentAt(0, "<p>Zero</p>");
      peer.commands.insertContentAt(peer.state.doc.content.size - 1, " edited");
      deliver();

      expect(request.getBlock()?.node.textContent).toBe("First");
      expect(request.getBlock()?.pos).toBe(editor.state.doc.child(0).nodeSize);
      expect(close).not.toHaveBeenCalled();
    } finally {
      editor.destroy();
      peer.destroy();
    }
  });

  // y-tiptap writes a peer's edit by rewriting elements in place, so after
  // these the menu block's element holds another block.
  it.each([
    {
      change: "changes it",
      edit: (peer: Editor) =>
        peer.view.dispatch(
          peer.state.tr.setNodeMarkup(0, undefined, { level: 2 }),
        ),
    },
    {
      change: "moves it below the others",
      edit: (peer: Editor) => {
        const first = peer.state.doc.child(0);
        const tr = peer.state.tr.delete(0, first.nodeSize);
        peer.view.dispatch(tr.insert(tr.doc.content.size, first));
      },
    },
    {
      change: "deletes it and edits the next block in one edit",
      edit: (peer: Editor) => {
        const tr = peer.state.tr.delete(0, peer.state.doc.child(0).nodeSize);
        peer.view.dispatch(
          tr.insertText(" edited", tr.doc.child(0).nodeSize - 1),
        );
      },
    },
  ])("lets go of its block once a peer $change", ({ edit }) => {
    const { close, deliver, editor, handle, peer, requests } =
      mountCollaborative("<h1>First</h1><h1>Second</h1><h1>Third</h1>");

    try {
      clickHandle(handle);
      const [request] = requests;

      edit(peer);
      deliver();
      const after = editor.state.doc.toJSON();

      expect(close).toHaveBeenCalledTimes(1);
      expect(handle.getAttribute("aria-expanded")).toBe("false");
      expect(request.getBlock()).toBeNull();
      request.remove();
      request.duplicate();
      expect(editor.state.doc.toJSON()).toEqual(after);
    } finally {
      editor.destroy();
      peer.destroy();
    }
  });

  it("lets go of its block once this editor moves it outside the menu", () => {
    const { close, editor, handle, requests } = mountCollaborative(
      "<p>First</p><p>Second</p><p>Third</p>",
    );

    try {
      clickHandle(handle);
      const [request] = requests;

      const first = editor.state.doc.child(0);
      const tr = editor.state.tr.delete(0, first.nodeSize);
      editor.view.dispatch(tr.insert(tr.doc.content.size, first));

      expect(close).toHaveBeenCalledTimes(1);
      expect(request.getBlock()).toBeNull();
      request.remove();
      expect(editor.state.doc.textContent).toBe("SecondThirdFirst");
    } finally {
      editor.destroy();
    }
  });

  it("lets go of a block the document has no element for once the document loads", () => {
    const local = new Y.Doc();
    const requests: DragHandleMenuRequest[] = [];
    const close = vi.fn();
    const starterKit = StarterKit.configure({ undoRedo: false });
    const { editor, handle } = mountEditor(
      "",
      {
        openMenu: (request) => {
          requests.push(request);
          return close;
        },
      },
      undefined,
      undefined,
      undefined,
      [starterKit, Collaboration.configure({ document: local })],
    );
    const saved = new Y.Doc();
    const loader = new Editor({
      extensions: [starterKit, Collaboration.configure({ document: saved })],
    });

    try {
      clickHandle(handle);
      const [request] = requests;
      expect(request.getBlock()?.node.textContent).toBe("");

      loader.commands.setContent("<p>First</p><p>Second</p>");
      Y.applyUpdate(local, Y.encodeStateAsUpdate(saved));

      expect(childText(editor, 0)).toBe("First");
      expect(close).toHaveBeenCalledTimes(1);
      expect(request.getBlock()).toBeNull();
      request.remove();
      expect(editor.state.doc.textContent).toBe("FirstSecond");
    } finally {
      editor.destroy();
      loader.destroy();
    }
  });

  it("acts on the copy whose menu is open, not the block it copies", () => {
    const { close, deliver, editor, handle, peer, requests } =
      mountCollaborative("<h1>First</h1><p>Second</p>");

    try {
      clickHandle(handle);
      requests[0].duplicate();
      requests[0].onClose();
      const copyPos = editor.state.doc.child(0).nodeSize;
      const at = (pos: number, top: number) =>
        setRect(
          editor.view.nodeDOM(pos) as HTMLElement,
          makeRect({ left: 24, top, width: 640, height: 24 }),
        );
      at(copyPos, 40);
      at(copyPos * 2, 80);
      hoverAt(32, 52);
      clickHandle(handle);
      const request = requests[1];

      expect(request.getBlock()?.pos).toBe(copyPos);
      request.dispatch(
        editor.state.tr.setNodeMarkup(copyPos, undefined, { level: 2 }),
      );
      expect(request.getBlock()?.node.attrs.level).toBe(2);
      expect(close).not.toHaveBeenCalled();
      deliver();
      expect(peer.state.doc.child(0).attrs.level).toBe(1);
      expect(peer.state.doc.child(1).attrs.level).toBe(2);

      request.remove();
      expect(editor.state.doc.childCount).toBe(2);
      expect(editor.state.doc.child(0).attrs.level).toBe(1);
      expect(childText(editor, 1)).toBe("Second");
    } finally {
      editor.destroy();
      peer.destroy();
    }
  });

  it("opens the built-in menu when the app's declines", () => {
    const { editor, handle } = mountEditor("<p>First</p>", {
      openMenu: () => null,
    });

    try {
      clickHandle(handle);
      expect(getMenuItems().map((item) => item.textContent)).toEqual([
        "Duplicate",
        "Delete",
        "Insert block below",
      ]);
    } finally {
      editor.destroy();
    }
  });

  it("closes the app's menu when the page scrolls, but not when the menu or a sidebar does", () => {
    const close = vi.fn();
    const page = document.createElement("div");
    const sidebar = document.createElement("div");
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.append(page, sidebar, menu);
    const { editor, handle } = mountEditor(
      "<p>First</p>",
      { openMenu: () => close },
      undefined,
      page,
    );

    try {
      clickHandle(handle);
      menu.dispatchEvent(new Event("scroll"));
      sidebar.dispatchEvent(new Event("scroll"));
      expect(close).not.toHaveBeenCalled();

      page.dispatchEvent(new Event("scroll"));
      expect(close).toHaveBeenCalledTimes(1);
      expect(handle.getAttribute("aria-expanded")).toBe("false");

      hoverAt(32, 12);
      clickHandle(handle);
      window.dispatchEvent(new Event("scroll"));
      expect(close).toHaveBeenCalledTimes(2);
    } finally {
      editor.destroy();
      page.remove();
      sidebar.remove();
      menu.remove();
    }
  });

  it("keeps the app's menu open while a touch keyboard opens for its field", () => {
    const close = vi.fn();
    const { editor, handle } = mountEditor("<p>First</p>", {
      openMenu: () => close,
    });
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const field = document.createElement("input");
    menu.appendChild(field);
    document.body.appendChild(menu);
    let coarse = true;
    const matchMedia = vi
      .spyOn(window, "matchMedia")
      .mockImplementation(
        (query) => ({ matches: coarse, media: query }) as MediaQueryList,
      );

    try {
      clickHandle(handle);
      field.focus();
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("scroll"));
      expect(close).not.toHaveBeenCalled();

      // Once the keyboard is up, a pan still moves the block away.
      const touch = (type: string, touches: number) => {
        const event = new Event(type, { bubbles: true });
        Object.defineProperty(event, "touches", {
          value: { length: touches },
        });
        document.body.dispatchEvent(event);
      };
      touch("touchstart", 1);
      window.dispatchEvent(new Event("scroll"));
      expect(close).toHaveBeenCalledTimes(1);
      touch("touchend", 0);

      hoverAt(32, 12);
      clickHandle(handle);
      field.focus();
      // A mouse user's resized window moves the block out from under it.
      coarse = false;
      window.dispatchEvent(new Event("resize"));
      expect(close).toHaveBeenCalledTimes(2);
    } finally {
      matchMedia.mockRestore();
      menu.remove();
      editor.destroy();
    }
  });

  it("closes the app's menu with the editor", () => {
    const close = vi.fn();
    const { editor, handle } = mountEditor("<p>First</p>", {
      openMenu: () => close,
    });

    clickHandle(handle);
    editor.destroy();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("DragHandle grip position", () => {
  it("keeps the grip on screen beside a block at the page's edge", () => {
    const { editor, handle } = mountEditor(
      "<p>First</p>",
      {},
      makeRect({ left: 0, top: 0, width: 390, height: 400 }),
    );
    setRect(
      editor.view.nodeDOM(0) as HTMLElement,
      makeRect({ left: 16, top: 0, width: 358, height: 24 }),
    );

    try {
      hoverAt(40, 12);
      expect(handle.style.display).toBe("flex");
      expect(handle.style.left).toBe("0px");
    } finally {
      editor.destroy();
    }
  });
});

describe("DragHandle block selection", () => {
  const modifier = /Mac|iP(hone|[oa]d)/.test(navigator.platform)
    ? { metaKey: true }
    : { ctrlKey: true };

  function pressModD(editor: Editor): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "d",
      ...modifier,
    });
    editor.view.dom.dispatchEvent(event);
    return event;
  }

  function pointerDown(target: Element): void {
    target.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
  }

  it("duplicates a selected block with Mod-d, as the user's edit", () => {
    const { editor } = mountEditor("<p>First</p><p>Second</p>");
    const marks: unknown[] = [];
    editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) marks.push(transaction.getMeta("uiEvent"));
    });

    try {
      editor.commands.setNodeSelection(0);
      const event = pressModD(editor);

      expect(event.defaultPrevented).toBe(true);
      expect(
        Array.from({ length: editor.state.doc.childCount }, (_, index) =>
          childText(editor, index),
        ),
      ).toEqual(["First", "First", "Second"]);
      expect(editor.state.selection.from).toBe(
        editor.state.doc.child(0).nodeSize,
      );
      expect(marks).toEqual([DRAG_HANDLE_UI_EVENT]);
    } finally {
      editor.destroy();
    }
  });

  it("leaves Mod-d to the browser with a caret in text", () => {
    const { editor } = mountEditor("<p>First</p><p>Second</p>");

    try {
      editor.commands.setTextSelection(2);
      const event = pressModD(editor);

      expect(event.defaultPrevented).toBe(false);
      expect(editor.state.doc.childCount).toBe(2);
    } finally {
      editor.destroy();
    }
  });

  it.each([
    ["a paragraph", "<p>First</p><p>Second</p>", 0, "First"],
    ["a divider", "<p>First</p><hr><p>Second</p>", 7, "Second"],
  ])(
    "lets go of %s when the page beside it is clicked",
    (_name, content, pos, caretText) => {
      const { editor, wrapper } = mountEditor(content);
      const page = document.createElement("div");
      document.body.appendChild(page);
      const before = editor.state.doc.toJSON();

      try {
        editor.commands.setNodeSelection(pos);
        expect(
          editor.view.dom.querySelector(".ProseMirror-selectednode"),
        ).not.toBeNull();

        pointerDown(page);

        expect(editor.state.selection.empty).toBe(true);
        expect(editor.state.selection.$from.parent.textContent).toBe(caretText);
        expect(
          editor.view.dom.querySelector(".ProseMirror-selectednode"),
        ).toBeNull();
        expect(editor.state.doc.toJSON()).toEqual(before);
        expect(wrapper.isConnected).toBe(true);
      } finally {
        editor.destroy();
      }
    },
  );

  it("keeps the block selected for a click on the editor, the grip or a control", () => {
    const { editor, handle } = mountEditor("<p>First</p><p>Second</p>");
    const button = document.createElement("button");
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const menuText = document.createElement("span");
    menu.appendChild(menuText);
    document.body.append(button, menu);

    try {
      editor.commands.setNodeSelection(0);
      for (const target of [
        editor.view.dom.querySelector("p")!,
        handle,
        button,
        menuText,
      ]) {
        pointerDown(target);
        expect(editor.state.selection.from).toBe(0);
        expect(editor.state.selection.empty).toBe(false);
      }
    } finally {
      editor.destroy();
    }
  });

  it("stops watching the page once the editor is destroyed", () => {
    const { editor } = mountEditor("<p>First</p><p>Second</p>");
    editor.commands.setNodeSelection(0);
    const dispatch = vi.spyOn(editor.view, "dispatch");
    editor.destroy();

    pointerDown(document.body);

    expect(dispatch).not.toHaveBeenCalled();
  });
});
