import { describe, expect, it } from "vitest";

import type { ElementInfo } from "../types";
import {
  deriveLockedAspectSize,
  elementIdentityKey,
  elementStableKey,
  interactionStateSelectionKey,
} from "./element-identity";

function element(overrides: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tagName: "div",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 100, height: 50 },
    isFlexChild: false,
    isFlexContainer: false,
    ...overrides,
  } as ElementInfo;
}

describe("elementStableKey", () => {
  it("prefers sourceId when present", () => {
    expect(elementStableKey(element({ sourceId: "node-1", id: "el-1" }))).toBe(
      "node-1",
    );
  });

  it("falls through an empty-string sourceId to id/selector/tagName", () => {
    // The bridge (editor-chrome.bridge.ts getElementInfo) reports
    // sourceId: "" — not undefined — for any element that isn't
    // source-backed (e.g. a runtime-only DOM node in a connected
    // localhost/fusion screen). A `??` chain stops at "" (it isn't
    // nullish), so it must be `||` throughout to actually skip it.
    expect(
      elementStableKey(
        element({ sourceId: "", id: "", selector: ".card > .title" }),
      ),
    ).toBe(".card > .title");
  });

  it("does not collapse two different non-source-backed elements to the same key", () => {
    // This is the concrete symptom of the `??` bug: two unrelated elements
    // that both lack sourceId/id would otherwise both resolve to "" and
    // share aspect-ratio-lock state (see useAspectRatioLock) even though
    // they are completely different nodes.
    const a = element({ sourceId: "", selector: ".card:nth-child(1)" });
    const b = element({ sourceId: "", selector: ".card:nth-child(2)" });
    expect(elementStableKey(a)).not.toBe(elementStableKey(b));
  });

  it("falls all the way through to tagName when nothing else is set", () => {
    expect(
      elementStableKey(element({ sourceId: "", id: "", selector: "" })),
    ).toBe("div");
  });
});

describe("elementIdentityKey", () => {
  it("changes when the bounding rect changes, even for the same stable key", () => {
    const a = elementIdentityKey(
      element({
        sourceId: "node-1",
        boundingRect: { x: 0, y: 0, width: 10, height: 10 },
      }),
    );
    const b = elementIdentityKey(
      element({
        sourceId: "node-1",
        boundingRect: { x: 0, y: 0, width: 20, height: 10 },
      }),
    );
    expect(a).not.toBe(b);
  });

  it("uses the same empty-string fall-through as elementStableKey", () => {
    const key = elementIdentityKey(
      element({
        sourceId: "",
        id: "",
        selector: ".sidebar > .item",
        boundingRect: { x: 1, y: 2, width: 3, height: 4 },
      }),
    );
    expect(key).toBe(".sidebar > .item:1:2:3:4");
  });
});

// deriveLockedAspectSize — W/H aspect-ratio lock: derives the paired
// dimension from a captured width/height ratio. See EditPanel.inspectorHelpers.spec.ts
// for the original coverage; duplicated narrowly here since element-identity.ts
// is this file's home now.
describe("deriveLockedAspectSize", () => {
  it("derives height from width using the locked ratio", () => {
    expect(deriveLockedAspectSize("width", 300, 2)).toBe(150);
  });

  it("derives width from height using the locked ratio", () => {
    expect(deriveLockedAspectSize("height", 150, 2)).toBe(300);
  });

  it("rounds to one decimal place", () => {
    expect(deriveLockedAspectSize("width", 100, 3)).toBe(33.3);
  });
});

describe("interactionStateSelectionKey", () => {
  it("stays stable when geometry changes on the same selected element", () => {
    const before = element({
      sourceId: "button_1",
      boundingRect: { x: 10, y: 20, width: 100, height: 40 },
    });
    const after = element({
      sourceId: "button_1",
      boundingRect: { x: 80, y: 90, width: 240, height: 64 },
    });

    expect(interactionStateSelectionKey(before, "screen-a", 1)).toBe(
      interactionStateSelectionKey(after, "screen-a", 1),
    );
  });

  it("changes across screens even when document-local node ids match", () => {
    const selected = element({ sourceId: "button_1" });
    expect(interactionStateSelectionKey(selected, "screen-a", 1)).not.toBe(
      interactionStateSelectionKey(selected, "screen-b", 1),
    );
  });

  it("changes when the selection cardinality changes", () => {
    const selected = element({ sourceId: "button_1" });
    expect(interactionStateSelectionKey(selected, "screen-a", 1)).not.toBe(
      interactionStateSelectionKey(selected, "screen-a", 2),
    );
  });
});
