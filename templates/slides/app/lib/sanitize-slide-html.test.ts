// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { extractMermaidBlocks } from "./mermaid-blocks";
import {
  sanitizeCssValue,
  sanitizeSlideHtml,
  sanitizeSlideUrl,
} from "./sanitize-slide-html";

describe("sanitizeSlideHtml", () => {
  it("strips scripts, handlers, and unsafe urls", () => {
    const html = sanitizeSlideHtml(
      '<div onclick="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">x</a><img src="java&#x0a;script:alert(1)"></div>',
    );

    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<a");
    expect(html).toContain('target="_blank"');
  });

  it("keeps layout styles but removes css url injection", () => {
    expect(
      sanitizeSlideHtml(
        '<div class="fmd-slide" style="display:flex;color:#fff">ok</div>',
      ),
    ).toContain("display: flex");

    const html = sanitizeSlideHtml(
      '<div class="fmd-slide" style="display:flex;background:url(javascript:alert(1));color:#fff">ok</div>',
    );

    expect(html).not.toContain("url(");
    expect(html).not.toContain("javascript:");
  });

  it("sanitizes generated presentation style blocks", () => {
    const html = sanitizeSlideHtml(
      '<style>[data-pstep="0"] { opacity: 0; background: url(https://x.test/t.png); }</style><div>ok</div>',
    );

    expect(html).toContain("opacity: 0");
    expect(html).not.toContain("url(");
  });

  it("scopes rendered style blocks to the slide root", () => {
    const html = sanitizeSlideHtml(
      '<style>body { margin: 0; } .title, [data-pstep="0"] { opacity: 0; }</style><div class="title">ok</div>',
      { scopeSelector: '[data-slide-content-scope="test"]' },
    );

    expect(html).toContain('[data-slide-content-scope="test"] { margin: 0; }');
    expect(html).toContain(
      '[data-slide-content-scope="test"] .title, [data-slide-content-scope="test"] [data-pstep="0"]',
    );
    expect(html).not.toContain("body {");
  });

  it("heals a stylesheet scoped by an earlier save to a single scope", () => {
    const html = sanitizeSlideHtml(
      '<style>[data-slide-content-scope="slide-a"] [data-slide-content-scope="slide-b"] .card { color: red; } [data-slide-content-scope="slide-a"], [data-slide-content-scope="slide-a"] * { margin: 0; }</style><div class="card">ok</div>',
      { scopeSelector: '[data-slide-content-scope="slide-c"]' },
    );

    expect(html).toContain(
      '[data-slide-content-scope="slide-c"] .card { color: red; }',
    );
    expect(html).toContain(
      '[data-slide-content-scope="slide-c"], [data-slide-content-scope="slide-c"], [data-slide-content-scope="slide-c"] *',
    );
    expect(html).not.toContain("slide-a");
    expect(html).not.toContain("slide-b");
  });

  it("keeps source stamps, including on a mermaid block", () => {
    const html = sanitizeSlideHtml(
      '<div class="fmd-slide" data-src-i="n:0"><p data-src-i="n:1">x</p></div>',
    );
    expect(html).toContain('data-src-i="n:0"');
    expect(html).toContain('data-src-i="n:1"');

    const { blocks, contentWithPlaceholders } = extractMermaidBlocks(
      '<div class="mermaid" data-src-i="n:2">graph TD\nA --> B</div>',
    );
    expect(blocks).toEqual(["graph TD\nA --> B"]);
    expect(contentWithPlaceholders).toBe('<div data-mermaid-index="0"></div>');
  });
});

describe("sanitizeSlideUrl", () => {
  it("allows safe image urls and rejects unsafe protocols", () => {
    expect(sanitizeSlideUrl("https://example.com/a.png", "image")).toBe(
      "https://example.com/a.png",
    );
    expect(sanitizeSlideUrl("javascript:alert(1)", "image")).toBeNull();
  });

  it("allows parameterized raster data URLs while keeping the MIME allowlist", () => {
    const dataUrl = "data:IMAGE/PNG;charset=binary;base64,AQID";
    expect(sanitizeSlideUrl(dataUrl, "image")).toBe(dataUrl);
    expect(
      sanitizeSlideUrl(
        "data:image/svg+xml;charset=utf-8;base64,PHN2Zy8+",
        "image",
      ),
    ).toBeNull();
  });

  it("allows blob urls only for explicitly enabled client previews", () => {
    expect(
      sanitizeSlideUrl("blob:https://example.com/preview", "image"),
    ).toBeNull();
    expect(
      sanitizeSlideUrl("blob:https://example.com/preview", "image", {
        allowBlob: true,
      }),
    ).toBe("blob:https://example.com/preview");
    expect(
      sanitizeSlideUrl("blob:https://example.com/preview", "link"),
    ).toBeNull();
  });

  it("does not persist blob image sources without the client preview opt-in", () => {
    const html = '<div class="fmd-slide"><img src="blob:preview"></div>';

    expect(sanitizeSlideHtml(html)).not.toContain("blob:preview");
    expect(sanitizeSlideHtml(html, { allowBlobImages: true })).toContain(
      "blob:preview",
    );
  });

  it("preserves playable MP4 and WebM markup", () => {
    const html = sanitizeSlideHtml(
      '<video controls playsinline preload="metadata"><source src="https://media.example.com/clip.webm" type="video/webm"></video>',
    );

    expect(html).toContain("<video");
    expect(html).toContain('controls=""');
    expect(html).toContain('playsinline=""');
    expect(html).toContain('src="https://media.example.com/clip.webm"');
    expect(html).toContain('type="video/webm"');
  });

  it("rejects unsafe video and source URLs", () => {
    const html = sanitizeSlideHtml(
      '<video src="javascript:alert(1)"><source src="data:video/mp4;base64,AQID" type="video/mp4"></video>',
    );

    expect(html).toContain("<video");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:video");
  });

  it("removes every false video boolean in DOM and SSR sanitizers", () => {
    const source =
      '<video controls="false" autoplay="false" loop="false" muted="false" playsinline="false"></video><video playsinline="false" muted="false" loop="false" autoplay="false" controls="false"></video>';
    const domResult = sanitizeSlideHtml(source);
    expect(domResult).not.toMatch(
      /\b(?:autoplay|controls|loop|muted|playsinline)\s*=\s*(?:"false"|'false'|false)(?=\s|\/?>)/i,
    );
    expect(domResult).not.toMatch(
      /\b(?:autoplay|controls|loop|muted|playsinline)(?:="")?/i,
    );

    vi.stubGlobal("DOMParser", undefined);
    try {
      const ssrResult = sanitizeSlideHtml(source);
      expect(ssrResult).not.toMatch(
        /\b(?:autoplay|controls|loop|muted|playsinline)\s*=\s*(?:"false"|'false'|false)(?=\s|\/?>)/i,
      );
      expect(ssrResult).not.toMatch(
        /\b(?:autoplay|controls|loop|muted|playsinline)(?:="")?/i,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("gates blob video previews and preserves autoplay settings in thumbnails", () => {
    const html = '<video src="blob:preview" autoplay></video>';
    expect(sanitizeSlideHtml(html)).not.toContain("blob:preview");

    const thumbnail = sanitizeSlideHtml(html, {
      allowBlobVideos: true,
      disableVideoAutoplay: true,
    });
    expect(thumbnail).toContain('src="blob:preview"');
    expect(thumbnail).not.toMatch(/\sautoplay(?:="")?/);
    expect(thumbnail).toContain('data-video-autoplay="true"');
    expect(thumbnail).toContain('muted=""');
    expect(thumbnail).toContain('playsinline=""');

    expect(sanitizeSlideHtml(thumbnail)).toContain('autoplay=""');
  });
});

describe("sanitizeCssValue", () => {
  it("rejects css url values", () => {
    expect(sanitizeCssValue("linear-gradient(red, blue)")).toBe(
      "linear-gradient(red, blue)",
    );
    expect(sanitizeCssValue("url(https://example.com/a.png)")).toBeNull();
  });
});
