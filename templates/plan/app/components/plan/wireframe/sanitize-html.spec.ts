// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { sanitizeWireframeHtml } from "./sanitize-html";

describe("sanitizeWireframeHtml", () => {
  it("drops <script> elements", () => {
    const out = sanitizeWireframeHtml(
      "<div>ok<script>window.x=1</script></div>",
    );
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain("ok");
  });

  it("strips on* event handlers (img onerror)", () => {
    const out = sanitizeWireframeHtml('<img src="x" onerror="window.x=1">');
    expect(out).not.toMatch(/onerror/i);
  });

  it("removes a plain javascript: href", () => {
    const out = sanitizeWireframeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out.toLowerCase()).not.toContain("javascript:");
    expect(out).toContain(">x<");
  });

  it("removes a TAB-obfuscated java\\tscript: href", () => {
    const out = sanitizeWireframeHtml('<a href="java\tscript:alert(1)">x</a>');
    expect(out.toLowerCase()).not.toContain("script:");
  });

  it("removes an HTML-entity-obfuscated &#106;avascript: href", () => {
    const out = sanitizeWireframeHtml(
      '<a href="&#106;avascript:alert(1)">x</a>',
    );
    expect(out.toLowerCase()).not.toContain("javascript:");
  });

  it("removes a vbscript: href", () => {
    const out = sanitizeWireframeHtml('<a href="vbscript:msgbox(1)">x</a>');
    expect(out.toLowerCase()).not.toContain("vbscript:");
  });

  it("drops <iframe> / <object> / <embed>", () => {
    const out = sanitizeWireframeHtml(
      '<iframe src="https://evil"></iframe><object data="x"></object><embed src="x">safe',
    );
    expect(out).not.toMatch(/<iframe|<object|<embed/i);
    expect(out).toContain("safe");
  });

  it("strips inline style with expression()/javascript:", () => {
    const out = sanitizeWireframeHtml(
      '<div style="width:expression(alert(1))">x</div>',
    );
    expect(out.toLowerCase()).not.toContain("expression(");
  });

  it("blocks data:text/html but keeps data:image/png", () => {
    const html = sanitizeWireframeHtml(
      '<img src="data:image/png;base64,AAAA"><a href="data:text/html,<script>1</script>">l</a>',
    );
    expect(html).toContain("data:image/png");
    expect(html.toLowerCase()).not.toContain("data:text/html");
  });

  it("preserves safe content + safe links + classes", () => {
    const out = sanitizeWireframeHtml(
      '<div class="wf-card"><a href="https://example.com">go</a><p>hello</p></div>',
    );
    expect(out).toContain("https://example.com");
    expect(out).toContain("hello");
    expect(out).toContain('class="wf-card"');
  });

  it("preserves safe prototype runtime directives", () => {
    const out = sanitizeWireframeHtml(
      `<div x-data="{ draft: '', todos: [] }"><input x-model="draft" @keydown.enter="todos.push({ text: draft })"><button x-on:click="draft = ''" :class="{ primary: draft }" x-show="draft">Add</button></div>`,
    );

    expect(out).toContain("x-data");
    expect(out).toContain("x-model");
    expect(out).toContain("@keydown.enter");
    expect(out).toContain("x-on:click");
    expect(out).toContain(":class");
    expect(out).toContain("x-show");
  });

  it("handles empty / undefined", () => {
    expect(sanitizeWireframeHtml(undefined)).toBe("");
    expect(sanitizeWireframeHtml("")).toBe("");
  });
});
