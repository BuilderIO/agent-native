import { describe, expect, it } from "vitest";

import { renderableHtmlPrefix } from "./renderable-html";

describe("renderableHtmlPrefix", () => {
  it("drops a tag cut off mid-way", () => {
    expect(renderableHtmlPrefix('<main><div class="p-4 bg-')).toBe("<main>");
    expect(renderableHtmlPrefix("<main><p>Hi</")).toBe("<main><p>Hi");
  });

  it("keeps a less-than sign in text", () => {
    expect(renderableHtmlPrefix("<p>1 < 2")).toBe("<p>1 < 2");
  });

  it("holds back a script until it closes", () => {
    expect(
      renderableHtmlPrefix("<head><script>const a = 1;</script><script>let b"),
    ).toBe("<head><script>const a = 1;</script>");
  });

  it("drops an unclosed comment and a cut-off entity", () => {
    expect(renderableHtmlPrefix("<p>a</p><!-- note")).toBe("<p>a</p>");
    expect(renderableHtmlPrefix("<p>Fish &am")).toBe("<p>Fish ");
  });

  it("keeps a style that is still streaming", () => {
    expect(renderableHtmlPrefix("<style>body { color: re")).toBe(
      "<style>body { color: re",
    );
  });
});
