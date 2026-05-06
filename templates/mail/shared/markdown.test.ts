import { describe, expect, it } from "vitest";
import {
  decodeCommonHtmlEntities,
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
