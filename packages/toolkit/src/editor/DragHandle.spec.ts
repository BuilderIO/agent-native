// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DragHandle, type DragHandleOptions } from "./DragHandle.js";

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

afterEach(() => {
  document.body.innerHTML = "";
  document
    .querySelectorAll("#an-rich-md-drag-menu-styles")
    .forEach((node) => node.remove());
});

describe("DragHandle menu", () => {
  it("opens the block menu on a single click", () => {
    const { editor, handle } = mountEditor("<p>First</p><p>Second</p>");

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
    // A flush-left nested region (like the first column of a `columns` block)
    // shares its container's left-margin gutter. Hovering that gutter — where the
    // grip lives — must select the CONTAINER so it can be dragged to reorder,
    // even though the nested editor is the smaller area. (Regression: nested
    // column editors used to win everywhere, leaving the columns block ungrabbable.)
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
    // Inner region mounted flush-left (block left === container left), mirroring a
    // column that starts at the container's left edge.
    const inner = mountEditor(
      "<p>Inner block</p>",
      {},
      makeRect({ left: 24, top: 160, width: 300, height: 90 }),
      outer.wrapper,
      { x: 60, y: 172 },
    );

    try {
      // Over the inner body, the innermost (smallest) editor still wins.
      hoverAt(60, 172);
      expect(inner.handle.style.display).toBe("flex");
      expect(outer.handle.style.display).toBe("none");

      // In the shared left-margin gutter AT THE NESTED BLOCK'S ROW, the inner
      // block owns the grip band — so a block inside a flush-left column stays
      // grabbable there to drag OUT of / BETWEEN columns. Its grip glyph renders
      // in this exact gutter, so flipping to the container here would make the
      // block's own grip unclickable (the whole point of column drag handles).
      hoverAt(10, 172);
      expect(inner.handle.style.display).toBe("flex");
      expect(outer.handle.style.display).toBe("none");

      // In the gutter ABOVE the nested region (a row the container alone
      // occupies), the container still wins, so the columns block itself remains
      // grabbable — it just yields the rows where a nested block's grip lives.
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
    // A right column / tab body renders its grip in a gap, NOT the page-left
    // gutter. Moving the cursor from that block's body toward its grip crosses
    // into the neighbour's wide forgiving zone (and even its content), so the
    // plain picker flips hover to the neighbour and the grip vanishes before the
    // cursor reaches it. The keepalive must hold the grip across that approach.
    // Here the right grip glyph sits at x:320–344 — LEFT of the 28px gutter band
    // and inside the left region's content [24,336], so without keepalive the
    // left region wins at x=330 and the right grip disappears.
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
    // The right block's grip glyph, rendered in the inter-region gap.
    setRect(
      right.handle,
      makeRect({ left: 320, top: 162, width: 24, height: 24 }),
    );

    try {
      // Over the right block's body → its grip shows.
      hoverAt(500, 172);
      expect(right.handle.style.display).toBe("flex");

      // Cursor moved left onto the right block's grip glyph (x=330). This is
      // inside the LEFT region's content, so the plain picker would hand hover to
      // the left region — the keepalive must keep the RIGHT grip visible.
      hoverAt(330, 172);
      expect(right.handle.style.display).toBe("flex");
      expect(left.handle.style.display).toBe("none");
    } finally {
      right.editor.destroy();
      left.editor.destroy();
    }
  });
});
