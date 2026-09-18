/**
 * Effects-section bug-hunt fixes (Figma-parity pass).
 *
 * 1. `effectsSelectionIsMixed` — Effects had no multi-select "Mixed" handling
 *    at all, unlike Fill/Stroke. `parseShadowLayers("Mixed")` would parse the
 *    literal sentinel string as a bogus single shadow layer (color: "Mixed"),
 *    and editing any of its fields would commit an invalid
 *    `box-shadow: ... Mixed` to every selected element. The section now gates
 *    on this predicate and shows a "Click + to replace" hint instead, same as
 *    Fill/Stroke.
 * 2. The hidden-effect stash (used by the eye-toggle on shadows/layer-blur/
 *    backdrop-blur) was keyed by `elementIdentityKey`, which folds in the
 *    element's bounding rect and therefore changes on every resize/move.
 *    Hiding an effect, then resizing/moving the element, then showing it
 *    again silently lost the stashed original value and fell back to a
 *    generic default instead. Fixed by keying the stash with
 *    `elementStableKey` (element-identity.ts) instead — the same helper
 *    `useAspectRatioLock` uses for the identical reason. This file
 *    previously carried its own local copy of that helper
 *    (`stableEffectElementKey`) with a `??`-vs-`||` bug matching the one
 *    fixed in element-identity.ts (an empty-string `sourceId` — the bridge's
 *    reported value for non-source-backed elements — short-circuited past
 *    `id`/`selector` under `??`, collapsing every such element to the same
 *    key); it now imports the shared, already-fixed helper instead of
 *    duplicating it.
 */

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
    // isMixedValue only matches the exact sentinel string "Mixed", not any
    // value that happens to contain it as a substring.
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
