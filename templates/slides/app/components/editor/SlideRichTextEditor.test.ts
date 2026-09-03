// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  contentForSlideTextContainer,
  normalizeSlideEditorContent,
  selectionOffsetsWithin,
} from "./SlideRichTextEditor";

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

  it("preserves styled imported trailing paragraphs", () => {
    const html = normalizeSlideEditorContent(
      '<p>Title</p><p data-pptx-paragraph style="min-height: 24px"></p>',
    );

    expect(html).toContain('data-pptx-paragraph=""');
    expect(html).toContain("min-height: 24px");
  });

  it("keeps selection offsets stable when legacy bullet markers are removed", () => {
    const root = document.createElement("div");
    root.innerHTML = "<div><span>●</span><span>First point</span></div>";
    const text = root.querySelectorAll("span")[1]?.firstChild;
    expect(text).toBeTruthy();

    const range = document.createRange();
    range.setStart(text!, 0);
    range.setEnd(text!, text!.textContent?.length ?? 0);

    expect(selectionOffsetsWithin(root, range)).toEqual({ from: 0, to: 11 });
  });

  it("restores semantic containers without nesting editor block markup", () => {
    expect(contentForSlideTextContainer("H2", "<h2>Title</h2>")).toBe("Title");
    expect(contentForSlideTextContainer("UL", "<ul><li>First</li></ul>")).toBe(
      "<li>First</li>",
    );
  });
});
