// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import {
  sanitizeWireframeCss,
  sanitizeWireframeHtml,
  scopeDesignCss,
} from "./sanitize-html";

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

describe("sanitizeWireframeCss", () => {
  it("drops dangerous CSS while keeping safe design rules", () => {
    const out = sanitizeWireframeCss(`
@import url("https://example.com/theme.css");
@font-face { font-family: Leaky; src: url(https://example.com/leaky.woff2); }
@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }
.card { color: #111; }
.bad { background: url(javascript:alert(1)); }
.icon { background: url(data:image/svg+xml,<svg></svg>); }
.safe { border-radius: 10px; }
`);

    expect(out).not.toContain("@import");
    expect(out).not.toContain("@font-face");
    expect(out).not.toContain("@keyframes");
    expect(out).not.toContain("javascript");
    expect(out).not.toContain("image/svg+xml");
    expect(out).toContain(".card { color: #111; }");
    expect(out).toContain(".safe { border-radius: 10px; }");
  });

  it("drops CSS escape obfuscation and viewport-trapping declarations", () => {
    const out = sanitizeWireframeCss(String.raw`
.\69 mportant { color: #111; }
@\69mport url("https://example.com/theme.css");
.bad-url { background: url("\\6a avascript:alert(1)"); }
.fixed { position: fixed; inset: 0; }
.sticky { position: sticky; top: 0; }
.stack { z-index: 100000; }
.safe { color: #0f172a; }
`);

    expect(out).not.toMatch(/@\\?69?mport|javascript|position:\s*fixed/i);
    expect(out).not.toContain("position: sticky");
    expect(out).not.toContain("100000");
    expect(out).toContain(".safe { color: #0f172a; }");
  });
});

describe("scopeDesignCss", () => {
  it("scopes element and class selectors to one design artboard", () => {
    const scope = '[data-plan-design-scope="abc"]';
    const out = scopeDesignCss(
      '.hero, body, :root { color: #111; }\n[data-plan-design-scope="abc"] .pill { color: red; }',
      scope,
    );

    expect(out).toContain(`${scope} .hero`);
    expect(out).toContain(`${scope} { color: #111; }`);
    expect(out).toContain(`${scope} .pill { color: red; }`);
    expect(out).not.toContain(`${scope} ${scope} .pill`);
  });

  it("scopes selectors nested inside media queries", () => {
    const scope = '[data-plan-design-scope="responsive"]';
    const out = scopeDesignCss(
      "@media (max-width: 640px) { .hero, body { padding: 12px; } }",
      scope,
    );

    expect(out).toContain("@media (max-width: 640px) {");
    expect(out).toContain(`${scope} .hero`);
    expect(out).toContain(`${scope} { padding: 12px; }`);
    expect(out).not.toContain("{ .hero");
  });

  it("keeps commas inside pseudo-class arguments and attribute selectors", () => {
    const scope = '[data-plan-design-scope="selectors"]';
    const out = scopeDesignCss(
      ':is(.primary, .secondary), [data-label="A,B"] { color: #111; }',
      scope,
    );

    expect(out).toContain(`${scope} :is(.primary, .secondary)`);
    expect(out).toContain(`${scope} [data-label="A,B"]`);
    expect(out).not.toContain(`, ${scope} .secondary)`);
    expect(out).not.toContain(`A, ${scope} B`);
  });
});
