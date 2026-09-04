// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  contentForSlideTextContainer,
  normalizeSlideEditorContent,
  restoreSlideTextContainerContent,
  selectionOffsetsWithin,
} from "./SlideRichTextEditor";

const stylesheet = document.createElement("style");
stylesheet.textContent = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../global.css"),
  "utf8",
);

beforeAll(() => {
  document.head.append(stylesheet);
});

afterAll(() => {
  stylesheet.remove();
});

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

  it("restores styled bullet rows after editing their semantic list", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px">
        <div style="display:flex;align-items:baseline;gap:20px;font-size:22px;color:rgb(255, 255, 255)">
          <span style="font-size:8px">●</span><span>First point</span>
        </div>
        <div style="display:flex;align-items:baseline;gap:20px;font-size:22px;color:rgb(255, 255, 255)">
          <span style="font-size:8px">●</span><span>Second point</span>
        </div>
      </div>
    `;
    const target = root.firstElementChild as HTMLElement;
    const source = target.innerHTML;
    const restored = restoreSlideTextContainerContent(
      target,
      '<ul><li style="font-size:22px;color:rgb(255, 255, 255)"><p><strong>Updated point</strong></p></li><li style="font-size:22px;color:rgb(255, 255, 255)"><p>Second point</p></li></ul>',
      source,
    );

    const rows = restored.querySelectorAll(":scope > div");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector(":scope > span")?.textContent).toBe("●");
    expect(rows[0]?.querySelectorAll(":scope > span")).toHaveLength(2);
    expect(rows[0]?.querySelector("strong")?.textContent).toBe("Updated point");
    expect((rows[0]?.firstElementChild as HTMLElement).style.fontSize).toBe(
      "8px",
    );
    expect((rows[0] as HTMLElement).style.gap).toBe("20px");
  });

  it("keeps persisted semantic lists styled without an editor marker", () => {
    document.body.innerHTML = `
      <div class="slide-content">
        <div class="fmd-slide">
          <div><ul><li><p>First point</p></li></ul></div>
        </div>
      </div>
    `;
    const list = document.querySelector("ul") as HTMLElement;
    const style = getComputedStyle(list);

    expect(style.listStylePosition).toBe("outside");
    expect(style.listStyleType).toBe("disc");
    expect(style.paddingLeft).toBe("24px");
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
    ).toBe("<p>Title</p>");
    expect(contentForSlideTextContainer("UL", "<ul><li>First</li></ul>")).toBe(
      "<ul><li>First</li></ul>",
    );
    expect(
      contentForSlideTextContainer(
        "OL",
        '<ol style="position:absolute;left:20px"><li>First</li></ol>',
      ),
    ).toBe("<ol><li>First</li></ol>");
    expect(
      contentForSlideTextContainer(
        "BLOCKQUOTE",
        "<blockquote><p>Quote</p></blockquote>",
      ),
    ).toBe("<blockquote><p>Quote</p></blockquote>");
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

    const restored = restoreSlideTextContainerContent(heading, editorContent);

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

  it("preserves paragraph and list-item formatting through editor wrappers", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<p style="position:absolute;left:8px;color:red;font-size:24px;text-align:right" dir="rtl" data-pptx-paragraph="2">Paragraph</p><ul><li style="position:absolute;left:12px;color:blue;font-size:18px" dir="ltr" data-pptx-paragraph="3"><p>Item</p><ul><li>Nested</li></ul></li></ul>';
    const paragraph = root.firstElementChild as HTMLElement;
    const item = root.querySelector("ul > li") as HTMLElement;

    const paragraphEditorContent = contentForSlideTextContainer(
      paragraph.tagName,
      paragraph.outerHTML,
    );
    const paragraphSeed = document.createElement("div");
    paragraphSeed.innerHTML = paragraphEditorContent;
    expect(paragraphSeed.firstElementChild?.tagName).toBe("P");
    expect((paragraphSeed.firstElementChild as HTMLElement).style.color).toBe(
      "red",
    );
    expect(
      paragraphSeed.firstElementChild?.getAttribute("data-pptx-paragraph"),
    ).toBe("2");

    const restoredParagraph = restoreSlideTextContainerContent(
      paragraph,
      paragraphEditorContent,
    );
    expect(restoredParagraph.style.left).toBe("8px");
    expect(restoredParagraph.style.color).toBe("red");
    expect(restoredParagraph.style.fontSize).toBe("24px");
    expect(restoredParagraph.getAttribute("dir")).toBe("rtl");

    const itemEditorContent = contentForSlideTextContainer(
      item.tagName,
      item.outerHTML,
      "UL",
    );
    const itemSeed = document.createElement("div");
    itemSeed.innerHTML = itemEditorContent;
    const seededItem = itemSeed.querySelector("ul > li") as HTMLElement;
    expect(seededItem.style.color).toBe("blue");
    expect(seededItem.getAttribute("dir")).toBe("ltr");
    expect(seededItem.querySelector(":scope > ul li")?.textContent).toBe(
      "Nested",
    );

    const restoredItem = restoreSlideTextContainerContent(
      item,
      itemEditorContent,
    );
    expect(restoredItem).toBe(item);
    expect(restoredItem.style.left).toBe("12px");
    expect(restoredItem.style.color).toBe("blue");
    expect(restoredItem.style.fontSize).toBe("18px");
    expect(restoredItem.getAttribute("dir")).toBe("ltr");
    expect(restoredItem.getAttribute("data-pptx-paragraph")).toBe("3");
    expect(restoredItem.querySelector(":scope > ul li")?.textContent).toBe(
      "Nested",
    );

    const orderedRoot = document.createElement("div");
    orderedRoot.innerHTML = "<ol><li>Ordered item</li></ol>";
    const orderedItem = orderedRoot.querySelector("li") as HTMLElement;
    expect(
      contentForSlideTextContainer("LI", orderedItem.outerHTML, "OL"),
    ).toBe("<ol><li>Ordered item</li></ol>");
  });

  it("clears removed heading formatting without clearing its position", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<h2 style="position:absolute;left:107px;top:190px;color:red;font-size:56px" dir="rtl" data-pptx-paragraph="2">Title</h2>';
    const heading = root.firstElementChild as HTMLElement;

    restoreSlideTextContainerContent(
      heading,
      '<p style="color:red;font-size:56px" dir="rtl" data-pptx-paragraph="2">Title</p>',
    );
    const restored = restoreSlideTextContainerContent(heading, "<p>Title</p>");

    expect(restored.style.position).toBe("absolute");
    expect(restored.style.left).toBe("107px");
    expect(restored.style.color).toBe("");
    expect(restored.style.fontSize).toBe("");
    expect(restored.getAttribute("dir")).toBeNull();
    expect(restored.getAttribute("data-pptx-paragraph")).toBeNull();
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

    const unquoted = restoreSlideTextContainerContent(quote, "<p>Quote</p>");
    expect(unquoted.tagName).toBe("DIV");
    expect(unquoted.querySelector("p")?.textContent).toBe("Quote");
  });

  it("syncs same-root block formatting without moving the canvas object", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<blockquote style="position:absolute;left:10px;color:red" dir="ltr" data-pptx-paragraph="1"><p>Quote</p></blockquote>';
    const quote = root.firstElementChild as HTMLElement;

    const restored = restoreSlideTextContainerContent(
      quote,
      '<blockquote style="color:blue;text-align:center" dir="rtl" data-pptx-paragraph="2"><p>Quote</p></blockquote>',
    );

    expect(restored).toBe(quote);
    expect(restored.style.position).toBe("absolute");
    expect(restored.style.left).toBe("10px");
    expect(restored.style.color).toBe("blue");
    expect(restored.style.textAlign).toBe("center");
    expect(restored.getAttribute("dir")).toBe("rtl");
    expect(restored.getAttribute("data-pptx-paragraph")).toBe("2");
  });

  it("preserves blockquote attributes the editor cannot round-trip", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<blockquote style="position:absolute;left:10px;color:red" dir="rtl" data-pptx-paragraph="1"><p>Quote</p></blockquote>';
    const quote = root.firstElementChild as HTMLElement;

    const restored = restoreSlideTextContainerContent(
      quote,
      '<blockquote style="color:blue"><p>Quote</p></blockquote>',
    );

    expect(restored).toBe(quote);
    expect(restored.style.position).toBe("absolute");
    expect(restored.style.left).toBe("10px");
    expect(restored.style.color).toBe("blue");
    expect(restored.getAttribute("dir")).toBe("rtl");
    expect(restored.getAttribute("data-pptx-paragraph")).toBe("1");
  });

  it("keeps positioned list objects when changing list type", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<ul data-builder-id="list" style="position:absolute;left:12px;list-style-type:disc"><li>First</li></ul>';
    const list = root.firstElementChild as HTMLElement;

    const ordered = restoreSlideTextContainerContent(
      list,
      "<ol><li>First</li></ol>",
    );

    expect(ordered.tagName).toBe("OL");
    expect(ordered.getAttribute("data-builder-id")).toBe("list");
    expect(ordered.style.position).toBe("absolute");
    expect(ordered.style.left).toBe("12px");
    expect(ordered.style.listStyleType).toBe("disc");

    const unordered = restoreSlideTextContainerContent(
      ordered,
      "<ul><li>First</li></ul>",
    );
    expect(unordered.tagName).toBe("UL");
    expect(unordered.querySelector("li")?.textContent).toBe("First");
  });

  it("keeps list-item roots containing nested lists", () => {
    const root = document.createElement("div");
    root.innerHTML =
      "<ul><li><p>First</p><ul><li><p>Nested</p></li></ul></li></ul>";
    const item = root.querySelector("ul > li") as HTMLElement;

    const restored = restoreSlideTextContainerContent(
      item,
      "<p>Updated</p><ul><li><p>Nested updated</p></li></ul>",
    );

    expect(restored).toBe(item);
    expect(restored.tagName).toBe("LI");
    expect(restored.querySelector(":scope > p")?.textContent).toBe("Updated");
    expect(restored.querySelector(":scope > ul li")?.textContent).toBe(
      "Nested updated",
    );
  });

  it("keeps newly created list items as siblings", () => {
    const root = document.createElement("div");
    root.innerHTML = "<ul><li>First</li></ul>";
    const item = root.querySelector("li") as HTMLElement;

    const restored = restoreSlideTextContainerContent(
      item,
      "<ul><li>First</li><li>Second</li></ul>",
    );

    expect(restored).toBe(item);
    expect(item.parentElement?.tagName).toBe("UL");
    expect(
      Array.from(item.parentElement!.children).map(
        (child) => child.textContent,
      ),
    ).toEqual(["First", "Second"]);
  });

  it("converts the actual parent list when editing an item", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<ul data-builder-id="list"><li>First</li><li>Second</li></ul>';
    const item = root.querySelector("li") as HTMLElement;

    const restored = restoreSlideTextContainerContent(
      item,
      "<ol><li>First</li></ol>",
    );

    expect(restored).toBe(item);
    expect(item.parentElement?.tagName).toBe("OL");
    expect(item.parentElement?.getAttribute("data-builder-id")).toBe("list");
    expect(item.parentElement?.children).toHaveLength(2);
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
