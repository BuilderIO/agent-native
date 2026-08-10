// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  findSmartBlock,
  isTextLeaf,
  shouldStampBuilderId,
} from "./slide-text-targets";

describe("slide text targets", () => {
  it("keeps inline style runs inside their containing text block", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<h2>Keep <span data-slide-inline-style="true">this word</span></h2>';

    const heading = root.querySelector("h2") as HTMLElement;
    const styledRun = root.querySelector("span") as HTMLElement;

    expect(isTextLeaf(styledRun)).toBe(false);
    expect(isTextLeaf(heading)).toBe(true);
    expect(findSmartBlock(styledRun, root)).toBe(heading);
    expect(shouldStampBuilderId(styledRun)).toBe(false);
    expect(shouldStampBuilderId(heading)).toBe(true);
  });
});
