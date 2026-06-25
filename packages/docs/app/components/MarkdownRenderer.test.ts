import { describe, expect, it } from "vitest";

import {
  renderMarkdownToHtml,
  resolveRenderedMarkdownHtml,
  resolveCodeBlockLanguage,
} from "./MarkdownRenderer";

describe("renderMarkdownToHtml", () => {
  it("escapes raw HTML instead of rendering it", () => {
    const html = renderMarkdownToHtml('<img src=x onerror="alert(1)">');

    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
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

  it("renders known docs images with reserved dimensions", () => {
    const html = renderMarkdownToHtml("![Mail inbox](/screenshots/mail.png)");

    expect(html).toContain('class="docs-image-frame"');
    expect(html).toContain("aspect-ratio: 1400 / 710");
    expect(html).toContain('class="docs-image"');
    expect(html).toContain('width="1400"');
    expect(html).toContain('height="710"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });

  it("infers markdown highlighting for generic markdown-like snippets", () => {
    const html = renderMarkdownToHtml(`
\`\`\`text
<!-- context/company.md -->

# Company

- Company: Example Co
- Product: Agent-native workspace for internal teams
\`\`\`
`);

    expect(html).toContain('class="language-markdown"');
    expect(html).not.toContain('class="language-text"');
  });

  it("infers useful languages for bare code fences", () => {
    expect(resolveCodeBlockLanguage(undefined, "pnpm test")).toBe("bash");
    expect(resolveCodeBlockLanguage(undefined, '{"ok": true}')).toBe("json");
    expect(
      resolveCodeBlockLanguage(undefined, "import { z } from 'zod';"),
    ).toBe("typescript");
  });

  it("normalizes explicit language aliases and metadata", () => {
    expect(resolveCodeBlockLanguage("md", "# Docs")).toBe("markdown");
    expect(
      resolveCodeBlockLanguage('ts title="example.ts"', "const x = 1"),
    ).toBe("typescript");
  });
});

describe("resolveRenderedMarkdownHtml", () => {
  it("ignores highlighted HTML generated for a previous markdown render", () => {
    expect(
      resolveRenderedMarkdownHtml('<h2 id="second">Second</h2>', {
        sourceHtml: '<h2 id="first">First</h2>',
        html: '<h2 id="first" class="highlighted">First</h2>',
      }),
    ).toBe('<h2 id="second">Second</h2>');
  });
});
