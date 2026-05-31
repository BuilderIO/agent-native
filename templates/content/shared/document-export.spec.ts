import { describe, expect, it } from "vitest";
import {
  buildDocumentExport,
  exportFilename,
  markdownWithTitle,
} from "./document-export";

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
});
