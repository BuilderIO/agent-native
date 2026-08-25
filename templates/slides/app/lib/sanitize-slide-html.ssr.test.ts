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
