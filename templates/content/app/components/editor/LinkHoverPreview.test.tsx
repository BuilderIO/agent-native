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
        '<p>Read <a href="https://example.com/research">a research page</a> today and <a href="https://other.example/notes">some notes</a></p>',
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

  it("closes on Escape without taking the key from the editor, and stays shut until the pointer leaves its link", () => {
    hover(inEditor("a.content-link"));
    expect(card()).not.toBeNull();

    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      editor?.view.dom.dispatchEvent(escape);
    });
    expect(card()).toBeNull();
    expect(escape.defaultPrevented).toBe(false);

    hover(inEditor("a.content-link"));
    expect(card()).toBeNull();

    hover(inEditor("p"));
    hover(inEditor("a.content-link"));
    expect(card()?.textContent).toContain("example.com");
  });

  it("stays on its link when the pointer comes back before another link's delay ends", () => {
    hover(inEditor('a[href="https://example.com/research"]'));
    act(() => {
      inEditor('a[href="https://other.example/notes"]').dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true }),
      );
    });
    hover(inEditor('a[href="https://example.com/research"]'));

    expect(card()?.textContent).toContain("example.com");
    expect(card()?.textContent).not.toContain("other.example");
  });

  it("unlinks the link it was opened on after the page above it changes", () => {
    hover(inEditor('a[href="https://example.com/research"]'));
    act(() => {
      editor?.commands.insertContentAt(
        0,
        '<p><a href="https://inserted.example/">an inserted link long enough to cover the old spot</a></p>',
      );
    });

    const unlink = card()
      ?.querySelector(".tabler-icon-unlink")
      ?.closest("button");
    if (!unlink) throw new Error("The card has no unlink button");
    act(() => unlink.click());

    const html = editor?.getHTML() ?? "";
    expect(html).toContain('href="https://inserted.example/"');
    expect(html).not.toContain('href="https://example.com/research"');
  });
});
