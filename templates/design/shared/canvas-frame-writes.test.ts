import { describe, expect, it } from "vitest";

import {
  canvasFrameGeometryWriteErrors,
  isCanvasFrameGeometryKey,
  parseCanvasFrameGeometryById,
} from "./canvas-frames.js";

describe("canvas frame write validation", () => {
  it("rejects the string-valued frame that reads back as no dimensions", () => {
    const frame = { x: "651", y: "0", width: "595", height: "842", z: "0" };

    // Without the guard this write persists and then parses to an empty
    // frame, which is why a resize could report success and change nothing.
    expect(parseCanvasFrameGeometryById({ screen: frame })).toEqual({
      screen: {},
    });

    const errors = canvasFrameGeometryWriteErrors(frame, "canvasFrames.screen");
    expect(errors).toHaveLength(5);
    expect(errors[0]).toBe(
      'canvasFrames.screen.x must be a finite number of pixels, received string "651"',
    );
    expect(errors).toContain(
      'canvasFrames.screen.width must be a finite number of pixels, received string "595"',
    );
  });

  it("accepts numeric geometry and ignores absent fields", () => {
    expect(
      canvasFrameGeometryWriteErrors(
        { x: 651, y: 0, width: 595, height: 842 },
        "canvasFrames.screen",
      ),
    ).toEqual([]);
    expect(
      canvasFrameGeometryWriteErrors({ width: 595 }, "canvasFrames.screen"),
    ).toEqual([]);
  });

  it("rejects non-finite numbers and non-object frames", () => {
    expect(
      canvasFrameGeometryWriteErrors(
        { width: Number.NaN },
        "canvasFrames.screen",
      ),
    ).toHaveLength(1);
    expect(canvasFrameGeometryWriteErrors(null, "canvasFrames.screen")).toEqual(
      [
        "canvasFrames.screen must be an object of numeric pixel values, received null",
      ],
    );
  });

  it("knows which keys carry geometry", () => {
    expect(isCanvasFrameGeometryKey("width")).toBe(true);
    expect(isCanvasFrameGeometryKey("rotation")).toBe(true);
    expect(isCanvasFrameGeometryKey("label")).toBe(false);
  });
});
