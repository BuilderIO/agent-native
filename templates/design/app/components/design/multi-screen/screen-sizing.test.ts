import { describe, expect, it } from "vitest";

import { getFrameGroupSizeBounds } from "../../../../shared/canvas-math";
import {
  clampScreenDimension,
  clampScreenFrameSize,
  readScreenSizeConstraints,
  screenSizeConstraintsToFrameBounds,
} from "./screen-sizing";

describe("screen sizing constraints", () => {
  it("preserves authored maxima above the shared one-pixel floor", () => {
    const constraints = readScreenSizeConstraints({
      maxWidth: "12px",
      maxHeight: "20px",
    });

    expect(clampScreenDimension(0, "width", constraints)).toBe(1);
    expect(clampScreenFrameSize({ width: 20, height: 8 }, constraints)).toEqual(
      {
        width: 12,
        height: 8,
      },
    );
    expect(screenSizeConstraintsToFrameBounds(constraints)).toEqual({
      minWidth: 1,
      maxWidth: 12,
      minHeight: 1,
      maxHeight: 20,
    });
  });

  it("preserves authored bounds above the one-pixel floor", () => {
    const constraints = readScreenSizeConstraints({
      minWidth: "40px",
      maxWidth: "80px",
      minHeight: "30px",
      maxHeight: "60px",
    });

    expect(
      clampScreenFrameSize({ width: 10, height: 90 }, constraints),
    ).toEqual({
      width: 40,
      height: 60,
    });
    expect(screenSizeConstraintsToFrameBounds(constraints)).toEqual({
      minWidth: 40,
      maxWidth: 80,
      minHeight: 30,
      maxHeight: 60,
    });
  });

  it("makes contradictory authored bounds resolve to the minimum", () => {
    const constraints = readScreenSizeConstraints({
      minWidth: "50px",
      maxWidth: "32px",
    });

    expect(clampScreenDimension(80, "width", constraints)).toBe(50);
    expect(screenSizeConstraintsToFrameBounds(constraints)).toEqual({
      minWidth: 50,
      maxWidth: 50,
    });
  });

  it("normalizes subpixel bounds to the same one-pixel floor as clamping", () => {
    const constraints = readScreenSizeConstraints({
      minWidth: "0.5px",
      maxWidth: "0.25px",
    });

    expect(clampScreenDimension(0.25, "width", constraints)).toBe(1);
    expect(screenSizeConstraintsToFrameBounds(constraints)).toEqual({
      minWidth: 1,
      maxWidth: 1,
    });
  });

  it("passes normalized screen bounds through the shared resize consumer", () => {
    const constraints = readScreenSizeConstraints({
      minWidth: "50px",
      maxWidth: "32px",
      maxHeight: "12px",
    });
    const frameSizeBoundsById = {
      screen: screenSizeConstraintsToFrameBounds(constraints),
    };
    const geometry = { x: 0, y: 0, width: 100, height: 100 };

    expect(
      getFrameGroupSizeBounds([{ id: "screen", geometry }], geometry, {
        minWidth: 1,
        minHeight: 1,
        frameSizeBoundsById,
      }),
    ).toEqual({
      minWidth: 50,
      minHeight: 1,
      maxWidth: 50,
      maxHeight: 12,
    });
  });
});
