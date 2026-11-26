// @vitest-environment happy-dom

import { Editor as CoreEditor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BubbleToolbar } from "./BubbleToolbar.js";

describe("BubbleToolbar link editor keys", () => {
  let container: HTMLDivElement;
  let editorHost: HTMLDivElement;
  let toolbarHost: HTMLDivElement;
  let root: Root;
  let editor: CoreEditor;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    editorHost = document.createElement("div");
    toolbarHost = document.createElement("div");
    container.append(editorHost, toolbarHost);
    document.body.append(container);
    editor = new CoreEditor({
      element: editorHost,
      extensions: [StarterKit],
      content: "<p>Selected summary text</p>",
      editable: true,
    });
    root = createRoot(toolbarHost);
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue({
      x: 20,
      y: 30,
      top: 30,
      left: 20,
      right: 120,
      bottom: 50,
      width: 100,
      height: 20,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    editor.destroy();
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function defined<T>(value: T | null | undefined): T {
    expect(value).toBeDefined();
    expect(value).not.toBeNull();
    return value as T;
  }

  function openLinkEditor() {
    act(() => {
      root.render(<BubbleToolbar editor={editor as never} />);
    });
    act(() => {
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, 9),
        ),
      );
      editor.view.focus();
    });
    act(() => {
      defined(
        toolbarHost.querySelector<HTMLButtonElement>('button[title="Link"]'),
      ).click();
    });
  }

  function input(label: "Text" | "URL") {
    return toolbarHost.querySelector<HTMLInputElement>(
      `input[aria-label="${label}"]`,
    );
  }

  async function type(field: HTMLInputElement, value: string) {
    await act(async () => {
      defined(
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
          ?.set,
      ).call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function press(
    field: HTMLInputElement,
    key: string,
    init: KeyboardEventInit = {},
  ) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    await act(async () => {
      field.dispatchEvent(event);
    });
    return event;
  }

  it.each(["URL", "Text"] as const)(
    "applies the link on Enter in the %s input and keeps the key out of the editor",
    async (label) => {
      openLinkEditor();
      await type(defined(input("URL")), "https://example.com/");

      const enter = await press(defined(input(label)), "Enter");

      expect(enter.defaultPrevented).toBe(true);
      expect(input("URL")).toBeNull();
      expect(editor.state.doc.textContent).toBe("Selected summary text");
      expect(editor.getHTML()).toContain(
        'href="https://example.com/">Selected</a> summary text</p>',
      );
    },
  );

  it("closes on Escape without touching the text or letting the key through", async () => {
    openLinkEditor();
    await type(defined(input("URL")), "https://example.com/");

    const escape = await press(defined(input("URL")), "Escape");

    expect(escape.defaultPrevented).toBe(true);
    expect(input("URL")).toBeNull();
    expect(editor.getHTML()).toBe("<p>Selected summary text</p>");
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    "leaves an Enter that confirms an IME composition to the input (%o)",
    async (init) => {
      openLinkEditor();
      await type(defined(input("URL")), "https://example.com/");

      const enter = await press(defined(input("URL")), "Enter", init);

      expect(enter.defaultPrevented).toBe(false);
      expect(input("URL")).not.toBeNull();
      expect(editor.getHTML()).toBe("<p>Selected summary text</p>");
    },
  );
});
