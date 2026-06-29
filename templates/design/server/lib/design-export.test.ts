import { describe, expect, it } from "vitest";

import { buildStandaloneHtml, buildSvgForeignObject } from "./design-export";

describe("design export helpers", () => {
  it("escapes closing style tags when bundling CSS into standalone HTML", () => {
    const html = buildStandaloneHtml({
      title: "Export",
      files: [
        {
          filename: "index.html",
          fileType: "html",
          content: "<!doctype html><html><head></head><body></body></html>",
        },
        {
          filename: "styles.css",
          fileType: "css",
          content: ".note::after { content: '</style>'; }",
        },
      ],
    });

    expect(html).toContain("content: '<\\/style>'");
  });

  it("wraps script and style contents in CDATA for SVG foreignObject exports", () => {
    const svg = buildSvgForeignObject({
      width: 320,
      height: 200,
      title: "SVG",
      html: "<style>.a::before { content: '<'; }</style><script>if (a && b) draw('<x>')</script>",
    });

    expect(svg).toContain("<![CDATA[");
    expect(svg).toContain("//<![CDATA[");
    expect(svg).toContain('xmlns="http://www.w3.org/1999/xhtml"');
  });
});
