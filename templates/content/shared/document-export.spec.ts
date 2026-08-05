import { describe, expect, it } from "vitest";

import {
  buildDocumentExport,
  exportFilename,
  markdownWithTitle,
} from "./document-export";
import { KATEX_STYLESHEET_URL } from "./math-rendering";

describe("document export", () => {
  it("creates stable filenames from page titles", () => {
    expect(exportFilename("Q2 Launch / PRD", "markdown")).toBe(
      "q2-launch-prd.md",
    );
    expect(exportFilename("", "pdf")).toBe("untitled.pdf");
  });

  it("adds the page title to markdown without duplicating an existing H1", () => {
    expect(markdownWithTitle("Roadmap", "First paragraph")).toBe(
      "# Roadmap\n\nFirst paragraph\n",
    );
    expect(markdownWithTitle("Roadmap", "# Roadmap\n\nFirst paragraph")).toBe(
      "# Roadmap\n\nFirst paragraph\n",
    );
  });

  it("escapes user-authored HTML in portable HTML exports", () => {
    const exportPayload = buildDocumentExport({
      id: "doc_123",
      title: "Launch <Plan>",
      content: "<script>alert('x')</script>\n\n**Ship it**",
      format: "html",
    });

    expect(exportPayload.filename).toBe("launch-plan.html");
    expect(exportPayload.content).toContain("Launch &lt;Plan&gt;");
    expect(exportPayload.content).toContain("&lt;script&gt;");
    expect(exportPayload.content).not.toContain("<script>");
    expect(exportPayload.content).toContain("<strong>Ship it</strong>");
  });

  it("renders inline and block math in standalone HTML exports", () => {
    const exportPayload = buildDocumentExport({
      id: "doc_123",
      title: "Equations",
      content: [
        "Inline $E = mc^2$.",
        "",
        "$$",
        "\\int_0^1 x^2 dx = \\frac{1}{3}",
        "$$",
      ].join("\n"),
      format: "html",
    });

    expect(exportPayload.content).toContain(`href="${KATEX_STYLESHEET_URL}"`);
    expect(exportPayload.content).toContain('class="math-inline"');
    expect(exportPayload.content).toContain('class="math-block"');
    expect(exportPayload.content).toContain('class="katex"');
    expect(exportPayload.content).toContain('class="katex-display"');
    expect(exportPayload.content).not.toContain("$E = mc^2$");
  });

  it("renders inline math inside emphasis and links", () => {
    const exportPayload = buildDocumentExport({
      id: "doc_123",
      title: "Styled equations",
      content: [
        "**Energy is $E = mc^2$ here.**",
        "",
        "[Solve *$x^2 = 4$*](https://example.com/solve)",
      ].join("\n"),
      format: "html",
    });

    expect(exportPayload.content).toMatch(
      /<strong>Energy is <span class="math-inline">.*<\/span> here\.<\/strong>/,
    );
    expect(exportPayload.content).toMatch(
      /<a href="https:\/\/example\.com\/solve">Solve <em><span class="math-inline">.*<\/span><\/em><\/a>/,
    );
    expect(exportPayload.content).not.toContain("**Energy");
    expect(exportPayload.content).not.toContain("[Solve");
  });

  it("keeps equation delimiters literal inside code spans", () => {
    const exportPayload = buildDocumentExport({
      id: "doc_123",
      title: "Equation source",
      content: [
        "Use ``$`E = mc^2`$`` to write inline math.",
        "",
        "`before` $`x^2`$ `after`",
      ].join("\n"),
      format: "html",
    });

    expect(exportPayload.content).toContain("<code>$`E = mc^2`$</code>");
    expect(exportPayload.content).toContain("<code>before</code>");
    expect(exportPayload.content).toContain("<code>after</code>");
    expect(exportPayload.content.match(/class="math-inline"/g)).toHaveLength(1);
  });

  it("renders GitHub-style inline math as a backwards-compatible alias", () => {
    const exportPayload = buildDocumentExport({
      id: "doc_123",
      title: "Legacy equation",
      content: "Inline $`E = mc^2`$.",
      format: "html",
    });

    expect(exportPayload.content).toContain('class="math-inline"');
    expect(exportPayload.content).not.toContain("$`E = mc^2`$");
  });

  it("does not tokenize escaped math or code delimiters", () => {
    const exportPayload = buildDocumentExport({
      id: "doc_123",
      title: "Escaped delimiters",
      content: [
        "Escaped math: \\$`x^2`$.",
        "Escaped code: \\`not code\\`.",
        "Even parity still renders: \\\\$`y^2`$ and \\\\`code`.",
      ].join("\n\n"),
      format: "html",
    });

    expect(exportPayload.content).toContain("\\$`x^2`$");
    expect(exportPayload.content).toContain("\\`not code\\`");
    expect(exportPayload.content.match(/class="math-inline"/g)).toHaveLength(1);
    expect(exportPayload.content).toContain("<code>code</code>");
  });

  it("allows a code span to end after a literal backslash", () => {
    const exportPayload = buildDocumentExport({
      id: "doc_123",
      title: "Code path",
      content: "Use `path\\` as the value.",
      format: "html",
    });

    expect(exportPayload.content).toContain("<code>path\\</code>");
  });

  it("localizes malformed math to its first closing delimiter", () => {
    const exportPayload = buildDocumentExport({
      id: "doc_123",
      title: "Malformed math",
      content: "Broken $`\\`$ then `code` and valid $`x^2`$.",
      format: "html",
    });

    expect(
      exportPayload.content.match(/class="math-error math-error-inline"/g),
    ).toHaveLength(1);
    expect(exportPayload.content).toContain("<code>code</code>");
    expect(exportPayload.content.match(/class="math-inline"/g)).toHaveLength(1);
  });

  it("keeps indented block equations inside their list items", () => {
    const exportPayload = buildDocumentExport({
      id: "doc_123",
      title: "Nested equations",
      content: [
        "- Pythagoras",
        "",
        "  $$",
        "  x^2 + y^2 = z^2",
        "  $$",
        "- Finished",
      ].join("\n"),
      format: "html",
    });

    expect(exportPayload.content).toMatch(
      /<ul>\s*<li><p>Pythagoras<\/p>\s*<div class="math-block">.*<\/div><\/li>\s*<li>Finished<\/li>\s*<\/ul>/,
    );
    expect(exportPayload.content).not.toMatch(
      /<\/ul>\s*<div class="math-block">/,
    );
  });

  it("keeps same-marker nested bullets inside their parent item", () => {
    const exportPayload = buildDocumentExport({
      id: "doc_123",
      title: "Nested bullets",
      content: ["- Parent", "  - Child", "    - Grandchild", "- Sibling"].join(
        "\n",
      ),
      format: "html",
    });

    expect(exportPayload.content).toMatch(
      /<ul>\s*<li><p>Parent<\/p>\s*<ul>\s*<li><p>Child<\/p>\s*<ul>\s*<li>Grandchild<\/li>\s*<\/ul><\/li>\s*<\/ul><\/li>\s*<li>Sibling<\/li>\s*<\/ul>/,
    );
  });

  it("keeps tab-indented NFM bullets inside their parent item", () => {
    const exportPayload = buildDocumentExport({
      id: "doc_123",
      title: "Nested NFM bullets",
      content: ["- Parent", "\t- Child", "\t\t- Grandchild", "- Sibling"].join(
        "\n",
      ),
      format: "html",
    });

    expect(exportPayload.content).toMatch(
      /<ul>\s*<li><p>Parent<\/p>\s*<ul>\s*<li><p>Child<\/p>\s*<ul>\s*<li>Grandchild<\/li>\s*<\/ul><\/li>\s*<\/ul><\/li>\s*<li>Sibling<\/li>\s*<\/ul>/,
    );
  });

  it("keeps canonical math source in Markdown exports", () => {
    const source = "Inline $E = mc^2$.\n\n$$\nx^2\n$$";
    const exportPayload = buildDocumentExport({
      id: "doc_123",
      title: "Equations",
      content: source,
      format: "markdown",
    });

    expect(exportPayload.content).toBe(`# Equations\n\n${source}\n`);
    expect(exportPayload.content).not.toContain('class="katex"');
  });

  it("preserves invalid math as visible source in HTML exports", () => {
    const exportPayload = buildDocumentExport({
      id: "doc_123",
      title: "Broken equation",
      content: "Inline $\\frac{$.",
      format: "html",
    });

    expect(exportPayload.content).toContain("math-error-inline");
    expect(exportPayload.content).toContain("$\\frac{$");
    expect(exportPayload.content).toContain("KaTeX parse error");
  });

  it("does not emit trusted links from math commands", () => {
    const exportPayload = buildDocumentExport({
      id: "doc_123",
      title: "Untrusted equation",
      content: "$\\href{javascript:alert(1)}{unsafe}$",
      format: "html",
    });

    expect(exportPayload.content).not.toContain('href="javascript:');
  });

  it("strips unsafe link targets from HTML exports", () => {
    const exportPayload = buildDocumentExport({
      id: "doc_123",
      title: "Links",
      content: "[bad](javascript:alert(1)) ![bad](javascript:alert(1))",
      format: "html",
    });

    expect(exportPayload.content).toContain('<a href="#">bad</a>');
    expect(exportPayload.content).toContain('<img src="#" alt="bad" />');
    expect(exportPayload.content).not.toContain("javascript:");
  });

  it("renders <empty-block/> as <p>&nbsp;</p> in HTML exports", () => {
    const exportPayload = buildDocumentExport({
      id: "doc_123",
      title: "Spacing",
      content: "First line\n<empty-block/>\nSecond line",
      format: "html",
    });

    expect(exportPayload.content).toContain("<p>First line</p>");
    expect(exportPayload.content).toContain("<p>&nbsp;</p>");
    expect(exportPayload.content).toContain("<p>Second line</p>");
    expect(exportPayload.content).not.toContain("<empty-block");
    expect(exportPayload.content).not.toContain("&lt;empty-block");
    expect(exportPayload.content).not.toContain("<br/>");
  });

  it("renders consecutive empty blocks as separate paragraphs", () => {
    const exportPayload = buildDocumentExport({
      id: "doc_123",
      title: "Spacing",
      content: "Top\n<empty-block/>\n<empty-block/>\nBottom",
      format: "html",
    });

    expect(exportPayload.content.match(/<p>&nbsp;<\/p>/g)).toHaveLength(2);
    expect(exportPayload.content).toContain("<p>Top</p>");
    expect(exportPayload.content).toContain("<p>Bottom</p>");
    expect(exportPayload.content).not.toContain("<empty-block");
  });

  it("marks PDF exports as print-ready HTML with a PDF filename", () => {
    const exportPayload = buildDocumentExport({
      id: "doc_123",
      title: "Board Notes",
      content: "Agenda",
      format: "pdf",
    });

    expect(exportPayload.filename).toBe("board-notes.pdf");
    expect(exportPayload.mimeType).toBe("text/html;charset=utf-8");
    expect(exportPayload.print).toBe(true);
    expect(exportPayload.content).toContain("@media print");
  });

  it("renders math in PDF-ready HTML", () => {
    const exportPayload = buildDocumentExport({
      id: "doc_123",
      title: "Equation handout",
      content: "$$\nx^2 + y^2 = z^2\n$$",
      format: "pdf",
    });

    expect(exportPayload.content).toContain(`href="${KATEX_STYLESHEET_URL}"`);
    expect(exportPayload.content).toContain('class="katex-display"');
  });
});
