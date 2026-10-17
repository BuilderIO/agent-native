import { describe, expect, it } from "vitest";

import { renderInlineLinks, renderMarkdown } from "./Markdown";

describe("renderMarkdown", () => {
  it("escapes raw HTML", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');

    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });

  it("blocks encoded unsafe link protocols", () => {
    const html = renderMarkdown(
      "[one](javascript:alert(1)) [two](javascript&#58;alert(1)) [three](java&#x0a;script:alert(1))",
    );

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("javascript&#58;");
    expect(html).toContain('href="#"');
  });

  it("keeps safe http links", () => {
    expect(renderMarkdown("[site](https://example.com)")).toContain(
      'href="https://example.com"',
    );
  });

  it("renders same-origin embed fences as iframes", () => {
    const html = renderMarkdown(
      [
        "```embed",
        "src: /api/media/chart.png",
        "title: Revenue chart",
        "aspect: 4/3",
        "```",
      ].join("\n"),
    );

    expect(html).toContain('<iframe src="/api/media/chart.png"');
    expect(html).toContain('title="Revenue chart"');
    expect(html).not.toContain("<pre>");
  });

  it("blocks cross-origin embed fences", () => {
    const html = renderMarkdown(
      ["```embed", "src: https://example.com/chart", "```"].join("\n"),
    );

    expect(html).toContain("Embed blocked");
    expect(html).not.toContain("<iframe");
  });
});

describe("renderInlineLinks", () => {
  it("renders safe Markdown links and escapes surrounding text", () => {
    const html = renderInlineLinks(
      "<b>Read</b> [the docs](https://example.com/metrics) now",
    );

    expect(html).toContain("&lt;b&gt;Read&lt;/b&gt;");
    expect(html).toContain(
      '<a href="https://example.com/metrics" target="_blank" rel="noopener noreferrer"',
    );
    expect(html).toContain(">the docs</a> now");
  });

  it("keeps unsafe links and image syntax as escaped text", () => {
    const html = renderInlineLinks(
      "[bad](javascript:alert(1)) ![image](https://example.com/image.png)",
    );

    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<img ");
    expect(html).toContain("[bad](javascript:alert(1))");
    expect(html).toContain("![image](https://example.com/image.png)");
  });
});
