import { describe, expect, it } from "vitest";

import {
  joinMarkdownBlocks,
  splitMarkdownBlocks,
} from "./markdown-block-split.js";

describe("splitMarkdownBlocks", () => {
  it("returns empty completed blocks and empty tail for empty string", () => {
    expect(splitMarkdownBlocks("")).toEqual({ completedBlocks: [], tail: "" });
  });

  it("puts a single paragraph in the tail when no blank line follows", () => {
    const result = splitMarkdownBlocks("Hello world");
    expect(result.completedBlocks).toEqual([]);
    expect(result.tail).toBe("Hello world");
  });

  it("splits two paragraphs separated by a blank line", () => {
    const text = "First paragraph.\n\nSecond paragraph.";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual(["First paragraph."]);
    expect(result.tail).toBe("Second paragraph.");
  });

  it("splits three paragraphs", () => {
    const text = "Para A.\n\nPara B.\n\nPara C.";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual(["Para A.", "Para B."]);
    expect(result.tail).toBe("Para C.");
  });

  it("does not split on blank lines inside a fenced code block", () => {
    const text =
      "Before fence.\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter fence.";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual([
      "Before fence.",
      "```js\nconst a = 1;\n\nconst b = 2;\n```",
    ]);
    expect(result.tail).toBe("After fence.");
  });

  it("treats an unterminated fence as part of the tail", () => {
    const text = "Before.\n\n```ts\nconst x = ";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual(["Before."]);
    expect(result.tail).toBe("```ts\nconst x = ");
  });

  it("handles tilde fences", () => {
    const text = "Intro.\n\n~~~python\nprint('hi')\n~~~\n\nOutro.";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual([
      "Intro.",
      "~~~python\nprint('hi')\n~~~",
    ]);
    expect(result.tail).toBe("Outro.");
  });

  it("requires closing fence to be same type as opening fence", () => {
    // ~~~ does not close a ``` fence
    const text = "Start.\n\n```js\ncode\n~~~\nstill inside\n```\n\nEnd.";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual([
      "Start.",
      "```js\ncode\n~~~\nstill inside\n```",
    ]);
    expect(result.tail).toBe("End.");
  });

  it("handles multiple blank lines as a single block separator", () => {
    const text = "Block A.\n\n\n\nBlock B.";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual(["Block A."]);
    expect(result.tail).toBe("Block B.");
  });

  it("keeps list items within the same block", () => {
    const text =
      "# Heading\n\n- Item 1\n- Item 2\n- Item 3\n\nFinal paragraph.";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual([
      "# Heading",
      "- Item 1\n- Item 2\n- Item 3",
    ]);
    expect(result.tail).toBe("Final paragraph.");
  });

  it("keeps an indented fenced child in an active list item", () => {
    const text = "- item\n\n  ```ts\n  code\n  ```\n\nAfter.";
    expect(splitMarkdownBlocks(text)).toEqual({
      completedBlocks: ["- item\n\n  ```ts\n  code\n  ```"],
      tail: "After.",
    });
  });

  it("handles a table block", () => {
    const text = "Intro.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nConclusion.";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual([
      "Intro.",
      "| A | B |\n|---|---|\n| 1 | 2 |",
    ]);
    expect(result.tail).toBe("Conclusion.");
  });

  it("handles a partial fence at end of stream (no closing marker)", () => {
    const text = "Text.\n\n```\npartial code";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual(["Text."]);
    expect(result.tail).toBe("```\npartial code");
  });

  it("handles text ending with a newline", () => {
    const text = "Block A.\n\nBlock B.\n";
    const result = splitMarkdownBlocks(text);
    // "Block B.\n" → trailing newline → last line is "" which is blank
    // so Block B is a completed block, tail is ""
    expect(result.completedBlocks).toEqual(["Block A.", "Block B."]);
    expect(result.tail).toBe("");
  });

  it("handles fence with extended opening marker (4+ backticks)", () => {
    const text = "Before.\n\n````ts\nsome code\n````\n\nAfter.";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual([
      "Before.",
      "````ts\nsome code\n````",
    ]);
    expect(result.tail).toBe("After.");
  });

  it("closing fence with fewer backticks than opening does not close", () => {
    // Opening is ```` (4), closing is ``` (3): does NOT close
    const text = "Intro.\n\n````ts\ncode\n```\nmore code\n````\n\nEnd.";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual([
      "Intro.",
      "````ts\ncode\n```\nmore code\n````",
    ]);
    expect(result.tail).toBe("End.");
  });
});

// ─── CRLF line endings ───────────────────────────────────────────────────────

describe("CRLF line endings", () => {
  it("splits two CRLF paragraphs separated by a blank CRLF line", () => {
    const text = "First.\r\n\r\nSecond.";
    const result = splitMarkdownBlocks(text);
    // The blank line "\r\n" splits on "\n" → "\r" which trimStart() reduces
    // to "" — so splitting is detected correctly.
    expect(result.completedBlocks).toHaveLength(1);
    expect(result.tail).toBe("Second.");
  });

  it("does not split on blank lines inside a CRLF fenced code block", () => {
    const text =
      "Before.\r\n\r\n```js\r\nconst a = 1;\r\n\r\nconst b = 2;\r\n```\r\n\r\nAfter.";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toHaveLength(2);
    expect(result.tail).toBe("After.");
  });

  it("treats an unterminated CRLF fence as part of the tail", () => {
    const text = "Before.\r\n\r\n```ts\r\nconst x = ";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toHaveLength(1);
    expect(result.tail).toContain("```ts");
  });
});

describe("joinMarkdownBlocks", () => {
  it("rejoins with double newlines to recover original structure", () => {
    const original = "First.\n\nSecond.\n\nThird.";
    const split = splitMarkdownBlocks(original);
    // joining gives "First.\n\nSecond.\n\nThird." — same structure
    expect(joinMarkdownBlocks(split)).toBe(original);
  });

  it("rejoins a single-block message", () => {
    const original = "Hello.";
    const split = splitMarkdownBlocks(original);
    expect(joinMarkdownBlocks(split)).toBe(original);
  });

  it("rejoins an empty split", () => {
    expect(joinMarkdownBlocks({ completedBlocks: [], tail: "" })).toBe("");
  });
});

/**
 * The split drives BOTH the streaming render and the final one, so rendering
 * the blocks separately must equal rendering the whole document. When these
 * diverged, streamed text was visibly wrong until the stream ended, and the
 * correction rebuilt the message's DOM — the flash and scroll jump users
 * reported. Add a case here before adding any new split rule.
 */
describe("split/whole render parity", () => {
  const CONSTRUCTS: Array<[string, string]> = [
    ["plain paragraphs", "First para.\n\nSecond para.\n\nThird."],
    ["heading + para", "# Title\n\nBody text here.\n\n## Sub\n\nMore."],
    ["tight list", "- a\n- b\n- c"],
    ["loose list", "- a\n\n- b\n\n- c"],
    ["ordered loose list", "1. a\n\n2. b"],
    ["list then para", "- a\n- b\n\nAfter the list."],
    ["nested list", "- a\n  - a1\n\n- b"],
    ["list with continuation para", "- a\n\n  continued para\n\n- b"],
    [
      "list with indented fenced code continuation",
      "- item\n\n  ```ts\n  code\n  ```\n\nAfter.",
    ],
    ["fenced code", "Intro\n\n```ts\nconst x = 1;\n```\n\nOutro"],
    ["fence with blank lines", "```ts\nconst a = 1;\n\nconst b = 2;\n```"],
    ["table", "| a | b |\n| - | - |\n| 1 | 2 |\n\nAfter."],
    ["blockquotes", "> one\n\n> two"],
    ["indented code", "Para\n\n    indented code\n\nAfter."],
    ["thematic break", "Above\n\n---\n\nBelow"],
    ["html block", "<div>hi</div>\n\nAfter."],
    ["setext heading", "Title\n=====\n\nBody"],
    ["reference link", "See [docs].\n\n[docs]: https://example.com"],
    ["reference link with id", "See [docs][d].\n\n[d]: https://example.com"],
    ["footnote", "Text[^1]\n\n[^1]: note"],
    ["indented code with blank line", "Intro\n\n    a\n\n    b\n\nAfter."],
    ["tab indented code with blank", "Intro\n\n\ta\n\n\tb\n\nAfter."],
    [
      "ts index signature in fence",
      "```ts\ntype X = {\n  [key: string]: string\n}\n```\n\npara two\n\npara three",
    ],
  ];

  it.each(CONSTRUCTS)(
    "renders %s identically split and whole",
    async (_name, text) => {
      const { default: ReactMarkdown } = await import("react-markdown");
      const { default: gfm } = await import("remark-gfm");
      const { renderToStaticMarkup } = await import("react-dom/server");
      const { createElement } = await import("react");

      const render = (md: string) =>
        renderToStaticMarkup(
          createElement(ReactMarkdown, { remarkPlugins: [gfm] }, md),
        );

      const split = splitMarkdownBlocks(text);
      const pieces = [...split.completedBlocks, split.tail].filter(Boolean);
      const joined = pieces.map(render).join("");

      const normalize = (html: string) => html.replace(/\s+/g, "");
      expect(normalize(joined)).toBe(normalize(render(text)));
    },
  );

  // A TypeScript index signature inside a fence looks exactly like a link
  // reference definition. Matching it disabled splitting for the whole message,
  // so every commit re-parsed the entire document.
  it("still splits a message whose fence contains a TS index signature", () => {
    const text =
      "```ts\ntype X = {\n  [key: string]: string\n}\n```\n\npara two\n\npara three";
    expect(splitMarkdownBlocks(text).completedBlocks.length).toBeGreaterThan(0);
  });

  it("declines to split a real reference definition", () => {
    const text = "See [docs].\n\n[docs]: https://example.com";
    expect(splitMarkdownBlocks(text)).toEqual({
      completedBlocks: [],
      tail: text,
    });
  });

  it("round-trips through joinMarkdownBlocks", () => {
    for (const [, text] of CONSTRUCTS) {
      const rejoined = joinMarkdownBlocks(splitMarkdownBlocks(text));
      expect(rejoined.replace(/\n{2,}/g, "\n\n").trim()).toBe(
        text.replace(/\n{2,}/g, "\n\n").trim(),
      );
    }
  });
});
