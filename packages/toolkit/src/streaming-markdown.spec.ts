import { describe, expect, it } from "vitest";

import {
  markdownBlockOffsets,
  settleStreamingMarkdown,
} from "./streaming-markdown.js";

const streamed = (text: string) => settleStreamingMarkdown(text, true);

describe("settleStreamingMarkdown hold-back", () => {
  it.each([
    ["bold", "Ready: **very bold", "Ready: **very bold**"],
    ["bold before a space", "Ready: **very bold ", "Ready: **very bold** "],
    ["underscore bold", "Ready: __very bold", "Ready: __very bold__"],
    ["italic", "An *emphasized phrase", "An *emphasized phrase*"],
    ["underscore italic", "An _emphasized phrase", "An _emphasized phrase_"],
    ["strikethrough", "Was ~~the old plan", "Was ~~the old plan~~"],
    ["nested emphasis", "A **bold and *italic", "A **bold and *italic***"],
    [
      "inline code",
      "Run `pnpm install --frozen",
      "Run `pnpm install --frozen`",
    ],
    ["code inside bold", "**Run `pnpm", "**Run `pnpm`**"],
    ["bold in a table header", "| **Na", "| **Na**\n| --- |"],
  ])("closes an unclosed %s at the tail", (_name, text, visible) => {
    expect(streamed(text)).toBe(visible);
  });

  it.each([
    ["link text", "See [the release", "See "],
    ["link without target yet", "See [the release notes]", "See "],
    ["link target", "See [the notes](https://example.com/rel", "See "],
    ["image", "Logo ![brand mark](https://example.com/logo", "Logo "],
    ["autolink", "Visit <https://example.com/pa", "Visit "],
    ["trailing delimiter run", "Next up **", "Next up "],
    ["fence opening line", "Code:\n```type", "Code:\n"],
    [
      "table header",
      "| Name | Value |\n| --",
      "| Name | Value |\n| --- | --- |",
    ],
    ["half table header", "| Name | Val", "| Name | Val\n| --- | --- |"],
    ["table header with no word yet", "Intro\n\n| ", "Intro\n\n"],
    ["rows of pipes with no delimiter", "| a | b |\n| c | d", ""],
    [
      "table row with no word yet",
      "| A | B |\n| - | - |\n| 1 | 2 |\n| ",
      "| A | B |\n| - | - |\n| 1 | 2 |\n",
    ],
    ["bare list marker", "- First item\n- ", "- First item\n"],
    ["bare heading marker", "Intro\n##", "Intro\n"],
    ["rule or setext underline", "Title\n--", "Title\n"],
  ])("holds back an unclosed %s", (_name, text, visible) => {
    expect(streamed(text)).toBe(visible);
  });

  it.each([
    "Ready: **very bold** and done",
    "An *emphasized* phrase and `code` here",
    "See [the notes](https://example.com/a_(b)) now",
    "Visit <https://example.com> now",
    "5 * 3 = 15 and 2 * 4 = 8",
    "Use snake_case_names freely",
    "Price is ~5 minutes away",
    "- item one\n- item two",
    "| A | B |\n| - | - |\n| 1 | 2 |\n| 3 |",
    "| A | B |\n| - | - |\n| 1 | first words of a ce",
    "```ts\nconst a = **b",
    "Done with **bold**",
    "Escaped \\*\\* stays",
  ])("passes closed or literal syntax through: %s", (text) => {
    expect(streamed(text)).toBe(text);
  });

  it("does not continue inline syntax across a block boundary", () => {
    expect(streamed("- an **unclosed item\n- next item")).toBe(
      "- an **unclosed item\n- next item",
    );
  });

  it("streams a long bold run already bold instead of holding it", () => {
    const tail = "word ".repeat(80);
    expect(streamed(`Start **${tail}`)).toBe(`Start **${tail.trimEnd()}** `);
  });

  it("never shows content beyond the text, and each prefix only grows", () => {
    const final = [
      "## Plan",
      "",
      "Use **bold**, *emphasis*, `code`, and [a link](https://example.com/x).",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "```ts",
      "const ready = true;",
      "```",
      "",
      "- one",
      "- two",
    ].join("\n");
    let previous = "";
    for (let end = 0; end <= final.length; end += 1) {
      // Closers and a header's early delimiter row are the only characters
      // beyond the text.
      const settled = streamed(final.slice(0, end));
      const visible = final.startsWith(settled)
        ? settled
        : settled
            .replace(/\n(?:\| --- )+\|$/, "")
            .replace(/[*_~`]+(\s*)$/, "$1");
      expect(final.startsWith(visible)).toBe(true);
      // Only syntax still open is held, so the shown prefix never jumps back
      // past text that was already settled outside a construct.
      if (!visible.startsWith(previous)) {
        expect(previous.length - visible.length).toBeLessThan(40);
      }
      previous = visible;
    }
    expect(settleStreamingMarkdown(final, false)).toBe(final);
    expect(streamed(final)).toBe(final);
  });

  it("keeps every character of a finished message, escaping unmatched strong", () => {
    expect(settleStreamingMarkdown("**Hello, AgentKit", false)).toBe(
      "\\*\\*Hello, AgentKit",
    );
  });
});

describe("markdownBlockOffsets", () => {
  it("locates each block inside the text", () => {
    const text = "One.\n\nTwo two.\n\n\nThree";
    expect(markdownBlockOffsets(text, ["One.", "Two two.", "Three"])).toEqual([
      0, 6, 17,
    ]);
  });
});
