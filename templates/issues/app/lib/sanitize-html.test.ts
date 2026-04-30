// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "./sanitize-html";

describe("sanitizeHtml", () => {
  it("strips script tags and event handlers", () => {
    const html = sanitizeHtml(
      '<p onclick="alert(1)">hello</p><script>alert(1)</script>',
    );

    expect(html).toContain("<p>hello</p>");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("<script");
  });

  it("removes unsafe link targets", () => {
    // The DOM-based sanitizer rebuilds <a> tags and forces target=_blank
    // + rel=noopener, so we just verify the unsafe href is stripped.
    const out1 = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out1).not.toContain("href=");
    expect(out1).toContain(">x</a>");

    const out2 = sanitizeHtml('<a href="//evil.test">x</a>');
    expect(out2).not.toContain("evil.test");
    expect(out2).toContain(">x</a>");
  });

  it("forces external links to open in a new tab with rel=noopener", () => {
    const out = sanitizeHtml('<a href="https://example.com">x</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it("strips iframe payloads entirely", () => {
    const out = sanitizeHtml(
      '<p>before</p><iframe srcdoc="<script>alert(1)</script>"></iframe><p>after</p>',
    );
    expect(out).not.toContain("iframe");
    expect(out).not.toContain("script");
    expect(out).toContain("<p>before</p>");
    expect(out).toContain("<p>after</p>");
  });

  it("strips svg payloads entirely", () => {
    const out = sanitizeHtml(
      "<p>note</p><svg><foreignObject><script>alert(1)</script></foreignObject></svg>",
    );
    expect(out).not.toContain("svg");
    expect(out).not.toContain("foreignObject");
    expect(out).not.toContain("script");
    expect(out).toContain("<p>note</p>");
  });

  it("strips srcdoc/srcset on allowed tags", () => {
    const out = sanitizeHtml(
      '<img src="https://x.com/y.png" srcset="data:..." srcdoc="<script>x</script>">',
    );
    expect(out).not.toContain("srcdoc");
    expect(out).not.toContain("srcset");
    expect(out).toContain('src="https://x.com/y.png"');
  });
});
