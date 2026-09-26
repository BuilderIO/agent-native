
import { describe, expect, it } from "vitest";

import type { ElementInfo } from "../types";
import { effectsSelectionIsMixed } from "./effects-properties";
import { elementStableKey } from "./element-identity";

function elementWithRect(
  overrides: Partial<ElementInfo> & {
    boundingRect: ElementInfo["boundingRect"];
  },
): ElementInfo {
  return {
    tagName: "div",
    selector: "div.card",
    computedStyles: {},
    inlineStyles: {},
    classes: [],
    ...overrides,
  } as ElementInfo;
}

describe("effectsSelectionIsMixed", () => {
  it("is false when every effects-relevant style agrees across the selection", () => {
    expect(
      effectsSelectionIsMixed({
        boxShadow: "0px 4px 12px 0px rgba(0,0,0,0.25)",
        filter: "none",
        backdropFilter: "none",
      }),
    ).toBe(false);
  });

  it("is true when box-shadow differs across a multi-selection (Mixed sentinel)", () => {
    expect(
      effectsSelectionIsMixed({
        boxShadow: "Mixed",
        filter: "none",
      }),
    ).toBe(true);
  });

  it("is true when filter (layer blur) differs across a multi-selection", () => {
    expect(effectsSelectionIsMixed({ filter: "Mixed" })).toBe(true);
  });

  it("is true when either backdrop-filter alias differs across a multi-selection", () => {
    expect(effectsSelectionIsMixed({ backdropFilter: "Mixed" })).toBe(true);
    expect(effectsSelectionIsMixed({ webkitBackdropFilter: "Mixed" })).toBe(
      true,
    );
  });

  it('does not false-positive on a real value that merely contains the word "mixed"', () => {
    expect(
      effectsSelectionIsMixed({ boxShadow: "0px 0px 0px 0px Mixed City" }),
    ).toBe(false);
  });
});

describe("elementStableKey (used by the effects hidden-effect stash)", () => {
  it("stays identical across a resize/move of the same element", () => {
    const before = elementWithRect({
      sourceId: "node-42",
      boundingRect: { x: 0, y: 0, width: 100, height: 40 },
    });
    const afterResize = elementWithRect({
      sourceId: "node-42",
      boundingRect: { x: 250, y: 80, width: 340, height: 96 },
    });
    expect(elementStableKey(before)).toBe(elementStableKey(afterResize));
  });

  it("falls back through sourceId -> id -> selector -> tagName", () => {
    const bySourceId = elementWithRect({
      sourceId: "src-1",
      id: "dom-1",
      selector: "#dom-1",
      boundingRect: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(elementStableKey(bySourceId)).toBe("src-1");

    const byId = elementWithRect({
      id: "dom-1",
      selector: "#dom-1",
      boundingRect: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(elementStableKey(byId)).toBe("dom-1");

    const bySelector = elementWithRect({
      selector: "#dom-1",
      boundingRect: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(elementStableKey(bySelector)).toBe("#dom-1");

    const byTagName = elementWithRect({
      tagName: "section",
      selector: undefined,
      boundingRect: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(elementStableKey(byTagName)).toBe("section");
  });

  it("differs between two genuinely different elements at the same position", () => {
    const a = elementWithRect({
      sourceId: "node-a",
      boundingRect: { x: 0, y: 0, width: 50, height: 50 },
    });
    const b = elementWithRect({
      sourceId: "node-b",
      boundingRect: { x: 0, y: 0, width: 50, height: 50 },
    });
    expect(elementStableKey(a)).not.toBe(elementStableKey(b));
  });
});
