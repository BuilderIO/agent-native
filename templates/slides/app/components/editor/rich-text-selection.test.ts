// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  applyInlineTextStyle,
  getEditableTextRange,
  getInlineTextStyleSnapshot,
  getInlineTextStyleSnapshotForRange,
  normalizeInlineTextSpans,
  normalizeSlideClipboardHtml,
  restoreEditableTextRange,
  selectAllEditableText,
  setInlineTextLink,
  snapshotEditableTextRange,
  toggleInlineTextFormat,
} from "./rich-text-selection";

function rangeFor(
  start: Text,
  startOffset: number,
  end: Text = start,
  endOffset = end.length,
) {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
}

function editable(html: string) {
  const element = document.createElement("div");
  element.contentEditable = "true";
  element.innerHTML = html;
  document.body.append(element);
  return element;
}

describe("rich text selection", () => {
  it("styles a partial word without changing unselected text", () => {
    const block = editable("hello world");
    const text = block.firstChild as Text;
    rangeFor(text, 6, text, 11);

    const result = applyInlineTextStyle(block, { color: "#609ff8" });

    expect(result.scope).toBe("selection");
    expect(block.textContent).toBe("hello world");
    expect(block.innerHTML).toContain("hello ");
    expect(block.querySelector("span")?.textContent).toBe("world");
    expect(block.querySelector("span")?.style.color).toBe("#609ff8");
  });

  it("styles each selected run inside its own markup without splitting it", () => {
    const block = editable("one <strong>two</strong> three");
    const [one, two] = [
      block.firstChild as Text,
      block.querySelector("strong")!.firstChild as Text,
    ];
    rangeFor(one, 2, two, 2);

    applyInlineTextStyle(block, { fontWeight: "700", color: "rgb(0, 0, 255)" });

    const wrappers = Array.from(
      block.querySelectorAll<HTMLSpanElement>("span[data-slide-inline-style]"),
    );
    expect(wrappers.map((wrapper) => wrapper.textContent)).toEqual([
      "e ",
      "tw",
    ]);
    expect(wrappers[1].parentElement?.tagName).toBe("STRONG");
    expect(wrappers.every((wrapper) => wrapper.style.color)).toBe(true);
    expect(block.querySelectorAll("strong")).toHaveLength(1);
    expect(block.querySelector("strong")!.textContent).toBe("two");
    expect(block.textContent).toBe("one two three");
    expect(window.getSelection()!.toString()).toBe("e tw");
  });

  it("styles part of a pill inside the one pill", () => {
    const block = editable(
      'Solar <span class="pill" style="background: rgb(220, 252, 231); padding: 4px 10px;">Done now</span> more',
    );
    const lead = block.firstChild as Text;
    const pillText = block.querySelector(".pill")!.firstChild as Text;
    rangeFor(lead, 3, pillText, 4);

    applyInlineTextStyle(block, { color: "rgb(0, 0, 255)" });

    const pills = block.querySelectorAll<HTMLSpanElement>(".pill");
    expect(pills).toHaveLength(1);
    expect(pills[0].textContent).toBe("Done now");
    expect(pills[0].firstElementChild?.textContent).toBe("Done");
    expect(block.textContent).toBe("Solar Done now more");
  });

  it("never removes an empty author span or merges author spans", () => {
    const block = editable(
      '<span class="dot" style="width: 8px; height: 8px; background: red;"></span><span style="color: red;">a</span><span style="color: red;">b</span> tail',
    );
    const a = block.children[1].firstChild as Text;
    const tail = block.lastChild as Text;
    rangeFor(a, 0, tail, 3);

    applyInlineTextStyle(block, { fontSize: "30px" });

    expect(block.querySelector(".dot")).not.toBeNull();
    expect(block.querySelectorAll('span[style="color: red;"]')).toHaveLength(2);
  });

  it("normalizes only its own style spans", () => {
    const block = editable(
      '<span data-slide-inline-style="true" style="color: red;">a</span><span data-slide-inline-style="true" style="color: red;">b</span><span data-slide-inline-style="true"></span><span></span><span data-slide-inline-style="true">c</span>',
    );

    normalizeInlineTextSpans(block);

    expect(block.innerHTML).toBe(
      '<span data-slide-inline-style="true" style="color: red;">ab</span><span></span>c',
    );
  });

  it("toggles bold from the computed weight, writing 400 over a class", () => {
    const style = document.createElement("style");
    style.textContent = ".heavy { font-weight: 700; }";
    document.head.append(style);
    const block = editable('<span class="heavy">Heavy</span> plain');
    const heavy = block.querySelector(".heavy")!.firstChild as Text;
    rangeFor(heavy, 0, heavy, 5);

    toggleInlineTextFormat(block, "bold");

    const unbolded = block.querySelector<HTMLSpanElement>(
      ".heavy > span[data-slide-inline-style]",
    )!;
    expect(unbolded.style.fontWeight).toBe("400");
    expect(block.querySelector(".heavy")!.getAttribute("class")).toBe("heavy");

    const plain = block.lastChild as Text;
    rangeFor(plain, 1, plain, 6);
    toggleInlineTextFormat(block, "bold");
    const bolded = block.lastElementChild as HTMLSpanElement;
    expect(bolded.textContent).toBe("plain");
    expect(bolded.style.fontWeight).toBe("700");
    style.remove();
  });

  it("toggles italic and removes a line drawn by a fully selected ancestor", () => {
    const block = editable(
      '<a style="text-decoration: underline;">under</a> rest',
    );
    const under = block.querySelector("a")!.firstChild as Text;
    rangeFor(under, 0, under, 5);

    toggleInlineTextFormat(block, "italic");
    expect(
      block.querySelector<HTMLSpanElement>("span[data-slide-inline-style]")!
        .style.fontStyle,
    ).toBe("italic");

    rangeFor(under, 0, under, 5);
    toggleInlineTextFormat(block, "underline");
    expect(block.querySelector("a")!.style.textDecorationLine).toBe("none");
    expect(block.querySelectorAll("a")).toHaveLength(1);

    rangeFor(under, 0, under, 5);
    toggleInlineTextFormat(block, "underline");
    expect(
      block.querySelector<HTMLSpanElement>("span[data-slide-inline-style]")!
        .style.textDecorationLine,
    ).toBe("underline");
  });

  it("overrides existing nested inline styles without touching their markup", () => {
    const block = editable(
      '<span style="color: rgb(239, 68, 68)"><em>before</em> after</span>',
    );
    const text = block.querySelector("em")!.firstChild as Text;
    rangeFor(text, 1, text, 5);

    applyInlineTextStyle(block, { color: "rgb(96, 159, 248)" });

    const styled = block.querySelector<HTMLSpanElement>(
      "span[data-slide-inline-style]",
    )!;
    expect(styled.textContent).toBe("efor");
    expect(styled.parentElement?.tagName).toBe("EM");
    expect(styled.style.color).toBe("rgb(96, 159, 248)");
    expect(block.textContent).toBe("before after");
  });

  it("uses block fallback for collapsed and foreign selections", () => {
    const block = editable("inside");
    const other = editable("outside");
    const insideText = block.firstChild as Text;
    const outsideText = other.firstChild as Text;

    rangeFor(insideText, 2, insideText, 2);
    expect(getEditableTextRange(block)).toBeNull();
    expect(applyInlineTextStyle(block, { color: "blue" }).scope).toBe("block");

    rangeFor(outsideText, 0, outsideText, 3);
    expect(getEditableTextRange(block)).toBeNull();
    expect(applyInlineTextStyle(block, { color: "blue" }).scope).toBe("block");
    expect(block.innerHTML).toBe("inside");
  });

  it("snapshots and restores a valid selection after inspector focus changes", () => {
    const block = editable("hello");
    const text = block.firstChild as Text;
    rangeFor(text, 1, text, 4);
    const saved = snapshotEditableTextRange(block)!;
    window.getSelection()!.removeAllRanges();

    expect(restoreEditableTextRange(block, saved)).toBe(true);
    expect(window.getSelection()!.toString()).toBe("ell");
  });

  it("selects the whole editable block without selecting the page", () => {
    const block = editable("first line<br>second line");

    expect(selectAllEditableText(block)).toBe(true);
    expect(window.getSelection()!.toString()).toBe("first linesecond line");
    expect(getEditableTextRange(block)).not.toBeNull();
  });

  it("keeps the returned range connected across adjacent matching styles", () => {
    const block = editable("one two");
    const text = block.firstChild as Text;
    rangeFor(text, 0, text, 3);
    applyInlineTextStyle(block, { color: "#609ff8" });

    const trailingText = block.lastChild as Text;
    rangeFor(trailingText, 1, trailingText, 4);
    const result = applyInlineTextStyle(block, { color: "#609ff8" });

    expect(result.scope).toBe("selection");
    expect(
      result.range && block.contains(result.range.commonAncestorContainer),
    ).toBe(true);
    expect(restoreEditableTextRange(block, result.range ?? null)).toBe(true);
    expect(window.getSelection()!.toString()).toBe("two");
  });

  it("reuses one wrapper for repeated styles on the same selection", () => {
    const block = editable("resize me");
    const text = block.firstChild as Text;
    rangeFor(text, 0, text, text.length);

    applyInlineTextStyle(block, { fontSize: "20px" });
    applyInlineTextStyle(block, { fontSize: "32px" });

    const wrappers = block.querySelectorAll("span[data-slide-inline-style]");
    expect(wrappers).toHaveLength(1);
    expect((wrappers[0] as HTMLSpanElement).style.fontSize).toBe("32px");
    expect(window.getSelection()!.toString()).toBe("resize me");
  });

  it("reports a single inline value and null for mixed selected runs", () => {
    const block = editable(
      '<span style="color: rgb(96, 159, 248); font-size: 20px; font-family: Inter, sans-serif">blue</span><span style="color: rgb(239, 68, 68); font-size: 20px; font-family: Poppins, sans-serif">red</span>',
    );
    const blue = block.firstChild!.firstChild as Text;
    const red = block.lastChild!.firstChild as Text;

    rangeFor(blue, 0, blue, 4);
    const blueSnapshot = getInlineTextStyleSnapshot(block);
    expect(blueSnapshot.scope).toBe("selection");
    expect(blueSnapshot.values.color).toBe("rgb(96, 159, 248)");
    expect(blueSnapshot.values.fontSize).toBe("20px");
    expect(blueSnapshot.values.fontFamily).toBe("Inter, sans-serif");

    rangeFor(blue, 0, red, 3);
    const mixed = getInlineTextStyleSnapshot(block);
    expect(mixed.scope).toBe("selection");
    expect(mixed.values.color).toBeNull();
    expect(mixed.mixed).toContain("color");
    expect(mixed.values.fontSize).toBe("20px");
    expect(mixed.values.fontFamily).toBeNull();
    expect(mixed.mixed).toContain("fontFamily");

    const savedMixed = window.getSelection()!.getRangeAt(0).cloneRange();
    window.getSelection()!.removeAllRanges();
    expect(
      getInlineTextStyleSnapshotForRange(block, savedMixed).mixed,
    ).toContain("color");
  });
});

describe("setInlineTextLink", () => {
  it("links each selected run without splitting author elements", () => {
    const block = document.createElement("p");
    block.innerHTML = 'Read <em class="pill">the docs</em> now';
    document.body.replaceChildren(block);
    const [before, inside] = [
      block.firstChild as Text,
      block.querySelector("em")!.firstChild as Text,
    ];
    rangeFor(before, 5, inside, 3);

    expect(setInlineTextLink(block, "https://example.com").scope).toBe(
      "selection",
    );
    expect(block.innerHTML).toBe(
      'Read <em class="pill"><a href="https://example.com">the</a> docs</em> now',
    );

    rangeFor(block.querySelector("a")!.firstChild as Text, 0);
    setInlineTextLink(block, null);
    expect(block.innerHTML).toBe('Read <em class="pill">the docs</em> now');
  });

  it("splits an author link around a re-linked part instead of nesting links", () => {
    const block = document.createElement("p");
    block.innerHTML =
      '<a href="https://old.test" style="color: green">2026 sustainability report</a>';
    document.body.replaceChildren(block);
    const text = block.querySelector("a")!.firstChild as Text;
    rangeFor(text, 5, text, 19);

    setInlineTextLink(block, "https://new.test");

    expect(block.innerHTML).toBe(
      '<a href="https://old.test" style="color: green">2026 </a><a href="https://new.test" style="color: green">sustainability</a><a href="https://old.test" style="color: green"> report</a>',
    );
    const reparsed = document.createElement("p");
    reparsed.innerHTML = block.innerHTML;
    expect(reparsed.innerHTML).toBe(block.innerHTML);
  });
});

describe("normalizeSlideClipboardHtml", () => {
  it("keeps rich clipboard styling without source layout or editor context", () => {
    const html = normalizeSlideClipboardHtml(
      '<p data-pm-slice="1 1 []" style="position:absolute;left:80px;font-size:34px;font-weight:500">First</p><p style="font-size:34px"><strong><br></strong></p><p style="visibility:hidden;pointer-events:none;height:76px">Spacer</p><p style="position:absolute;top:185px;width:800px;font-size:34px;font-weight:500"><span style="color:rgb(34,211,238)"><strong>Blue text</strong></span></p>',
    );

    expect(html).toContain("First");
    expect(html).toContain("Blue text");
    expect(html).toContain("font-size: 34px");
    expect(html).toContain("font-weight: 500");
    expect(html).toContain("color: rgb(34, 211, 238)");
    expect(html).toContain("<br>");
    expect(html).not.toContain("data-pm-slice");
    expect(html).not.toContain("position:");
    expect(html).not.toContain("visibility:");
    expect(html).not.toContain("Spacer");
  });

  it("does not persist embedded clipboard image payloads", () => {
    const html = normalizeSlideClipboardHtml(
      '<p>Copied text<img src="data:image/png;base64,AAAA" alt="image label"></p><p><img src="data:image/png;base64,BBBB"></p>',
    );

    expect(html).toContain("Copied text");
    expect(html).toContain("image label");
    expect(html).not.toContain("data:image");
  });
});

describe("review round 3", () => {
  function drawsLine(text: Text, block: HTMLElement, line: string) {
    for (
      let element = text.parentElement;
      element && block.contains(element);
      element = element.parentElement
    ) {
      if (getComputedStyle(element).textDecorationLine.includes(line)) {
        return element;
      }
    }
    return null;
  }

  it("removes an underline drawn by a partly selected ancestor, keeping it on the rest", () => {
    const block = editable(
      '<span id="u" style="text-decoration-line: underline; text-decoration-style: wavy; text-decoration-color: red;">Hello world</span>',
    );
    const text = block.querySelector("#u")!.firstChild as Text;
    rangeFor(text, 6, text, 11);
    toggleInlineTextFormat(block, "underline");
    const world = Array.from(block.querySelectorAll("*"))
      .flatMap((element) => Array.from(element.childNodes))
      .find(
        (node): node is Text => node instanceof Text && node.data === "world",
      )!;
    const hello = Array.from(block.querySelectorAll("*"))
      .flatMap((element) => Array.from(element.childNodes))
      .find(
        (node): node is Text => node instanceof Text && node.data === "Hello ",
      )!;
    expect(drawsLine(world, block, "underline")).toBeNull();
    const kept = drawsLine(hello, block, "underline")!;
    expect(kept).not.toBeNull();
    expect(getComputedStyle(kept).textDecorationStyle).toBe("wavy");
    expect(getComputedStyle(kept).textDecorationColor).toBe("red");
    expect(block.querySelectorAll("#u")).toHaveLength(1);
    expect(block.textContent).toBe("Hello world");
  });

  it("strips element identity from clipboard HTML but keeps its look", () => {
    const html = normalizeSlideClipboardHtml(
      '<p id="a">x<span id="b" data-slide-object-id="c" class="k" style="color: red">y</span></p>',
    );
    expect(html).toBe('<p>x<span class="k" style="color: red">y</span></p>');
  });
});
