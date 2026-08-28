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

  it("strips a handler written with a slash separator", () => {
    // `<img/src=x/onerror=…>` is a valid img tag with a live handler. Anchoring
    // the scrub on whitespace alone let it through verbatim.
    const html = sanitizeSlideHtml(
      '<div class="fmd-slide"><img/src=x/onerror=alert(1)><p>Body</p></div>',
    );
    expect(html).not.toContain("onerror");
    expect(html).toContain("Body");
  });

  it("leaves an ordinary styled slide alone", () => {
    const html = sanitizeSlideHtml(
      '<div class="fmd-slide"><h1 style="font-size:64px">Growth</h1><ul><li>One</li></ul></div>',
    );
    expect(html).toContain("Growth");
    expect(html).toContain("<li>One</li>");
  });
});
