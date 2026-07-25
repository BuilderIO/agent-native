// @vitest-environment happy-dom

import Link from "@tiptap/extension-link";
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
  }: {
    children: ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
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
      extensions: [StarterKit, Link],
      content: "<p>Builder link</p>",
    });
    editor.commands.setTextSelection({ from: 1, to: 8 });

    root = createRoot(toolbarElement);
    act(() => root!.render(<BubbleToolbar editor={editor!} />));
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
  });
});
