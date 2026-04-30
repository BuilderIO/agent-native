// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  sanitizeCssValue,
  sanitizeSlideHtml,
  sanitizeSlideUrl,
} from "./sanitize-slide-html";

describe("sanitizeSlideHtml", () => {
  it("strips scripts, handlers, and unsafe urls", () => {
    const html = sanitizeSlideHtml(
      '<div onclick="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">x</a><img src="java&#x0a;script:alert(1)"></div>',
    );

    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<a");
    expect(html).toContain('target="_blank"');
  });

  it("keeps layout styles but removes css url injection", () => {
    expect(
      sanitizeSlideHtml(
        '<div class="fmd-slide" style="display:flex;color:#fff">ok</div>',
      ),
    ).toContain("display: flex");

    const html = sanitizeSlideHtml(
      '<div class="fmd-slide" style="display:flex;background:url(javascript:alert(1));color:#fff">ok</div>',
    );

    expect(html).not.toContain("url(");
    expect(html).not.toContain("javascript:");
  });

  it("sanitizes generated presentation style blocks", () => {
    const html = sanitizeSlideHtml(
      '<style>[data-pstep="0"] { opacity: 0; background: url(https://x.test/t.png); }</style><div>ok</div>',
    );

    expect(html).toContain("opacity: 0");
    expect(html).not.toContain("url(");
  });
});

describe("sanitizeSlideUrl", () => {
  it("allows safe image urls and rejects unsafe protocols", () => {
    expect(sanitizeSlideUrl("https://example.com/a.png", "image")).toBe(
      "https://example.com/a.png",
    );
    expect(sanitizeSlideUrl("javascript:alert(1)", "image")).toBeNull();
  });
});

describe("sanitizeCssValue", () => {
  it("rejects css url values", () => {
    expect(sanitizeCssValue("linear-gradient(red, blue)")).toBe(
      "linear-gradient(red, blue)",
    );
    expect(sanitizeCssValue("url(https://example.com/a.png)")).toBeNull();
  });
});
