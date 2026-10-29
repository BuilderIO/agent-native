import { describe, expect, it, vi } from "vitest";

import {
  COMMENT_MARKDOWN_LIMIT,
  commentExcerpt,
  commentPlainText,
  splitCommentAtMarkdownLimit,
} from "./plain-text.js";

describe("commentPlainText", () => {
  it("drops inline markers and keeps the words", () => {
    expect(
      commentPlainText(
        "**bold**, __also bold__, *italic*, _italic_, ~~gone~~ and `code`",
      ),
    ).toBe("bold, also bold, italic, italic, gone and code");
    expect(commentPlainText("***both*** and *a*")).toBe("both and a");
  });

  it("keeps link text and reads mailto mentions as @Name", () => {
    expect(
      commentPlainText(
        'Ask @[Sam Lee](mailto:sam@example.com) about [the brief](https://example.com/b "Brief") <https://example.com>',
      ),
    ).toBe("Ask @Sam Lee about the brief https://example.com");
  });

  it("drops images and task checkboxes, which the renderer draws no text for", () => {
    expect(commentPlainText("See it ![chart](https://x.test/c.png)")).toBe(
      "See it",
    );
    expect(commentPlainText("- [x] done\n- [ ] todo")).toBe("- done\n- todo");
  });

  it("reads a table a row to a line, and keeps nested lists under their items", () => {
    expect(commentPlainText("| a | b |\n|---|---|\n| 1 | 2 |")).toBe(
      "a | b\n1 | 2",
    );
    expect(commentPlainText("1. a\n   - b\n2. c")).toBe("1. a\n   - b\n2. c");
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

  it("drops HTML comments, as the renderer does", () => {
    expect(commentPlainText("Visible text <!-- hidden note -->")).toBe(
      "Visible text",
    );
    expect(commentPlainText("a<!-- x -->b and <!-->c")).toBe("ab and c");
    expect(
      commentPlainText("Before\n<!--\nhidden\n\nstill hidden -->\nAfter"),
    ).toBe("Before\n\nAfter");
    // A quoted comment ends with the quote.
    expect(commentPlainText("> <!-- a\n> b\nc")).toBe("c");
    // Mid-line, an unclosed opener is text.
    expect(commentPlainText("a <!-- never closed")).toBe("a <!-- never closed");
    expect(commentPlainText("`<!-- code -->`")).toBe("<!-- code -->");
    expect(commentPlainText("\\<!-- not a comment -->")).toBe(
      "<!-- not a comment -->",
    );
  });

  it("hides raw HTML blocks, as the renderer does", () => {
    expect(commentPlainText("<div>\ninternal note\n</div>\n\nshown")).toBe(
      "shown",
    );
    // A comment in a list item runs to its `-->`, past a blank line.
    expect(
      commentPlainText("Note:\n\n- <!-- hidden\n\n  still hidden -->\n- shown"),
    ).toBe("Note:\n\n-\n- shown");
    // A backtick inside a comment doesn't open code.
    expect(commentPlainText("Start <!-- use ` here --> thanks `code`")).toBe(
      "Start  thanks code",
    );
  });

  it("keeps the rest of a very long comment as written", () => {
    const text = commentPlainText(
      `**a**\n\n${"x".repeat(COMMENT_MARKDOWN_LIMIT)}\n\n**b**`,
    );
    expect(text.startsWith("a\n\nxxx")).toBe(true);
    expect(text.endsWith("x\n\n**b**")).toBe(true);
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

  it("reads a paragraph's lines together, as the renderer does", () => {
    expect(commentPlainText("`a *b*\nc`")).toBe("a *b* c");
    expect(commentPlainText("**bold\nacross** and _this\none_")).toBe(
      "bold\nacross and this\none",
    );
    expect(commentPlainText("> `a\n> b`")).toBe("a b");
    // Code doesn't run into the next list item or paragraph.
    expect(commentPlainText("- a `b\n- c` d")).toBe("- a `b\n- c` d");
    expect(commentPlainText("`a\n\nb`")).toBe("`a\n\nb`");
  });

  it("drops formatting that wraps inline code", () => {
    expect(commentPlainText("**`a`** and [`b`](https://x.test)")).toBe(
      "a and b",
    );
    expect(commentPlainText("_`c`_ and ~~`d`~~")).toBe("c and d");
    expect(commentPlainText("[a\\]b](https://x.test)")).toBe("a]b");
  });

  it("keeps code blocks in quotes and list items as written", () => {
    expect(commentPlainText("> ```\n> **x**\n> ```\nafter")).toBe(
      "**x**\nafter",
    );
    // Code in a list item loses the item's indent.
    expect(commentPlainText("a\n- ```\n    _y_\n  ```")).toBe("a\n-   _y_");
    // A quoted fence ends with the quote.
    expect(commentPlainText("> ```\n> a\nb **c**")).toBe("a\nb c");
  });

  it("drops a heading's underline", () => {
    expect(commentPlainText("Title\n===\nnext")).toBe("Title\nnext");
    expect(commentPlainText("**Sub**\n---")).toBe("Sub");
  });

  it("keeps private-use characters the author typed", () => {
    const typed = "\uE0000\uE001";
    expect(commentPlainText(`${typed} and \\* star`)).toBe(
      `${typed} and * star`,
    );
    expect(commentPlainText(`\`${typed}\` and **b**`)).toBe(`${typed} and b`);
  });

  it("leaves escaped backticks as backticks", () => {
    expect(commentPlainText("\\`not code\\`")).toBe("`not code`");
    expect(commentPlainText("\\``code`")).toBe("`code");
    // Inside code a backslash is literal, so it can't escape the closer.
    expect(commentPlainText("`ends in \\`")).toBe("ends in \\");
    expect(commentPlainText("\\\\`code`")).toBe("\\code");
  });

  it("reads a paragraph too tangled to parse quickly as written", () => {
    // Each would take the parser seconds, or run it out of stack.
    for (const tangled of [
      `${">".repeat(15_000)} deep`,
      `${"- ".repeat(8_000)}deep`,
      `${"![".repeat(3_000)}x${"](u)".repeat(3_000)}`,
      "*a".repeat(10_000),
      "x <!--".repeat(1_000),
    ]) {
      expect(commentPlainText(`**Intro**\n\n${tangled}`)).toBe(
        `Intro\n\n${tangled}`,
      );
    }
  });

  it("reads long comments people write as Markdown", () => {
    const steps = Array.from(
      { length: 150 },
      (_, i) => `- **Step ${i + 1}**: see [docs](https://example.com/${i})`,
    );
    const quote = "> > > > > > An old reply with *emphasis*";
    expect(commentPlainText(`${steps.join("\n")}\n\n${quote}`)).toBe(
      `${steps.map((_, i) => `- Step ${i + 1}: see docs`).join("\n")}\n\n` +
        "An old reply with emphasis",
    );
  });

  it("reads a comment as written if the parser fails", async () => {
    vi.resetModules();
    vi.doMock("mdast-util-from-markdown", () => ({
      fromMarkdown: () => {
        throw new RangeError("Maximum call stack size exceeded");
      },
    }));
    try {
      const fresh = await import("./plain-text.js");
      expect(fresh.commentPlainText(" **a** ")).toBe("**a**");
    } finally {
      vi.doUnmock("mdast-util-from-markdown");
      vi.resetModules();
    }
  });

  it("reads comments full of unclosed or nested markers about as fast as ordinary ones", () => {
    // The parser reads at most COMMENT_MARKDOWN_LIMIT characters, and stops
    // before a paragraph that would take it seconds, as the renderer does.
    // Each input is timed against an ordinary comment of that length, so a
    // slow or busy machine slows both alike. They take a few times as long;
    // a blowup would take hundreds.
    const ordinaryMs = fastest(
      "Words, **bold**, `code` and a [link](https://example.com).\n\n"
        .repeat(500)
        .slice(0, COMMENT_MARKDOWN_LIMIT),
      3,
    );
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
      "**x\n".repeat(50_000),
      "`x\n".repeat(50_000),
      "x <!--".repeat(50_000),
      `${"\\".repeat(10)}\``.repeat(10_000),
      "*a".repeat(10_000),
      `${"*_".repeat(32)}x`.repeat(300),
      `${"*".repeat(6_000)}x${"*".repeat(6_000)}`,
      `${"![".repeat(3_000)}x${"](u)".repeat(3_000)}`,
      `${">".repeat(15_000)} x`,
      `${"- ".repeat(8_000)}x`,
      // Just inside each paragraph and line limit.
      `${"*a".repeat(999)}\n\n`.repeat(10),
      `${"![".repeat(16)}x${"](u)".repeat(16)} `.repeat(400),
      `${"- ".repeat(16)}x\n`.repeat(600),
      `${"x <!--".repeat(64)}\n\n`.repeat(50),
    ]) {
      expect(fastest(text, 2) / ordinaryMs, text.slice(0, 12)).toBeLessThan(20);
    }
  });
});

describe("splitCommentAtMarkdownLimit", () => {
  it("stops before the first paragraph too tangled to read quickly", () => {
    const tangled = `${"[".repeat(17)}x`;
    expect(
      splitCommentAtMarkdownLimit(`one\n\ntwo\n \n${tangled}\nthree\n\nfour`),
    ).toEqual({
      markdown: "one\n\ntwo\n \n",
      rest: `${tangled}\nthree\n\nfour`,
    });
    expect(splitCommentAtMarkdownLimit(`one\r\n\r\n${tangled}`)).toEqual({
      markdown: "one\r\n\r\n",
      rest: tangled,
    });
  });

  it("ends lines where the parser does, even at a lone carriage return", () => {
    // `x` then a quote nested 17 deep, on its own line to the parser.
    expect(
      splitCommentAtMarkdownLimit(`one\r\rx\r${">".repeat(17)} deep`),
    ).toEqual({
      markdown: "one\r\r",
      rest: `x\r${">".repeat(17)} deep`,
    });
  });

  it("counts the quote and list markers that open a line", () => {
    expect(splitCommentAtMarkdownLimit(`${"> ".repeat(16)}ok`).rest).toBe("");
    expect(
      splitCommentAtMarkdownLimit(`${"> - 1. ".repeat(6)}deep`).markdown,
    ).toBe("");
    // Markers need a space after them, so these are words.
    expect(splitCommentAtMarkdownLimit("-1.".repeat(50)).rest).toBe("");
  });

  it("counts emphasis markers and HTML comments per paragraph", () => {
    const paragraph = `${"**".repeat(500)}\n\n`;
    expect(splitCommentAtMarkdownLimit(paragraph.repeat(10)).rest).toBe("");
    expect(splitCommentAtMarkdownLimit(`${"**".repeat(500)}*`).markdown).toBe(
      "",
    );
    expect(
      splitCommentAtMarkdownLimit("<!-- a -->\n".repeat(65)).markdown,
    ).toBe("");
  });
});

/** The quickest of a few reads, in milliseconds, which steadies a busy machine. */
function fastest(text: string, runs: number): number {
  let best = Infinity;
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    commentPlainText(text);
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

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
