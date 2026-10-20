import { describe, expect, it } from "vitest";

import { decodeGmailSnippet } from "./gmail-snippet.js";

describe("decodeGmailSnippet", () => {
  it("decodes named entities", () => {
    expect(
      decodeGmailSnippet(
        "A&amp;B &lt;tag&gt; &quot;hi&quot; it&apos;s a&nbsp;b",
      ),
    ).toBe('A&B <tag> "hi" it\'s a b');
  });

  it("decodes decimal and hex numeric entities", () => {
    expect(
      decodeGmailSnippet("I&#39;ve &#8220;done&#8221; it &#x2014; &#X1F600;"),
    ).toBe("I've “done” it — \u{1F600}");
    expect(decodeGmailSnippet("it&#x27;s &#xe9;t&#xE9;")).toBe("it's été");
  });

  it("decodes double-escaped text only one level", () => {
    expect(
      decodeGmailSnippet("write &amp;lt;div&amp;gt; &amp;amp; &amp;#39;"),
    ).toBe("write &lt;div&gt; &amp; &#39;");
  });

  it("leaves unknown entities and invalid code points as written", () => {
    expect(
      decodeGmailSnippet(
        "&copy; &#0; &#xD800; &#1114112; &#x110000; &amp &#39",
      ),
    ).toBe("&copy; &#0; &#xD800; &#1114112; &#x110000; &amp &#39");
  });
});
