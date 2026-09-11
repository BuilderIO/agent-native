import { describe, expect, it } from "vitest";

import { extractDocxSections, sanitizeInertDocumentHtml } from "./docx.js";

describe("DOCX HTML ingestion", () => {
  it("keeps structural markup while removing active content and all attributes", () => {
    const html = sanitizeInertDocumentHtml(`
      <!doctype html>
      <h1 onclick="alert(1)">Launch <em style="color:red">plan</em></h1>
      <script>alert("script")</script>
      <p style="background:url(javascript:alert(1))">
        <a href="javascript:alert(1)">Body</a>
        <img src="x" onerror="alert(1)">
      </p>
      <svg><script>alert("svg")</script></svg>
    `);

    expect(html).toContain("<h1>Launch <em>plan</em></h1>");
    expect(html).toContain("<p>");
    expect(html).toContain("Body");
    expect(html).not.toMatch(
      /script|onclick|javascript:|onerror|style=|<img|<svg/i,
    );
  });

  it("sanitizes direct section extraction before HTML reaches metadata", () => {
    const sections = extractDocxSections(
      '<h2 data-source="unsafe">Overview</h2><p onmouseover="alert(1)">Safe text</p><iframe src="https://example.test"></iframe>',
    );

    expect(sections).toEqual([
      {
        heading: "Overview",
        content: "<p>Safe text</p>",
        html: "<p>Safe text</p>",
        text: "Safe text",
      },
    ]);
  });
});
