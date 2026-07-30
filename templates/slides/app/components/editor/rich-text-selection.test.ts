// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  applyInlineTextStyle,
  getEditableTextRange,
  getInlineTextStyleSnapshot,
  getInlineTextStyleSnapshotForRange,
  restoreEditableTextRange,
  snapshotEditableTextRange,
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

  it("preserves nested markup and applies style across multiple text nodes", () => {
    const block = editable("one <strong>two</strong> three");
    const [one, two] = [
      block.firstChild as Text,
      block.querySelector("strong")!.firstChild as Text,
    ];
    rangeFor(one, 2, two, 2);

    applyInlineTextStyle(block, { fontWeight: "700", color: "rgb(0, 0, 255)" });

    const wrapper = block.querySelector("span[data-slide-inline-style]")!;
    expect(wrapper.textContent).toBe("e tw");
    expect(wrapper.querySelector("strong")?.textContent).toBe("tw");
    expect(wrapper.querySelector("strong")?.style.color).toBe("rgb(0, 0, 255)");
    expect(block.textContent).toBe("one two three");
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
      '<span style="color: rgb(96, 159, 248); font-size: 20px">blue</span><span style="color: rgb(239, 68, 68); font-size: 20px">red</span>',
    );
    const blue = block.firstChild!.firstChild as Text;
    const red = block.lastChild!.firstChild as Text;

    rangeFor(blue, 0, blue, 4);
    const blueSnapshot = getInlineTextStyleSnapshot(block);
    expect(blueSnapshot.scope).toBe("selection");
    expect(blueSnapshot.values.color).toBe("rgb(96, 159, 248)");
    expect(blueSnapshot.values.fontSize).toBe("20px");

    rangeFor(blue, 0, red, 3);
    const mixed = getInlineTextStyleSnapshot(block);
    expect(mixed.scope).toBe("selection");
    expect(mixed.values.color).toBeNull();
    expect(mixed.mixed).toContain("color");
    expect(mixed.values.fontSize).toBe("20px");

    const savedMixed = window.getSelection()!.getRangeAt(0).cloneRange();
    window.getSelection()!.removeAllRanges();
    expect(
      getInlineTextStyleSnapshotForRange(block, savedMixed).mixed,
    ).toContain("color");
  });
});
