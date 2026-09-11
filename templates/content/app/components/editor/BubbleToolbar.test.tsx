// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import { docToNfm, nfmToDoc } from "@shared/nfm";
import { BubbleMenuView } from "@tiptap/extension-bubble-menu";
import type { Transaction } from "@tiptap/pm/state";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BubbleToolbar,
  getSelectionNotionSpanAttribute,
  selectionHasColorableText,
  setSelectionNotionSpanAttribute,
  shouldShowBubbleToolbar,
} from "./BubbleToolbar";
import { LOCAL_FILE_USER_EDIT_META } from "./extensions/LocalMdxComponentNode";
import {
  CompatibleCode,
  NotionInlineAtom,
  NotionSpanMark,
} from "./extensions/NotionExtensions";
import {
  isUserInitiatedCollaborativeEditorUpdate,
  shouldPersistCollaborativeEditorUpdate,
} from "./VisualEditor";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

const menuHarness = vi.hoisted(() => ({ real: false }));

vi.mock("@tiptap/react/menus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react/menus")>();
  return {
    ...actual,
    BubbleMenu: (props: React.ComponentProps<typeof actual.BubbleMenu>) =>
      menuHarness.real ? (
        <actual.BubbleMenu {...props} />
      ) : (
        <div className={props.className} data-update-delay={props.updateDelay}>
          {props.children}
        </div>
      ),
  };
});

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipContent: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => children,
  PopoverTrigger: ({ children }: { children: ReactNode }) => children,
  PopoverContent: ({
    children,
    onCloseAutoFocus,
    onEscapeKeyDown,
  }: {
    children: ReactNode;
    onCloseAutoFocus?: (event: Event) => void;
    onEscapeKeyDown?: (event: KeyboardEvent) => void;
  }) => (
    <div>
      <button
        data-escape-key-down
        onClick={() => {
          onEscapeKeyDown?.(new KeyboardEvent("keydown", { key: "Escape" }));
        }}
      />
      <button
        data-close-auto-focus
        onClick={(clickEvent) => {
          const closeEvent = new Event("closeAutoFocus", {
            cancelable: true,
          });
          onCloseAutoFocus?.(closeEvent);
          clickEvent.currentTarget.dataset.prevented = String(
            closeEvent.defaultPrevented,
          );
        }}
      />
      {children}
    </div>
  ),
}));

describe("BubbleToolbar", () => {
  let editor: Editor | null = null;
  let root: Root | null = null;
  let editorElement: HTMLDivElement | null = null;
  let toolbarElement: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    editor?.destroy();
    editorElement?.remove();
    toolbarElement?.remove();
    editor = null;
    root = null;
    editorElement = null;
    toolbarElement = null;
  });
  it("delivers coalesced resize positioning to the real BubbleMenu without changing content or selection and cleans up", () => {
    menuHarness.real = true;
    const positionUpdates = vi
      .spyOn(BubbleMenuView.prototype, "updatePosition")
      .mockImplementation(() => {});
    const callbacks: ResizeObserverCallback[] = [];
    const disconnect = vi.fn();
    const observe = vi.fn();
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback);
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    const cancel = vi.fn((id: number) => frames.delete(id));
    vi.stubGlobal("cancelAnimationFrame", cancel);
    try {
      editorElement = document.createElement("div");
      toolbarElement = document.createElement("div");
      document.body.append(editorElement, toolbarElement);
      editor = new Editor({
        element: editorElement,
        extensions: [StarterKit],
        content: "<p>Italic sample.</p>",
      });
      editor.commands.setTextSelection({ from: 1, to: 7 });
      const content = editor.getJSON();
      const selection = editor.state.selection.toJSON();
      root = createRoot(toolbarElement);
      act(() => root!.render(<BubbleToolbar editor={editor!} />));
      positionUpdates.mockClear();
      const transactions: Transaction[] = [];
      editor.on("transaction", ({ transaction }) =>
        transactions.push(transaction),
      );
      expect(observe).toHaveBeenCalledWith(editor.view.dom);
      const resize = (width: number) =>
        callbacks[0]!(
          [
            {
              target: editor!.view.dom,
              contentRect: new DOMRectReadOnly(0, 0, width, 320),
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            },
          ],
          {} as ResizeObserver,
        );
      act(() => {
        resize(760);
        resize(600);
        resize(600);
      });
      expect(frames.size).toBe(1);
      const flush = () => {
        const pending = [...frames.values()];
        frames.clear();
        act(() => pending.forEach((callback) => callback(0)));
      };
      flush();
      expect(positionUpdates).toHaveBeenCalledTimes(1);
      expect(transactions).toHaveLength(1);
      expect(transactions[0]!.docChanged).toBe(false);
      expect(transactions[0]!.selectionSet).toBe(false);
      expect(editor.getJSON()).toEqual(content);
      expect(editor.state.selection.toJSON()).toEqual(selection);
      act(() => resize(600));
      expect(frames.size).toBe(0);
      act(() => resize(590));
      expect(frames.size).toBe(1);
      act(() => root!.unmount());
      root = null;
      expect(disconnect).toHaveBeenCalledOnce();
      expect(cancel).toHaveBeenCalledOnce();
      flush();
      expect(frames.size).toBe(0);
      resize(580);
      expect(frames.size).toBe(0);
      expect(positionUpdates).toHaveBeenCalledTimes(1);
    } finally {
      menuHarness.real = false;
      positionUpdates.mockRestore();
      vi.unstubAllGlobals();
    }
  });
  it("layers the toolbar above the block grip and preserves a second-paragraph SVG click selection", () => {
    const css = readFileSync("app/global.css", "utf8");
    const style = document.createElement("style");
    const grip = document.createElement("div");
    grip.className = "drag-handle";
    const gripPress = vi.fn();
    grip.addEventListener("mousedown", gripPress);
    const rules = ["drag-handle", "bubble-toolbar"].map((name) => {
      const rule = css.match(new RegExp(`\\.${name} \\{[^}]+\\}`))?.[0];
      expect(rule).toBeDefined();
      return rule;
    });
    style.textContent = rules.join("\n");
    document.head.append(style);
    document.body.append(grip);
    try {
      editorElement = document.createElement("div");
      toolbarElement = document.createElement("div");
      document.body.append(editorElement, toolbarElement);
      editor = new Editor({
        element: editorElement,
        extensions: [StarterKit],
        content: "<p>Bold sample.</p><p>Italic sample.</p>",
      });
      editor.commands.setTextSelection({ from: 15, to: 21 });
      editor.view.focus();
      root = createRoot(toolbarElement);
      act(() => root!.render(<BubbleToolbar editor={editor!} />));
      const toolbar =
        toolbarElement.querySelector<HTMLElement>(".bubble-toolbar")!;
      expect(Number(getComputedStyle(toolbar).zIndex)).toBeGreaterThan(
        Number(getComputedStyle(grip).zIndex),
      );
      const button = toolbar.querySelector<HTMLButtonElement>(
        'button[aria-label="editor.italic"]',
      )!;
      const icon = button.querySelector("path")!;
      const press = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        icon.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        icon.dispatchEvent(press);
        icon.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        icon.dispatchEvent(
          new MouseEvent("click", { bubbles: true, detail: 1 }),
        );
      });
      expect(press.defaultPrevented).toBe(true);
      expect(gripPress).not.toHaveBeenCalled();
      expect(editor.state.selection.from).toBe(15);
      expect(editor.state.selection.to).toBe(21);
      expect(docToNfm(editor.getJSON())).toBe("Bold sample.\n*Italic* sample.");
    } finally {
      style.remove();
      grip.remove();
    }
  });
  it("opens an existing link destination for change and explicit removal", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: '<p><a href="https://example.test/old">Echo</a> sample.</p>',
    });
    editor.commands.setTextSelection({ from: 1, to: 5 });
    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));
    act(() =>
      toolbarElement!
        .querySelector<HTMLButtonElement>('button[aria-label="editor.link"]')!
        .click(),
    );
    const input = toolbarElement.querySelector<HTMLInputElement>(
      'input[aria-label="editor.pasteLink"]',
    )!;
    expect(input.value).toBe("https://example.test/old");
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "https://example.test/new");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() =>
      [...toolbarElement!.querySelectorAll("button")]
        .find((button) => button.textContent === "editor.apply")!
        .click(),
    );
    expect(editor.getAttributes("link").href).toBe("https://example.test/new");
    act(() =>
      toolbarElement!
        .querySelector<HTMLButtonElement>('button[aria-label="editor.link"]')!
        .click(),
    );
    act(() =>
      [...toolbarElement!.querySelectorAll("button")]
        .find((button) => button.textContent === "editor.removeLink")!
        .click(),
    );
    expect(editor.isActive("link")).toBe(false);
    expect(editor.state.doc.textContent).toBe("Echo sample.");
  });
  it("adds and removes underline through its visible control before and after NFM reload", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit, NotionSpanMark],
      content: "<p>Echo sample.</p><p>Other paragraph.</p>",
    });
    editor.commands.setTextSelection({ from: 1, to: 5 });
    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));
    const button = toolbarElement.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.underline"]',
    );
    expect(button).not.toBeNull();
    act(() => button!.click());
    const marked = docToNfm(editor.state.doc.toJSON());
    expect(marked).toBe(
      '<span underline="true">Echo</span> sample.\nOther paragraph.',
    );
    act(() => {
      editor!.commands.setContent(nfmToDoc(marked));
      editor!.commands.setTextSelection({ from: 1, to: 5 });
    });
    act(() => button!.click());
    expect(docToNfm(editor.state.doc.toJSON())).toBe(
      "Echo sample.\nOther paragraph.",
    );
    act(() => editor!.commands.setUnderline());
    act(() => button!.click());
    expect(docToNfm(editor.state.doc.toJSON())).toBe(
      "Echo sample.\nOther paragraph.",
    );
  });

  it("starts a comment from selected text on Mod+Shift+M", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: "<p>Comment on this text</p>",
    });
    editor.commands.setTextSelection({ from: 1, to: 8 });
    const onComment = vi.fn();

    root = createRoot(toolbarElement);
    act(() =>
      root!.render(<BubbleToolbar editor={editor!} onComment={onComment} />),
    );
    act(() => {
      editor!.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "m",
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onComment).toHaveBeenCalledOnce();
    expect(onComment.mock.calls[0]?.[0]).toBe("Comment");
    expect(onComment.mock.calls[0]?.[3]).toEqual({ from: 1, to: 8 });
  });

  it("opens the link input for selected editor text on Mod+K", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: "<p>Builder link</p>",
    });
    editor.commands.setTextSelection({ from: 1, to: 8 });

    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));
    expect(
      toolbarElement.querySelector('.bubble-toolbar[data-update-delay="0"]'),
    ).not.toBeNull();
    expect(
      toolbarElement.querySelector('button[aria-label="editor.link"]'),
    ).not.toBeNull();
    act(() => {
      editor!.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(
      toolbarElement.querySelector('input[placeholder="editor.pasteLink"]'),
    ).not.toBeNull();
    expect(
      toolbarElement.querySelector('input[aria-label="editor.pasteLink"]'),
    ).not.toBeNull();

    const menu = toolbarElement.querySelector<HTMLElement>(".bubble-toolbar");
    expect(document.activeElement).toBe(
      toolbarElement.querySelector('input[placeholder="editor.pasteLink"]'),
    );
    expect(
      shouldShowBubbleToolbar({
        editor,
        element: menu!,
        state: editor.state,
        from: editor.state.selection.from,
        to: editor.state.selection.to,
      }),
    ).toBe(true);

    const input = toolbarElement.querySelector<HTMLInputElement>(
      'input[aria-label="editor.pasteLink"]',
    )!;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "https://www.builder.io/");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const applyButton = [...toolbarElement.querySelectorAll("button")].find(
      (button) => button.textContent === "editor.apply",
    );
    act(() => applyButton!.click());

    expect(editor.getHTML()).toContain(
      '<a target="_blank" rel="noopener noreferrer nofollow" href="https://www.builder.io/">Builder</a>',
    );
  });

  it("makes an unfocused link removal persistable through exact transaction provenance", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: '<p><a href="https://example.com/second">Link</a> sample.</p>',
    });
    editor.commands.setTextSelection({ from: 1, to: 5 });
    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));

    act(() => {
      toolbarElement!
        .querySelector<HTMLButtonElement>('button[aria-label="editor.link"]')!
        .click();
    });
    const input = toolbarElement.querySelector<HTMLInputElement>(
      'input[aria-label="editor.pasteLink"]',
    )!;
    expect(document.activeElement).toBe(input);

    let persistenceAllowed = false;
    editor.on("update", ({ editor: updatedEditor, transaction }) => {
      const editorFocused = updatedEditor.isFocused;
      const userInitiated = isUserInitiatedCollaborativeEditorUpdate({
        editorFocused,
        explicitUserEdit:
          transaction.getMeta(LOCAL_FILE_USER_EDIT_META) === true,
        recentUserEditIntent: false,
        transactionUiEvent: transaction.getMeta("uiEvent"),
      });
      persistenceAllowed = shouldPersistCollaborativeEditorUpdate({
        collab: true,
        editorFocused,
        userInitiated,
      });
    });
    const removeButton = [...toolbarElement.querySelectorAll("button")].find(
      (button) => button.textContent === "editor.removeLink",
    )!;
    act(() => removeButton.click());

    expect(editor.getHTML()).not.toContain("href=");
    expect(persistenceAllowed).toBe(true);
  });

  it("opens the link input on pointer-down before the menu can reconcile", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: "<p>Builder link</p>",
    });
    editor.commands.setTextSelection({ from: 1, to: 8 });

    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));
    const linkButton = toolbarElement.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.link"]',
    )!;
    act(() => {
      linkButton.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(
      toolbarElement.querySelector('input[aria-label="editor.pasteLink"]'),
    ).not.toBeNull();
  });

  it("shows the active text style and converts a heading to Text by keyboard", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: "<h2>Selected heading</h2>",
    });
    editor.commands.setTextSelection({ from: 1, to: 9 });

    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));

    const trigger = toolbarElement.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.slash.turnInto: editor.heading2"]',
    );
    expect(trigger?.textContent).toContain("H2");

    const textOption = [
      ...toolbarElement.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitemradio"]',
      ),
    ].find((button) => button.textContent?.includes("editor.slash.text"));
    act(() => {
      textOption!.dispatchEvent(
        new MouseEvent("click", {
          detail: 0,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(editor.getHTML()).toContain("<p>Selected heading</p>");
    expect(editor.getHTML()).not.toContain("<h2>Selected heading</h2>");
  });

  it("converts every block in a mixed paragraph and heading selection to Text", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: "<p>First block</p><h2>Second block</h2>",
    });
    editor.commands.setTextSelection({
      from: 1,
      to: editor.state.doc.content.size - 2,
    });
    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));

    const textOption = [
      ...toolbarElement.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitemradio"]',
      ),
    ].find((button) => button.textContent?.includes("editor.slash.text"));
    act(() => textOption!.click());

    expect(editor.getHTML()).toContain("<p>First block</p><p>Second block</p>");
    expect(editor.getHTML()).not.toContain("<h2>");
  });

  it("allows close autofocus to restore focus when no style was applied", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: "<p>Selected paragraph</p>",
    });
    editor.commands.setTextSelection({ from: 1, to: 9 });

    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));

    const closeAutoFocus = toolbarElement.querySelector<HTMLButtonElement>(
      "button[data-close-auto-focus]",
    )!;
    act(() => closeAutoFocus.click());

    expect(closeAutoFocus.dataset.prevented).toBe("false");
  });

  it("returns focus to the editor when Escape closes the text-style menu", async () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: "<p>Selected paragraph</p>",
    });
    editor.commands.setTextSelection({ from: 1, to: 9 });

    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));
    const trigger = toolbarElement.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.slash.turnInto: editor.slash.text"]',
    )!;
    trigger.focus();

    const escapeKeyDown = toolbarElement.querySelector<HTMLButtonElement>(
      "button[data-escape-key-down]",
    )!;
    const closeAutoFocus = toolbarElement.querySelector<HTMLButtonElement>(
      "button[data-close-auto-focus]",
    )!;
    await act(async () => {
      escapeKeyDown.click();
      closeAutoFocus.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(closeAutoFocus.dataset.prevented).toBe("true");
    expect(editor.isFocused).toBe(true);
    expect(document.activeElement).toBe(editor.view.dom);
  });

  it.each([5, 6] as const)(
    "identifies an H%s block and converts it to Text",
    (level) => {
      editorElement = document.createElement("div");
      toolbarElement = document.createElement("div");
      document.body.append(editorElement, toolbarElement);
      editor = new Editor({
        element: editorElement,
        extensions: [StarterKit],
        content: `<h${level}>Selected heading</h${level}>`,
      });
      editor.commands.setTextSelection({ from: 1, to: 9 });

      root = createRoot(toolbarElement);
      act(() => root!.render(<BubbleToolbar editor={editor!} />));

      const trigger = toolbarElement.querySelector<HTMLButtonElement>(
        `button[aria-label="editor.slash.turnInto: editor.heading${level}"]`,
      );
      expect(trigger?.textContent).toContain(`H${level}`);

      const textOption = [
        ...toolbarElement.querySelectorAll<HTMLButtonElement>(
          'button[role="menuitemradio"]',
        ),
      ].find((button) => button.textContent?.includes("editor.slash.text"));
      act(() => textOption!.click());

      expect(editor.getHTML()).toContain("<p>Selected heading</p>");
      expect(editor.getHTML()).not.toContain(
        `<h${level}>Selected heading</h${level}>`,
      );
    },
  );

  it("updates the selector when the active block becomes an H5", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: "<p>Selected heading</p>",
    });
    editor.commands.setTextSelection({ from: 1, to: 9 });

    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));
    void act(() => editor!.commands.setHeading({ level: 5 }));

    const trigger = toolbarElement.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.slash.turnInto: editor.heading5"]',
    );
    expect(trigger?.textContent).toContain("H5");
  });

  it("sets an exact heading level without toggling the current style off", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: "<h3>Stable heading</h3>",
    });
    editor.commands.setTextSelection({ from: 1, to: 7 });

    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));

    const headingOption = [
      ...toolbarElement.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitemradio"]',
      ),
    ].find((button) => button.textContent?.includes("editor.heading3"));
    expect(headingOption?.getAttribute("aria-checked")).toBe("true");
    act(() => headingOption!.click());

    expect(editor.getHTML()).toContain("<h3>Stable heading</h3>");
    expect(editor.getHTML()).not.toContain("<p>Stable heading</p>");
    const closeAutoFocus = toolbarElement.querySelector<HTMLButtonElement>(
      "button[data-close-auto-focus]",
    )!;
    act(() => closeAutoFocus.click());
    expect(closeAutoFocus.dataset.prevented).toBe("true");
  });

  it("sets a heading from a pointer click", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: "<p>Selected paragraph</p>",
    });
    editor.commands.setTextSelection({ from: 1, to: 9 });

    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));

    const headingOption = [
      ...toolbarElement.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitemradio"]',
      ),
    ].find((button) => button.textContent?.includes("editor.heading3"));
    editor.commands.blur();
    act(() => {
      headingOption!.dispatchEvent(
        new PointerEvent("pointerdown", {
          button: 0,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(editor.getHTML()).toContain("<h3>Selected paragraph</h3>");
    expect(editor.getHTML()).not.toContain("<p>Selected paragraph</p>");
  });

  it("applies foreground and background colors without losing other marks", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit, NotionSpanMark],
      content:
        '<p><a href="https://www.builder.io/"><strong><span underline="true">Palette</span></strong></a> text</p>',
    });
    editor.commands.setTextSelection({ from: 1, to: 8 });
    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));

    const textRed = toolbarElement.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.textColor: editor.color.red"]',
    )!;
    const backgroundYellow = toolbarElement.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.backgroundColor: editor.color.yellow"]',
    )!;
    act(() => textRed.click());
    act(() => backgroundYellow.click());

    const selected = editor.state.doc.nodeAt(1)!;
    expect(selected.marks.some((mark) => mark.type.name === "bold")).toBe(true);
    expect(selected.marks.some((mark) => mark.type.name === "link")).toBe(true);
    expect(
      selected.marks.find((mark) => mark.type.name === "notionSpan")?.attrs,
    ).toMatchObject({
      color: "red",
      bgColor: "yellow_bg",
      underline: true,
    });
    expect(editor.getHTML()).toContain(
      'class="notion-block-color--red notion-block-bg--yellow"',
    );
    expect(editor.state.selection).toMatchObject({ from: 1, to: 8 });
  });

  it("defaults one color attribute without clearing the other", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit, NotionSpanMark],
      content:
        '<p><span color="red" bg_color="yellow_bg" underline="true">Palette</span></p>',
    });
    editor.commands.setTextSelection({ from: 1, to: 8 });
    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));

    const defaultBackground = toolbarElement.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.backgroundColor: editor.defaultColor"]',
    )!;
    act(() => defaultBackground.click());

    expect(
      editor.state.doc
        .nodeAt(1)!
        .marks.find((mark) => mark.type.name === "notionSpan")?.attrs,
    ).toMatchObject({ color: "red", bgColor: null, underline: true });

    const backgroundYellow = toolbarElement.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.backgroundColor: editor.color.yellow"]',
    )!;
    const defaultForeground = toolbarElement.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.textColor: editor.defaultColor"]',
    )!;
    act(() => backgroundYellow.click());
    act(() => defaultForeground.click());

    expect(
      editor.state.doc
        .nodeAt(1)!
        .marks.find((mark) => mark.type.name === "notionSpan")?.attrs,
    ).toMatchObject({ color: null, bgColor: "yellow_bg", underline: true });
  });

  it("reports a mixed color selection without claiming an active swatch", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit, NotionSpanMark],
      content:
        '<p><span color="red">Red</span><span color="blue">Blue</span></p>',
    });
    editor.commands.setTextSelection({ from: 1, to: 8 });
    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));

    expect(getSelectionNotionSpanAttribute(editor, "color")).toBe("mixed");
    expect(
      toolbarElement
        .querySelector(
          'button[aria-label="editor.textColor: editor.color.red"]',
        )
        ?.getAttribute("aria-checked"),
    ).toBe("false");
    expect(
      toolbarElement
        .querySelector(
          'button[aria-label="editor.textColor: editor.color.blue"]',
        )
        ?.getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("ignores unmarkable code-block text when resolving the active color", () => {
    editorElement = document.createElement("div");
    document.body.append(editorElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit, NotionSpanMark],
      content:
        '<p><span color="red">Red</span></p><pre><code>Code</code></pre>',
    });
    editor.commands.setTextSelection({
      from: 1,
      to: editor.state.doc.content.size,
    });

    expect(getSelectionNotionSpanAttribute(editor, "color")).toBe("red");
  });

  it("skips unmarkable code-block text when applying a color", () => {
    editorElement = document.createElement("div");
    document.body.append(editorElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit, NotionSpanMark],
      content: "<p>Text</p><pre><code>Code</code></pre>",
    });
    editor.commands.setTextSelection({
      from: 1,
      to: editor.state.doc.content.size,
    });

    expect(setSelectionNotionSpanAttribute(editor, "color", "red")).toBe(true);
    expect(editor.state.doc.nodeAt(1)?.marks[0]?.attrs.color).toBe("red");
    let codeMarkCount: number | undefined;
    editor.state.doc.descendants((node, _position, parent) => {
      if (node.isText && parent?.type.name === "codeBlock") {
        codeMarkCount = node.marks.length;
      }
    });
    expect(codeMarkCount).toBe(0);
  });

  it("composes color with inline code", () => {
    editorElement = document.createElement("div");
    document.body.append(editorElement);
    editor = new Editor({
      element: editorElement,
      extensions: [
        StarterKit.configure({ code: false }),
        CompatibleCode,
        NotionSpanMark,
      ],
      content: "<p><code>inline</code></p>",
    });
    editor.commands.setTextSelection({ from: 1, to: 7 });

    expect(selectionHasColorableText(editor.state, 1, 7)).toBe(true);
    expect(setSelectionNotionSpanAttribute(editor, "color", "red")).toBe(true);
    expect(
      editor.state.doc.nodeAt(1)?.marks.map((mark) => mark.type.name),
    ).toEqual(["notionSpan", "code"]);
  });

  it("hides the color control when a selection contains no text", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit, NotionSpanMark, NotionInlineAtom],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "notionInlineAtom",
                attrs: { tagName: "math", attrsJson: "{}", label: "x" },
              },
            ],
          },
        ],
      },
    });
    editor.commands.setTextSelection({ from: 1, to: 2 });
    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));

    expect(selectionHasColorableText(editor.state, 1, 2)).toBe(false);
    expect(
      toolbarElement.querySelector('button[aria-label="editor.color.label"]'),
    ).toBeNull();
  });

  it("hides the color control for text in a code block", () => {
    editorElement = document.createElement("div");
    toolbarElement = document.createElement("div");
    document.body.append(editorElement, toolbarElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit, NotionSpanMark],
      content: "<pre><code>const answer = 42;</code></pre>",
    });
    editor.commands.setTextSelection({ from: 1, to: 19 });
    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));

    expect(selectionHasColorableText(editor.state, 1, 19)).toBe(false);
    expect(
      toolbarElement.querySelector('button[aria-label="editor.color.label"]'),
    ).toBeNull();
  });
});
