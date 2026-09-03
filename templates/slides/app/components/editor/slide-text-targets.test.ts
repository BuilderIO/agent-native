// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  findSmartBlock,
  isSlideRichTextLayer,
  isSlideTextEditingTarget,
  isTextLeaf,
  shouldStampBuilderId,
} from "./slide-text-targets";

describe("slide text targets", () => {
  it("keeps inline style runs inside their containing text block", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div class="fmd-slide"><h2>Keep <span data-slide-inline-style="true">this word</span></h2></div>';

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

  it("keeps rich text descendants inside one layer", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="fmd-slide">
        <div>
          <p>Heading</p>
          <ul><li><p>First point</p></li><li><p>Second point</p></li></ul>
        </div>
      </div>
    `;

    const layer = root.querySelector(".fmd-slide > div") as HTMLElement;
    const paragraph = layer.querySelector("p") as HTMLElement;

    expect(isSlideRichTextLayer(layer)).toBe(true);
    expect(shouldStampBuilderId(layer)).toBe(true);
    expect(shouldStampBuilderId(paragraph)).toBe(false);
    expect(findSmartBlock(paragraph, root)).toBe(layer);
  });

  it("keeps table structure out of rich-text ownership", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="fmd-slide">
        <table>
          <tbody><tr><td><p>Cell text</p></td></tr></tbody>
        </table>
      </div>
    `;

    const table = root.querySelector("table") as HTMLElement;
    const paragraph = root.querySelector("p") as HTMLElement;

    expect(isSlideRichTextLayer(table)).toBe(false);
    expect(findSmartBlock(paragraph, root)).toBe(paragraph);
  });
});
