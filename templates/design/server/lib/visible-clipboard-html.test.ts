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
});
