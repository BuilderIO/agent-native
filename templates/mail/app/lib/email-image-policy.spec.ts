// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { processHtmlImages } from "./email-image-policy";

describe("processHtmlImages", () => {
  it("leaves CSS image URLs untouched when images are shown", () => {
    const input =
      '<style>.hero{background-image:url("https://cdn.example.com/hero.png")}</style><div style="background:url(https://cdn.example.com/card.png)">Hello</div>';

    const [html, blockedCount] = processHtmlImages(input, "show");

    expect(blockedCount).toBe(0);
    expect(html).toContain("https://cdn.example.com/hero.png");
    expect(html).toContain("https://cdn.example.com/card.png");
  });

  it("blocks remote CSS image URLs in style attributes", () => {
    const input =
      '<div style="background:#fff url(&quot;https://cdn.example.com/card.png&quot;) center / cover no-repeat; border-image:url(cid:badge) 1">Hello</div>';

    const [html, blockedCount] = processHtmlImages(input, "block-all");

    expect(blockedCount).toBe(1);
    expect(html).not.toContain("https://cdn.example.com/card.png");
    expect(html).toContain("url(cid:badge)");
  });

  it("blocks remote CSS image URLs and imports in style tags", () => {
    const input = [
      '<style>@import url("https://cdn.example.com/email.css");',
      ".hero{background-image:url(https://cdn.example.com/hero.png)}",
      ".inline{background:url(data:image/png;base64,abcd)}</style>",
      "<p>Hello</p>",
    ].join("");

    const [html, blockedCount] = processHtmlImages(input, "block-all");

    expect(blockedCount).toBe(2);
    expect(html).not.toContain("https://cdn.example.com/email.css");
    expect(html).not.toContain("https://cdn.example.com/hero.png");
    expect(html).toContain("data:image/png;base64,abcd");
  });

  it("preserves same-document CSS fragment URLs while blocking remote URLs", () => {
    const input = [
      "<style>.icon{clip-path:url(#clipPath)}",
      '.mask{mask:url("#mask")}',
      ".hero{background-image:url(https://cdn.example.com/hero.png)}</style>",
      '<div style="filter:url(#shadow); background:url(https://cdn.example.com/card.png)">Hello</div>',
    ].join("");

    const [html, blockedCount] = processHtmlImages(input, "block-all");

    expect(blockedCount).toBe(2);
    expect(html).toContain("url(#clipPath)");
    expect(html).toContain('url("#mask")');
    expect(html).toContain("url(#shadow)");
    expect(html).not.toContain("https://cdn.example.com/hero.png");
    expect(html).not.toContain("https://cdn.example.com/card.png");
  });

  it("removes link elements with remote hrefs", () => {
    const input =
      '<link href="https://cdn.example.com/email.css"><link href="https://cdn.example.com/font.woff2"><p>Hello</p>';

    const [html, blockedCount] = processHtmlImages(input, "block-all");

    expect(blockedCount).toBe(2);
    expect(html).not.toContain("<link");
    expect(html).not.toContain("https://cdn.example.com/email.css");
    expect(html).not.toContain("https://cdn.example.com/font.woff2");
  });

  it("removes legacy remote background resources", () => {
    const input =
      '<table background="https://cdn.example.com/bg.png"><tr><td>Hi</td></tr></table><video poster="https://cdn.example.com/poster.png"></video>';

    const [html, blockedCount] = processHtmlImages(input, "block-all");

    expect(blockedCount).toBe(2);
    expect(html).not.toContain("https://cdn.example.com/bg.png");
    expect(html).not.toContain("https://cdn.example.com/poster.png");
  });

  it("removes remote SVG fetch attributes while preserving local references", () => {
    const input = [
      "<svg>",
      '<image href="https://cdn.example.com/pixel.png" xlink:href="cid:logo"></image>',
      '<feImage href="#filterSource" xlink:href="https://cdn.example.com/filter.png"></feImage>',
      '<use href="#symbol"></use>',
      '<use xlink:href="https://cdn.example.com/sprite.svg#icon"></use>',
      "</svg>",
    ].join("");

    const [html, blockedCount] = processHtmlImages(input, "block-all");

    expect(blockedCount).toBe(3);
    expect(html).not.toContain("https://cdn.example.com/pixel.png");
    expect(html).not.toContain("https://cdn.example.com/filter.png");
    expect(html).not.toContain("https://cdn.example.com/sprite.svg#icon");
    expect(html).toContain("cid:logo");
    expect(html).toContain("#filterSource");
    expect(html).toContain("#symbol");
  });
});
