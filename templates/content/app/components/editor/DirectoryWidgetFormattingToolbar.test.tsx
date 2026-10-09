// @vitest-environment happy-dom

import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { DirectoryWidgetFormattingToolbar } from "./DirectoryWidgetFormattingToolbar";

describe("DirectoryWidgetFormattingToolbar", () => {
  let container: HTMLDivElement;
  let editorElement: HTMLDivElement;
  let editor: Editor;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    editorElement = document.createElement("div");
    document.body.append(container, editorElement);
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: "<h2>Format this text</h2>",
    });
    editor.commands.setTextSelection({ from: 1, to: 7 });
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    editor.destroy();
    container.remove();
    editorElement.remove();
    vi.unstubAllGlobals();
  });

  const button = (label: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

  const clickWithoutLosingSelection = (target: HTMLButtonElement) => {
    const down = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(down);
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return down.defaultPrevented;
  };

  it.each([320, 560, 960])(
    "keeps compact formatting controls available at %s px",
    async (width) => {
      container.style.width = `${width}px`;
      await act(async () =>
        root.render(
          createElement(DirectoryWidgetFormattingToolbar, { editor }),
        ),
      );

      const toolbar = container.querySelector<HTMLElement>(
        "[data-content-widget-format-toolbar]",
      );
      expect(toolbar?.getAttribute("role")).toBe("toolbar");
      expect(toolbar?.getAttribute("aria-label")).toBe("editor.slash.text");
      expect(toolbar?.className).toContain("overflow-x-auto");
      expect(button("editor.slash.text")?.className).toContain("shrink-0");
      expect(button("editor.bold")?.className).toContain("shrink-0");
      expect(button("editor.slash.bulletedList")?.className).toContain(
        "shrink-0",
      );
    },
  );

  it("applies paragraph, bold, and bullet formatting and tracks active state", async () => {
    await act(async () =>
      root.render(createElement(DirectoryWidgetFormattingToolbar, { editor })),
    );

    const paragraph = button("editor.slash.text")!;
    const bold = button("editor.bold")!;
    const bulletList = button("editor.slash.bulletedList")!;
    expect(paragraph.getAttribute("aria-pressed")).toBe("false");
    expect(bold.getAttribute("aria-pressed")).toBe("false");
    expect(bulletList.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      expect(clickWithoutLosingSelection(paragraph)).toBe(true);
    });
    expect(editor.isActive("paragraph")).toBe(true);
    expect(paragraph.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      expect(clickWithoutLosingSelection(bold)).toBe(true);
    });
    expect(editor.isActive("bold")).toBe(true);
    expect(bold.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      expect(clickWithoutLosingSelection(bulletList)).toBe(true);
    });
    expect(editor.isActive("bulletList")).toBe(true);
    expect(bulletList.getAttribute("aria-pressed")).toBe("true");
    expect(editor.getText()).toContain("Format this text");
  });
});
