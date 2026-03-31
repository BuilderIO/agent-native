import { describe, expect, it } from "vitest";
import { notionBlocksToMarkdown } from "./notion";

// Helper to make block creation less verbose
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
  // ── Indentation / whitespace ──

  it("converts indented paragraphs (children of paragraph) to nested bullets", () => {
    const { markdown } = notionBlocksToMarkdown([
      para("agent native starter project for brent", [
        para("make that port the default port"),
      ]),
    ] as any);

    expect(markdown).toBe(
      "agent native starter project for brent\n  - make that port the default port",
    );
  });

  it("handles multiple indented child paragraphs", () => {
    const { markdown } = notionBlocksToMarkdown([
      para("blog sidebar and bottom a/b tests", [
        para("multiplayer claude code"),
        para("release video"),
      ]),
    ] as any);

    expect(markdown).toBe(
      "blog sidebar and bottom a/b tests\n  - multiplayer claude code\n  - release video",
    );
  });

  it("handles deeply nested paragraph children", () => {
    const { markdown } = notionBlocksToMarkdown([
      para("level 1", [para("level 2", [para("level 3")])]),
    ] as any);

    expect(markdown).toBe("level 1\n  - level 2\n    - level 3");
  });

  it("keeps nested list items tightly grouped with indentation", () => {
    const { markdown } = notionBlocksToMarkdown([
      bullet("team mtg dek", [
        bullet("the world is changing"),
        bullet("big opportunity"),
      ]),
      para("next paragraph"),
    ] as any);

    expect(markdown).toBe(
      "- team mtg dek\n  - the world is changing\n  - big opportunity\n\nnext paragraph",
    );
  });

  it("preserves paragraph breaks between normal blocks", () => {
    const { markdown } = notionBlocksToMarkdown([
      para("line one"),
      para("line two"),
    ] as any);

    expect(markdown).toBe("line one\n\nline two");
  });

  it("handles mixed paragraph + bullet children", () => {
    const { markdown } = notionBlocksToMarkdown([
      para("work for sajal", [bullet("team mtg dek"), para("also some notes")]),
    ] as any);

    expect(markdown).toBe(
      "work for sajal\n  - team mtg dek\n  - also some notes",
    );
  });

  // ── Toggle blocks ──

  it("renders toggle blocks with ▶ prefix", () => {
    const { markdown } = notionBlocksToMarkdown([
      toggle("team mtg dek", [bullet("item 1"), bullet("item 2")]),
    ] as any);

    expect(markdown).toBe("- ▶ team mtg dek\n  - item 1\n  - item 2");
  });

  it("renders toggle without children", () => {
    const { markdown } = notionBlocksToMarkdown([
      toggle("click to expand"),
    ] as any);

    expect(markdown).toBe("- ▶ click to expand");
  });

  // ── Code detection ──

  it("flattens plain-text code blocks that do not look like code", () => {
    const { markdown } = notionBlocksToMarkdown([
      code("teams (with permissions)\n\nalso book me links, form links"),
    ] as any);

    expect(markdown).toBe(
      "teams (with permissions)\n\nalso book me links, form links",
    );
  });

  it("flattens short plain text with parenthetical phrases", () => {
    const { markdown } = notionBlocksToMarkdown([
      code("teams (with permissions)\nalso book me links\na2a\nclaw"),
    ] as any);

    // Should NOT be code — "teams (with permissions)" is natural language
    expect(markdown).not.toContain("```");
    expect(markdown).toContain("teams (with permissions)");
  });

  it("flattens single-line plain text", () => {
    const { markdown } = notionBlocksToMarkdown([
      code("just some notes"),
    ] as any);

    expect(markdown).toBe("just some notes");
  });

  it("keeps real code blocks fenced", () => {
    const { markdown } = notionBlocksToMarkdown([
      code("const x = 1;", "typescript"),
    ] as any);

    expect(markdown).toBe("```typescript\nconst x = 1;\n```");
  });

  it("keeps plain-text blocks with actual code patterns fenced", () => {
    const { markdown } = notionBlocksToMarkdown([
      code(
        "const x = 1;\nfunction foo() {\n  return x;\n}\nconsole.log(foo());",
      ),
    ] as any);

    // This has enough code signals — should stay as code
    expect(markdown).toContain("```");
  });

  it("does not treat prose with many words as code", () => {
    const { markdown } = notionBlocksToMarkdown([
      code(
        "This is a long paragraph of text that happens to mention something about a function and other technical things but is clearly prose.",
      ),
    ] as any);

    // High word count per line → prose, not code
    expect(markdown).not.toContain("```");
  });

  it("handles code block with explicit non-plain language", () => {
    const { markdown } = notionBlocksToMarkdown([
      code("hello world", "javascript"),
    ] as any);

    // Explicit language → always fenced
    expect(markdown).toBe("```javascript\nhello world\n```");
  });

  // ── Empty / edge cases ──

  it("handles empty paragraph", () => {
    const { markdown } = notionBlocksToMarkdown([para("")] as any);
    expect(markdown).toBe("");
  });

  it("handles paragraph with only whitespace children", () => {
    const { markdown } = notionBlocksToMarkdown([
      para("parent", [para("")]),
    ] as any);

    expect(markdown).toBe("parent");
  });

  it("handles consecutive paragraphs with children", () => {
    const { markdown } = notionBlocksToMarkdown([
      para("first", [para("child of first")]),
      para("second", [para("child of second")]),
    ] as any);

    expect(markdown).toBe(
      "first\n  - child of first\n\nsecond\n  - child of second",
    );
  });

  // ── Full document scenario matching the user's Notion page ──

  it("converts a realistic Notion todo list correctly", () => {
    const { markdown } = notionBlocksToMarkdown([
      para("work for sajal", [toggle("team mtg dek")]),
      para("one more for agent native - multiple agents in parallel"),
      para("agent native starter project for brent", [
        para("make that port the default port"),
      ]),
      para("→ amazon A+ loom for Nick", [para("Aziz - kyle eng on amazon")]),
      para("blog sidebar and bottom a/b tests", [
        para("multiplayer claude code"),
        para("release video"),
      ]),
    ] as any);

    const lines = markdown.split("\n");

    // "work for sajal" with toggle child
    expect(lines[0]).toBe("work for sajal");
    expect(lines[1]).toBe("  - ▶ team mtg dek");

    // Blank line before next paragraph
    expect(lines[2]).toBe("");

    // Standalone paragraph
    expect(lines[3]).toBe(
      "one more for agent native - multiple agents in parallel",
    );

    // Paragraph with indented child
    expect(lines[5]).toBe("agent native starter project for brent");
    expect(lines[6]).toBe("  - make that port the default port");

    // Arrow paragraph with indented child
    expect(markdown).toContain("→ amazon A+ loom for Nick");
    expect(markdown).toContain("  - Aziz - kyle eng on amazon");

    // Blog paragraph with multiple indented children
    expect(markdown).toContain("blog sidebar and bottom a/b tests");
    expect(markdown).toContain("  - multiplayer claude code");
    expect(markdown).toContain("  - release video");
  });
});
