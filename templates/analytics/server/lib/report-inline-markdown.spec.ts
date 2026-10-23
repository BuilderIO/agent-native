import { describe, expect, it } from "vitest";

import {
  reportInlineMarkdownHtml,
  safeReportLinkHref,
} from "./report-inline-markdown";

const BASE = "https://analytics.example.com/dashboards/repo-health";
const options = { baseUrl: BASE, linkStyle: "L", codeStyle: "C" };
const render = (markdown: string) =>
  reportInlineMarkdownHtml(markdown, options);

describe("reportInlineMarkdownHtml", () => {
  it("renders markdown links and bare URLs as links", () => {
    expect(
      render("[#8067](https://github.com/o/r/pull/8067) needs a review"),
    ).toBe(
      '<a href="https://github.com/o/r/pull/8067" style="L">#8067</a> needs a review',
    );
    expect(render("See https://example.com/a.")).toBe(
      'See <a href="https://example.com/a" style="L">https://example.com/a</a>.',
    );
    expect(render("(https://example.com/a)")).toBe(
      '(<a href="https://example.com/a" style="L">https://example.com/a</a>)',
    );
  });

  it("resolves a relative link against the dashboard's origin", () => {
    expect(render("[Open PRs](/dashboards/prs)")).toBe(
      '<a href="https://analytics.example.com/dashboards/prs" style="L">Open PRs</a>',
    );
  });

  it("shows the text of a link it will not follow", () => {
    expect(render("[click](javascript:alert(1))")).toBe("click");
    expect(render("[x](//evil.example.com)")).toBe("x");
    expect(render("[x](/_agent-native/actions/run)")).toBe("x");
    expect(
      reportInlineMarkdownHtml("[x](/dashboards/prs)", {
        ...options,
        baseUrl: undefined,
      }),
    ).toBe("x");
  });

  it("renders bold and code and escapes everything else", () => {
    expect(render("**3 PRs** wait on `main`")).toBe(
      '<strong>3 PRs</strong> wait on <code style="C">main</code>',
    );
    expect(render('<img src=x onerror="alert(1)"> & more')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; more",
    );
    expect(render('[<b>x</b>](https://example.com/?a=1&b="2")')).toBe(
      '<a href="https://example.com/?a=1&amp;b=&quot;2&quot;" style="L">&lt;b&gt;x&lt;/b&gt;</a>',
    );
  });

  it("keeps escaped and unmatched marks as text", () => {
    expect(render("\\*\\*not bold\\*\\* and \\[not a link\\](x)")).toBe(
      "**not bold** and [not a link](x)",
    );
    expect(render("a ` lone tick and [an open bracket")).toBe(
      "a ` lone tick and [an open bracket",
    );
  });
});

describe("safeReportLinkHref", () => {
  it("allows only http and https", () => {
    expect(safeReportLinkHref("https://example.com", BASE)).toBe(
      "https://example.com",
    );
    expect(safeReportLinkHref("mailto:a@example.com", BASE)).toBeNull();
    expect(safeReportLinkHref("data:text/html,x", BASE)).toBeNull();
    expect(safeReportLinkHref("", BASE)).toBeNull();
  });
});
