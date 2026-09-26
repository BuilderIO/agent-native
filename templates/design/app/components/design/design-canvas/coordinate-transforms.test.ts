import { describe, expect, it } from "vitest";

import { getScreenContentPointFromClient } from "./coordinate-transforms";

describe("getScreenContentPointFromClient — scrollOffset", () => {
  it("defaults to {left: 0, top: 0} when omitted (pre-existing unscrolled behavior)", () => {
    const point = getScreenContentPointFromClient(
      150,
      220,
      { left: 100, top: 50, width: 800, height: 600 },
      { width: 800, height: 600 },
    );
    expect(point).toEqual({ x: 50, y: 170 });
  });

  it("adds an unscaled scroll offset directly, NOT divided/multiplied by scale", () => {
    const point = getScreenContentPointFromClient(
      100, // clientX === iframeRect.left (visible left edge)
      50, // clientY === iframeRect.top (visible top edge)
      { left: 100, top: 50, width: 400, height: 300 },
      { width: 800, height: 600 },
      { left: 0, top: 600 },
    );
    expect(point).toEqual({ x: 0, y: 600 });
  });

  it("combines a non-zero rendered offset with scroll (50% zoom)", () => {
    const point = getScreenContentPointFromClient(
      100 + 200,
      50 + 150,
      { left: 100, top: 50, width: 400, height: 300 },
      { width: 800, height: 600 },
      { left: 50, top: 600 },
    );
    expect(point).toEqual({ x: 400 + 50, y: 300 + 600 });
  });

  it("adds scroll unchanged at 100% zoom (rect matches content size)", () => {
    const point = getScreenContentPointFromClient(
      150,
      220,
      { left: 100, top: 50, width: 800, height: 600 },
      { width: 800, height: 600 },
      { left: 10, top: 20 },
    );
    expect(point).toEqual({ x: 50 + 10, y: 170 + 20 });
  });

  it("adds scroll unchanged even when content size is zero/unknown (scale falls back to 1)", () => {
    const point = getScreenContentPointFromClient(
      140,
      95,
      { left: 40, top: 45, width: 0, height: 0 },
      { width: 0, height: 0 },
      { left: 5, top: 5 },
    );
    expect(point).toEqual({ x: 100 + 5, y: 50 + 5 });
  });

  it("undoes a zoomed-in outer transform (rect larger than content size) with scroll", () => {
    const point = getScreenContentPointFromClient(
      10 + 100,
      20 + 60,
      { left: 10, top: 20, width: 1600, height: 1200 },
      { width: 800, height: 600 },
      { left: 30, top: 40 },
    );
    expect(point).toEqual({ x: 50 + 30, y: 30 + 40 });
  });
});
