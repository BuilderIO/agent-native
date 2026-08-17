import { describe, expect, it } from "vitest";

import {
  moveSlideObject,
  resizeSlideObject,
  type SlideObjectGeometry,
} from "./slide-object-interactions";

const start: SlideObjectGeometry = { x: 100, y: 80, width: 240, height: 120 };

describe("slide object interactions", () => {
  it("moves an object without changing its size", () => {
    expect(moveSlideObject(start, 32, -12)).toEqual({
      x: 132,
      y: 68,
      width: 240,
      height: 120,
    });
  });

  it("resizes from the southeast handle", () => {
    expect(resizeSlideObject(start, "se", 40, 20)).toEqual({
      x: 100,
      y: 80,
      width: 280,
      height: 140,
    });
  });

  it("keeps the opposite corner fixed when resizing from the northwest", () => {
    expect(resizeSlideObject(start, "nw", -20, -10)).toEqual({
      x: 80,
      y: 70,
      width: 260,
      height: 130,
    });
  });

  it("clamps text boxes to a usable minimum size", () => {
    expect(resizeSlideObject(start, "nw", 300, 200)).toEqual({
      x: 316,
      y: 176,
      width: 24,
      height: 24,
    });
  });
});
