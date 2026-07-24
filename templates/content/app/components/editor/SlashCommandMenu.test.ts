// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import {
  buildHeadingCommands,
  CommandButton,
  CONTENT_HEADING_LEVELS,
  equationNodeContent,
  getEquationInsertionRange,
  inlineDatabaseBlockContent,
  insertEquation,
  insertInlineDatabaseBlock,
  parseSlashCommandQuery,
  parseInlineGeneratePrompt,
  setPlainTextBlock,
} from "./SlashCommandMenu";

function TestIcon() {
  return createElement("svg");
}

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

describe("generate command affordances", () => {
  it("uses slash commands and the shared composer instead of a space shortcut", () => {
    const source = readSlashCommandMenuSource();

    expect(source).toContain("import { PromptComposer }");
    expect(source).toMatch(
      /<PromptComposer[\s\S]*onSubmit={submitGeneratePrompt}/,
    );
    expect(source).toContain("icon: IconHierarchy2");
    expect(source).not.toContain("shouldOpenGenerateOnSpace");
    expect(source).not.toContain('e.code === "Space"');
  });
});

describe("slash command menu trigger", () => {
  it("opens for slash commands at the start of a block", () => {
    expect(parseSlashCommandQuery("/")).toBe("");
    expect(parseSlashCommandQuery("/heading")).toBe("heading");
    expect(parseSlashCommandQuery("/heading 2")).toBe("heading 2");
    expect(parseSlashCommandQuery("/numbered list")).toBe("numbered list");
    expect(parseSlashCommandQuery("  /table")).toBe("table");
  });

  it("still yields multi-word generate prompts to inline submission", () => {
    expect(parseSlashCommandQuery("/generate outline this PRD")).toBeNull();
  });

  it("does not open for slashes embedded in normal prose", () => {
    expect(parseSlashCommandQuery("hello/world")).toBeNull();
    expect(parseSlashCommandQuery("hello /world")).toBeNull();
    expect(parseSlashCommandQuery("open https://example.com/path")).toBeNull();
  });
});

describe("slash command pointer activation", () => {
  function renderCommandButton(onExecute: () => void) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    act(() => {
      root.render(
        createElement(CommandButton, {
          cmd: {
            title: "Code Block",
            description: "Insert a code block",
            icon: TestIcon,
            action: vi.fn(),
          },
          isSelected: true,
          onExecute,
          onHover: vi.fn(),
        }),
      );
    });
    return {
      button: container.querySelector("button"),
      cleanup: () => {
        act(() => root.unmount());
        container.remove();
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      },
    };
  }

  it("preserves selection and deduplicates deferred pointer clicks", async () => {
    const onExecute = vi.fn();
    const { button, cleanup } = renderCommandButton(onExecute);

    try {
      const mouseDown = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        button?.dispatchEvent(mouseDown);
      });
      expect(mouseDown.defaultPrevented).toBe(true);

      act(() => {
        button?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        button?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      expect(onExecute).not.toHaveBeenCalled();

      await act(async () => {
        await Promise.resolve();
      });
      expect(onExecute).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it("keeps the chosen command alive when closing the menu unmounts it", async () => {
    const onExecute = vi.fn();
    const { button, cleanup } = renderCommandButton(onExecute);

    act(() => {
      button?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    cleanup();
    await act(async () => {
      await Promise.resolve();
    });
    expect(onExecute).toHaveBeenCalledTimes(1);
  });
});

describe("heading slash commands", () => {
  it("offers all six HTML heading levels for insert and turn-into flows", () => {
    expect(CONTENT_HEADING_LEVELS).toEqual([1, 2, 3, 4, 5, 6]);

    const toggleCommands = buildHeadingCommands("toggle");
    const setCommands = buildHeadingCommands("set");

    expect(toggleCommands.map((command) => command.titleKey)).toEqual([
      "editor.heading1",
      "editor.heading2",
      "editor.heading3",
      "editor.heading4",
      "editor.heading5",
      "editor.heading6",
    ]);
    expect(toggleCommands.map((command) => command.shortcut)).toEqual([
      "#",
      "##",
      "###",
      "####",
      "#####",
      "######",
    ]);
    expect(setCommands.map((command) => command.titleKey)).toEqual(
      toggleCommands.map((command) => command.titleKey),
    );
  });

  it("runs the matching heading command for levels five and six", () => {
    const chain: any = {
      focus: vi.fn(() => chain),
      toggleHeading: vi.fn(() => chain),
      setHeading: vi.fn(() => chain),
      run: vi.fn(() => true),
    };
    const editor = { chain: () => chain } as any;

    buildHeadingCommands("toggle")[4]?.action(editor, {
      slashRange: null,
    });
    buildHeadingCommands("set")[5]?.action(editor, { slashRange: null });

    expect(chain.toggleHeading).toHaveBeenCalledWith({ level: 5 });
    expect(chain.setHeading).toHaveBeenCalledWith({ level: 6 });
  });
});

describe("equation slash commands", () => {
  it("builds the canonical inline and block atom payloads", () => {
    expect(equationNodeContent("E = mc^2", false)).toEqual({
      type: "notionInlineAtom",
      attrs: { tagName: "math", attrsJson: "{}", label: "E = mc^2" },
    });
    expect(equationNodeContent("E = mc^2", true)).toEqual({
      type: "notionBlockAtom",
      attrs: { tagName: "equation", attrsJson: "{}", label: "E = mc^2" },
    });
  });

  it("replaces only the slash range for inline equations", () => {
    const chain: any = {
      focus: vi.fn(() => chain),
      insertContentAt: vi.fn(() => chain),
      run: vi.fn(() => true),
    };

    expect(
      insertEquation({ chain: () => chain } as any, "x^2", false, {
        from: 4,
        to: 11,
      }),
    ).toBe(true);
    expect(chain.insertContentAt).toHaveBeenCalledWith(
      { from: 4, to: 11 },
      equationNodeContent("x^2", false),
    );
  });

  it("replaces the paragraph and leaves a trailing paragraph for block equations", () => {
    const chain: any = {
      focus: vi.fn(() => chain),
      insertContentAt: vi.fn(() => chain),
      run: vi.fn(() => true),
    };

    expect(
      insertEquation({ chain: () => chain } as any, "x^2", true, {
        from: 0,
        to: 9,
      }),
    ).toBe(true);
    expect(chain.insertContentAt).toHaveBeenCalledWith({ from: 0, to: 9 }, [
      equationNodeContent("x^2", true),
      { type: "paragraph" },
    ]);
  });

  it("expands block insertion to the containing paragraph", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "/equation" }] },
        ],
      },
    });

    try {
      expect(
        getEquationInsertionRange(editor as any, { from: 1, to: 10 }, true),
      ).toEqual({ from: 0, to: 11 });
      expect(
        getEquationInsertionRange(editor as any, { from: 1, to: 10 }, false),
      ).toEqual({ from: 1, to: 10 });
    } finally {
      editor.destroy();
    }
  });

  it("wires two searchable equation commands to a validated preview", () => {
    const source = readSlashCommandMenuSource();

    expect(source).toContain('title: t("editor.slash.blockEquation")');
    expect(source).toContain('title: t("editor.slash.inlineEquation")');
    expect(source).toContain('searchText: "latex katex math formula"');
    expect(source).toContain("renderMathToHtml(");
    expect(source).toContain("disabled={!equationResult.ok}");
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
