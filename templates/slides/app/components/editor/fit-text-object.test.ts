// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import {
  hasInlineBottom,
  hasInlineHeight,
  isFitFreeformFrame,
  shrinkTextToFit,
  textRunsIn,
} from "./fit-text-object";

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

function box(style: string, className = "") {
  const element = document.createElement("div");
  element.className = className;
  element.setAttribute("style", style);
  element.textContent = "Text";
  document.body.append(element);
  return element;
}

describe("fit freeform frame", () => {
  it("treats auto and empty inline height and bottom alike", () => {
    expect(hasInlineHeight(box("height:auto"))).toBe(false);
    expect(hasInlineHeight(box("height:40px"))).toBe(true);
    expect(hasInlineBottom(box("bottom:auto"))).toBe(false);
    expect(hasInlineBottom(box("bottom:40px"))).toBe(true);
  });

  it("is fit for absolute or fixed boxes with no inline height or bottom", () => {
    expect(isFitFreeformFrame(box("position:absolute"))).toBe(true);
    expect(isFitFreeformFrame(box("position:fixed;height:auto"))).toBe(true);
    expect(isFitFreeformFrame(box("position:absolute;bottom:auto"))).toBe(true);
    expect(isFitFreeformFrame(box("position:absolute;height:40px"))).toBe(
      false,
    );
    expect(isFitFreeformFrame(box("position:absolute;bottom:40px"))).toBe(
      false,
    );
    expect(isFitFreeformFrame(box(""))).toBe(false);
  });

  it("reads position from the stylesheet, not only the inline style", () => {
    const style = document.createElement("style");
    style.textContent = ".pinned { position: absolute; }";
    document.head.append(style);

    expect(isFitFreeformFrame(box("", "pinned"))).toBe(true);
    expect(isFitFreeformFrame(box("bottom:12px", "pinned"))).toBe(false);
  });
});

describe("shrink text to fit", () => {
  const sizes = (elements: readonly HTMLElement[]) =>
    elements.map((element) => element.style.getPropertyValue("font-size"));

  it("steps every run down in whole px until it fits", () => {
    const title = box("font-size:40px");
    const body = box("font-size:20px");
    const result = shrinkTextToFit(
      [title, body],
      () => Number.parseFloat(title.style.fontSize) <= 34,
    );
    expect(result).toBe("fitted");
    expect(sizes([title, body])).toEqual(["34px", "17px"]);
  });

  it("stops at 12px and 65% of the start size, and then restores it", () => {
    const title = box("font-size:40px");
    const small = box("font-size:14px;color:red");
    const seen: string[][] = [];
    const result = shrinkTextToFit([title, small], () => {
      seen.push(sizes([title, small]));
      return false;
    });
    expect(result).toBe("cannot-fit");
    expect(seen.at(-1)).toEqual(["26px", "12px"]);
    expect(small.getAttribute("style")).toBe("font-size:14px;color:red");
    expect(title.getAttribute("style")).toBe("font-size:40px");
  });

  it("only picks the text that holds characters of its own", () => {
    const frame = box("");
    frame.textContent = "";
    frame.innerHTML = "<div><p>Line <b>bold</b></p><span></span></div>";
    expect(textRunsIn(frame).map((element) => element.tagName)).toEqual([
      "P",
      "B",
    ]);
  });
});
