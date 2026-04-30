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
});
