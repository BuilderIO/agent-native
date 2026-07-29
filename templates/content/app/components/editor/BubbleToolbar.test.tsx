// @vitest-environment happy-dom

import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BubbleToolbar, shouldShowBubbleToolbar } from "./BubbleToolbar";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@tiptap/react/menus", () => ({
  BubbleMenu: ({
    children,
    className,
    updateDelay,
  }: {
    children: ReactNode;
    className?: string;
    updateDelay?: number;
  }) => (
    <div className={className} data-update-delay={updateDelay}>
      {children}
    </div>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipContent: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
}));

describe("BubbleToolbar link shortcut", () => {
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
});
