import { describe, expect, it } from "vitest";

import {
  isUsableSelection,
  mapPointToSource,
  mapRectToSource,
  rectFromPoints,
} from "./screenshot-region";

describe("rectFromPoints", () => {
  it("describes the same rectangle whichever way the drag ran", () => {
    const downRight = rectFromPoints({ x: 10, y: 20 }, { x: 110, y: 70 });
    const upLeft = rectFromPoints({ x: 110, y: 70 }, { x: 10, y: 20 });

    expect(downRight).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    expect(upLeft).toEqual(downRight);
  });
});

describe("isUsableSelection", () => {
  it("ignores a click or a twitch", () => {
    expect(isUsableSelection(null)).toBe(false);
    expect(isUsableSelection({ x: 0, y: 0, width: 0, height: 0 })).toBe(false);
    expect(isUsableSelection({ x: 0, y: 0, width: 200, height: 3 })).toBe(
      false,
    );
  });

  it("accepts a real drag", () => {
    expect(isUsableSelection({ x: 0, y: 0, width: 40, height: 40 })).toBe(true);
  });
});

describe("mapRectToSource", () => {
  const displayed = { width: 960, height: 540 };
  const source = { width: 3840, height: 2160 };

  it("scales the selection back up to source pixels", () => {
    expect(
      mapRectToSource(
        { x: 100, y: 50, width: 200, height: 100 },
        displayed,
        source,
      ),
    ).toEqual({ x: 400, y: 200, width: 800, height: 400 });
  });

  it("crops to the edge when the drag overshoots it", () => {
    // Dragging off the side of the image is the normal way to select a strip
    // along the edge, so it must clamp rather than fail.
    expect(
      mapRectToSource(
        { x: 900, y: 500, width: 400, height: 400 },
        displayed,
        source,
      ),
    ).toEqual({ x: 3600, y: 2000, width: 240, height: 160 });
  });

  it("refuses a selection that rounds away to nothing", () => {
    expect(
      mapRectToSource({ x: 0, y: 0, width: 0, height: 0 }, displayed, source),
    ).toBeNull();
  });

  it("refuses to divide by an unmeasured image", () => {
    expect(
      mapRectToSource(
        { x: 0, y: 0, width: 10, height: 10 },
        { width: 0, height: 0 },
        source,
      ),
    ).toBeNull();
  });
});

describe("mapPointToSource", () => {
  it("maps a point on the right and bottom edges, where a 1x1 rect maps to nothing", () => {
    // An arrow released just past the picture is clamped onto its edge; it
    // must land on the edge, not be dropped.
    const displayed = { width: 400, height: 300 };
    const source = { width: 4000, height: 3000 };
    expect(mapRectToSource({ x: 400, y: 300, width: 1, height: 1 }, displayed, source))
      .toBeNull();
    expect(mapPointToSource({ x: 400, y: 300 }, displayed, source)).toEqual({
      x: 4000,
      y: 3000,
    });
  });

  it("scales and clamps", () => {
    expect(
      mapPointToSource({ x: 100, y: -5 }, { width: 200, height: 100 }, { width: 1000, height: 500 }),
    ).toEqual({ x: 500, y: 0 });
  });
});
