// @vitest-environment happy-dom

import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { BubbleToolbar } from "./BubbleToolbar";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@tiptap/react/menus", () => ({
  BubbleMenu: ({
    className,
    children,
  }: {
    className?: string;
    children: React.ReactNode;
  }) => <div className={className}>{children}</div>,
}));

describe("BubbleToolbar tooltips", () => {
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

  it("closes the Comment tooltip when the button is pressed", () => {
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
      root!.render(
        <TooltipProvider delayDuration={0}>
          <BubbleToolbar editor={editor!} onComment={onComment} />
        </TooltipProvider>,
      ),
    );
    const commentButton = toolbarElement.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.comment"]',
    )!;
    const tooltips = () =>
      document.querySelectorAll('[data-agent-native-tooltip="true"]');

    act(() => commentButton.focus());
    expect(tooltips()).toHaveLength(1);
    expect(tooltips()[0]?.textContent).toContain("editor.comment");

    act(() => {
      commentButton.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerType: "mouse",
        }),
      );
    });

    expect(onComment).toHaveBeenCalledOnce();
    expect(tooltips()).toHaveLength(0);
  });
});
