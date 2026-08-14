// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  findSmartBlock,
  isTextLeaf,
  isSlideTextEditingTarget,
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

  it("recognizes an active text block even when focus has moved to the page", () => {
    const block = document.createElement("div");
    block.contentEditable = "true";
    block.dataset.editingBlock = "true";
    const text = document.createElement("span");
    text.textContent = "editing";
    block.append(text);
    document.body.append(block);

    expect(isSlideTextEditingTarget(text, document.body)).toBe(true);
    expect(isSlideTextEditingTarget(document.body, document.body, block)).toBe(
      true,
    );
  });
});
