// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSharedEditorExtensions } from "./extensions.js";
import { FocusWithoutScroll } from "./FocusWithoutScroll.js";

const MAC_CHROME_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36";

function mountEditor(
  content: string,
  extensions = createSharedEditorExtensions(),
) {
  const element = document.createElement("div");
  document.body.append(element);
  return new Editor({ element, extensions, content });
}

describe("FocusWithoutScroll", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, "ontouchend");
    document.body.replaceChildren();
  });

  it("focuses the editor root without scrolling it into view", () => {
    const editor = mountEditor("<p>Hello</p>", [
      StarterKit,
      FocusWithoutScroll,
    ]);
    const focus = vi.spyOn(HTMLElement.prototype, "focus");

    editor.view.dom.focus();

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    editor.destroy();
  });

  it("is part of every editor built from the shared extensions", () => {
    const editor = mountEditor("<p>Hello</p>");
    const focus = vi.spyOn(HTMLElement.prototype, "focus");

    editor.view.dom.focus();

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    editor.destroy();
  });

  it.each([
    {
      device: "an iPhone",
      emulate: () => {
        vi.spyOn(navigator, "platform", "get").mockReturnValue("iPhone");
      },
    },
    {
      device:
        "a Mac whose Chrome reports touch, which TipTap takes for an iPad",
      emulate: () => {
        vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
          MAC_CHROME_USER_AGENT,
        );
        Object.defineProperty(document, "ontouchend", {
          configurable: true,
          value: null,
        });
      },
    },
  ])(
    "keeps the page still when a check mark is ticked on $device",
    ({ emulate }) => {
      emulate();
      const editor = mountEditor(
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Buy milk</p></li></ul><p>Then cook</p>',
        [StarterKit, TaskList, TaskItem, FocusWithoutScroll],
      );
      const focus = vi.spyOn(HTMLElement.prototype, "focus");
      const checkbox = editor.view.dom.querySelector<HTMLInputElement>(
        'input[type="checkbox"]',
      );
      if (!checkbox) throw new Error("expected a check mark checkbox");

      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));

      expect(focus).toHaveBeenCalled();
      for (const [options] of focus.mock.calls) {
        expect(options).toMatchObject({ preventScroll: true });
      }
      expect(editor.state.doc.firstChild?.firstChild?.attrs.checked).toBe(true);
      editor.destroy();
    },
  );

  it("gives the editor root its own focus back when the editor is destroyed", () => {
    const editor = mountEditor("<p>Hello</p>", [
      StarterKit,
      FocusWithoutScroll,
    ]);
    const dom = editor.view.dom;
    expect(Object.getOwnPropertyDescriptor(dom, "focus")).toBeDefined();

    editor.destroy();

    expect(Object.getOwnPropertyDescriptor(dom, "focus")).toBeUndefined();
  });
});
