// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  findSlideShapeOwner,
  findSmartBlock,
  getSlideCanvasTraversalElements,
  isRichTextBlock,
  isSlideCanvasShortcutTarget,
  isSlideTextEditingTarget,
  isTextLeaf,
  preventSlideLinkNavigation,
  resolveRichTextEditingBlock,
  resolveSlideTextSelectionTarget,
  shouldStampBuilderId,
  shouldTraverseSlideLayerChildren,
} from "./slide-text-targets";

describe("slide text targets", () => {
  it("grabs the nearest painted box around text, like a Google Slides shape", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="fmd-slide">
        <h2 id="title">Bare title</h2>
        <div style="display:flex;flex-direction:column">
          <div id="row" style="display:grid;border-top:1px solid #2a3038">
            <div id="label">LABEL</div><div>Body</div>
          </div>
        </div>
        <div id="card" style="background:#14181d;padding:16px">
          <img id="logo" src="logo.png"><p id="note">Note</p>
        </div>
      </div>
    `;
    document.body.append(root);
    const byId = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;

    expect(findSlideShapeOwner(byId("title"), root)).toBeNull();
    expect(findSlideShapeOwner(byId("label"), root)).toBe(byId("row"));
    expect(findSlideShapeOwner(byId("note"), root)).toBe(byId("card"));
    expect(findSlideShapeOwner(byId("logo"), root)).toBeNull();
    root.remove();
  });

  it("does not treat a full-slide backdrop as a shape", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div id="backdrop" style="background:#111"><p id="text">Text</p></div>`;
    document.body.append(root);
    const backdrop = root.querySelector<HTMLElement>("#backdrop")!;
    const slideRect = DOMRect.fromRect({ width: 960, height: 540 });
    root.getBoundingClientRect = () => slideRect;
    backdrop.getBoundingClientRect = () => slideRect;

    expect(
      findSlideShapeOwner(root.querySelector<HTMLElement>("#text"), root),
    ).toBeNull();
    root.remove();
  });

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
    expect(isSlideCanvasShortcutTarget(document.body, canvas)).toBe(true);
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

  it("restores the canvas identity for nested rich-text blocks", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="fmd-slide">
        <div data-builder-id="text" data-slide-object-id="text-id">
          <p>First paragraph</p>
          <p>Second paragraph</p>
        </div>
      </div>
    `;

    const text = root.querySelector("[data-builder-id='text']") as HTMLElement;
    const paragraph = text.querySelector("p:last-of-type") as HTMLElement;

    expect(resolveSlideTextSelectionTarget(paragraph, root)).toBe(text);
    expect(resolveSlideTextSelectionTarget(text, root)).toBe(text);
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
    expect(shouldTraverseSlideLayerChildren(group)).toBe(true);
    expect(findSmartBlock(text, root)).toBe(text);
    expect(findSmartBlock(group, root)).toBeNull();
    expect(group.style.display).toBe("flex");
    expect(group.querySelector(".stage-label")?.getAttribute("style")).toBe(
      "background:#ffb38a;color:#101820",
    );
  });

  it("does not promote a styled multi-leaf card into one rich-text editor", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="fmd-slide">
        <div class="metric-card" style="border:1px solid #1a1a1a;padding:20px;background:#0f0f0f">
          <div class="metric" style="font-size:54px;color:#01c8f1;line-height:1">~66%</div>
          <div style="font-size:17px;color:#e0e0d7;margin-top:8px">of inbound is from free tools</div>
          <div style="font:13px monospace;color:#9a9997;margin-top:8px">33% blog</div>
        </div>
      </div>
    `;

    const card = root.querySelector(".metric-card") as HTMLElement;
    const metric = root.querySelector(".metric") as HTMLElement;

    expect(findSmartBlock(card, root)).toBeNull();
    expect(findSmartBlock(metric, root)).toBe(metric);
  });

  it("never makes a grid of class-styled cards one edit root", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <style>
        .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
        .card { background: #131316; border: 1px solid #26262b; padding: 16px; }
      </style>
      <div class="fmd-slide">
        <div class="cards">
          <div class="card"><div class="label">ARR</div><div class="value">$412,800</div></div>
          <div class="card"><div class="label">Renewal</div><div class="value">12/15/26</div></div>
          <div class="card"><div class="label">Segment</div><div class="value">Strategic</div></div>
        </div>
      </div>
    `;
    document.body.append(root);
    const cards = root.querySelector<HTMLElement>(".cards")!;
    const [first] = Array.from(root.querySelectorAll<HTMLElement>(".card"));
    const value = first.querySelector<HTMLElement>(".value")!;

    expect(findSmartBlock(value, root)).toBe(value);
    expect(findSmartBlock(cards, root)).toBeNull();
    const block = findSmartBlock(first, root);
    expect(block === null || first.contains(block)).toBe(true);
    root.remove();
  });

  it("still edits a single painted panel of paragraphs as one", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <style>.panel { background: #131316; border-radius: 8px; }</style>
      <div class="fmd-slide">
        <div class="panel"><p id="one">First paragraph</p><p>Second paragraph</p></div>
      </div>
    `;
    document.body.append(root);
    const panel = root.querySelector<HTMLElement>(".panel")!;
    const paragraph = root.querySelector<HTMLElement>("#one")!;
    expect(findSmartBlock(panel, root)).toBe(panel);
    expect(findSmartBlock(paragraph, root)).toBe(paragraph);
    root.remove();
  });

  it("keeps a click on a slide link from opening it, but not a link in editor chrome", () => {
    document.body.innerHTML = `
      <div data-main-slide-canvas="true">
        <div class="slide-content"><p>Read <a href="/report" target="_blank"><b>the report</b></a></p></div>
        <a id="chrome" href="/help">Help</a>
      </div>
    `;
    const canvas = document.querySelector<HTMLElement>(
      "[data-main-slide-canvas]",
    )!;
    canvas.addEventListener("click", preventSlideLinkNavigation, true);
    canvas.addEventListener("auxclick", preventSlideLinkNavigation, true);
    const click = (
      target: Element,
      type = "click",
      init: MouseEventInit = {},
    ) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const run = document.querySelector("b")!;
    expect(click(run)).toBe(true);
    expect(click(run, "click", { metaKey: true })).toBe(true);
    expect(click(run, "auxclick", { button: 1 })).toBe(true);
    expect(click(document.querySelector("p")!)).toBe(false);
    expect(click(document.querySelector("#chrome")!)).toBe(false);
    document.body.innerHTML = "";
  });

  it("does not treat the autofit renderer shell as editable text", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="fmd-slide">
        <div class="fmd-autofit-scale">
          <p>First line</p>
          <p>Second line</p>
        </div>
      </div>
    `;

    const autofit = root.querySelector(".fmd-autofit-scale") as HTMLElement;
    expect(findSmartBlock(autofit, root)).toBeNull();
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

  it("keeps styled semantic bullet wrappers as one canvas block", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div class="fmd-slide"><div data-fmd-autofit-content><div data-builder-id="text" style="display:flex;align-items:baseline;gap:20px"><ul style="--slide-legacy-list:1;list-style:none;padding-left:0"><li style="display:flex;align-items:baseline;gap:20px;--slide-legacy-marker-content:\"●\""><p>First</p></li></ul></div></div></div>';

    const block = root.querySelector("[data-builder-id='text']") as HTMLElement;
    const paragraph = block.querySelector("p") as HTMLElement;

    expect(isRichTextBlock(block)).toBe(true);
    expect(findSmartBlock(paragraph, root)).toBe(block);
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

  it("keeps a heading emptied to a line break enterable", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div class="fmd-slide"><h1 style="position:absolute;left:40px;top:20px;font-size:48px"><br></h1></div>';
    const heading = root.querySelector("h1") as HTMLElement;

    expect(isRichTextBlock(heading)).toBe(true);
    expect(findSmartBlock(heading, root)).toBe(heading);
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
