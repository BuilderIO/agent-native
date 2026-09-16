// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  findSmartBlock,
  getSlideCanvasTraversalElements,
  isRichTextBlock,
  isSlideCanvasShortcutTarget,
  isSlideTextEditingTarget,
  isTextLeaf,
  resolveRichTextEditingBlock,
  shouldStampBuilderId,
  shouldTraverseSlideLayerChildren,
} from "./slide-text-targets";

describe("slide text targets", () => {
  it("traverses flow-layout roots and groups without selecting renderer shells or members", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="fmd-slide" data-builder-id="frame">
        <div data-fmd-autofit-content data-builder-id="autofit">
          <h1 data-builder-id="title">Flow title</h1>
          <div class="fmd-slide-group" data-builder-id="group" data-slide-object-id="group-id">
            <div data-builder-id="member" data-slide-object-id="member-id">Shape</div>
          </div>
          <div class="fmd-layout-spacer" data-builder-id="spacer"></div>
        </div>
      </div>
    `;

    expect(
      getSlideCanvasTraversalElements(root).map((element) =>
        element.getAttribute("data-builder-id"),
      ),
    ).toEqual(["title", "group"]);
    expect(
      shouldStampBuilderId(
        root.querySelector<HTMLElement>(".fmd-slide-group")!,
      ),
    ).toBe(true);
  });

  it("routes canvas shortcuts only while focus is inside the slide canvas", () => {
    const canvas = document.createElement("div");
    const selectedObject = document.createElement("div");
    const toolbarButton = document.createElement("button");
    const activeElement = document.createElement("div");
    canvas.append(selectedObject);

    expect(isSlideCanvasShortcutTarget(selectedObject, canvas)).toBe(true);
    expect(isSlideCanvasShortcutTarget(toolbarButton, canvas)).toBe(false);
    expect(isSlideCanvasShortcutTarget(activeElement, null)).toBe(false);
    expect(isSlideCanvasShortcutTarget(null, canvas)).toBe(false);
  });

  it("keeps inline style runs inside their containing text block", () => {
    const root = document.createElement("div");
    root.className = "slide-content";
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

    expect(isRichTextBlock(layer)).toBe(true);
    expect(shouldStampBuilderId(layer)).toBe(true);
    expect(shouldStampBuilderId(paragraph)).toBe(false);
    expect(findSmartBlock(paragraph, root)).toBe(layer);
  });

  it("edits text leaves inside imported smart groups without replacing their layout", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="fmd-slide">
        <div class="stage-card" style="display:flex;flex-direction:column;gap:16px;background:#101820">
          <div class="stage-label" style="background:#ffb38a;color:#101820">STAGE 1</div>
          <div class="stage-title" style="font-size:32px;color:#ffffff">Curiosity</div>
          <div class="stage-copy" style="font-size:18px;color:rgba(255,255,255,.7)">An occasional cup.</div>
        </div>
      </div>
    `;

    const group = root.querySelector(".stage-card") as HTMLElement;
    const text = root.querySelector(".stage-title") as HTMLElement;

    expect(shouldStampBuilderId(group)).toBe(true);
    expect(shouldStampBuilderId(text)).toBe(true);
    expect(findSmartBlock(text, root)).toBe(text);
    expect(findSmartBlock(group, root)).toBe(group);
    expect(group.style.display).toBe("flex");
    expect(group.querySelector(".stage-label")?.getAttribute("style")).toBe(
      "background:#ffb38a;color:#101820",
    );
  });

  it("keeps nested smart-group leaves in the Layers tree", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="fmd-slide">
        <div class="layout-wrapper">
          <div class="stage-card">
            <div class="stage-label">STAGE 1</div>
            <div class="stage-title">Curiosity</div>
          </div>
        </div>
      </div>
    `;

    const wrapper = root.querySelector(".layout-wrapper") as HTMLElement;
    const group = root.querySelector(".stage-card") as HTMLElement;
    const text = root.querySelector(".stage-title") as HTMLElement;

    expect(isRichTextBlock(group)).toBe(true);
    expect(isRichTextBlock(wrapper)).toBe(false);
    expect(shouldTraverseSlideLayerChildren(wrapper)).toBe(true);
    expect(shouldTraverseSlideLayerChildren(group)).toBe(true);
    expect(shouldTraverseSlideLayerChildren(text)).toBe(false);
    expect(shouldStampBuilderId(wrapper)).toBe(true);
    expect(shouldStampBuilderId(group)).toBe(true);
    expect(shouldStampBuilderId(text)).toBe(true);
    expect(findSmartBlock(text, root)).toBe(text);
  });

  it("keeps a structural wrapper around a text block selectable", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="fmd-slide">
        <div data-fmd-autofit-content>
          <div class="layout-wrapper">
            <div class="text-block"><p>Text block</p></div>
          </div>
        </div>
      </div>
    `;

    const wrapper = root.querySelector(".layout-wrapper") as HTMLElement;
    const textBlock = root.querySelector(".text-block") as HTMLElement;
    const paragraph = textBlock.querySelector("p") as HTMLElement;

    expect(isRichTextBlock(wrapper)).toBe(false);
    expect(shouldTraverseSlideLayerChildren(wrapper)).toBe(true);
    expect(shouldStampBuilderId(wrapper)).toBe(true);
    expect(isRichTextBlock(textBlock)).toBe(true);
    expect(shouldStampBuilderId(textBlock)).toBe(true);
    expect(shouldStampBuilderId(paragraph)).toBe(false);
    expect(findSmartBlock(paragraph, root)).toBe(textBlock);
  });

  it("keeps table cells selectable instead of owning them as one text layer", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="fmd-slide">
        <table>
          <tbody><tr><td><p>Cell text</p></td></tr></tbody>
        </table>
      </div>
    `;

    const table = root.querySelector("table") as HTMLElement;
    const cell = root.querySelector("td") as HTMLElement;
    const paragraph = root.querySelector("p") as HTMLElement;

    expect(shouldStampBuilderId(cell)).toBe(true);
    expect(findSmartBlock(paragraph, root)).not.toBe(table);
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

  it("keeps dividers inside one canvas text block", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div class="fmd-slide"><div data-fmd-autofit-content><div data-builder-id="text"><p>Before</p><hr><p>After</p></div></div></div>';

    const block = root.querySelector("[data-builder-id='text']") as HTMLElement;
    const paragraph = block.querySelector("p:last-of-type") as HTMLElement;

    expect(isRichTextBlock(block)).toBe(true);
    expect(findSmartBlock(paragraph, root)).toBe(block);
  });

  it("keeps a divider-only editor wrapper as one canvas text block", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div class="fmd-slide"><div data-fmd-autofit-content><div data-builder-id="text"><hr></div></div></div>';

    const block = root.querySelector("[data-builder-id='text']") as HTMLElement;
    const divider = block.querySelector("hr") as HTMLElement;

    expect(isRichTextBlock(block)).toBe(true);
    expect(findSmartBlock(divider, root)).toBe(block);
  });

  it("does not rewrite unsupported h5 and h6 headings", () => {
    const root = document.createElement("div");
    root.innerHTML = "<h5>Small heading</h5><h6>Smaller heading</h6>";

    for (const heading of Array.from(root.children) as HTMLElement[]) {
      expect(isTextLeaf(heading)).toBe(false);
      expect(isRichTextBlock(heading)).toBe(false);
      expect(findSmartBlock(heading, root)).toBeNull();
    }
  });
});
