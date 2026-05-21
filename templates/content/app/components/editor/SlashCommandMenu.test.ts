// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  parseInlineGeneratePrompt,
  shouldOpenGenerateOnSpace,
} from "./SlashCommandMenu";

describe("inline slash generate command parsing", () => {
  it("extracts the prompt from /generate text", () => {
    expect(parseInlineGeneratePrompt("/generate outline this PRD")).toBe(
      "outline this PRD",
    );
  });

  it("trims extra whitespace around the prompt", () => {
    expect(parseInlineGeneratePrompt("/generate   summarize this   ")).toBe(
      "summarize this",
    );
  });

  it("ignores incomplete or different slash commands", () => {
    expect(parseInlineGeneratePrompt("/generate")).toBeNull();
    expect(parseInlineGeneratePrompt("/image hero")).toBeNull();
    expect(parseInlineGeneratePrompt("prefix /generate text")).toBeNull();
  });
});

describe("space generate shortcut", () => {
  it("opens only from an empty paragraph line", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: {
        type: "doc",
        content: [{ type: "paragraph" }],
      },
    });

    try {
      editor.commands.setTextSelection(1);
      expect(shouldOpenGenerateOnSpace(editor as any)).toBe(true);

      editor.commands.insertContent("Text");
      expect(shouldOpenGenerateOnSpace(editor as any)).toBe(false);
    } finally {
      editor.destroy();
    }
  });
});
