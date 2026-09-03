// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { normalizeSlideEditorContent } from "./SlideRichTextEditor";

describe("slide rich text normalization", () => {
  it("converts legacy bullet rows without losing row styling", () => {
    const html = normalizeSlideEditorContent(
      '<div><div style="font-size: 24px; color: red"><span>●</span><span>First</span></div><div><span>●</span><span>Second</span></div></div><p></p>',
    );

    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const list = wrapper.querySelector("ul")!;
    const items = wrapper.querySelectorAll("li");

    expect(list).toBeTruthy();
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toBe("First");
    expect(items[0]?.style.fontSize).toBe("24px");
    expect(items[0]?.style.color).toBe("red");
    expect(html).not.toContain("<p></p>");
  });
});
