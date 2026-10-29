import { describe, expect, it } from "vitest";

import { commentExcerpt, commentPlainText } from "./plain-text.js";

describe("commentPlainText", () => {
  it("drops inline markers and keeps the words", () => {
    expect(
      commentPlainText(
        "**bold**, __also bold__, *italic*, _italic_, ~~gone~~ and `code`",
      ),
    ).toBe("bold, also bold, italic, italic, gone and code");
    expect(commentPlainText("***both*** and *a*")).toBe("both and a");
  });

  it("keeps link and image text and reads mailto mentions as @Name", () => {
    expect(
      commentPlainText(
        'Ask @[Sam Lee](mailto:sam@example.com) about [the brief](https://example.com/b "Brief") ![chart](https://x.test/c.png) <https://example.com>',
      ),
    ).toBe("Ask @Sam Lee about the brief chart https://example.com");
  });

  it("keeps list markers and line breaks, and drops quote and heading markers", () => {
    expect(
      commentPlainText(
        "## Two fixes ##\n\n- the intro runs long\n- the title\n\n1. first\n\n> quoted\n> > nested\n\n---\nafter",
      ),
    ).toBe(
      "Two fixes\n\n- the intro runs long\n- the title\n\n1. first\n\nquoted\nnested\n\nafter",
    );
  });

  it("keeps a code block's lines as written", () => {
    expect(
      commentPlainText("Try:\n```ts\nconst a = **b**;\n_c_\n```\ndone"),
    ).toBe("Try:\nconst a = **b**;\n_c_\ndone");
    expect(commentPlainText("~~~\n`x`\n~~~")).toBe("`x`");
    expect(commentPlainText("``` `inline` ```")).toBe("`inline`");
  });

  it("leaves text that only looks like Markdown alone", () => {
    expect(commentPlainText("snake_case_name and 2 * 3 * 4")).toBe(
      "snake_case_name and 2 * 3 * 4",
    );
    expect(commentPlainText("\\*not italic\\* and \\_this\\_")).toBe(
      "*not italic* and _this_",
    );
    expect(commentPlainText("use `**` for bold")).toBe("use ** for bold");
  });

  it("drops raw HTML tags, as the renderer does", () => {
    expect(commentPlainText("<b>hi</b> there<br>")).toBe("hi there");
    expect(commentPlainText('<a href="x" data-y=1>link</a>')).toBe("link");
  });

  it("keeps text that only looks like a tag", () => {
    expect(commentPlainText("x<y+1 and y>2")).toBe("x<y+1 and y>2");
    expect(commentPlainText("a <3 b > c")).toBe("a <3 b > c");
  });

  it("drops a heading's closing hashes but keeps hashes in prose", () => {
    expect(commentPlainText("## Title ##")).toBe("Title");
    expect(commentPlainText("# C#")).toBe("C#");
    expect(commentPlainText("Ship it #")).toBe("Ship it #");
    expect(commentPlainText("see issue #")).toBe("see issue #");
  });

  it("takes linear time on long lines of unclosed markers", () => {
    const started = performance.now();
    for (const text of [
      Array.from({ length: 400 }, (_, i) => `${"`".repeat(i + 1)}x`).join(" "),
      "~~a ".repeat(50_000),
      "**x ".repeat(50_000),
      "[a](".repeat(50_000),
      "[".repeat(100_000),
      "<a ".repeat(70_000),
      `<a${" b".repeat(50_000)}`,
      `# x${" ".repeat(100_000)}y`,
      `# x${" #".repeat(50_000)}y`,
      `\` ${"a".repeat(100_000)}\``,
    ]) {
      commentPlainText(text);
    }
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe("commentExcerpt", () => {
  it("puts a comment on one line", () => {
    expect(commentExcerpt("- **one**\n- two\n\n> three")).toBe(
      "- one - two three",
    );
  });

  it("cuts a long comment with an ellipsis", () => {
    const excerpt = commentExcerpt("word ".repeat(100), 40);
    expect(excerpt).toHaveLength(40);
    expect(excerpt.endsWith("word…")).toBe(true);
  });

  it("never splits a character outside the Basic Multilingual Plane", () => {
    expect(commentExcerpt(`${"a".repeat(8)}\u{1F600}tail`, 10)).toBe(
      `${"a".repeat(8)}…`,
    );
  });
});
