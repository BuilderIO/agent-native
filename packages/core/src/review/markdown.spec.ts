import { describe, expect, it } from "vitest";

import {
  commentDocToMarkdown,
  commentMarkdownToDoc,
  type CommentDocNode,
} from "./markdown.js";
import { COMMENT_MARKDOWN_LIMIT, commentPlainText } from "./plain-text.js";

const people = [
  { label: "Sam", email: "sam@example.com" },
  { label: "Sam Lee", email: "sam.lee@example.com" },
];

function roundTrip(markdown: string, mentions = people): string {
  return commentDocToMarkdown(commentMarkdownToDoc(markdown, mentions));
}

function lines(...texts: string[]): CommentDocNode {
  return {
    type: "doc",
    content: texts.map((text) =>
      text
        ? { type: "paragraph", content: [{ type: "text", text }] }
        : { type: "paragraph" },
    ),
  };
}

function inline(...content: CommentDocNode[]): CommentDocNode {
  return { type: "doc", content: [{ type: "paragraph", content }] };
}

function chips(doc: CommentDocNode): string[] {
  const labels: string[] = [];
  const visit = (node: CommentDocNode) => {
    if (node.type === "reviewMention") labels.push(String(node.attrs?.label));
    node.content?.forEach(visit);
  };
  visit(doc);
  return labels;
}

describe("comment Markdown and the box's document", () => {
  it("saves what it opens unchanged", () => {
    for (const markdown of [
      "",
      "plain",
      "two\nlines",
      "a\n\nb",
      "**bold**, *italic*, ~~gone~~ and `code`",
      "[the brief](https://example.com/brief) and https://example.com",
      "- one\n- two",
      "3. three\n4. four",
      "- outer\n  - inner",
      "> quoted\n> more",
      "```js\nconst a = 1;\n\nreturn a;\n```",
      "Hey @Sam, can you check?\n@Sam Lee too",
      "before\n\n- item\n\nafter",
      "snake_case, 2 * 3 and a@b.com",
      "Ask **@Sam** about `@Sam`",
      "**`bold code`** and [`linked code`](https://example.com)",
      "ask @[Sam](mailto:sam@example.com)",
      "999999999. first\n999999999. second",
    ]) {
      expect(roundTrip(markdown)).toBe(markdown);
    }
  });

  it("escapes formatting typed as text, so it shows as typed", () => {
    for (const typed of [
      "*not italic*",
      "__not bold__",
      "~~not struck~~",
      "`not code`",
      "[not](a link)",
      "# not a heading",
      "> not a quote",
      "- not a list",
      "1. not a list",
      "<b>a tag</b>",
      "a\\b and a\\_b",
    ]) {
      const saved = commentDocToMarkdown(lines(typed));
      expect(commentPlainText(saved)).toBe(typed);
      expect(roundTrip(saved)).toBe(saved);
    }
    const second = commentDocToMarkdown(lines("first", "- second"));
    expect(second).toBe("first\n\\- second");
    expect(commentPlainText(second)).toBe("first\n- second");
  });

  it("keeps a typed web address bare, so it still shows as a link", () => {
    expect(commentDocToMarkdown(lines("see https://example.com/a_b"))).toBe(
      "see https://example.com/a_b",
    );
    expect(roundTrip("<https://example.com>, www.example.com or a@b.com")).toBe(
      "https://example.com, www.example.com or a@b.com",
    );
    const linked = (text: string, href: string, after = "") =>
      commentDocToMarkdown(
        inline(
          { type: "text", text, marks: [{ type: "link", attrs: { href } }] },
          ...(after ? [{ type: "text", text: after }] : []),
        ),
      );
    expect(linked("https://example.com", "https://example.com", ".")).toBe(
      "https://example.com.",
    );
    expect(linked("https://example.com", "https://example.com", "x")).toBe(
      "<https://example.com>x",
    );
    expect(linked("example.com", "https://example.com")).toBe(
      "[example.com](https://example.com)",
    );
    // Bare only where, written as it is, it reads back as the same link.
    expect(
      roundTrip(
        "[https://example.com/a?x=1&y=2](https://example.com/a?x=1&y=2)",
      ),
    ).toBe("https://example.com/a?x=1&y=2");
    expect(roundTrip("[a@b](mailto:a@b)")).toBe("<a@b>");
  });

  it("joins lines into a paragraph and breaks it at an empty line", () => {
    expect(commentDocToMarkdown(lines("a", "b", "", "", "c"))).toBe(
      "a\nb\n\nc",
    );
    expect(commentMarkdownToDoc("a\nb\n\n\n\nc")).toEqual(
      lines("a", "b", "", "c"),
    );
  });

  it("drops the spaces at each end of a line", () => {
    expect(commentDocToMarkdown(lines("  indented  ", "\tnext"))).toBe(
      "indented\nnext",
    );
    expect(commentDocToMarkdown(lines("   "))).toBe("");
  });

  it("moves spaces at the edge of bold or italic text outside it", () => {
    expect(
      commentDocToMarkdown(
        inline(
          { type: "text", text: "a" },
          { type: "text", text: " bold ", marks: [{ type: "bold" }] },
          { type: "text", text: "next" },
        ),
      ),
    ).toBe("a **bold** next");
    expect(
      commentDocToMarkdown(
        inline(
          { type: "text", text: "both ", marks: [{ type: "bold" }] },
          {
            type: "text",
            text: "marks",
            marks: [{ type: "bold" }, { type: "italic" }],
          },
        ),
      ),
    ).toBe("**both *marks***");
  });

  it("nests marks around code and links", () => {
    expect(
      commentDocToMarkdown(
        inline(
          {
            type: "text",
            text: "the site",
            marks: [
              { type: "bold" },
              { type: "link", attrs: { href: "https://example.com" } },
            ],
          },
          { type: "text", text: " and " },
          { type: "text", text: "a`b", marks: [{ type: "code" }] },
        ),
      ),
    ).toBe("[**the site**](https://example.com) and ``a`b``");
  });

  it("chips listed mentions as whole words, longest name first", () => {
    expect(chips(commentMarkdownToDoc("@Sam Lee and @Sam", people))).toEqual([
      "Sam Lee",
      "Sam",
    ]);
    expect(chips(commentMarkdownToDoc("@Samantha mail@Sam", people))).toEqual(
      [],
    );
    expect(
      chips(
        commentMarkdownToDoc(
          "`@Sam` [@Sam](https://example.com) **@Sam**",
          people,
        ),
      ),
    ).toEqual(["Sam"]);
    expect(
      commentDocToMarkdown(
        inline(
          { type: "text", text: "hi " },
          { type: "reviewMention", attrs: { label: "Sam *Lee*" } },
        ),
      ),
    ).toBe("hi @Sam *Lee*");
    // Markdown in a label is part of the chip, as the renderer draws it.
    const styled = [{ label: "Sam _Lee_", email: "sam@example.com" }];
    expect(chips(commentMarkdownToDoc("Hey @Sam _Lee_", styled))).toEqual([
      "Sam _Lee_",
    ]);
    expect(roundTrip("Hey @Sam _Lee_", styled)).toBe("Hey @Sam _Lee_");
  });

  it("chips mentions in a long line full of @ signs in linear time", () => {
    const unmatched = "x@".repeat(9_000);
    const matched = "@Sam ".repeat(1_900);
    const started = performance.now();
    const unmatchedDoc = commentMarkdownToDoc(unmatched, people);
    const matchedDoc = commentMarkdownToDoc(matched, people);
    const elapsedMs = performance.now() - started;

    expect(chips(unmatchedDoc)).toEqual([]);
    expect(chips(matchedDoc)).toHaveLength(1_900);
    expect(elapsedMs).toBeLessThan(1_000);
    // Past the most the renderer draws, none are chips, there or here.
    expect(chips(commentMarkdownToDoc("@Sam ".repeat(2_100), people))).toEqual(
      [],
    );
  });

  it("opens what the renderer draws as text the way it draws it", () => {
    expect(roundTrip("# Heading\n\ntext")).toBe("**Heading**\n\ntext");
    expect(roundTrip("a <!-- hidden --> <span>b</span>")).toBe(
      "a  \\<span>b\\</span>",
    );
    expect(roundTrip("| a | b |\n| - | - |\n| 1 | 2 |")).toBe("a | b\n1 | 2");
    expect(roundTrip("above\n\n---\n\n![alt](https://example.com/i.png)")).toBe(
      "above",
    );
    expect(roundTrip("[the brief][b]\n\n[b]: https://example.com/brief")).toBe(
      "[the brief](https://example.com/brief)",
    );
    expect(roundTrip("- [x] done\n- [ ] open")).toBe("- done\n- open");
    expect(roundTrip("unreferenced\n\n[^note]: drawn as nothing")).toBe(
      "unreferenced",
    );
  });

  it("gives a list item that starts with a block an empty first line", () => {
    const doc = commentMarkdownToDoc("- ```\n  code\n  ```");
    const item = doc.content?.[0]?.content?.[0];
    expect(item?.content?.map((node) => node.type)).toEqual([
      "paragraph",
      "codeBlock",
    ]);
  });

  it("opens the text past the Markdown limit as the lines it shows as", () => {
    const head = "a".repeat(COMMENT_MARKDOWN_LIMIT - 10);
    const doc = commentMarkdownToDoc(`${head}\n\n**not bold**\nnext`);
    expect(doc.content?.slice(-3)).toEqual([
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "**not bold**" }] },
      { type: "paragraph", content: [{ type: "text", text: "next" }] },
    ]);
  });

  it("saves the text past the Markdown limit as it shows, unescaped", () => {
    const head = "a".repeat(COMMENT_MARKDOWN_LIMIT - 10);
    const long = `${head}\n\n**not bold** \\_x_\nnext`;
    expect(roundTrip(long)).toBe(long);
    // Code's backslashes are as typed, so a tail holding code keeps escapes.
    expect(roundTrip(`${head}\n\n*a* \`b\` past the limit`)).toBe(
      `${head}\n\n\\*a\\* \\\`b\\\` past the limit`,
    );
  });

  it("opens an empty comment as one empty line", () => {
    expect(commentMarkdownToDoc("")).toEqual(lines(""));
    expect(commentDocToMarkdown(lines(""))).toBe("");
  });
});
