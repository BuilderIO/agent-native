// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  findSmartBlock,
  isRichTextBlock,
  isTextLeaf,
  isSlideTextEditingTarget,
  resolveRichTextEditingBlock,
  shouldStampBuilderId,
} from "./slide-text-targets";

describe("slide text targets", () => {
  it("keeps inline style runs inside their containing text block", () => {
    const root = document.createElement("div");
    root.className = "slide-content";
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

  it("keeps persisted text boxes selectable on single click while preserving explicit edit targets", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="fmd-slide">
        <div class="fmd-text-box" data-slide-object-id="text-box-1">
          Existing text box
          <div>Nested text box content</div>
        </div>
      </div>
    `;

    const textBox = root.querySelector(".fmd-text-box") as HTMLElement;
    const nestedText = textBox.querySelector("div") as HTMLElement;

    expect(findSmartBlock(textBox, root)).toBe(textBox);
    expect(
      findSmartBlock(textBox, root, {
        includeTextBoxes: false,
      }),
    ).toBeNull();
    expect(findSmartBlock(nestedText, root)).toBe(nestedText);
    expect(
      findSmartBlock(nestedText, root, {
        includeTextBoxes: false,
      }),
    ).toBeNull();
  });

  it("treats semantic rich text as one canvas block", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div class="fmd-slide"><div data-fmd-autofit-content><div data-builder-id="text"><ul><li>First</li><li>Second</li></ul></div></div></div>';

    const block = root.querySelector("[data-builder-id='text']") as HTMLElement;
    const list = block.querySelector("ul") as HTMLElement;
    const item = block.querySelector("li") as HTMLElement;

    expect(isRichTextBlock(block)).toBe(true);
    expect(resolveRichTextEditingBlock(list)).toBe(block);
    expect(findSmartBlock(item, root)).toBe(block);
  });
});
