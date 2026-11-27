// @vitest-environment happy-dom

import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { LinkHoverPreview } from "./LinkHoverPreview";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

describe("LinkHoverPreview", () => {
  let editor: Editor | null = null;
  let root: Root | null = null;
  let editorElement: HTMLDivElement | null = null;
  let previewElement: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    editorElement = document.createElement("div");
    previewElement = document.createElement("div");
    document.body.append(editorElement, previewElement);
    editor = new Editor({
      element: editorElement,
      extensions: [
        StarterKit.configure({
          link: { HTMLAttributes: { class: "content-link" } },
        }),
      ],
      content:
        '<p>Read <a href="https://example.com/research">a research page</a> today</p>',
    });
    root = createRoot(previewElement);
    act(() =>
      root!.render(
        <TooltipProvider delayDuration={0}>
          <LinkHoverPreview editor={editor!} />
        </TooltipProvider>,
      ),
    );
  });

  afterEach(() => {
    act(() => root?.unmount());
    editor?.destroy();
    editorElement?.remove();
    previewElement?.remove();
    editor = null;
    root = null;
    editorElement = null;
    previewElement = null;
    vi.useRealTimers();
  });

  const link = () =>
    editorElement!.querySelector<HTMLAnchorElement>("a.content-link")!;
  const card = () =>
    document.querySelector("[data-radix-popper-content-wrapper]");

  function hover(target: Element) {
    act(() => {
      target.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
  }

  it("places the card through the shared popover, anchored to the hovered link", () => {
    hover(link());

    expect(card()?.textContent).toContain("example.com");
  });

  it("keeps a card closed with Escape shut until the pointer leaves its link", () => {
    hover(link());
    expect(card()).not.toBeNull();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(card()).toBeNull();

    hover(link());
    expect(card()).toBeNull();

    hover(editorElement!.querySelector("p")!);
    hover(link());
    expect(card()?.textContent).toContain("example.com");
  });
});
