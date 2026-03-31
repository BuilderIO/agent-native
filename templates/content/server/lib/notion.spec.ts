import { describe, expect, it } from "vitest";
import { notionBlocksToMarkdown } from "./notion";

describe("notionBlocksToMarkdown", () => {
  it("keeps nested list items tightly grouped with indentation", () => {
    const { markdown } = notionBlocksToMarkdown([
      {
        id: "1",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ plain_text: "team mtg dek" }] },
        children: [
          {
            id: "2",
            type: "bulleted_list_item",
            bulleted_list_item: {
              rich_text: [{ plain_text: "the world is changing" }],
            },
          },
          {
            id: "3",
            type: "bulleted_list_item",
            bulleted_list_item: {
              rich_text: [{ plain_text: "big opportunity" }],
            },
          },
        ],
      },
      {
        id: "4",
        type: "paragraph",
        paragraph: { rich_text: [{ plain_text: "next paragraph" }] },
      },
    ] as any);

    expect(markdown).toBe(
      "- team mtg dek\n  - the world is changing\n  - big opportunity\n\nnext paragraph",
    );
  });

  it("preserves paragraph breaks between normal blocks", () => {
    const { markdown } = notionBlocksToMarkdown([
      {
        id: "1",
        type: "paragraph",
        paragraph: { rich_text: [{ plain_text: "line one" }] },
      },
      {
        id: "2",
        type: "paragraph",
        paragraph: { rich_text: [{ plain_text: "line two" }] },
      },
    ] as any);

    expect(markdown).toBe("line one\n\nline two");
  });

  it("flattens plain-text notion code blocks that do not look like code", () => {
    const { markdown } = notionBlocksToMarkdown([
      {
        id: "1",
        type: "code",
        code: {
          language: "plain text",
          rich_text: [
            { plain_text: "teams (with permissions)\n\nalso book me links" },
          ],
        },
      },
    ] as any);

    expect(markdown).toBe("teams (with permissions)\n\nalso book me links");
  });

  it("keeps real code blocks fenced", () => {
    const { markdown } = notionBlocksToMarkdown([
      {
        id: "1",
        type: "code",
        code: {
          language: "typescript",
          rich_text: [{ plain_text: "const x = 1;" }],
        },
      },
    ] as any);

    expect(markdown).toBe("```typescript\nconst x = 1;\n```");
  });
});
