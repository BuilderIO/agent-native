// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { SlashCommandMenu } from "./SlashCommandMenu.js";
import {
  DEFAULT_SLASH_COMMANDS,
  filterSlashCommandItems,
  focusEditorInInsertedBlock,
} from "./SlashCommandMenu.js";

describe("SlashCommandMenu heading", () => {
  it.each([
    [undefined, "Blocks"],
    ["Insert block", "Insert block"],
  ])("renders heading %s", async (heading, expected) => {
    const editorElement = document.createElement("div");
    const menuElement = document.createElement("div");
    document.body.append(editorElement, menuElement);
    const editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
    });
    const root = createRoot(menuElement);
    vi.spyOn(editor.view, "coordsAtPos").mockReturnValue(
      new DOMRect(10, 10, 1, 10),
    );

    try {
      await act(async () => {
        root.render(
          createElement(SlashCommandMenu, {
            editor,
            ...(heading === undefined ? {} : { heading }),
          }),
        );
      });
      await act(async () => {
        editor.commands.insertContent("/");
      });

      expect(
        document.querySelector(".an-rich-md-slash-heading")?.textContent,
      ).toBe(expected);
    } finally {
      act(() => root.unmount());
      editor.destroy();
      editorElement.remove();
      menuElement.remove();
    }
  });
});

describe("SlashCommandMenu viewport positioning", () => {
  it("keeps the menu inside a narrow viewport when the caret is near the right edge", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    const editorElement = document.createElement("div");
    const menuElement = document.createElement("div");
    document.body.append(editorElement, menuElement);
    const editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
    });
    const root = createRoot(menuElement);
    vi.spyOn(editor.view, "coordsAtPos").mockReturnValue(
      new DOMRect(380, 10, 1, 10),
    );

    try {
      await act(async () => {
        root.render(createElement(SlashCommandMenu, { editor }));
      });
      await act(async () => {
        editor.commands.insertContent("/");
      });

      const menu = document.querySelector<HTMLElement>(
        ".an-rich-md-slash-menu",
      );
      expect(menu).not.toBeNull();
      expect(menu?.style.left).toBe("12px");
    } finally {
      act(() => root.unmount());
      editor.destroy();
      editorElement.remove();
      menuElement.remove();
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
    }
  });
});

describe("filterSlashCommandItems", () => {
  it("hides commands whose editor extensions are disabled", () => {
    const commands = filterSlashCommandItems(DEFAULT_SLASH_COMMANDS, {
      codeBlock: false,
      tables: false,
      tasks: false,
    });

    expect(commands.map((command) => command.title)).not.toEqual(
      expect.arrayContaining(["Code block", "Table", "To-do list"]),
    );
  });

  it("keeps commands enabled when their feature is unspecified", () => {
    const commands = filterSlashCommandItems(DEFAULT_SLASH_COMMANDS, {
      tasks: false,
    });

    expect(commands.map((command) => command.title)).toEqual(
      expect.arrayContaining(["Code block", "Table"]),
    );
    expect(commands.map((command) => command.title)).not.toContain(
      "To-do list",
    );
  });
});

describe("focusEditorInInsertedBlock", () => {
  it.each([
    ["Text", "paragraph", "paragraph"],
    ["Heading 1", "heading", "heading"],
    ["Bulleted list", "bulletList", "paragraph"],
    ["Numbered list", "orderedList", "paragraph"],
    ["Quote", "blockquote", "paragraph"],
    ["Code block", "codeBlock", "codeBlock"],
  ])(
    "leaves the caret inside the %s block instead of after it",
    (title, activeNode, parentNode) => {
      const element = document.createElement("div");
      document.body.appendChild(element);
      const editor = new Editor({
        element,
        extensions: [StarterKit],
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "/code" }],
            },
          ],
        },
      });

      try {
        const slashRange = { from: 1, to: 6 };
        editor.commands.setTextSelection(slashRange);
        editor.chain().focus().deleteRange(slashRange).run();
        const command = DEFAULT_SLASH_COMMANDS.find(
          (item) => item.title === title,
        );
        if (!command) throw new Error(`Missing slash command: ${title}`);
        command.action(editor);
        focusEditorInInsertedBlock(editor, slashRange.from);

        expect(editor.isActive(activeNode)).toBe(true);
        expect(editor.state.selection.$from.parent.type.name).toBe(parentNode);
        expect(editor.state.selection.from).toBeLessThanOrEqual(
          editor.state.selection.$from.end(),
        );
        expect(editor.isFocused).toBe(true);
      } finally {
        editor.destroy();
        element.remove();
      }
    },
  );
});
