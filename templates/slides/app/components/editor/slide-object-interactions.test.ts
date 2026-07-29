// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  clientPointToSlideCoordinates,
  cloneSlideObject,
  createSlidesSelectionState,
  ensureSlideObjectId,
  escapedEditingSelection,
  findSlideObjectById,
  getSlideSelectionIdentity,
  getSlideSelectionMode,
  resizeSlideObject,
} from "./slide-object-interactions";

describe("slide object interactions", () => {
  it("places boxes in the autofit layer's unscaled layout coordinates", () => {
    expect(
      clientPointToSlideCoordinates(
        820,
        500,
        { left: 226, top: 80, width: 1700, height: 920 },
        1700,
        920,
      ),
    ).toEqual({ x: 594, y: 420 });
  });

  it("preserves negative coordinates when a slide click is outside its padded layer", () => {
    expect(
      clientPointToSlideCoordinates(
        80,
        40,
        { left: 110, top: 80, width: 1700, height: 920 },
        1700,
        920,
      ),
    ).toEqual({ x: -30, y: -40 });
  });

  it("gives clones a distinct persisted identity and drops runtime ids", () => {
    const object = document.createElement("div");
    object.dataset.builderId = "b-1";
    object.dataset.slideObjectId = "original";
    object.innerHTML = '<span data-builder-id="b-2">Text</span>';

    const clone = cloneSlideObject(object);

    expect(clone.dataset.slideObjectId).not.toBe(object.dataset.slideObjectId);
    expect(clone.querySelectorAll("[data-builder-id]")).toHaveLength(0);
    expect(ensureSlideObjectId(object)).toBe("original");
  });

  it("publishes persisted freeform identity while retaining the runtime selector", () => {
    const object = document.createElement("div");
    object.dataset.slideObjectId = "freeform-1";

    expect(
      getSlideSelectionIdentity(object, '[data-builder-id="b-1"]'),
    ).toEqual({
      selector: '[data-slide-object-id="freeform-1"]',
      runtimeSelector: '[data-builder-id="b-1"]',
      objectId: "freeform-1",
    });
  });

  it("keeps absolute objects in box-selected and honors resizing mode", () => {
    const absoluteObject = { isImage: false, isAbsolute: true };

    expect(getSlideSelectionMode(absoluteObject)).toBe("box-selected");
    expect(getSlideSelectionMode(absoluteObject, "resizing")).toBe("resizing");
  });

  it("publishes canvas text-tool state while the tool is armed", () => {
    expect(
      createSlidesSelectionState({
        deckId: "deck-1",
        slideId: "slide-1",
        slideIndex: 2,
        mode: "canvas",
        items: [],
        drawMode: false,
        pinMode: false,
        textBoxMode: true,
      }),
    ).toEqual({
      deckId: "deck-1",
      slideId: "slide-1",
      slideIndex: 2,
      slideNumber: 3,
      mode: "canvas",
      activeTool: "text",
      items: [],
    });
  });

  it("resolves a persisted object after its DOM path changes", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-fmd-autofit-content>
        <div data-slide-object-id="persisted-text">Text</div>
      </div>
    `;

    expect(findSlideObjectById(root, "persisted-text")?.textContent).toBe(
      "Text",
    );
    expect(findSlideObjectById(root, "missing")).toBeNull();
  });

  it("anchors the opposite corner and enforces a usable resize minimum", () => {
    expect(
      resizeSlideObject(
        { x: 100, y: 50, width: 200, height: 100 },
        { handle: "nw", dx: 250, dy: 150, preserveAspectRatio: false },
      ),
    ).toEqual({ x: 276, y: 126, width: 24, height: 24 });
  });

  it("preserves the edited object as the selected object after Escape", () => {
    expect(escapedEditingSelection("text-box", "other-object")).toEqual({
      editing: null,
      selected: "text-box",
    });
  });
});
