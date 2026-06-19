// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  parseSlashCommandQuery,
  parseInlineGeneratePrompt,
  setPlainTextBlock,
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

describe("slash command menu trigger", () => {
  it("opens for slash commands at the start of a block", () => {
    expect(parseSlashCommandQuery("/")).toBe("");
    expect(parseSlashCommandQuery("/heading")).toBe("heading");
    expect(parseSlashCommandQuery("  /table")).toBe("table");
  });

  it("does not open for slashes embedded in normal prose", () => {
    expect(parseSlashCommandQuery("hello/world")).toBeNull();
    expect(parseSlashCommandQuery("hello /world")).toBeNull();
    expect(parseSlashCommandQuery("open https://example.com/path")).toBeNull();
  });
});

describe("plain text slash command", () => {
  it("uses the paragraph command when the editor registers it", () => {
    const chain: any = {
      focus: vi.fn(() => chain),
      setParagraph: vi.fn(() => chain),
      setNode: vi.fn(() => chain),
      run: vi.fn(() => true),
    };

    expect(setPlainTextBlock({ chain: () => chain } as any)).toBe(true);
    expect(chain.setParagraph).toHaveBeenCalled();
    expect(chain.setNode).not.toHaveBeenCalled();
  });

  it("falls back to the paragraph node when setParagraph is unavailable", () => {
    const chain: any = {
      focus: vi.fn(() => chain),
      setNode: vi.fn(() => chain),
      run: vi.fn(() => true),
    };

    expect(setPlainTextBlock({ chain: () => chain } as any)).toBe(true);
    expect(chain.setNode).toHaveBeenCalledWith("paragraph");
  });
});
