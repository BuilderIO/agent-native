// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SLASH_COMMANDS,
  filterSlashCommandItems,
  focusEditorInInsertedBlock,
} from "./SlashCommandMenu.js";

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
