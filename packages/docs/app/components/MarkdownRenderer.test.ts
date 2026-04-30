import { describe, expect, it } from "vitest";
import { renderMarkdownToHtml } from "./MarkdownRenderer";

describe("renderMarkdownToHtml", () => {
  it("escapes raw HTML instead of rendering it", () => {
    const html = renderMarkdownToHtml('<img src=x onerror="alert(1)">');

    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror=");
  });

  it("drops unsafe markdown link and image URLs", () => {
    const html = renderMarkdownToHtml(
      "[run](javascript:alert(1)) ![bad](javascript:alert(1)) [encoded](javascript&#58;alert(1))",
    );

    expect(html).toContain("run");
    expect(html).toContain("encoded");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("javascript&#58;");
    expect(html).not.toContain("<img");
  });

  it("keeps normal links", () => {
    const html = renderMarkdownToHtml("[docs](/docs) [site](https://x.test)");

    expect(html).toContain('<a href="/docs">docs</a>');
    expect(html).toContain('<a href="https://x.test">site</a>');
  });
});
