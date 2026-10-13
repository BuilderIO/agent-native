import { describe, expect, it } from "vitest";

import {
  isAutoLayoutDisplay,
  marginHandlesApply,
  type MarginHandleContext,
} from "./spacing-handle-rule";

const PLAIN_FRAME: MarginHandleContext = {
  margins: [0, 0, 0, 0],
  anyAuto: false,
  parentDisplay: "block",
  position: "absolute",
};

describe("isAutoLayoutDisplay", () => {
  it("is true only for flex and grid displays", () => {
    for (const display of ["flex", "inline-flex", "grid", "inline-grid"]) {
      expect(isAutoLayoutDisplay(display)).toBe(true);
    }
    for (const display of ["block", "inline", "inline-block", "none", ""]) {
      expect(isAutoLayoutDisplay(display)).toBe(false);
    }
    expect(isAutoLayoutDisplay(undefined)).toBe(false);
  });
});

describe("marginHandlesApply", () => {
  it("offers nothing on a plain zero-margin frame", () => {
    expect(marginHandlesApply(PLAIN_FRAME)).toBe(false);
    expect(marginHandlesApply({ ...PLAIN_FRAME, position: "relative" })).toBe(
      false,
    );
    expect(
      marginHandlesApply({ ...PLAIN_FRAME, parentDisplay: undefined }),
    ).toBe(false);
  });

  it("offers handles for any authored margin, including negative and auto", () => {
    expect(marginHandlesApply({ ...PLAIN_FRAME, margins: [0, 0, 0, 12] })).toBe(
      true,
    );
    expect(marginHandlesApply({ ...PLAIN_FRAME, margins: [-8, 0, 0, 0] })).toBe(
      true,
    );
    expect(marginHandlesApply({ ...PLAIN_FRAME, anyAuto: true })).toBe(true);
  });

  it("offers zero-margin handles on an in-flow item of a flex or grid parent", () => {
    for (const parentDisplay of [
      "flex",
      "inline-flex",
      "grid",
      "inline-grid",
    ]) {
      expect(
        marginHandlesApply({
          ...PLAIN_FRAME,
          position: "relative",
          parentDisplay,
        }),
      ).toBe(true);
      expect(
        marginHandlesApply({
          ...PLAIN_FRAME,
          position: "static",
          parentDisplay,
        }),
      ).toBe(true);
    }
  });

  it("does not treat an out-of-flow child of a flex parent as a layout item", () => {
    for (const position of ["absolute", "fixed"]) {
      expect(
        marginHandlesApply({ ...PLAIN_FRAME, position, parentDisplay: "flex" }),
      ).toBe(false);
    }
  });
});
