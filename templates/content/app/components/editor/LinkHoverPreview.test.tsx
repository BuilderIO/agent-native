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
    const editorHost = document.createElement("div");
    const previewHost = document.createElement("div");
    document.body.append(editorHost, previewHost);
    const mountedEditor = new Editor({
      element: editorHost,
      extensions: [
        StarterKit.configure({
          link: { HTMLAttributes: { class: "content-link" } },
        }),
      ],
      content:
        '<p>Read <a href="https://example.com/research">a research page</a> today</p>',
    });
    const mountedRoot = createRoot(previewHost);
    act(() =>
      mountedRoot.render(
        <TooltipProvider delayDuration={0}>
          <LinkHoverPreview editor={mountedEditor} />
        </TooltipProvider>,
      ),
    );
    editor = mountedEditor;
    root = mountedRoot;
    editorElement = editorHost;
    previewElement = previewHost;
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

  function inEditor(selector: string) {
    const element = editorElement?.querySelector(selector);
    if (!element) throw new Error(`Nothing matches ${selector} in the editor`);
    return element;
  }
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
    hover(inEditor("a.content-link"));

    expect(card()?.textContent).toContain("example.com");
  });

  it("keeps a card closed with Escape shut until the pointer leaves its link", () => {
    hover(inEditor("a.content-link"));
    expect(card()).not.toBeNull();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(card()).toBeNull();

    hover(inEditor("a.content-link"));
    expect(card()).toBeNull();

    hover(inEditor("p"));
    hover(inEditor("a.content-link"));
    expect(card()?.textContent).toContain("example.com");
  });
});
