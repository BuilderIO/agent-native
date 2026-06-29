import { describe, expect, it } from "vitest";

import {
  mergeCanvasFramePlacements,
  parseCanvasFrameGeometryById,
} from "./canvas-frames";

describe("canvas frame geometry helpers", () => {
  it("parses only finite frame geometry values", () => {
    expect(
      parseCanvasFrameGeometryById({
        screen_a: { x: 10, y: 20, width: 390, height: 844, z: 2 },
        screen_b: { x: Number.NaN, y: 0, width: "wide" },
        invalid: null,
      }),
    ).toEqual({
      screen_a: { x: 10, y: 20, width: 390, height: 844, z: 2 },
      screen_b: { y: 0 },
    });
  });

  it("merges placements resolved by filename into existing frame data", () => {
    const result = mergeCanvasFramePlacements({
      existing: {
        existing_file: { x: 0, y: 0, width: 1440, height: 1024 },
      },
      placements: [
        {
          filename: "checkout.html",
          x: 1760,
          y: 0,
          width: 390,
          height: 844,
        },
      ],
      resolveFileId: (placement) =>
        placement.filename === "checkout.html" ? "checkout_file" : undefined,
    });

    expect(result.canvasFrames).toEqual({
      existing_file: { x: 0, y: 0, width: 1440, height: 1024 },
      checkout_file: { x: 1760, y: 0, width: 390, height: 844 },
    });
    expect(result.placedFrames).toEqual([
      {
        fileId: "checkout_file",
        filename: "checkout.html",
        frame: { x: 1760, y: 0, width: 390, height: 844 },
      },
    ]);
  });

  it("rejects placements that do not identify a file", () => {
    expect(() =>
      mergeCanvasFramePlacements({
        existing: {},
        placements: [{ x: 0, y: 0 }],
        resolveFileId: () => undefined,
      }),
    ).toThrow("canvasFrames entries require fileId or filename");
  });
});
