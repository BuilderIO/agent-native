// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import {
  hasInlineBottom,
  hasInlineHeight,
  isFitFreeformFrame,
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
