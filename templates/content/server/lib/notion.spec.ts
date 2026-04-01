import { describe, expect, it } from "vitest";
import { markdownToNotionBlocks, notionBlocksToMarkdown } from "./notion";

const INDENT = "\u00A0\u00A0";

function para(text: string, children?: any[]) {
  return {
    id: Math.random().toString(36).slice(2),
    type: "paragraph" as const,
    paragraph: { rich_text: [{ plain_text: text }] },
    ...(children ? { children } : {}),
  };
}

function bullet(text: string, children?: any[]) {
  return {
    id: Math.random().toString(36).slice(2),
    type: "bulleted_list_item" as const,
    bulleted_list_item: { rich_text: [{ plain_text: text }] },
    ...(children ? { children } : {}),
  };
}

function toggle(text: string, children?: any[]) {
  return {
    id: Math.random().toString(36).slice(2),
    type: "toggle" as const,
    toggle: { rich_text: [{ plain_text: text }] },
    ...(children ? { children } : {}),
  };
}

function code(text: string, language = "plain text") {
  return {
    id: Math.random().toString(36).slice(2),
    type: "code" as const,
    code: { language, rich_text: [{ plain_text: text }] },
  };
}

describe("notionBlocksToMarkdown", () => {
  it("preserves indented paragraph children without inventing bullets", () => {
    const { markdown } = notionBlocksToMarkdown([
      para("agent native starter project for brent", [
        para("make that port the default port"),
      ]),
    ] as any);

    expect(markdown).toBe(
      `agent native starter project for brent\n${INDENT}make that port the default port`,
    );
  });

  it("preserves multiple indented child paragraphs on separate lines", () => {
    const { markdown } = notionBlocksToMarkdown([
      para("blog sidebar and bottom a/b tests", [
        para("multiplayer claude code"),
        para("release video"),
      ]),
    ] as any);

    expect(markdown).toBe(
      `blog sidebar and bottom a/b tests\n${INDENT}multiplayer claude code\n${INDENT}release video`,
    );
  });

  it("renders toggles as explicit toggle markers rather than bullets", () => {
    const { markdown } = notionBlocksToMarkdown([
      toggle("team mtg dek", [para("generate"), bullet("follow up")]),
    ] as any);

    expect(markdown).toBe(`▶ team mtg dek\n${INDENT}generate\n  - follow up`);
  });

  it("preserves paragraph spacing between top-level blocks", () => {
    const { markdown } = notionBlocksToMarkdown([
      para("line one"),
      para("line two"),
    ] as any);

    expect(markdown).toBe("line one\n\nline two");
  });

  it("flattens plain-text code blocks that do not look like code", () => {
    const { markdown } = notionBlocksToMarkdown([
      code("teams (with permissions)\n\nalso book me links"),
    ] as any);

    expect(markdown).toBe("teams (with permissions)\n\nalso book me links");
  });

  it("keeps real code blocks fenced", () => {
    const { markdown } = notionBlocksToMarkdown([
      code("const x = 1;", "typescript"),
    ] as any);

    expect(markdown).toBe("```typescript\nconst x = 1;\n```");
  });
});

describe("markdownToNotionBlocks", () => {
  it("parses visual indented lines back into child paragraphs", () => {
    const blocks = markdownToNotionBlocks(
      `agent native starter project for brent\n${INDENT}make that port the default port`,
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[0].children).toHaveLength(1);
    expect(blocks[0].children[0].type).toBe("paragraph");
    expect(blocks[0].children[0].paragraph.rich_text[0].text.content).toBe(
      "make that port the default port",
    );
  });

  it("parses toggle marker syntax into notion toggles", () => {
    const blocks = markdownToNotionBlocks(
      `work for sajal\n${INDENT}▶ team mtg dek\n${INDENT}${INDENT}generate`,
    );

    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[0].children[0].type).toBe("toggle");
    expect(blocks[0].children[0].toggle.rich_text[0].text.content).toBe(
      "team mtg dek",
    );
    expect(
      blocks[0].children[0].children[0].paragraph.rich_text[0].text.content,
    ).toBe("generate");
  });

  it("supports legacy bullet-toggle markdown when exporting to notion", () => {
    const blocks = markdownToNotionBlocks("- ▶ click to expand");

    expect(blocks[0].type).toBe("toggle");
    expect(blocks[0].toggle.rich_text[0].text.content).toBe("click to expand");
  });

  it("keeps nested bullets as bullets", () => {
    const blocks = markdownToNotionBlocks("- parent\n  - child");

    expect(blocks[0].type).toBe("bulleted_list_item");
    expect(blocks[0].children[0].type).toBe("bulleted_list_item");
    expect(
      blocks[0].children[0].bulleted_list_item.rich_text[0].text.content,
    ).toBe("child");
  });
});
