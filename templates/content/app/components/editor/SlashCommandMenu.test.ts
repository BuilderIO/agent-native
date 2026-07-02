// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it, vi } from "vitest";

import {
  inlineDatabaseBlockContent,
  insertInlineDatabaseBlock,
  parseSlashCommandQuery,
  parseInlineGeneratePrompt,
  setPlainTextBlock,
  shouldOpenGenerateOnSpace,
} from "./SlashCommandMenu";

function readSlashCommandMenuSource() {
  return readFileSync(
    join(process.cwd(), "app/components/editor/SlashCommandMenu.tsx"),
    {
      encoding: "utf8",
    },
  );
}

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

describe("inline database slash command", () => {
  const block = {
    databaseId: "database-alpha",
    databaseDocumentId: "document-database-alpha",
    ownerBlockId: "inline-database-owner-alpha",
  };

  it("builds the inline database registry block payload", () => {
    expect(inlineDatabaseBlockContent(block)).toMatchObject({
      type: "registryBlock",
      attrs: {
        blockType: "inline-database",
        blockId: block.ownerBlockId,
        title: null,
        summary: null,
      },
    });
    expect(inlineDatabaseBlockContent(block).attrs.__raw).toContain(
      '<InlineDatabase id="inline-database-owner-alpha"',
    );
    expect(inlineDatabaseBlockContent(block).attrs.__raw).toContain(
      'databaseId="database-alpha"',
    );
  });

  it("inserts the inline database block through the editor chain", () => {
    const chain: any = {
      focus: vi.fn(() => chain),
      insertContent: vi.fn(() => chain),
      insertContentAt: vi.fn(() => chain),
      run: vi.fn(() => true),
    };

    expect(
      insertInlineDatabaseBlock({ chain: () => chain } as any, block),
    ).toBe(true);
    expect(chain.insertContent).toHaveBeenCalledWith(
      inlineDatabaseBlockContent(block),
    );
  });

  it("can replace the preserved slash command range with the inline database", () => {
    const chain: any = {
      focus: vi.fn(() => chain),
      insertContent: vi.fn(() => chain),
      insertContentAt: vi.fn(() => chain),
      run: vi.fn(() => true),
    };

    expect(
      insertInlineDatabaseBlock({ chain: () => chain } as any, block, {
        from: 7,
        to: 16,
      }),
    ).toBe(true);
    expect(chain.insertContentAt).toHaveBeenCalledWith(
      { from: 7, to: 16 },
      inlineDatabaseBlockContent(block),
    );
    expect(chain.insertContent).not.toHaveBeenCalled();
  });

  it("keeps /database wired to inline creation instead of page navigation", () => {
    const source = readSlashCommandMenuSource();

    expect(source).toContain("useCreateInlineContentDatabase");
    expect(source).toContain("hostDocumentId: documentId");
    expect(source).toContain("preserveSlashRange: true");
    expect(source).toContain("deleteRange(slashRange)");
    expect(source).toContain("insertInlineDatabaseBlock(");
    expect(source).toContain("requiredText: result.block.ownerBlockId");
    expect(source).toContain("await onDraftPersisted(content)");
    expect(source).not.toContain("useCreateContentDatabase");
    expect(source).not.toContain(
      "navigate(`/page/${result.database.documentId}`",
    );
  });
});
