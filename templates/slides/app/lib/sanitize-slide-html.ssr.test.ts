// @vitest-environment node
// The sibling suite runs in happy-dom, which only ever exercises the DOMParser
// branch. Public deck, share, and present pages are server-rendered, where
// DOMParser is undefined and sanitizeSlideHtml falls back to its regex twin —
// so that branch needs its own environment to be covered at all.
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

/**
 * The regex twin runs wherever DOMParser does not — the SSR'd share and present
 * pages. Two defects here were losing slide content and letting a live handler
 * through on exactly those pages.
 */
describe("sanitizeSlideHtml regex fallback, verified against the SSR path", () => {
  it("keeps a slide's <style> block and everything after it", () => {
    // The unclosed-raw-text sweep used to cut to the end of the string at any
    // <style>, including the sanitized one emitted a pass earlier — so a deck
    // with one stylesheet rendered as an empty slide.
    const html = sanitizeSlideHtml(
      '<div class="fmd-slide"><style>.a{color:red}</style><h1>Title</h1><p>Body</p></div>',
    );
    expect(html).toContain("Title");
    expect(html).toContain("Body");
    expect(html).toContain("<style>");
  });

  it("still drops everything after a <style> that never closes", () => {
    // An unclosed raw-text element swallows the rest of the document in a real
    // parser, so the regex path has to agree with it.
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
    // `embed` is void, so it never has a closing tag. Requiring one truncated
    // every slide that used it.
    const html = sanitizeSlideHtml(
      '<div class="fmd-slide"><embed src="x"><h1>After</h1></div>',
    );
    expect(html).toContain("After");
  });

  it("does not truncate on a tag name that only appears inside an attribute", () => {
    // Scanning the serialized string cannot tell a tag from text unless it
    // skips quoted values: this reads as a <style> start tag otherwise.
    const html = sanitizeSlideHtml(
      '<div class="fmd-slide"><p title="Use <style> in CSS">Visible</p></div>',
    );
    expect(html).toContain("Visible");
  });

  it("does not truncate on a tag name inside a stylesheet's own text", () => {
    // A raw-text element's body is text, not markup: this is a CSS string.
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
    // `/` is a legal separator, so this is an image with a live handler. Every
    // scrub here is whitespace-anchored, so none of them saw it.
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
    // The normalizer must only touch start tags; CSS is not markup, and
    // `font: 12px/1.5` is a shorthand whose slash carries meaning.
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
    // Widening the attribute scrubs to treat `/` as a separator corrupted this
    // — the match ran straight into the middle of a legitimate value.
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
