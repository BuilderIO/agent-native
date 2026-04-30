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
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe(
      "<a>x</a>",
    );
    expect(sanitizeHtml('<a href="//evil.test">x</a>')).toBe("<a>x</a>");
  });
});
