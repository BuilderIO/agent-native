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
});
