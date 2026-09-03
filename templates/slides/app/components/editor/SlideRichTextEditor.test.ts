// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  contentForSlideTextContainer,
  normalizeSlideEditorContent,
  restoreSlideTextContainerContent,
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

  it("normalizes legacy bullet rows with bare or empty text", () => {
    const html = normalizeSlideEditorContent(
      "<div><div><span>•</span>First</div><div><span>•</span></div></div>",
    );

    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const items = wrapper.querySelectorAll("li");

    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toBe("First");
    expect(items[1]?.textContent).toBe("");
  });

  it("normalizes PPTX bullet paragraphs and keeps paragraph metadata", () => {
    const html = normalizeSlideEditorContent(
      '<div><p data-pptx-paragraph="3" dir="rtl" style="font-size: 18px"><span aria-hidden="true">•</span>First</p></div>',
    );

    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const item = wrapper.querySelector("li")!;

    expect(item.textContent).toBe("First");
    expect(item.getAttribute("data-pptx-paragraph")).toBe("3");
    expect(item.getAttribute("dir")).toBe("rtl");
    expect(item.style.fontSize).toBe("18px");
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
    expect(
      contentForSlideTextContainer(
        "H2",
        '<h2 style="position:absolute;left:107px;top:190px">Title</h2>',
      ),
    ).toBe("Title");
    expect(contentForSlideTextContainer("UL", "<ul><li>First</li></ul>")).toBe(
      "<li>First</li>",
    );
  });

  it("round-trips a positioned heading without losing its semantic root", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<h2 style="position:absolute;left:107px;top:190px">Title</h2>';
    const heading = root.firstElementChild as HTMLElement;
    const editorContent = contentForSlideTextContainer(
      heading.tagName,
      heading.outerHTML,
    );

    const restored = restoreSlideTextContainerContent(
      heading,
      `<p>${editorContent}</p>`,
    );

    expect(restored).toBe(heading);
    expect(restored.tagName).toBe("H2");
    expect(restored.textContent).toBe("Title");
    expect(restored.style.left).toBe("107px");
  });

  it("preserves heading paragraph attributes and formatting", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<h2 style="position:absolute;left:107px;top:190px">Title</h2>';
    const heading = root.firstElementChild as HTMLElement;

    const restored = restoreSlideTextContainerContent(
      heading,
      '<p style="text-align:center;color:red" dir="rtl" data-pptx-paragraph="2">Title</p>',
    );

    expect(restored.style.position).toBe("absolute");
    expect(restored.style.left).toBe("107px");
    expect(restored.style.top).toBe("190px");
    expect(restored.style.textAlign).toBe("center");
    expect(restored.style.color).toBe("red");
    expect(restored.getAttribute("dir")).toBe("rtl");
    expect(restored.getAttribute("data-pptx-paragraph")).toBe("2");
  });

  it("keeps all blocks when a heading becomes structurally multi-block", () => {
    const root = document.createElement("div");
    root.innerHTML = "<h2>Title</h2>";
    const heading = root.firstElementChild as HTMLElement;

    const restored = restoreSlideTextContainerContent(
      heading,
      "<p>Title</p><p>Second line</p>",
    );

    expect(restored.tagName).toBe("DIV");
    expect(restored.querySelectorAll("p")).toHaveLength(2);
    expect(restored.textContent).toBe("TitleSecond line");
  });

  it("round-trips blockquote and list roots from editor block output", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<blockquote style="position:absolute;left:10px"><p>Quote</p></blockquote><ul><li>First</li></ul>';
    const quote = root.firstElementChild as HTMLElement;
    const list = root.lastElementChild as HTMLElement;
    const item = list.firstElementChild as HTMLElement;

    const restoredQuote = restoreSlideTextContainerContent(
      quote,
      contentForSlideTextContainer("BLOCKQUOTE", quote.outerHTML),
    );
    const restoredList = restoreSlideTextContainerContent(
      list,
      contentForSlideTextContainer("UL", list.outerHTML),
    );
    const restoredItem = restoreSlideTextContainerContent(item, "<p>First</p>");

    expect(restoredQuote).toBe(quote);
    expect(restoredQuote.querySelector("p")?.textContent).toBe("Quote");
    expect(restoredQuote.style.left).toBe("10px");
    expect(restoredList).toBe(list);
    expect(restoredList.querySelector("li")?.textContent).toBe("First");
    expect(restoredItem).toBe(item);
    expect(restoredItem.tagName).toBe("LI");
  });

  it("promotes semantic containers to one wrapper for structural edits", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<p data-builder-id="text" style="font-size: 24px">Old</p>';
    const paragraph = root.firstElementChild as HTMLElement;

    const restored = restoreSlideTextContainerContent(
      paragraph,
      "<p>First</p><p>Second</p>",
    );

    expect(restored.tagName).toBe("DIV");
    expect(restored.getAttribute("data-builder-id")).toBe("text");
    expect(restored.style.fontSize).toBe("24px");
    expect(restored.querySelectorAll("p")).toHaveLength(2);
  });

  it("restores divider-containing output into one wrapper", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>Old</p>";
    const paragraph = root.firstElementChild as HTMLElement;

    const restored = restoreSlideTextContainerContent(
      paragraph,
      "<p>Before</p><hr><p>After</p>",
    );

    expect(restored.tagName).toBe("DIV");
    expect(restored.querySelector("hr")).toBeTruthy();
    expect(restored.querySelectorAll("p")).toHaveLength(2);
  });

  it("removes list-only styles when unlisting a semantic list", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<ul style="margin:0;padding-left:1.25em;list-style-position:outside;list-style-type:disc;color:red"><li>First</li></ul>';
    const list = root.firstElementChild as HTMLElement;

    const restored = restoreSlideTextContainerContent(list, "<p>First</p>");

    expect(restored.tagName).toBe("DIV");
    expect(restored.style.paddingLeft).toBe("");
    expect(restored.style.listStylePosition).toBe("");
    expect(restored.style.listStyleType).toBe("");
    expect(restored.style.color).toBe("red");
  });
});
