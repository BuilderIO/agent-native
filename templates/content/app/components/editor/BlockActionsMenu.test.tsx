// @vitest-environment happy-dom

import type { DragHandleMenuRequest } from "@agent-native/toolkit/editor";
import { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BlockActionsMenu, openBlockActionsMenu } from "./BlockActionsMenu";
import { LOCAL_FILE_USER_EDIT_META } from "./extensions/LocalMdxComponentNode";
import { getTableHeaders } from "./table-commands";
import { createVisualEditorExtensions } from "./VisualEditor";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const cell = (type: "tableCell" | "tableHeader", text: string) => ({
  type,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

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

  function mount(tableOptions = true) {
    page = document.createElement("div");
    document.body.append(page);
    editor = new Editor({
      element: page,
      extensions: createVisualEditorExtensions(),
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Before" }] },
          {
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
          },
        ],
      },
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const current = editor;
    act(() =>
      root!.render(
        <BlockActionsMenu editor={current} tableOptions={tableOptions} />,
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

  const items = () =>
    Array.from(
      document.querySelectorAll('[role="menu"] [role^="menuitem"]'),
      (item) =>
        `${item.textContent}${item.hasAttribute("aria-checked") ? `=${item.getAttribute("aria-checked")}` : ""}`,
    );

  function choose(label: string) {
    const item = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[role="menu"] [role^="menuitem"]',
      ),
    ).find((element) => element.textContent === label)!;
    act(() => item.click());
  }

  it("offers a table's header and width switches", () => {
    open(mount(), 1);

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

  it("runs the grip's actions and tells it the menu closed", () => {
    const { request } = open(mount(), 0);

    expect(items()).toEqual([
      "editor.blockMenu.duplicate",
      "editor.blockMenu.delete",
      "editor.blockMenu.insertBelow",
    ]);

    choose("editor.blockMenu.duplicate");

    expect(request.duplicate).toHaveBeenCalledOnce();
    expect(request.onClose).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("closes when its block is deleted", () => {
    const target = mount();
    const { request } = open(target, 1);
    const table = target.state.doc.child(1);

    act(() => {
      target.view.dispatch(target.state.tr.delete(8, 8 + table.nodeSize));
    });

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(request.onClose).toHaveBeenCalledOnce();
  });

  it("puts the caret in its block on Escape", async () => {
    const target = mount();
    open(target, 1);

    act(() => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(target.view.hasFocus()).toBe(true);
    expect(target.state.selection.empty).toBe(true);
    expect(target.state.selection.$from.parent.textContent).toBe("A");
  });

  it("leaves focus taken while Escape closes it", async () => {
    const target = mount();
    open(target, 1);
    const input = document.createElement("input");
    host!.append(input);

    act(() => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    });
    input.focus();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(document.activeElement).toBe(input);
    expect(target.view.hasFocus()).toBe(false);
  });

  it("leaves out the table switches when asked to", () => {
    open(mount(false), 1);

    expect(items()).not.toContain("database.headerRow=true");
  });

  it("closes when the grip closes it", () => {
    const { request, close } = open(mount(), 1);

    act(() => close!());

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(request.onClose).not.toHaveBeenCalled();
  });

  it("lets the grip open its own menu when no editor menu is mounted", () => {
    const target = mount();
    act(() => root!.unmount());
    root = null;

    expect(open(target, 1).close).toBeNull();
  });
});
