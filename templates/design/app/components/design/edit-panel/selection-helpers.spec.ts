import { describe, expect, it } from "vitest";

import type { ElementInfo } from "../types";
import {
  isMixedValue,
  MIXED_VALUE,
  mixedElementFromSelection,
  sameOrMixed,
} from "./selection-helpers";

function makeElement(overrides: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tagName: "div",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 100, height: 40 },
    isFlexChild: false,
    isFlexContainer: false,
    ...overrides,
  };
}

describe("sameOrMixed", () => {
  it("returns the shared value when every entry matches", () => {
    expect(sameOrMixed(["16px", "16px", "16px"])).toBe("16px");
  });

  it("returns MIXED_VALUE as soon as one entry differs", () => {
    expect(sameOrMixed(["16px", "16px", "8px"])).toBe(MIXED_VALUE);
  });

  it("returns an empty string for an empty array", () => {
    expect(sameOrMixed([])).toBe("");
  });

  it("returns the sole value for a single-element array", () => {
    expect(sameOrMixed(["solid"])).toBe("solid");
  });

  it("treats two equal empty strings as the same (not mixed)", () => {
    expect(sameOrMixed(["", ""])).toBe("");
  });

  it("treats the literal string 'NaN' the same as any other equal string", () => {
    expect(sameOrMixed(["NaN", "NaN"])).toBe("NaN");
  });

  it("does not special-case the literal string 'Mixed' as an input value", () => {
    expect(sameOrMixed(["Mixed"])).toBe("Mixed");
  });
});

describe("isMixedValue", () => {
  it("is true only for the exact MIXED_VALUE sentinel", () => {
    expect(isMixedValue(MIXED_VALUE)).toBe(true);
    expect(isMixedValue("Mixed")).toBe(true);
  });

  it("is false for other strings, including near-misses", () => {
    expect(isMixedValue("mixed")).toBe(false);
    expect(isMixedValue("Mixed ")).toBe(false);
    expect(isMixedValue("16px")).toBe(false);
    expect(isMixedValue("")).toBe(false);
  });

  it("is false for undefined", () => {
    expect(isMixedValue(undefined)).toBe(false);
  });
});

describe("mixedElementFromSelection", () => {
  it("returns null for an empty selection", () => {
    expect(mixedElementFromSelection([])).toBeNull();
  });

  it("mixes computedStyles values that differ across the selection", () => {
    const a = makeElement({ computedStyles: { opacity: "1" } });
    const b = makeElement({ computedStyles: { opacity: "0.5" } });
    const merged = mixedElementFromSelection([a, b]);
    expect(merged?.computedStyles.opacity).toBe(MIXED_VALUE);
  });

  it("keeps a shared computedStyles value when all elements agree", () => {
    const a = makeElement({ computedStyles: { opacity: "1" } });
    const b = makeElement({ computedStyles: { opacity: "1" } });
    const merged = mixedElementFromSelection([a, b]);
    expect(merged?.computedStyles.opacity).toBe("1");
  });

  it("keeps authored sizing only when every selected element agrees", () => {
    const a = makeElement({
      authoredSizeStyles: { width: "240px", height: "auto" },
    });
    const b = makeElement({
      authoredSizeStyles: { width: "240px", height: "auto" },
    });
    expect(mixedElementFromSelection([a, b])?.authoredSizeStyles).toEqual({
      width: "240px",
      height: "auto",
    });
    expect(
      mixedElementFromSelection([
        a,
        makeElement({ authoredSizeStyles: { width: "320px" } }),
      ])?.authoredSizeStyles,
    ).toBeUndefined();
  });

  it("treats a property present on only one element as Mixed, not a shared default", () => {
    const text = makeElement({ computedStyles: { fontSize: "16px" } });
    const rect = makeElement({ computedStyles: {} });
    const merged = mixedElementFromSelection([text, rect]);
    expect(merged?.computedStyles.fontSize).toBe(MIXED_VALUE);
  });

  it("keeps the shared component name when every element is the same component", () => {
    const a = makeElement({ componentName: "Button" });
    const b = makeElement({ componentName: "Button" });
    const merged = mixedElementFromSelection([a, b]);
    expect(merged?.componentName).toBe("Button");
  });

  it("clears componentName (not 'Mixed') when a component is selected alongside a plain element", () => {
    const button = makeElement({ componentName: "Button" });
    const plainDiv = makeElement({ componentName: undefined });
    const merged = mixedElementFromSelection([button, plainDiv]);
    expect(merged?.componentName).toBeUndefined();
    expect(merged?.componentName).not.toBe(MIXED_VALUE);
  });

  it("clears componentName regardless of which element is last in the array", () => {
    const button = makeElement({ componentName: "Button" });
    const plainDiv = makeElement({ componentName: undefined });
    const merged = mixedElementFromSelection([plainDiv, button]);
    expect(merged?.componentName).toBeUndefined();
  });

  it("clears componentName when two different components are selected together", () => {
    const button = makeElement({ componentName: "Button" });
    const card = makeElement({ componentName: "Card" });
    const merged = mixedElementFromSelection([button, card]);
    expect(merged?.componentName).toBeUndefined();
  });

  it("keeps isGridContainer true only when every element is a grid container", () => {
    const a = makeElement({ isGridContainer: true });
    const b = makeElement({ isGridContainer: true });
    expect(mixedElementFromSelection([a, b])?.isGridContainer).toBe(true);
  });

  it("collapses isGridContainer to false for a mixed grid + non-grid selection, regardless of order", () => {
    const grid = makeElement({ isGridContainer: true });
    const nonGrid = makeElement({ isGridContainer: false });
    expect(mixedElementFromSelection([nonGrid, grid])?.isGridContainer).toBe(
      false,
    );
    expect(mixedElementFromSelection([nonGrid, grid])?.isGridContainer).toBe(
      false,
    );
  });

  it("preserves parentDisplay/parentAutoLayout/parentLayout when every element shares the same parent", () => {
    const parentBoundingRect = { x: 0, y: 0, width: 300, height: 100 };
    const parentAutoLayout = {
      display: "flex",
      selector: "#parent",
      sourceId: "parent-1",
      boundingRect: parentBoundingRect,
    };
    const parentLayout = {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-start",
      gap: "8px",
    };
    const a = makeElement({
      parentDisplay: "flex",
      parentAutoLayout,
      parentBoundingRect,
      parentLayout,
    });
    const b = makeElement({
      parentDisplay: "flex",
      parentAutoLayout,
      parentBoundingRect: { ...parentBoundingRect },
      parentLayout,
    });
    const merged = mixedElementFromSelection([a, b]);
    expect(merged?.parentDisplay).toBe("flex");
    expect(merged?.parentAutoLayout).toEqual(parentAutoLayout);
    expect(merged?.parentBoundingRect).toEqual(parentBoundingRect);
    expect(merged?.parentLayout).toEqual(parentLayout);
  });

  it("collapses parentDisplay/parentAutoLayout/parentLayout to undefined when elements come from different parents", () => {
    const a = makeElement({
      parentDisplay: "flex",
      parentBoundingRect: { x: 0, y: 0, width: 100, height: 40 },
      parentAutoLayout: {
        display: "flex",
        sourceId: "parent-a",
        boundingRect: { x: 0, y: 0, width: 100, height: 40 },
      },
      parentLayout: { display: "flex", flexDirection: "row" },
    });
    const b = makeElement({
      parentDisplay: "block",
      parentBoundingRect: { x: 0, y: 0, width: 200, height: 80 },
      parentAutoLayout: {
        display: "block",
        sourceId: "parent-b",
        boundingRect: { x: 0, y: 0, width: 200, height: 80 },
      },
      parentLayout: { display: "block" },
    });
    const merged = mixedElementFromSelection([a, b]);
    expect(merged?.parentDisplay).toBeUndefined();
    expect(merged?.parentAutoLayout).toBeUndefined();
    expect(merged?.parentBoundingRect).toBeUndefined();
    expect(merged?.parentLayout).toBeUndefined();
    const mergedReversed = mixedElementFromSelection([b, a]);
    expect(mergedReversed?.parentDisplay).toBeUndefined();
    expect(mergedReversed?.parentAutoLayout).toBeUndefined();
    expect(mergedReversed?.parentBoundingRect).toBeUndefined();
    expect(mergedReversed?.parentLayout).toBeUndefined();
  });

  it("leaves parentDisplay/parentAutoLayout/parentLayout unchanged for a single-element selection", () => {
    const parentLayout = { display: "grid", gridTemplateColumns: "1fr 1fr" };
    const only = makeElement({
      parentDisplay: "grid",
      parentAutoLayout: {
        display: "grid",
        sourceId: "parent-1",
        boundingRect: { x: 0, y: 0, width: 300, height: 100 },
      },
      parentLayout,
    });
    const merged = mixedElementFromSelection([only]);
    expect(merged?.parentDisplay).toBe("grid");
    expect(merged?.parentAutoLayout).toEqual(only.parentAutoLayout);
    expect(merged?.parentLayout).toEqual(parentLayout);
  });

  it("clears pendingNodeId on the merged element instead of leaking it from the last element", () => {
    const a = makeElement({ pendingNodeId: undefined });
    const b = makeElement({ pendingNodeId: "draft-text-123" });
    const merged = mixedElementFromSelection([a, b]);
    expect(merged?.pendingNodeId).toBeUndefined();
  });

  it("computes the bounding box as the union of all selected elements", () => {
    const a = makeElement({
      boundingRect: { x: 0, y: 0, width: 100, height: 40 },
    });
    const b = makeElement({
      boundingRect: { x: 200, y: 50, width: 20, height: 20 },
    });
    const merged = mixedElementFromSelection([a, b]);
    expect(merged?.boundingRect).toEqual({
      x: 0,
      y: 0,
      width: 220,
      height: 70,
    });
  });
});
