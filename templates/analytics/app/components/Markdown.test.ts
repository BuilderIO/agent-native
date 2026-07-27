import { describe, expect, it } from "vitest";

import { renderMarkdown } from "./Markdown";

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

  it("renders the hallucinated /chart shorthand as an inline SVG chart", () => {
    const html = renderMarkdown(
      '/chart type=bar title="Distinct Visitors" labels=["Mon","Tue","Wed"] data=[5,8,14] color=#6366f1',
    );

    expect(html).toContain("<svg");
    expect(html).toContain("Distinct Visitors");
    expect(html).not.toContain("/chart type=bar");
  });

  it("renders multi-series /chart shorthand data", () => {
    const html = renderMarkdown(
      '/chart type=bar title="PRs" labels=["Mar","Apr"] data=[{"label":"Created","data":[115,277],"color":"#6366f1"},{"label":"Merged","data":[103,258],"color":"#22c55e"}]',
    );

    expect(html).toContain("<svg");
    expect(html).toContain("Created");
    expect(html).toContain("Merged");
  });

  it("renders the exact PRs shorthand reported in chat", () => {
    const html = renderMarkdown(
      '/chart type=bar title="PRs Created vs Merged by Month" labels=["Mar","Apr","May"] data=[{"label":"PRs Created","data":[115,277,588],"color":"#6366f1"},{"label":"PRs Merged","data":[103,258,580],"color":"#22c55e"}]',
    );

    expect(html).toContain("<svg");
    expect(html).toContain("PRs Created");
    expect(html).toContain("PRs Merged");
    expect(html).not.toContain("/chart type=bar");
  });

  it("falls back to plain text when the shorthand cannot be parsed", () => {
    const html = renderMarkdown(
      '/chart type=bar title="broken" labels=[ data=[1,2]',
    );

    expect(html).not.toContain("<svg");
    expect(html).toContain("<p>");
  });
});
