// @vitest-environment node
import { describe, expect, it } from "vitest";

import { sanitizeSlideHtml } from "./sanitize-slide-html";

describe("sanitizeSlideHtml without DOMParser (SSR)", () => {
  it("takes the regex path", () => {
    expect(typeof DOMParser).toBe("undefined");
  });

  it("drops a script whose closing tag carries whitespace", () => {
    const html = sanitizeSlideHtml(
      "<div>keep</div><script>window.track({id:1});</script >",
    );

    expect(html).not.toContain("window.track");
    expect(html).not.toContain("script");
    expect(html).toContain("keep");
  });

  it("drops an unclosed script instead of leaving its source as slide text", () => {
    const html = sanitizeSlideHtml(
      "<div>keep</div><script>window.track({id:1});",
    );

    expect(html).not.toContain("window.track");
    expect(html).toContain("keep");
  });

  it("drops unclosed style and textarea bodies", () => {
    expect(sanitizeSlideHtml("<p>hi</p><style>.a{color:red}")).not.toContain(
      "color:red",
    );
    expect(sanitizeSlideHtml("<p>hi</p><textarea>secret")).not.toContain(
      "secret",
    );
  });

  it("still removes a well-formed script and keeps ordinary markup", () => {
    const html = sanitizeSlideHtml(
      "<div><script>alert(1)</script><span>text</span></div>",
    );

    expect(html).not.toContain("alert(1)");
    expect(html).toContain("text");
  });
});

describe("sanitizeSlideHtml regex fallback, verified against the SSR path", () => {
  it("keeps a slide's <style> block and everything after it", () => {
    const html = sanitizeSlideHtml(
      '<div class="fmd-slide"><style>.a{color:red}</style><h1>Title</h1><p>Body</p></div>',
    );
    expect(html).toContain("Title");
    expect(html).toContain("Body");
    expect(html).toContain("<style>");
  });

  it("still drops everything after a <style> that never closes", () => {
    const html = sanitizeSlideHtml(
      '<div class="fmd-slide"><h1>Kept</h1><style>.a{color:red}<h1>Swallowed</h1></div>',
    );
    expect(html).toContain("Kept");
    expect(html).not.toContain("Swallowed");
  });

  it("still drops everything after an unclosed <script>", () => {
    const html = sanitizeSlideHtml(
      '<div class="fmd-slide"><h1>Kept</h1><script>alert(1)<p>Swallowed</p></div>',
    );
    expect(html).toContain("Kept");
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("Swallowed");
  });

  it("keeps a slide containing a valid void <embed>", () => {
    const html = sanitizeSlideHtml(
      '<div class="fmd-slide"><embed src="x"><h1>After</h1></div>',
    );
    expect(html).toContain("After");
  });

  it("does not truncate on a tag name that only appears inside an attribute", () => {
    const html = sanitizeSlideHtml(
      '<div class="fmd-slide"><p title="Use <style> in CSS">Visible</p></div>',
    );
    expect(html).toContain("Visible");
  });

  it("does not truncate on a tag name inside a stylesheet's own text", () => {
    const html = sanitizeSlideHtml(
      '<div class="fmd-slide"><style>.a::after{content:"<script>"}</style><h1>Visible</h1></div>',
    );
    expect(html).toContain("Visible");
  });

  it("does not truncate on a tag name inside a comment", () => {
    const html = sanitizeSlideHtml(
      '<div class="fmd-slide"><!-- <script> --><h1>Visible</h1></div>',
    );
    expect(html).toContain("Visible");
  });

  it("strips a handler attached with a slash separator", () => {
    for (const attack of [
      "<img/src=x/onerror=alert(1)>",
      '<img src="x"/onerror="alert(1)">',
      "<img src='x'/onerror='alert(1)'>",
    ]) {
      const html = sanitizeSlideHtml(`<div class="fmd-slide">${attack}</div>`);
      expect(html).not.toContain("onerror");
    }
  });

  it("sanitizes a style attached with a slash separator", () => {
    const html = sanitizeSlideHtml(
      '<div class="fmd-slide"><div/style="background:url(https://attacker.example/p)">x</div></div>',
    );
    expect(html).not.toContain("attacker.example");
    expect(html).toContain("x");
  });

  it("does not rewrite separators inside a stylesheet's own text", () => {
    const html = sanitizeSlideHtml(
      '<div class="fmd-slide"><style>.a{font:12px/1.5 sans-serif}</style><h1>T</h1></div>',
    );
    expect(html).toContain("12px/1.5");
    expect(html).toContain("T");
  });

  it("does not rewrite separators inside a style attribute's value", () => {
    const html = sanitizeSlideHtml(
      '<div class="fmd-slide"><p style="font: 12px/1.5 sans-serif">T</p></div>',
    );
    expect(html).toContain("12px/1.5");
  });

  it("leaves a quoted URL that merely looks like a handler intact", () => {
    const html = sanitizeSlideHtml(
      '<div class="fmd-slide"><img src="https://cdn.example/onerror=logo.png"></div>',
    );
    expect(html).toContain("onerror=logo.png");
  });

  it("leaves an ordinary styled slide alone", () => {
    const html = sanitizeSlideHtml(
      '<div class="fmd-slide"><h1 style="font-size:64px">Growth</h1><ul><li>One</li></ul></div>',
    );
    expect(html).toContain("Growth");
    expect(html).toContain("<li>One</li>");
  });
});
