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
      "a note[^1] and another[^n]\n\n[^1]: the *first*\n\n[^n]: a second",
      "cited[^1]\n\n> [^1]: in a quote",
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
      "a footnote's mark[^1] alone",
    ]) {
      const saved = commentDocToMarkdown(lines(typed));
      expect(commentPlainText(saved)).toBe(typed);
      expect(roundTrip(saved)).toBe(saved);
    }
    const second = commentDocToMarkdown(lines("first", "- second"));
    expect(second).toBe("first\n\\- second");
    expect(commentPlainText(second)).toBe("first\n- second");
    // Lines that would make a table, whose delimiter row shows as nothing.
    for (const rows of [
      ["a|b", "-|-"],
      ["a | b", ":--|--"],
      ["|a|b|", "|---|---|"],
    ]) {
      const saved = commentDocToMarkdown(lines(...rows));
      expect(commentPlainText(saved)).toBe(rows.join("\n"));
      expect(roundTrip(saved)).toBe(saved);
    }
    expect(commentDocToMarkdown(lines("a|b", "-|-"))).toBe("a|b\n\\-|-");
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

  it("keeps marks side by side as they were, beside letters and punctuation too", () => {
    const text = (value: string, ...marks: string[]): CommentDocNode => ({
      type: "text",
      text: value,
      ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
    });
    const marksOf = (doc: CommentDocNode) =>
      (doc.content?.[0]?.content ?? []).map((node) => [
        node.text,
        (node.marks ?? []).map((mark) => mark.type).sort(),
      ]);
    for (const content of [
      [text("x", "bold", "italic"), text("y", "italic")],
      [text("x", "italic"), text("y", "bold", "italic"), text("z", "bold")],
      [text("x"), text("y", "strike", "bold")],
      [text("y", "strike", "italic"), text("x")],
      [text("x"), text("(y)", "strike")],
      [text("x"), text("y", "bold", "strike"), text("z")],
      // Bold and italic whose `*`s run together between punctuation and a
      // letter, where the run wouldn't close the one and open the other.
      [text("b.", "bold"), text("x", "italic")],
      [text("b.", "italic"), text("x", "bold")],
      [text("z"), text("b", "bold"), text("(x)", "italic"), text("y")],
      [text("b.", "bold"), text("x", "italic"), text("y")],
      [text("x", "italic"), text("y.", "bold", "italic"), text("z", "bold")],
      [text("b", "bold", "code"), text("x", "italic")],
      [text("b😀", "bold"), text("x", "italic")],
      [text("b.", "bold"), text("😀x", "italic")],
    ]) {
      const saved = commentDocToMarkdown(inline(...content));
      expect(marksOf(commentMarkdownToDoc(saved))).toEqual(
        marksOf(inline(...content)),
      );
      expect(roundTrip(saved)).toBe(saved);
    }
    expect(
      commentDocToMarkdown(
        inline(text("x", "bold", "italic"), text("y", "italic")),
      ),
    ).toBe("***x**y*");
    // The letter beside the run is spelled as a reference.
    expect(
      commentDocToMarkdown(inline(text("b.", "bold"), text("x", "italic"))),
    ).toBe("**b.***&#x78;*");
  });

  it("saves a typed web address as typed, which the renderer links", () => {
    const address =
      "https://en.wikipedia.org/wiki/Python_(programming_language)";
    for (const typed of [
      `see ${address} now`,
      `(${address})`,
      "www.example.com/a_b_(c)",
    ]) {
      const saved = commentDocToMarkdown(lines(typed));
      expect(saved).toBe(typed);
      expect(roundTrip(saved)).toBe(saved);
    }
    expect(roundTrip(`[${address}](${address})`)).toBe(address);
    // Unescaped, the end would show as "<", so it stays escaped.
    expect(commentDocToMarkdown(lines("www.x.com/&lt;"))).toBe(
      "www.x.com/\\&lt;",
    );
    // One ending in a backslash, which `<…>` would double, opens as a link
    // that saves the same each time.
    const ending = roundTrip(
      commentDocToMarkdown(lines("see https://example.com\\ ok")),
    );
    expect(ending).toBe(
      "see [https://example.com\\\\](https://example.com\\\\) ok",
    );
    expect(roundTrip(ending)).toBe(ending);
  });

  it("keeps a typed web address apart from formatting right after it", () => {
    const text = (value: string, ...marks: string[]): CommentDocNode => ({
      type: "text",
      text: value,
      ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
    });
    const linked: CommentDocNode = {
      type: "text",
      text: "https://example.com",
      marks: [{ type: "link", attrs: { href: "https://example.com" } }],
    };
    // Written bare, the address would run on into the marks after it.
    for (const { content, saved } of [
      {
        content: [text("https://example.com"), text("now", "bold")],
        saved: "<https://example.com>**now**",
      },
      {
        content: [text("see https://example.com."), text("now", "italic")],
        saved: "see <https://example.com>.*now*",
      },
      {
        content: [
          text("x", "code"),
          text("https://example.com"),
          text("now", "strike"),
        ],
        saved: "`x`<https://example.com>~~now~~",
      },
      {
        content: [linked, text("."), text("now", "bold")],
        saved: "<https://example.com>.**now**",
      },
      {
        content: [text("https://example.com\\"), text("now", "bold")],
        saved: "[https://example.com\\\\](https://example.com\\\\)**now**",
      },
    ]) {
      expect(commentDocToMarkdown(inline(...content))).toBe(saved);
      expect(commentMarkdownToDoc(saved).content?.[0]?.content?.at(-1)).toEqual(
        content.at(-1),
      );
      expect(roundTrip(saved)).toBe(saved);
    }
  });

  it("opens a mail-link mention as a chip that saves as written", () => {
    const written =
      "Ask @[Alex Kim](mailto:alex%40example.com) and **@[Sam](mailto:sam@example.com)**";
    expect(chips(commentMarkdownToDoc(written))).toEqual(["Alex Kim", "Sam"]);
    expect(roundTrip(written)).toBe(written);
    expect(
      commentMarkdownToDoc("@[Sam](mailto:sam@example.com)").content?.[0]
        ?.content?.[0]?.attrs,
    ).toEqual({
      label: "Sam",
      email: "sam@example.com",
      id: null,
      mailto: "sam@example.com",
    });
  });

  it("chips only the links it swapped in for mentions", () => {
    expect(
      commentMarkdownToDoc(
        "@Sam [normal](https://comment-mention.invalid/0)",
        people,
      ),
    ).toEqual(
      inline(
        {
          type: "reviewMention",
          attrs: { label: "Sam", email: "sam@example.com", id: null },
        },
        { type: "text", text: " " },
        {
          type: "text",
          text: "normal",
          marks: [
            {
              type: "link",
              attrs: { href: "https://comment-mention.invalid/0" },
            },
          ],
        },
      ),
    );
    const code = "`[x](https://comment-mention.invalid/x/0)` @Sam";
    expect(chips(commentMarkdownToDoc(code, people))).toEqual(["Sam"]);
    expect(roundTrip(code)).toBe(code);
  });

  it("never shows or saves a mention's stand-in link", () => {
    const named = [...people, { label: "a`b<c", email: "ab@example.com" }];
    const shown = (markdown: string) =>
      JSON.stringify(commentMarkdownToDoc(markdown, named));
    // A name holding a backtick or "<" stays one chip beside code.
    const beside = "@a`b<c and `code` <i>x</i>";
    expect(chips(commentMarkdownToDoc(beside, named))).toEqual(["a`b<c"]);
    expect(roundTrip(beside, named)).toBe("@a`b<c and `code` \\<i>x\\</i>");
    // `!` would make its link an image, so that one opens as written.
    const bang = "Hi!@Sam and @Sam";
    expect(chips(commentMarkdownToDoc(bang, named))).toEqual(["Sam"]);
    expect(roundTrip(bang, named)).toBe(bang);
    for (const markdown of [beside, bang, "`x @a`b<c y`", "`@Sam`"]) {
      expect(shown(markdown)).not.toContain("comment-mention.invalid");
    }
  });

  it("keeps a chip's name whole before formatted punctuation", () => {
    const sam = (...marks: string[]): CommentDocNode => ({
      type: "reviewMention",
      attrs: { label: "Sam", email: "sam@example.com", id: null },
      ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
    });
    const text = (value: string, ...marks: string[]): CommentDocNode => ({
      type: "text",
      text: value,
      ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
    });
    // Spelled as a character reference, the name's last letter would end the
    // chip early, so the punctuation moves outside the marks instead.
    for (const [content, saved] of [
      [[sam(), text("!", "bold")], "@Sam!"],
      [[sam(), text("(see)", "italic"), text(" ok")], "@Sam(*see)* ok"],
      [[sam(), text("!x", "strike")], "@Sam!~~x~~"],
      [[sam("bold"), text("!", "italic")], "**@Sam**!"],
      [[sam(), text("x", "bold")], "@Sam**x**"],
    ] as const) {
      expect(commentDocToMarkdown(inline(...content))).toBe(saved);
      expect(chips(commentMarkdownToDoc(saved, people))).toEqual(["Sam"]);
      expect(roundTrip(saved)).toBe(saved);
    }
  });

  it("chips listed mentions as whole words, longest name first", () => {
    expect(chips(commentMarkdownToDoc("@Sam Lee and @Sam", people))).toEqual([
      "Sam Lee",
      "Sam",
    ]);
    expect(chips(commentMarkdownToDoc("@Samantha mail@Sam", people))).toEqual(
      [],
    );
    // The `_` of `@Sam_`, saved escaped, still runs on from the name.
    const typed = commentDocToMarkdown(lines("Hi @Sam_ there"));
    expect(typed).toBe("Hi @Sam\\_ there");
    expect(chips(commentMarkdownToDoc(typed, people))).toEqual([]);
    expect(roundTrip(typed)).toBe(typed);
    expect(chips(commentMarkdownToDoc("Hi @Sam\\* there", people))).toEqual([
      "Sam",
    ]);
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

    expect(chips(commentMarkdownToDoc(unmatched, people))).toEqual([]);
    expect(chips(commentMarkdownToDoc(matched, people))).toHaveLength(1_900);
    // Each is timed against an ordinary comment of its length, so a slow or
    // busy machine slows both alike. They take up to several times as long;
    // a blowup would take hundreds.
    for (const text of [unmatched, matched]) {
      const ordinaryMs = fastest(
        "Words, **bold**, `code` and a [link](https://example.com).\n\n"
          .repeat(400)
          .slice(0, text.length),
        3,
      );
      expect(fastest(text, 2) / ordinaryMs, text.slice(0, 5)).toBeLessThan(20);
    }
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
    expect(roundTrip("| a | b |\n| - | - |\n| 1 | 2 |")).toBe("a\nb\n\n1\n2");
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
    const ticks = `${head}\n\n*a* \`b\` past the limit`;
    expect(roundTrip(ticks)).toBe(ticks);
    // Spaces and empty lines show there too, so they save as typed.
    const spaced = `${head}\n\n  indented  \n\n\n\nafter`;
    expect(roundTrip(spaced)).toBe(spaced);
    // Code's backslashes are as typed, so code there keeps them.
    const withCode = commentDocToMarkdown({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: head }] },
        { type: "paragraph" },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "*x* " },
            { type: "text", text: "a\\*b", marks: [{ type: "code" }] },
          ],
        },
        {
          type: "codeBlock",
          content: [{ type: "text", text: "c\\_d" }],
        },
      ],
    });
    expect(withCode).toBe(`${head}\n\n*x* \`a\\*b\`\n\n\`\`\`\nc\\_d\n\`\`\``);
  });

  it("opens an empty comment as one empty line", () => {
    expect(commentMarkdownToDoc("")).toEqual(lines(""));
    expect(commentDocToMarkdown(lines(""))).toBe("");
  });
});

function fastest(markdown: string, runs: number): number {
  let best = Infinity;
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    commentMarkdownToDoc(markdown, people);
    best = Math.min(best, performance.now() - started);
  }
  return best;
}
