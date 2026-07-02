import { describe, expect, it } from "vitest";

import {
  decodeCommonHtmlEntities,
  extractMarkdownUrls,
  markdownPreviewSnippet,
  normalizeMarkdownHardBreaks,
  renderInlineMarkdown,
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

  it("decodes editor-produced html entities for readable previews", () => {
    expect(markdownPreviewSnippet("Tom &amp; Jerry &lt;team&gt;", 80)).toBe(
      "Tom & Jerry <team>",
    );
  });
});

describe("decodeCommonHtmlEntities", () => {
  it("decodes common named and apostrophe entities", () => {
    expect(
      decodeCommonHtmlEntities(
        "A&amp;B &lt;tag&gt; &quot;hi&quot; &#39;ok&#39; a&nbsp;b",
      ),
    ).toBe("A&B <tag> \"hi\" 'ok' a b");
  });
});

describe("renderInlineMarkdown", () => {
  it("escapes html while rendering supported inline markdown", () => {
    expect(
      renderInlineMarkdown(
        "Hi <team>, **bold & safe**, *gentle*, and `<tag>`.",
      ),
    ).toBe(
      "Hi &lt;team&gt;, <strong>bold &amp; safe</strong>, <em>gentle</em>, and <code>&lt;tag&gt;</code>.",
    );
  });

  it("links markdown, autolink, and bare urls without swallowing punctuation", () => {
    const html = renderInlineMarkdown(
      "See [docs](https://example.com/docs?a=1&b=2), <https://example.com/a>, and https://example.com/path).",
    );

    expect(html).toContain(
      '<a href="https://example.com/docs?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">docs</a>,',
    );
    expect(html).not.toContain("&amp;amp;");
    expect(html).toContain(
      '<a href="https://example.com/a" target="_blank" rel="noopener noreferrer">https://example.com/a</a>,',
    );
    expect(html).toContain(
      '<a href="https://example.com/path" target="_blank" rel="noopener noreferrer">https://example.com/path</a>).',
    );
    expect(html).not.toContain("&gt;");
  });
});

describe("extractMarkdownUrls", () => {
  it("extracts unique markdown and bare urls while ignoring code spans", () => {
    expect(
      extractMarkdownUrls(
        "`https://ignore.example` [docs](https://example.com/docs), https://example.com/docs. <https://example.com/a>",
      ),
    ).toEqual(["https://example.com/docs", "https://example.com/a"]);
  });

  it("extracts bare-only urls with trailing punctuation trimmed", () => {
    expect(
      extractMarkdownUrls("Book here: https://calendar.example/book)."),
    ).toEqual(["https://calendar.example/book"]);
  });
});
