// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  clientPointToSlideCoordinates,
  cloneSlideObject,
  createSlidesSelectionState,
  ensureSlideObjectId,
  escapedEditingSelection,
  findSlideObjectById,
  freezeSlideElementForFreeform,
  getSelectedObjectDragStart,
  getSlideSelectionIdentity,
  getSlideSelectionMode,
  removeSlideObjectAndLayoutSpacer,
  resolveSlideObjectContainingBlock,
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

  it("uses the nearest positioned ancestor for nested freeform coordinates", () => {
    const layer = document.createElement("div");
    const layoutGroup = document.createElement("div");
    const positionedParent = document.createElement("div");
    const text = document.createElement("p");
    positionedParent.style.position = "absolute";
    positionedParent.append(text);
    layoutGroup.append(positionedParent);
    layer.append(layoutGroup);
    document.body.append(layer);

    const containingBlock = resolveSlideObjectContainingBlock(text, layer);

    expect(containingBlock).toBe(positionedParent);
    expect(
      clientPointToSlideCoordinates(
        250,
        130,
        { left: 200, top: 100, width: 800, height: 600 },
        800,
        600,
      ),
    ).toEqual({ x: 50, y: 30 });
  });

  it("falls back to the autofit layer for normal nested layout", () => {
    const layer = document.createElement("div");
    const layoutGroup = document.createElement("div");
    const text = document.createElement("p");
    layoutGroup.append(text);
    layer.append(layoutGroup);
    document.body.append(layer);

    expect(resolveSlideObjectContainingBlock(text, layer)).toBe(layer);
  });

  it("gives clones a distinct persisted identity and drops runtime ids", () => {
    const object = document.createElement("div");
    object.dataset.builderId = "b-1";
    object.dataset.slideObjectId = "original";
    object.innerHTML = `
      <span data-builder-id="b-2">Text</span>
      <div data-slide-object-id="nested-object">Nested object</div>
    `;

    const clone = cloneSlideObject(object);
    const originalIds = new Set(
      [
        object,
        ...object.querySelectorAll<HTMLElement>("[data-slide-object-id]"),
      ].map((node) => node.dataset.slideObjectId),
    );
    const cloneIds = [
      clone,
      ...clone.querySelectorAll<HTMLElement>("[data-slide-object-id]"),
    ].map((node) => node.dataset.slideObjectId);

    expect(clone.dataset.slideObjectId).not.toBe(object.dataset.slideObjectId);
    expect(clone.querySelectorAll("[data-builder-id]")).toHaveLength(0);
    expect(new Set(cloneIds)).toHaveLength(cloneIds.length);
    expect(cloneIds.some((id) => originalIds.has(id))).toBe(false);
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

  it("arms a selected object's body for dragging while reserving its perimeter", () => {
    expect(
      getSelectedObjectDragStart({
        targetWithinSelectedObject: true,
        pointerWithinMoveBand: false,
      }),
    ).toBe("body");
    expect(
      getSelectedObjectDragStart({
        targetWithinSelectedObject: true,
        pointerWithinMoveBand: true,
      }),
    ).toBe("perimeter");
    expect(
      getSelectedObjectDragStart({
        targetWithinSelectedObject: false,
        pointerWithinMoveBand: false,
      }),
    ).toBeNull();
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

  it.each([
    ["nw", { x: 140, y: 80, width: 160, height: 70 }],
    ["n", { x: 100, y: 80, width: 200, height: 70 }],
    ["ne", { x: 100, y: 80, width: 240, height: 70 }],
    ["w", { x: 140, y: 50, width: 160, height: 100 }],
    ["e", { x: 100, y: 50, width: 240, height: 100 }],
    ["sw", { x: 140, y: 50, width: 160, height: 130 }],
    ["s", { x: 100, y: 50, width: 200, height: 130 }],
    ["se", { x: 100, y: 50, width: 240, height: 130 }],
  ] as const)(
    "resizes and anchors the opposite edge for the %s handle",
    (handle, expected) => {
      expect(
        resizeSlideObject(
          { x: 100, y: 50, width: 200, height: 100 },
          { handle, dx: 40, dy: 30, preserveAspectRatio: false },
        ),
      ).toEqual(expected);
    },
  );

  it.each([
    ["nw", 500, 500, { x: 276, y: 126, width: 24, height: 24 }],
    ["n", 0, 500, { x: 100, y: 126, width: 200, height: 24 }],
    ["ne", -500, 500, { x: 100, y: 126, width: 24, height: 24 }],
    ["w", 500, 0, { x: 276, y: 50, width: 24, height: 100 }],
    ["e", -500, 0, { x: 100, y: 50, width: 24, height: 100 }],
    ["sw", 500, -500, { x: 276, y: 50, width: 24, height: 24 }],
    ["s", 0, -500, { x: 100, y: 50, width: 200, height: 24 }],
    ["se", -500, -500, { x: 100, y: 50, width: 24, height: 24 }],
  ] as const)(
    "keeps the opposite edge anchored when the %s handle reaches the minimum",
    (handle, dx, dy, expected) => {
      expect(
        resizeSlideObject(
          { x: 100, y: 50, width: 200, height: 100 },
          { handle, dx, dy, preserveAspectRatio: false },
        ),
      ).toEqual(expected);
    },
  );

  it("uses Shift aspect locking for corners while midpoint handles remain axis-only", () => {
    expect(
      resizeSlideObject(
        { x: 100, y: 50, width: 200, height: 100 },
        { handle: "nw", dx: 30, dy: 10, preserveAspectRatio: true },
      ),
    ).toEqual({ x: 130, y: 65, width: 170, height: 85 });

    expect(
      resizeSlideObject(
        { x: 100, y: 50, width: 200, height: 100 },
        { handle: "w", dx: 30, dy: 99, preserveAspectRatio: true },
      ),
    ).toEqual({ x: 130, y: 50, width: 170, height: 100 });
  });

  it("preserves the edited object as the selected object after Escape", () => {
    expect(escapedEditingSelection("text-box", "other-object")).toEqual({
      editing: null,
      selected: "text-box",
    });
  });

  it("freezes an in-flow text block without removing its layout slot", () => {
    const parent = document.createElement("div");
    const text = document.createElement("h1");
    text.dataset.builderId = "heading";
    text.textContent = "Slide title";
    parent.append(text);

    const spacer = freezeSlideElementForFreeform(
      text,
      { x: 120, y: 80, width: 420, height: 64 },
      {
        display: "block",
        flexGrow: "0",
        flexShrink: "1",
        flexBasis: "auto",
        alignSelf: "auto",
      },
    );

    expect(parent.children).toHaveLength(2);
    expect(parent.firstElementChild).toBe(spacer);
    expect(spacer.classList.contains("fmd-layout-spacer")).toBe(true);
    expect(spacer.style.visibility).toBe("hidden");
    expect(spacer.style.width).toBe("420px");
    expect(spacer.dataset.builderId).toBeUndefined();
    expect(text.style.position).toBe("absolute");
    expect(text.style.left).toBe("120px");
    expect(text.style.top).toBe("80px");
    expect(text.dataset.slideObjectId).toBeTruthy();
    expect(spacer.dataset.slideLayoutSpacerFor).toBe(
      text.dataset.slideObjectId,
    );

    removeSlideObjectAndLayoutSpacer(text);
    expect(parent.children).toHaveLength(0);
  });
});
