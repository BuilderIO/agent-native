import { describe, expect, it } from "vitest";

import { parseVisibleClipboardHtml } from "./visible-clipboard-html.js";

describe("parseVisibleClipboardHtml", () => {
  it("keeps visible clipboard HTML and strips hidden transfer data", () => {
    const html =
      '<span data-metadata="hidden"></span><span data-buffer="hidden"></span><div>Visible frame</div>';

    expect(parseVisibleClipboardHtml(html)).toEqual({
      fallbackHtml: "<div>Visible frame</div>",
    });
  });

  it("supports standalone HTML", () => {
    const html = "<section>Standalone markup</section>";

    expect(parseVisibleClipboardHtml(html)).toEqual({
      fallbackHtml: html,
    });
  });

  it("strips bare and entity-escaped Figma transfer comments", () => {
    const html = [
      "<!--(figmeta)metadata(/figmeta)-->",
      "<!--(figma)binary(/figma)-->",
      "&lt;!--(figma)escaped-binary(/figma)--&gt;",
      "<div>Visible frame</div>",
    ].join("");

    expect(parseVisibleClipboardHtml(html)).toEqual({
      fallbackHtml: "<div>Visible frame</div>",
    });
  });

  it("applies the visible HTML cap after removing a large hidden Figma buffer", () => {
    const html = `<!--(figma)${"a".repeat(3 * 1024 * 1024)}(/figma)--><div>Visible</div>`;

    expect(parseVisibleClipboardHtml(html)).toEqual({
      fallbackHtml: "<div>Visible</div>",
    });
  });

  it("treats Figma's empty pre-wrap span as no visible HTML", () => {
    const html =
      '<meta charset="utf-8"><span data-metadata="<!--(figmeta)e30=(/figmeta)-->"></span><span data-buffer="<!--(figma)AAAA(/figma)-->"></span><span style="white-space:pre-wrap;"></span>';

    expect(parseVisibleClipboardHtml(html)).toEqual({
      fallbackHtml: undefined,
    });
  });

  it("keeps markup whose only content is an image or svg", () => {
    const html = '<div><svg viewBox="0 0 1 1"></svg></div>';

    expect(parseVisibleClipboardHtml(html)).toEqual({ fallbackHtml: html });
  });
});
