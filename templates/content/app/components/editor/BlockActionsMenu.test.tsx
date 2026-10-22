// @vitest-environment happy-dom

import type { DragHandleMenuRequest } from "@agent-native/toolkit/editor";
import { Editor, type JSONContent } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BlockActionsMenu, openBlockActionsMenu } from "./BlockActionsMenu";
import { LOCAL_FILE_USER_EDIT_META } from "./extensions/LocalMdxComponentNode";
import { getTableHeaders } from "./table-commands";
import { createVisualEditorExtensions } from "./VisualEditor";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, string>) =>
    vars ? `${key}(${Object.values(vars).join(",")})` : key,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const APPLE = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
const MOD: KeyboardEventInit = APPLE ? { metaKey: true } : { ctrlKey: true };

const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const cell = (type: "tableCell" | "tableHeader", text: string) => ({
  type,
  content: [paragraph(text)],
});

const TABLE = {
  type: "table",
  content: [
    {
      type: "tableRow",
      content: [cell("tableHeader", "A"), cell("tableHeader", "B")],
    },
    {
      type: "tableRow",
      content: [cell("tableCell", "C"), cell("tableCell", "D")],
    },
  ],
};

const SOURCE_COMPONENT = {
  type: "registryBlock",
  attrs: { blockType: "source-component", blockId: "hero-1" },
};

describe("BlockActionsMenu", () => {
  let editor: Editor | null = null;
  let root: Root | null = null;
  let host: HTMLElement | null = null;
  let page: HTMLElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    editor?.destroy();
    page?.remove();
    editor = root = host = page = null;
  });

  function mount({
    content = [paragraph("Before"), TABLE],
    suggesting = false,
    onComment,
  }: {
    content?: JSONContent[];
    suggesting?: boolean;
    onComment?: () => void;
  } = {}) {
    page = document.createElement("div");
    document.body.append(page);
    editor = new Editor({
      element: page,
      extensions: createVisualEditorExtensions(),
      content: { type: "doc", content },
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const current = editor;
    act(() =>
      root!.render(
        <BlockActionsMenu
          editor={current}
          onComment={onComment}
          suggesting={suggesting}
        />,
      ),
    );
    return current;
  }

  function open(target: Editor, index: number) {
    const request: DragHandleMenuRequest = {
      view: target.view,
      anchorRect: new DOMRect(0, 0, 24, 24),
      getBlock: () => {
        if (index >= target.state.doc.childCount) return null;
        let pos = 0;
        for (let child = 0; child < index; child += 1) {
          pos += target.state.doc.child(child).nodeSize;
        }
        return { node: target.state.doc.child(index), pos };
      },
      dispatch: (tr) => target.view.dispatch(tr),
      duplicate: vi.fn(),
      remove: vi.fn(),
      insertBelow: vi.fn(),
      onClose: vi.fn(),
    };
    let close: (() => void) | null = null;
    act(() => {
      close = openBlockActionsMenu(request);
    });
    return { request, close: close as (() => void) | null };
  }

  const menus = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]'));
  const searchBox = () => menus()[0]!.querySelector<HTMLInputElement>("input")!;

  // An item's own words, without its icon or shortcut hint.
  const label = (item: Element) =>
    Array.from(item.childNodes)
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent)
      .join("");

  const menuItems = (menu = menus()[0]) =>
    Array.from(menu?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);

  const items = (menu = menus()[0]) =>
    menuItems(menu).map(
      (item) =>
        `${label(item)}${item.hasAttribute("aria-checked") ? `=${item.getAttribute("aria-checked")}` : ""}`,
    );

  const item = (text: string, menu = menus()[0]) =>
    menuItems(menu).find((element) => label(element) === text)!;

  function choose(text: string, menu = menus()[0]) {
    act(() => item(text, menu).click());
  }

  function search(text: string) {
    const input = searchBox();
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setValue.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function press(target: Element, key: string, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
      ...init,
    });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }

  function openSubmenu(text: string) {
    const trigger = item(text);
    act(() => trigger.focus());
    press(trigger, "ArrowRight");
    return menus()[1]!;
  }

  it("offers a table's header and width switches", () => {
    open(mount(), 1);

    expect(menus()[0]!.textContent).toContain("editor.slash.table");
    expect(items()).toEqual([
      "database.headerRow=true",
      "database.headerColumn=false",
      "database.fitToWidth=false",
      "editor.blockMenu.duplicate",
      "editor.blockMenu.delete",
      "editor.blockMenu.insertBelow",
    ]);
  });

  it("toggles a switch as the user's edit and stays open", () => {
    const target = mount();
    const metas: unknown[] = [];
    target.on("transaction", ({ transaction }: { transaction: Transaction }) =>
      metas.push(transaction.getMeta(LOCAL_FILE_USER_EDIT_META)),
    );
    open(target, 1);

    choose("database.headerColumn");

    expect(getTableHeaders(target.state.doc.child(1))).toEqual({
      row: true,
      column: true,
    });
    expect(metas).toContain(true);
    expect(items()).toContain("database.headerColumn=true");

    choose("database.fitToWidth");
    expect(target.state.doc.child(1).attrs.fitPageWidth).toBe(true);
    expect(items()).toContain("database.fitToWidth=true");
  });

  it("titles a text block's menu and offers its kind, colour and comment", () => {
    open(mount({ onComment: vi.fn() }), 0);

    expect(menus()[0]!.textContent).toContain("editor.slash.text");
    expect(items()).toEqual([
      "editor.slash.turnInto",
      "editor.color.label",
      "editor.blockMenu.duplicate",
      "editor.blockMenu.delete",
      "editor.blockMenu.insertBelow",
      "editor.comment",
    ]);
  });

  it("runs the grip's actions and tells it the menu closed", () => {
    const { request } = open(mount(), 0);

    choose("editor.blockMenu.duplicate");

    expect(request.duplicate).toHaveBeenCalledOnce();
    expect(request.onClose).toHaveBeenCalledOnce();
    expect(menus()).toEqual([]);
  });

  it("opens Turn into with the block's kind checked", () => {
    open(mount(), 0);

    const submenu = openSubmenu("editor.slash.turnInto");

    expect(items(submenu)).toEqual([
      "editor.slash.text=true",
      "editor.heading1=false",
      "editor.heading2=false",
      "editor.heading3=false",
      "editor.slash.bulletedList=false",
      "editor.slash.numberedList=false",
      "editor.slash.todoList=false",
      "editor.slash.quote=false",
      "editor.slash.codeBlock=false",
    ]);
  });

  it("turns a block into a heading as one user edit, ready to type in", () => {
    const target = mount();
    const metas: unknown[] = [];
    target.on(
      "transaction",
      ({ transaction }: { transaction: Transaction }) => {
        if (transaction.docChanged) {
          metas.push(transaction.getMeta(LOCAL_FILE_USER_EDIT_META));
        }
      },
    );
    open(target, 0);

    choose("editor.heading3", openSubmenu("editor.slash.turnInto"));

    const heading = target.state.doc.child(0);
    expect(heading.type.name).toBe("heading");
    expect(heading.attrs.level).toBe(3);
    expect(heading.textContent).toBe("Before");
    expect(metas).toEqual([true]);
    expect(menus()).toEqual([]);
    expect(target.view.hasFocus()).toBe(true);
    expect(target.state.selection.empty).toBe(true);
    expect(target.state.selection.from).toBe(7);

    act(() => {
      target.commands.undo();
    });
    expect(target.state.doc.child(0).type.name).toBe("paragraph");
    expect(target.state.doc.child(0).textContent).toBe("Before");
  });

  it("wraps a block in a list, keeping its text and colour", () => {
    const target = mount({
      content: [
        { ...paragraph("Before"), attrs: { color: "blue" } },
        paragraph("After"),
      ],
    });
    open(target, 0);

    choose("editor.slash.bulletedList", openSubmenu("editor.slash.turnInto"));

    const list = target.state.doc.child(0);
    expect(list.type.name).toBe("bulletList");
    expect(list.textContent).toBe("Before");
    expect(list.firstChild!.firstChild!.attrs.color).toBe("blue");
    expect(target.state.selection.$from.parent.textContent).toBe("Before");
    expect(target.state.selection.$from.parentOffset).toBe(6);
  });

  it("colours a block as the user's edit", () => {
    const target = mount();
    const metas: unknown[] = [];
    target.on(
      "transaction",
      ({ transaction }: { transaction: Transaction }) => {
        if (transaction.docChanged) {
          metas.push(transaction.getMeta(LOCAL_FILE_USER_EDIT_META));
        }
      },
    );
    open(target, 0);

    choose(
      "editor.color.backgroundChoice(editor.color.blue)",
      openSubmenu("editor.color.label"),
    );

    expect(target.state.doc.child(0).attrs.color).toBe("blue_bg");
    expect(metas).toEqual([true]);
    expect(menus()).toEqual([]);
  });

  it("starts a comment on the block's text", () => {
    const onComment = vi.fn();
    open(mount({ onComment }), 0);

    choose("editor.comment");

    expect(onComment).toHaveBeenCalledOnce();
    expect(onComment.mock.calls[0]?.[0]).toBe("Before");
    expect(onComment.mock.calls[0]?.[3]).toEqual({ from: 1, to: 7 });
    expect(menus()).toEqual([]);
  });

  it("filters as you type and runs the first match on Enter", () => {
    const { request } = open(mount(), 0);

    expect(document.activeElement).toBe(searchBox());
    search("dup");
    expect(items()).toEqual(["editor.blockMenu.duplicate"]);

    search("heading");
    expect(items()).toEqual([
      "editor.heading1=false",
      "editor.heading2=false",
      "editor.heading3=false",
    ]);

    search("zzz");
    expect(items()).toEqual([]);
    expect(menus()[0]!.textContent).toContain("editor.blockMenu.noResults");

    search("dup");
    press(searchBox(), "Enter");
    expect(request.duplicate).toHaveBeenCalledOnce();
    expect(menus()).toEqual([]);
  });

  it("moves between the search and the items with the arrow keys", () => {
    open(mount(), 0);

    press(searchBox(), "ArrowDown");
    expect(document.activeElement).toBe(item("editor.slash.turnInto"));

    press(document.activeElement!, "ArrowUp");
    expect(document.activeElement).toBe(searchBox());

    press(searchBox(), "ArrowUp");
    expect(document.activeElement).toBe(item("editor.blockMenu.insertBelow"));
  });

  it("filters with what's typed while an item has focus", () => {
    open(mount(), 0);
    const duplicate = item("editor.blockMenu.duplicate");
    act(() => duplicate.focus());

    const typed = press(duplicate, "u");
    expect(typed.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(searchBox());
    expect(searchBox().value).toBe("u");

    const kept = item("editor.blockMenu.duplicate");
    act(() => kept.focus());
    const erased = press(kept, "Backspace");
    expect(erased.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(searchBox());
    expect(searchBox().value).toBe("");
  });

  it("leaves the keys that pick an input method's candidate to it", () => {
    const { request } = open(mount(), 0);

    search("dup");
    const enter = press(searchBox(), "Enter", { isComposing: true });
    const arrow = press(searchBox(), "ArrowDown", { isComposing: true });

    expect(enter.defaultPrevented).toBe(false);
    expect(arrow.defaultPrevented).toBe(false);
    expect(request.duplicate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(searchBox());
    expect(menus()).toHaveLength(1);
  });

  it("runs Duplicate, Delete and Comment from their shortcuts", () => {
    const onComment = vi.fn();
    const target = mount({ onComment });

    let { request } = open(target, 0);
    expect(
      item("editor.blockMenu.duplicate").getAttribute("aria-keyshortcuts"),
    ).toBe(APPLE ? "Meta+D" : "Control+D");
    const duplicate = press(searchBox(), "d", MOD);
    expect(duplicate.defaultPrevented).toBe(true);
    expect(request.duplicate).toHaveBeenCalledOnce();
    expect(menus()).toEqual([]);

    ({ request } = open(target, 0));
    press(searchBox(), "Delete");
    expect(request.remove).toHaveBeenCalledOnce();

    ({ request } = open(target, 0));
    press(searchBox(), "M", { ...MOD, shiftKey: true });
    expect(onComment).toHaveBeenCalledOnce();
    expect(menus()).toEqual([]);
  });

  it("leaves Delete to the search while it has text", () => {
    const { request } = open(mount(), 0);

    search("x");
    press(searchBox(), "Delete");

    expect(request.remove).not.toHaveBeenCalled();
    expect(menus()).toHaveLength(1);
  });

  it("says why a source component can't be duplicated or deleted", () => {
    const target = mount({ content: [paragraph("Before"), SOURCE_COMPONENT] });
    const { request } = open(target, 1);

    const duplicate = item("editor.blockMenu.duplicate");
    const remove = item("editor.blockMenu.delete");
    expect(duplicate.hasAttribute("data-disabled")).toBe(true);
    expect(remove.hasAttribute("data-disabled")).toBe(true);
    const reason = document.getElementById(
      duplicate.getAttribute("aria-describedby")!,
    );
    expect(reason?.textContent).toBe("editor.blockMenu.lockedSource");
    expect(remove.getAttribute("aria-describedby")).toBe(reason?.id);

    const shortcut = press(searchBox(), "d", MOD);
    press(searchBox(), "Delete");
    expect(shortcut.defaultPrevented).toBe(true);
    expect(request.duplicate).not.toHaveBeenCalled();
    expect(request.remove).not.toHaveBeenCalled();
    expect(menus()).toHaveLength(1);
  });

  it("leaves out a block's kind, colour and table settings while suggesting", () => {
    const target = mount({ suggesting: true });
    open(target, 0);

    expect(items()).toEqual([
      "editor.blockMenu.duplicate",
      "editor.blockMenu.delete",
      "editor.blockMenu.insertBelow",
    ]);

    act(() => root!.render(<BlockActionsMenu editor={target} suggesting />));
    open(target, 1);
    expect(items()).not.toContain("database.headerRow=true");
  });

  it("closes when its block is deleted", () => {
    const target = mount();
    const { request } = open(target, 1);
    const table = target.state.doc.child(1);

    act(() => {
      target.view.dispatch(target.state.tr.delete(8, 8 + table.nodeSize));
    });

    expect(menus()).toEqual([]);
    expect(request.onClose).toHaveBeenCalledOnce();
  });

  it("puts the caret in its block on Escape", async () => {
    const target = mount();
    open(target, 1);

    press(document.activeElement!, "Escape");
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(menus()).toEqual([]);
    expect(target.view.hasFocus()).toBe(true);
    expect(target.state.selection.empty).toBe(true);
    expect(target.state.selection.$from.parent.textContent).toBe("A");
  });

  it.each(["editor.slash.turnInto", "editor.color.label"])(
    "puts the caret in its block on Escape from %s",
    async (submenu) => {
      const target = mount();
      open(target, 0);

      press(menuItems(openSubmenu(submenu))[0]!, "Escape");
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

      expect(menus()).toEqual([]);
      expect(target.view.hasFocus()).toBe(true);
      expect(target.state.selection.empty).toBe(true);
      expect(target.state.selection.$from.parent.textContent).toBe("Before");
    },
  );

  it("leaves focus taken while Escape closes it", async () => {
    const target = mount();
    open(target, 1);
    const input = document.createElement("input");
    host!.append(input);

    press(document.activeElement!, "Escape");
    input.focus();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(document.activeElement).toBe(input);
    expect(target.view.hasFocus()).toBe(false);
  });

  it("closes when the grip closes it", () => {
    const { request, close } = open(mount(), 1);

    act(() => close!());

    expect(menus()).toEqual([]);
    expect(request.onClose).not.toHaveBeenCalled();
  });

  it("lets the grip open its own menu when no editor menu is mounted", () => {
    const target = mount();
    act(() => root!.unmount());
    root = null;

    expect(open(target, 1).close).toBeNull();
  });
});
