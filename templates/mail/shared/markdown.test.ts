import { describe, expect, it } from "vitest";
import {
  markdownPreviewSnippet,
  normalizeMarkdownHardBreaks,
} from "./markdown.js";

describe("normalizeMarkdownHardBreaks", () => {
  it("removes CommonMark hard-break backslashes from prose lines", () => {
    expect(normalizeMarkdownHardBreaks("first\\\nsecond")).toBe(
      "first\nsecond",
    );
    expect(normalizeMarkdownHardBreaks("first\\\r\nsecond")).toBe(
      "first\nsecond",
    );
  });

  it("preserves trailing backslashes inside fenced code blocks", () => {
    const markdown = "Text\\\nnext\n\n```sh\necho one \\\necho two\n```";

    expect(normalizeMarkdownHardBreaks(markdown)).toBe(
      "Text\nnext\n\n```sh\necho one \\\necho two\n```",
    );
  });
});

describe("markdownPreviewSnippet", () => {
  it("builds single-line previews without hard-break backslashes", () => {
    expect(markdownPreviewSnippet("first\\\nsecond", 80)).toBe("first second");
  });
});
