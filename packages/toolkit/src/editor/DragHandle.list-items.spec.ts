// @vitest-environment happy-dom

import { type AnyExtension, Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  DragHandle,
  type DragHandleMenuRequest,
  type DragHandleOptions,
} from "./DragHandle.js";
import { isList, isListItem } from "./listItemBlocks.js";

const ROW = 40;
const NESTED =
  "<p>Intro</p><ul><li><p>One</p></li><li><p>Two</p><ul><li><p>Two A</p></li></ul></li><li><p>Three</p></li></ul><p>Outro</p>";
const LIST_NAMES: Record<string, string> = {
  bulletList: "ul",
  orderedList: "ol",
  taskList: "todo",
};

function outline(node: ProseMirrorNode): string {
  if (node.isTextblock) return node.textContent;
  const parts: string[] = [];
  node.forEach((child) => parts.push(outline(child)));
  if (node.type.name === "doc") return parts.join(" | ");
  if (isListItem(node)) return parts.join(" ");
  return `${LIST_NAMES[node.type.name] ?? node.type.name}(${parts.join(", ")})`;
}

function makeRect(left: number, top: number, width: number, height: number) {
  return new DOMRect(left, top, width, height);
}

function setRect(element: unknown, rect: DOMRect): void {
  if (!(element instanceof HTMLElement)) return;
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => rect,
  });
}

function rowsIn(node: ProseMirrorNode): number {
  let rows = isListItem(node) ? 1 : 0;
  node.forEach((child) => {
    if (isList(child) || isListItem(child)) rows += rowsIn(child);
  });
  return isList(node) || isListItem(node) ? rows : 1;
}

function layOut(editor: Editor): void {
  let row = 0;
  const place = (pos: number, left: number, rows: number) =>
    setRect(
      editor.view.nodeDOM(pos),
      makeRect(left, row * ROW, 664 - left, rows * ROW - 16),
    );
  const visitList = (list: ProseMirrorNode, listPos: number, depth: number) => {
    place(listPos, 24 + depth * 24, rowsIn(list));
    list.forEach((item, offset) => {
      const itemPos = listPos + 1 + offset;
      place(itemPos, 48 + depth * 24, rowsIn(item));
      row += 1;
      item.forEach((child, childOffset) => {
        if (isList(child)) {
          visitList(child, itemPos + 1 + childOffset, depth + 1);
        }
      });
    });
  };
  editor.state.doc.forEach((node, offset) => {
    if (isList(node)) {
      visitList(node, offset, 0);
    } else {
      place(offset, 24, 1);
      row += 1;
    }
  });
}

function mountEditor(
  content: string,
  options: Partial<DragHandleOptions> = { listItems: true },
  extensions: AnyExtension[] = [StarterKit.configure({ trailingNode: false })],
) {
  const wrapper = document.createElement("div");
  wrapper.className = "visual-editor-wrapper";
  setRect(wrapper, makeRect(24, 0, 640, 400));
  document.body.appendChild(wrapper);
  const element = document.createElement("div");
  wrapper.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [
      ...extensions,
      TaskList,
      TaskItem.configure({ nested: true }),
      DragHandle.configure(options),
    ],
    content,
  });
  setRect(editor.view.dom, makeRect(24, 0, 640, 400));
  layOut(editor);
  hoverAt(6);
  const handle = wrapper.querySelector<HTMLElement>(".drag-handle");
  if (!handle) throw new Error("Expected drag handle to mount");
  setRect(handle, makeRect(0, 2, 24, 24));
  return { editor, wrapper, handle };
}

function hoverAt(y: number): void {
  document.dispatchEvent(
    new MouseEvent("mousemove", { bubbles: true, clientX: 60, clientY: y }),
  );
}

function openMenuAt(handle: HTMLElement, y: number): void {
  hoverAt(y);
  for (const type of ["mousedown", "mouseup"]) {
    (type === "mousedown" ? handle : document).dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        button: 0,
        clientX: 12,
        clientY: y,
      }),
    );
  }
}

function dragTo(handle: HTMLElement, fromY: number, toY: number): void {
  hoverAt(fromY);
  handle.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      clientX: 12,
      clientY: fromY,
    }),
  );
  document.dispatchEvent(
    new MouseEvent("mousemove", { bubbles: true, clientX: 60, clientY: toY }),
  );
}

function drop(toY: number): void {
  document.dispatchEvent(
    new MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      clientX: 60,
      clientY: toY,
    }),
  );
}

function clickMenuItem(label: string): void {
  const item = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".an-rich-md-drag-menu__item"),
  ).find((button) => button.textContent.includes(label));
  if (!item) throw new Error(`Expected menu item "${label}"`);
  item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function caretIn(editor: Editor, text: string, offset = 0): void {
  let target = -1;
  editor.state.doc.descendants((node, pos) => {
    if (target === -1 && node.isTextblock && node.textContent === text) {
      target = pos + 1 + offset;
    }
  });
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, target),
    ),
  );
}

function press(editor: Editor, key: string, shiftKey = false): KeyboardEvent {
  const modifier = /Mac|iP(hone|[oa]d)/.test(navigator.platform)
    ? { metaKey: true }
    : { ctrlKey: true };
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    shiftKey,
    ...modifier,
  });
  editor.view.dom.dispatchEvent(event);
  return event;
}

const rowTop = (row: number) => row * ROW;

afterEach(() => {
  document.body.innerHTML = "";
  document
    .querySelectorAll("#an-rich-md-drag-menu-styles")
    .forEach((node) => node.remove());
});

describe("DragHandle with list items as blocks", () => {
  it("gives each item its own grip, beside its bullet, nested ones too", () => {
    const { editor, handle } = mountEditor(NESTED);

    try {
      hoverAt(rowTop(1) + 6);
      expect(handle.style.top).toBe(`${rowTop(1) + 2}px`);
      expect(handle.style.left).toBe("-24px");

      hoverAt(rowTop(2) + 30);
      expect(handle.style.top).toBe(`${rowTop(2) + 2}px`);

      hoverAt(rowTop(3) + 6);
      expect(handle.style.top).toBe(`${rowTop(3) + 2}px`);
      expect(handle.style.left).toBe("0px");
    } finally {
      editor.destroy();
    }
  });

  it("keeps one grip for the whole list without the option", () => {
    const { editor, handle } = mountEditor(NESTED, {});

    try {
      hoverAt(rowTop(3) + 6);
      expect(handle.style.top).toBe(`${rowTop(1) + 2}px`);
    } finally {
      editor.destroy();
    }
  });

  it("deletes, duplicates and inserts one item from its menu", () => {
    const { editor, handle } = mountEditor(NESTED);

    try {
      openMenuAt(handle, rowTop(1) + 6);
      clickMenuItem("Duplicate");
      expect(outline(editor.state.doc)).toBe(
        "Intro | ul(One, One, Two ul(Two A), Three) | Outro",
      );

      layOut(editor);
      openMenuAt(handle, rowTop(4) + 6);
      clickMenuItem("Delete");
      expect(outline(editor.state.doc)).toBe(
        "Intro | ul(One, One, Two, Three) | Outro",
      );

      layOut(editor);
      openMenuAt(handle, rowTop(4) + 6);
      clickMenuItem("Insert block below");
      expect(outline(editor.state.doc)).toBe(
        "Intro | ul(One, One, Two, Three, ) | Outro",
      );
      expect(editor.state.selection.$from.node(-1).type.name).toBe("listItem");
      expect(editor.state.selection.$from.parent.textContent).toBe("");
    } finally {
      editor.destroy();
    }
  });

  it("takes a list along with its only item", () => {
    const { editor, handle } = mountEditor(
      "<p>Before</p><ul><li><p>Only</p></li></ul><p>After</p>",
    );

    try {
      openMenuAt(handle, rowTop(1) + 6);
      clickMenuItem("Delete");
      expect(outline(editor.state.doc)).toBe("Before | After");
    } finally {
      editor.destroy();
    }
  });

  it("drops a paragraph between two items", () => {
    const { editor, handle } = mountEditor(NESTED);

    try {
      dragTo(handle, rowTop(0) + 6, rowTop(4) + 4);
      drop(rowTop(4) + 4);
      expect(outline(editor.state.doc)).toBe(
        "ul(One, Two ul(Two A)) | Intro | ul(Three) | Outro",
      );
    } finally {
      editor.destroy();
    }
  });

  it("moves one item, out of its list or under another", () => {
    const { editor, handle } = mountEditor(NESTED);

    try {
      dragTo(handle, rowTop(1) + 6, rowTop(2) + 30);
      drop(rowTop(2) + 30);
      expect(outline(editor.state.doc)).toBe(
        "Intro | ul(Two ul(One, Two A), Three) | Outro",
      );

      layOut(editor);
      dragTo(handle, rowTop(4) + 6, rowTop(0) + 4);
      drop(rowTop(0) + 4);
      expect(outline(editor.state.doc)).toBe(
        "ul(Three) | Intro | ul(Two ul(One, Two A)) | Outro",
      );
    } finally {
      editor.destroy();
    }
  });

  it("starts the drop line at the edge of the list a block will land in", () => {
    const { editor, handle, wrapper } = mountEditor(NESTED);

    try {
      dragTo(handle, rowTop(0) + 6, rowTop(3) + 4);
      const line = wrapper.querySelector<HTMLElement>(".notion-drop-indicator");
      expect(line?.style.left).toBe("24px");
      expect(line?.style.top).toBe(`${rowTop(3)}px`);

      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 60,
          clientY: rowTop(5) + 4,
        }),
      );
      expect(line?.style.left).toBe("0px");
      drop(rowTop(5) + 4);
    } finally {
      editor.destroy();
    }
  });

  it("makes an item dropped among to-dos a to-do", () => {
    const { editor, handle } = mountEditor(
      '<ul><li><p>Bullet</p></li></ul><p>Between</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task</p></li></ul>',
    );

    try {
      dragTo(handle, rowTop(0) + 6, rowTop(2) + 20);
      drop(rowTop(2) + 20);
      expect(outline(editor.state.doc)).toBe("Between | todo(Task, Bullet)");
      expect(editor.state.doc.child(1).lastChild?.type.name).toBe("taskItem");
    } finally {
      editor.destroy();
    }
  });

  it("duplicates the item with the caret on Mod-d, and moves it with Mod-Shift-arrows", () => {
    const { editor } = mountEditor(NESTED);

    try {
      caretIn(editor, "Two A", 2);
      expect(press(editor, "d").defaultPrevented).toBe(true);
      expect(outline(editor.state.doc)).toBe(
        "Intro | ul(One, Two ul(Two A, Two A), Three) | Outro",
      );
      expect(editor.state.selection.$from.parentOffset).toBe(2);
      expect(editor.state.selection.$from.index(-2)).toBe(1);

      caretIn(editor, "One", 1);
      expect(press(editor, "ArrowDown", true).defaultPrevented).toBe(true);
      expect(outline(editor.state.doc)).toBe(
        "Intro | ul(Two ul(Two A, Two A), One, Three) | Outro",
      );
      expect(editor.state.selection.$from.parent.textContent).toBe("One");
      expect(editor.state.selection.$from.parentOffset).toBe(1);

      expect(press(editor, "ArrowUp", true).defaultPrevented).toBe(true);
      expect(outline(editor.state.doc)).toBe(
        "Intro | ul(One, Two ul(Two A, Two A), Three) | Outro",
      );
    } finally {
      editor.destroy();
    }
  });

  it("moves an item at the edge of its list out past the block beside the list", () => {
    const { editor } = mountEditor(NESTED);

    try {
      caretIn(editor, "One", 1);
      expect(press(editor, "ArrowUp", true).defaultPrevented).toBe(true);
      expect(outline(editor.state.doc)).toBe(
        "ul(One) | Intro | ul(Two ul(Two A), Three) | Outro",
      );
      expect(editor.state.selection.$from.parent.textContent).toBe("One");
      expect(editor.state.selection.$from.parentOffset).toBe(1);
      expect(press(editor, "ArrowUp", true).defaultPrevented).toBe(false);

      expect(press(editor, "ArrowDown", true).defaultPrevented).toBe(true);
      expect(outline(editor.state.doc)).toBe(
        "Intro | ul(One, Two ul(Two A), Three) | Outro",
      );

      caretIn(editor, "Three", 1);
      expect(press(editor, "ArrowDown", true).defaultPrevented).toBe(true);
      expect(outline(editor.state.doc)).toBe(
        "Intro | ul(One, Two ul(Two A)) | Outro | ul(Three)",
      );

      caretIn(editor, "Two A", 1);
      expect(press(editor, "ArrowUp", true).defaultPrevented).toBe(false);
      expect(press(editor, "ArrowDown", true).defaultPrevented).toBe(false);
      expect(outline(editor.state.doc)).toBe(
        "Intro | ul(One, Two ul(Two A)) | Outro | ul(Three)",
      );
    } finally {
      editor.destroy();
    }
  });

  it("leaves Mod-d to the browser with the caret outside a list", () => {
    const { editor } = mountEditor(NESTED);

    try {
      caretIn(editor, "Intro", 1);
      expect(press(editor, "d").defaultPrevented).toBe(false);
      expect(outline(editor.state.doc)).toBe(
        "Intro | ul(One, Two ul(Two A), Three) | Outro",
      );
    } finally {
      editor.destroy();
    }
  });

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
    const starterKit = StarterKit.configure({
      undoRedo: false,
      trailingNode: false,
    });
    const peer = new Editor({
      extensions: [
        starterKit,
        TaskList,
        TaskItem.configure({ nested: true }),
        Collaboration.configure({ document: remote }),
      ],
    });
    peer.commands.setContent(content);
    deliver();
    const requests: DragHandleMenuRequest[] = [];
    const mounted = mountEditor(
      "",
      {
        listItems: true,
        openMenu: (request) => {
          requests.push(request);
          return () => {};
        },
      },
      [starterKit, Collaboration.configure({ document: local })],
    );
    return { ...mounted, deliver, peer, requests };
  }

  it("keeps a nested item's menu on it while a peer edits other items, and lets go once the peer deletes it", () => {
    const { deliver, editor, handle, peer, requests } =
      mountCollaborative(NESTED);

    try {
      openMenuAt(handle, rowTop(3) + 6);
      const [request] = requests;
      expect(request.getBlock()?.node.textContent).toBe("Two A");

      let onePos = -1;
      peer.state.doc.descendants((node, pos) => {
        if (onePos === -1 && node.isTextblock && node.textContent === "One") {
          onePos = pos;
        }
      });
      peer.commands.insertContentAt(onePos + 4, " edited");
      deliver();
      expect(outline(editor.state.doc)).toBe(
        "Intro | ul(One edited, Two ul(Two A), Three) | Outro",
      );
      expect(request.getBlock()?.node.textContent).toBe("Two A");
      expect(
        editor.state.doc.nodeAt(request.getBlock()?.pos ?? -1)?.textContent,
      ).toBe("Two A");

      let twoAPos = -1;
      peer.state.doc.descendants((node, pos) => {
        if (twoAPos === -1 && isList(node) && node.textContent === "Two A") {
          twoAPos = pos;
        }
      });
      const nested = peer.state.doc.nodeAt(twoAPos);
      peer.view.dispatch(
        peer.state.tr.delete(twoAPos, twoAPos + (nested?.nodeSize ?? 0)),
      );
      deliver();
      expect(outline(editor.state.doc)).toBe(
        "Intro | ul(One edited, Two, Three) | Outro",
      );
      expect(request.getBlock()).toBeNull();
    } finally {
      editor.destroy();
      peer.destroy();
    }
  });
});
