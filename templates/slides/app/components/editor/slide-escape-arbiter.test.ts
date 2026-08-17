import { describe, expect, it } from "vitest";

import { decideSlideEscape } from "./slide-escape-arbiter";

describe("Slide Escape arbiter", () => {
  it("uses the documented priority order", () => {
    expect(
      decideSlideEscape({
        editing: true,
        activeGesture: true,
        activeMode: true,
        multiSelection: true,
        singleSelection: true,
        targetOwnsEscape: false,
        overlayOwnsEscape: false,
      }),
    ).toBe("edit");
    expect(
      decideSlideEscape({
        editing: false,
        activeGesture: true,
        activeMode: true,
        multiSelection: true,
        singleSelection: true,
        targetOwnsEscape: false,
        overlayOwnsEscape: false,
      }),
    ).toBe("gesture");
    expect(
      decideSlideEscape({
        editing: false,
        activeGesture: false,
        activeMode: false,
        multiSelection: true,
        singleSelection: true,
        targetOwnsEscape: false,
        overlayOwnsEscape: false,
      }),
    ).toBe("multi-selection");
  });

  it("leaves dialogs and other owned targets alone", () => {
    expect(
      decideSlideEscape({
        editing: true,
        activeGesture: true,
        activeMode: true,
        multiSelection: true,
        singleSelection: true,
        targetOwnsEscape: true,
        overlayOwnsEscape: false,
      }),
    ).toBe("none");
    expect(
      decideSlideEscape({
        editing: true,
        activeGesture: true,
        activeMode: true,
        multiSelection: true,
        singleSelection: true,
        targetOwnsEscape: false,
        overlayOwnsEscape: true,
      }),
    ).toBe("none");
  });
});
