// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  cloneSlideObject,
  ensureSlideObjectId,
  escapedEditingSelection,
  findSlideObjectById,
  resizeSlideObject,
} from "./slide-object-interactions";

describe("slide object interactions", () => {
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
