// @vitest-environment happy-dom

import type { Extensions } from "@tiptap/core";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => children,
  PopoverTrigger: ({ children }: { children: ReactNode }) => children,
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div data-popover-content="">{children}</div>
  ),
}));

// Radix opens its menu on pointerdown and reports focus return on close. The
// stand-in renders the menu inline and fires the same close callback after a
// selection so the toolbar's deferred-action path runs.
vi.mock("@/components/ui/dropdown-menu", async () => {
  const { createContext, useContext } = await import("react");
  const Close = createContext<() => void>(() => {});
  const Item = ({
    children,
    disabled,
    onSelect,
    ...rest
  }: {
    children: ReactNode;
    disabled?: boolean;
    onSelect?: () => void;
    checked?: boolean;
  }) => {
    const close = useContext(Close);
    return (
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        aria-checked={rest.checked}
        onClick={() => {
          onSelect?.();
          close();
        }}
      >
        {children}
      </button>
    );
  };
  return {
    DropdownMenu: ({ children }: { children: ReactNode }) => children,
    DropdownMenuTrigger: ({ children }: { children: ReactNode }) => children,
    DropdownMenuContent: ({
      children,
      onCloseAutoFocus,
    }: {
      children: ReactNode;
      onCloseAutoFocus?: (event: Event) => void;
    }) => (
      <Close.Provider
        value={() =>
          onCloseAutoFocus?.(new Event("closeAutoFocus", { cancelable: true }))
        }
      >
        <div role="menu" data-overflow-menu="">
          {children}
        </div>
      </Close.Provider>
    ),
    DropdownMenuItem: Item,
    DropdownMenuCheckboxItem: Item,
    DropdownMenuSub: ({ children }: { children: ReactNode }) => children,
    DropdownMenuSubTrigger: ({
      children,
      disabled,
    }: {
      children: ReactNode;
      disabled?: boolean;
    }) => (
      <button type="button" role="menuitem" disabled={disabled}>
        {children}
      </button>
    ),
    DropdownMenuSubContent: ({ children }: { children: ReactNode }) => (
      <div data-overflow-color="">{children}</div>
    ),
  };
});

import { BubbleToolbar } from "./BubbleToolbar";

// The color submenu row leads with its aria-hidden "A" glyph.
const COLOR_ITEM = "Aeditor.color.label";

const STRIP_LABELS = {
  textStyle: "editor.slash.turnInto",
  bold: "editor.bold",
  italic: "editor.italic",
  bulletList: "editor.slash.bulletedList",
  orderedList: "editor.slash.numberedList",
  link: "editor.link",
  undo: "editor.toolbar.undo",
  redo: "editor.toolbar.redo",
  underline: "editor.underline",
  strike: "editor.strikethrough",
  code: "editor.code",
  color: "editor.color.label",
  taskList: "editor.slash.todoList",
};

describe("docked BubbleToolbar", () => {
  let editor: Editor;
  let editorElement: HTMLDivElement;
  let container: HTMLDivElement;
  let root: Root;
  let width = 1040;
  const resizeCallbacks: Array<() => void> = [];

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(() => callback([], this as never));
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return {
          width: this.getAttribute("role") === "toolbar" ? width : 0,
          height: 0,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      },
    );
    editorElement = document.createElement("div");
    container = document.createElement("div");
    document.body.append(editorElement, container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    editor.destroy();
    editorElement.remove();
    container.remove();
    resizeCallbacks.length = 0;
    width = 1040;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mount({
    content = "<p>Format this text</p><p>Second block</p>",
    extensions = [StarterKit],
    selection = { from: 1, to: 7 },
    containerWidth = 1040,
    onUndo = vi.fn(),
    onRedo = vi.fn(),
    onComment,
  }: {
    content?: string;
    extensions?: Extensions;
    selection?: { from: number; to: number };
    containerWidth?: number;
    onUndo?: () => void;
    onRedo?: () => void;
    onComment?: () => void;
  } = {}) {
    width = containerWidth;
    editor = new Editor({ element: editorElement, extensions, content });
    editor.commands.setTextSelection(selection);
    await act(async () =>
      root.render(
        <BubbleToolbar
          docked
          editor={editor}
          onUndo={onUndo}
          onRedo={onRedo}
          onComment={onComment}
        />,
      ),
    );
    return { onUndo, onRedo };
  }

  const toolbar = () =>
    container.querySelector<HTMLElement>('[role="toolbar"]')!;
  const stripButtons = () =>
    Array.from(
      toolbar().querySelectorAll<HTMLButtonElement>(":scope > button"),
    );
  // The text style trigger names its current style after a colon.
  const stripLabels = () =>
    stripButtons().map((button) =>
      (button.getAttribute("aria-label") ?? "").replace(/:.*$/, ""),
    );
  const strip = (label: string) =>
    stripButtons().find((button) =>
      (button.getAttribute("aria-label") ?? "").startsWith(label),
    ) ?? null;
  const overflowLabels = () =>
    Array.from(
      container.querySelectorAll<HTMLElement>("[data-overflow-menu] > button"),
    ).map((item) => item.textContent ?? "");
  const overflowTrigger = () => strip("editor.media.more");
  const linkRowButton = (label: string) =>
    toolbar().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

  async function press(target: HTMLElement) {
    const down = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      target.dispatchEvent(down);
      target.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    return down.defaultPrevented;
  }

  async function choose(menuLabel: string, rowText: string) {
    const row = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        `[role="menu"][aria-label="${menuLabel}"] button`,
      ),
    ).find((button) => button.textContent?.includes(rowText))!;
    await act(async () => {
      row.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerType: "mouse",
          button: 0,
        }),
      );
    });
  }

  async function resize(next: number) {
    width = next;
    await act(async () => resizeCallbacks.forEach((callback) => callback()));
  }

  it("is an always-visible named toolbar with every primary control labelled", async () => {
    await mount();

    expect(toolbar().getAttribute("aria-label")).toBe(
      "editor.toolbar.formatting",
    );
    expect(container.querySelector(".bubble-toolbar")).toBeNull();
    expect(stripLabels()).toEqual([
      STRIP_LABELS.textStyle,
      STRIP_LABELS.bold,
      STRIP_LABELS.italic,
      STRIP_LABELS.bulletList,
      STRIP_LABELS.orderedList,
      STRIP_LABELS.link,
      STRIP_LABELS.undo,
      STRIP_LABELS.redo,
      STRIP_LABELS.underline,
      STRIP_LABELS.strike,
      STRIP_LABELS.code,
      STRIP_LABELS.color,
    ]);
    expect(overflowTrigger()).toBeNull();
  });

  it("never offers comments in the widget strip", async () => {
    await mount({ onComment: vi.fn() });

    expect(strip("editor.comment")).toBeNull();
    expect(container.textContent).not.toContain("editor.comment");
  });

  it.each([
    {
      width: 360,
      visible: [
        "editor.slash.turnInto",
        "editor.bold",
        "editor.italic",
        "editor.slash.bulletedList",
        "editor.slash.numberedList",
        "editor.link",
        "editor.toolbar.undo",
        "editor.media.more",
      ],
      overflow: [
        "editor.toolbar.redo",
        "editor.underline",
        "editor.strikethrough",
        "editor.code",
        COLOR_ITEM,
      ],
    },
    {
      width: 400,
      visible: [
        "editor.slash.turnInto",
        "editor.bold",
        "editor.italic",
        "editor.slash.bulletedList",
        "editor.slash.numberedList",
        "editor.link",
        "editor.toolbar.undo",
        "editor.toolbar.redo",
        "editor.media.more",
      ],
      overflow: [
        "editor.underline",
        "editor.strikethrough",
        "editor.code",
        COLOR_ITEM,
      ],
    },
    { width: 620, visible: "all", overflow: [] },
    { width: 1040, visible: "all", overflow: [] },
  ])(
    "lays out whole 44px cells at $width px and overflows the rest",
    async ({ width: containerWidth, visible, overflow }) => {
      await mount({ containerWidth });

      if (visible === "all") {
        expect(overflowTrigger()).toBeNull();
        expect(stripLabels()).toHaveLength(12);
      } else {
        expect(stripLabels()).toEqual(visible);
      }
      expect(overflowLabels()).toEqual(overflow);
      expect(
        stripButtons().length * 44,
        "cells never exceed the strip width",
      ).toBeLessThanOrEqual(containerWidth);
    },
  );

  it("re-measures on resize without losing the toolbar", async () => {
    await mount({ containerWidth: 360 });
    expect(overflowTrigger()).not.toBeNull();

    await resize(620);
    expect(overflowTrigger()).toBeNull();
    expect(strip("editor.toolbar.redo")).not.toBeNull();

    await resize(360);
    expect(overflowTrigger()).not.toBeNull();
    expect(strip("editor.toolbar.redo")).toBeNull();
  });

  it("keeps the narrowest layout until the strip has a measurable width", async () => {
    await mount({ containerWidth: 0 });

    expect(stripButtons()).toHaveLength(8);
    expect(overflowTrigger()).not.toBeNull();
  });

  it("offers a registered task list last and overflows it first", async () => {
    await mount({
      containerWidth: 620,
      extensions: [StarterKit, TaskList, TaskItem],
    });
    expect(strip("editor.slash.todoList")).not.toBeNull();
    expect(overflowTrigger()).toBeNull();

    await resize(400);
    expect(strip("editor.slash.todoList")).toBeNull();
    expect(overflowLabels()).toContain("editor.slash.todoList");
  });

  it("gives every strip control a 44px touch target", async () => {
    await mount({ containerWidth: 360 });

    for (const button of stripButtons()) {
      expect(button.className, button.outerHTML).toContain("size-11");
    }
    expect(toolbar().className).toContain("h-12");
  });

  it("applies formatting on click without taking focus from the editor", async () => {
    await mount();

    for (const label of [
      STRIP_LABELS.bold,
      STRIP_LABELS.italic,
      STRIP_LABELS.bulletList,
    ]) {
      expect(await press(strip(label)!), label).toBe(true);
    }

    expect(editor.isActive("bold")).toBe(true);
    expect(editor.isActive("italic")).toBe(true);
    expect(editor.isActive("bulletList")).toBe(true);
    expect(strip(STRIP_LABELS.bold)!.getAttribute("aria-pressed")).toBe("true");
    expect(strip(STRIP_LABELS.italic)!.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(strip(STRIP_LABELS.bulletList)!.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(strip(STRIP_LABELS.orderedList)!.getAttribute("aria-pressed")).toBe(
      "false",
    );
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe("Format");
  });

  it("switches between bulleted and numbered lists and back to text", async () => {
    await mount();

    await press(strip(STRIP_LABELS.bulletList)!);
    expect(editor.isActive("bulletList")).toBe(true);
    await press(strip(STRIP_LABELS.orderedList)!);
    expect(editor.isActive("orderedList")).toBe(true);
    expect(editor.isActive("bulletList")).toBe(false);
    expect(strip(STRIP_LABELS.orderedList)!.getAttribute("aria-pressed")).toBe(
      "true",
    );
    await press(strip(STRIP_LABELS.orderedList)!);
    expect(editor.isActive("orderedList")).toBe(false);
    expect(editor.getText()).toContain("Format this text");
  });

  it("toggles a mark for the next typed text when only a caret is placed", async () => {
    await mount({ selection: { from: 4, to: 4 } });

    await press(strip(STRIP_LABELS.bold)!);
    expect(strip(STRIP_LABELS.bold)!.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      editor.commands.insertContent("X");
    });

    const text = editor.getJSON().content![0]!.content as Array<{
      text?: string;
      marks?: unknown;
    }>;
    expect(text.find((node) => node.text === "X")?.marks).toEqual([
      { type: "bold" },
    ]);
  });

  it("applies a text style to the caret's block, not a range remembered earlier", async () => {
    await mount();
    await act(async () => {
      editor.commands.setTextSelection({ from: 1, to: 7 });
    });
    await act(async () => {
      editor.commands.setTextSelection(22);
    });

    await choose("editor.slash.turnInto", "editor.heading2");

    const [first, second] = editor.getJSON().content!;
    expect(first!.type).toBe("paragraph");
    expect(second!.type).toBe("heading");
    expect(second!.attrs).toMatchObject({ level: 2 });
    expect(strip("editor.slash.turnInto")!.getAttribute("aria-label")).toBe(
      "editor.slash.turnInto: editor.heading2",
    );
  });

  it("reflects the heading at the caret in the text style trigger", async () => {
    await mount({
      content: "<h3>Heading here</h3><p>Body</p>",
      selection: { from: 3, to: 3 },
    });

    expect(strip("editor.slash.turnInto")!.getAttribute("aria-label")).toBe(
      "editor.slash.turnInto: editor.heading3",
    );
    expect(strip("editor.slash.turnInto")!.textContent).toContain("H3");
  });

  it("runs undo and redo through the supplied history handlers and mirrors availability", async () => {
    const { onUndo, onRedo } = await mount();

    expect(strip(STRIP_LABELS.undo)!.disabled).toBe(true);
    expect(strip(STRIP_LABELS.redo)!.disabled).toBe(true);
    expect(strip(STRIP_LABELS.undo)!.getAttribute("aria-pressed")).toBeNull();

    await press(strip(STRIP_LABELS.bold)!);
    expect(strip(STRIP_LABELS.undo)!.disabled).toBe(false);

    await press(strip(STRIP_LABELS.undo)!);
    expect(onUndo).toHaveBeenCalledTimes(1);
    await act(async () => {
      editor.commands.undo();
    });
    expect(strip(STRIP_LABELS.redo)!.disabled).toBe(false);
    await press(strip(STRIP_LABELS.redo)!);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it("only offers marks that need a range when text is selected", async () => {
    await mount({ selection: { from: 4, to: 4 } });

    expect(strip(STRIP_LABELS.underline)!.disabled).toBe(true);
    expect(strip(STRIP_LABELS.color)!.disabled).toBe(true);
    expect(strip(STRIP_LABELS.link)!.disabled).toBe(true);

    await act(async () => {
      editor.commands.setTextSelection({ from: 1, to: 7 });
    });
    expect(strip(STRIP_LABELS.underline)!.disabled).toBe(false);
    expect(strip(STRIP_LABELS.link)!.disabled).toBe(false);
  });

  it("sets a link on the selection from the docked link field", async () => {
    await mount();

    await press(strip(STRIP_LABELS.link)!);
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="editor.pasteLink"]',
    )!;
    expect(input).not.toBeNull();
    expect(input.className).toContain("h-11");
    expect(input.className).toContain("text-base");
    expect(linkRowButton("comments.cancel")).not.toBeNull();

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "https://example.com");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(editor.getHTML()).toContain('href="https://example.com"');
    expect(
      container.querySelector('input[aria-label="editor.pasteLink"]'),
    ).toBe(null);
    expect(strip(STRIP_LABELS.link)!.getAttribute("aria-pressed")).toBe("true");
  });

  it("leaves the link field without changing the page when cancelled", async () => {
    await mount();
    const before = editor.getHTML();

    await press(strip(STRIP_LABELS.link)!);
    await press(linkRowButton("comments.cancel")!);

    expect(
      container.querySelector('input[aria-label="editor.pasteLink"]'),
    ).toBe(null);
    expect(editor.getHTML()).toBe(before);
  });

  it("edits and removes the link under a caret", async () => {
    await mount({
      content: '<p>Go <a href="https://old.test">there</a> now</p>',
      selection: { from: 6, to: 6 },
    });

    expect(strip(STRIP_LABELS.link)!.disabled).toBe(false);
    await press(strip(STRIP_LABELS.link)!);
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="editor.pasteLink"]',
    )!;
    expect(input.value).toBe("https://old.test");

    await press(linkRowButton("editor.removeLink")!);
    expect(editor.getHTML()).not.toContain("<a");
    expect(editor.getText()).toContain("Go there now");
  });

  it("runs an overflowed action after the menu releases focus", async () => {
    const { onRedo } = await mount({ containerWidth: 360 });
    await press(strip(STRIP_LABELS.bold)!);
    await act(async () => {
      editor.commands.undo();
    });
    const item = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        "[data-overflow-menu] > button",
      ),
    ).find((candidate) => candidate.textContent === "editor.toolbar.redo")!;

    await act(async () => {
      item.click();
    });
    expect(onRedo).toHaveBeenCalledTimes(1);

    const code = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        "[data-overflow-menu] > button",
      ),
    ).find((candidate) => candidate.textContent === "editor.code")!;
    await act(async () => {
      code.click();
    });
    expect(editor.isActive("code")).toBe(true);
    const activeCode = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        "[data-overflow-menu] > button",
      ),
    ).find((candidate) => candidate.textContent === "editor.code")!;
    expect(activeCode.getAttribute("aria-checked")).toBe("true");
  });

  it("places text color in the overflow menu with the shared color grid", async () => {
    await mount({ containerWidth: 360 });

    const colors = container.querySelector("[data-overflow-color]")!;
    expect(colors).not.toBeNull();
    expect(
      colors.querySelector(
        'button[aria-label="editor.textColor: editor.color.red"]',
      ),
    ).not.toBeNull();
  });
});
