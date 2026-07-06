import { describe, expect, it } from "vitest";

import {
  buildStandaloneHtml,
  buildSvgForeignObject,
  HIDDEN_LAYER_EXPORT_CSS,
  injectHiddenLayerExportStyle,
} from "./design-export";

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

  it("merges multi-file HTML screens by extracting body content", () => {
    const html = buildStandaloneHtml({
      title: "Export",
      files: [
        {
          filename: "index.html",
          fileType: "html",
          content: "<!doctype html><html><body><h1>One</h1></body></html>",
        },
        {
          filename: "screen-2.html",
          fileType: "html",
          content:
            "<!doctype html><html><head><title>Two</title></head><body><p>Two</p></body></html>",
        },
      ],
    });

    expect(html).not.toContain(
      "<!doctype html><html><head><title>Two</title></head>",
    );
    expect(html).toContain("<h1>One</h1>");
    expect(html).toContain("<p>Two</p>");
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

  it("injects a display:none rule for hidden layers into standalone exports (doctype path)", () => {
    const html = buildStandaloneHtml({
      title: "Export",
      files: [
        {
          filename: "index.html",
          fileType: "html",
          content:
            '<!doctype html><html><head></head><body><div data-agent-native-hidden="true">secret</div></body></html>',
        },
      ],
    });

    expect(html).toContain(HIDDEN_LAYER_EXPORT_CSS);
  });

  it("injects a display:none rule for hidden layers into standalone exports (synthesized document path)", () => {
    const html = buildStandaloneHtml({
      title: "Export",
      files: [
        {
          filename: "screen.html",
          fileType: "html",
          content: '<div data-agent-native-hidden="true">secret</div>',
        },
      ],
    });

    expect(html).toContain(HIDDEN_LAYER_EXPORT_CSS);
  });

  it("injectHiddenLayerExportStyle is idempotent and inserts before </head>", () => {
    const once = injectHiddenLayerExportStyle(
      "<html><head><title>x</title></head><body></body></html>",
    );
    const twice = injectHiddenLayerExportStyle(once);

    expect(once.match(/data-agent-native-export-hidden/g)).toHaveLength(1);
    expect(twice.match(/data-agent-native-export-hidden/g)).toHaveLength(1);
    expect(once.indexOf(HIDDEN_LAYER_EXPORT_CSS)).toBeLessThan(
      once.indexOf("</head>"),
    );
  });

  it("injectHiddenLayerExportStyle prepends when there is no </head>", () => {
    const html = injectHiddenLayerExportStyle("<div>no head here</div>");
    expect(html.indexOf(HIDDEN_LAYER_EXPORT_CSS)).toBe(
      html.indexOf(HIDDEN_LAYER_EXPORT_CSS),
    );
    expect(html.startsWith("<style")).toBe(true);
  });
});
