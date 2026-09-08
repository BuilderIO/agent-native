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

  it("keeps complex styles in CDATA while removing executable scripts", () => {
    const svg = buildSvgForeignObject({
      width: 320,
      height: 200,
      title: "SVG",
      html: "<style>.a::before { content: '<'; }</style><script>if (a && b) draw('<x>')</script>",
    });

    expect(svg).toContain("<![CDATA[");
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("draw(");
    expect(svg).toContain('xmlns="http://www.w3.org/1999/xhtml"');
  });

  it("preserves bound inline-SVG namespaces and complex icon attributes", () => {
    const svg = buildSvgForeignObject({
      width: 48,
      height: 48,
      html: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24" xml:space="preserve">
        <defs><path id="mark" d="M1 1h22v22H1z" /></defs>
        <use xlink:href="#mark" fill-rule="evenodd" clip-rule="evenodd" />
      </svg>`,
    });
    expect(svg).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(svg).toContain('xlink:href="#mark"');
    expect(svg).toContain('xml:space="preserve"');
    expect(svg).toContain('viewBox="0 0 24 24"');
  });

  it("fails closed on active content while preserving inert visual markup", () => {
    const svg = buildSvgForeignObject({
      width: 800,
      height: 600,
      html: `<main onclick="steal()" style="color:red;background-image:url(javascript:steal())">
        <style data-agent-native-editor-chrome-style>overlay { display:block }</style>
        <div data-agent-native-edit-overlay><div>handle</div></div>
        <script>steal()</script>
        <iframe src="https://attacker.invalid"></iframe>
        <object data="data:text/html,active"></object>
        <embed src="javascript:steal()">
        <a href="javascript:steal()">unsafe</a>
        <img src="data:text/html,active" alt="unsafe">
        <img src="data:image/png;base64,AAAA" alt="safe image">
        <p class="kept">Visible inert content</p>
      </main>`,
    });
    expect(svg).not.toMatch(/<script|<iframe|<object|<embed/i);
    expect(svg).not.toContain("data-agent-native-editor-chrome-style");
    expect(svg).not.toContain("data-agent-native-edit-overlay");
    expect(svg).not.toContain("onclick=");
    expect(svg).not.toContain("javascript:");
    expect(svg).not.toContain("data:text/html");
    expect(svg).toContain("data:image/png;base64,AAAA");
    expect(svg).toContain("Visible inert content");
  });

  it("emits XML-safe XHTML for Alpine directives, boolean attributes, quoted delimiters, and special characters", () => {
    const svg = buildSvgForeignObject({
      width: 1280,
      height: 900,
      title: 'R&D <launch> "one"',
      html: `<main x-data="{ open: true }">
        <button @click="open = !open" :class="{ 'is-open': open }" x-bind:aria-expanded="open" disabled title="1 > 0 & safe">R&D &nbsp; launch &mdash; &copy; &hellip; 🚀</button>
        <input required value="quoted > delimiter & value">
      </main>`,
    });

    expect(svg).not.toContain("@click=");
    expect(svg).not.toContain(":class=");
    expect(svg).not.toContain("x-bind:aria-expanded=");
    expect(svg).not.toContain("x-data=");
    expect(svg).toContain('disabled=""');
    expect(svg).toContain('required=""');
    expect(svg).toContain('title="1 > 0 &amp; safe"');
    expect(svg).toContain("R&amp;D &#160; launch &#8212; &#169; &#8230; 🚀");
    expect(svg).not.toContain("&amp;nbsp;");
    expect(svg).toContain('width="1280" height="900"');
    expect(svg).toContain('viewBox="0 0 1280 900"');
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
