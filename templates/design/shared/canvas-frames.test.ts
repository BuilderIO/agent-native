import { describe, expect, it } from "vitest";

import {
  mergeCanvasFramePlacements,
  nextFreeCanvasRowY,
  numericDesignDataWriteError,
  parseCanvasFrameGeometryById,
} from "./canvas-frames";
import {
  getResponsiveBreakpointHeightPx,
  MAX_SANE_FRAME_DIMENSION_PX,
} from "./responsive-frame-layout";

describe("numericDesignDataWriteError", () => {
  it("rejects string dimensions", () => {
    expect(
      numericDesignDataWriteError(["canvasFrames", "screen_a"], {
        x: 0,
        width: "800",
      }),
    ).toContain('must be a finite JSON number, received the string "800"');
    expect(
      numericDesignDataWriteError(
        ["canvasFrames", "screen_a", "height"],
        "600px",
      ),
    ).toContain("must be a finite JSON number");
    expect(
      numericDesignDataWriteError(
        ["screenMetadata", "screen_a", "width"],
        "800",
      ),
    ).toContain("must be a finite JSON number");
    expect(
      numericDesignDataWriteError(
        ["screenMetadata", "screen_a", "breakpointHeights", "390"],
        2400,
      ),
    ).toBeNull();
    expect(
      numericDesignDataWriteError(
        ["screenMetadata", "screen_a", "breakpointHeights", "390"],
        "2400",
      ),
    ).toContain("must be a finite JSON number");
    expect(
      numericDesignDataWriteError(
        ["screenMetadata", "screen_a", "breakpointHeights", "390"],
        0,
      ),
    ).toContain("must be positive");
    expect(
      numericDesignDataWriteError(
        ["screenMetadata", "screen_a", "breakpointHeights", "390"],
        MAX_SANE_FRAME_DIMENSION_PX + 1,
      ),
    ).toContain(`must be at most ${MAX_SANE_FRAME_DIMENSION_PX} px`);
    expect(
      numericDesignDataWriteError(
        ["screenMetadata", "screen_a", "breakpointHeights", "390"],
        1e308,
      ),
    ).toContain(`must be at most ${MAX_SANE_FRAME_DIMENSION_PX} px`);
    expect(
      numericDesignDataWriteError(["screenMetadata", "screen_a"], {
        breakpointHeights: { "390": 1e308 },
      }),
    ).toContain(`must be at most ${MAX_SANE_FRAME_DIMENSION_PX} px`);
    expect(
      numericDesignDataWriteError(["screenMetadata", "screen_a"], {
        breakpointHeights: { "390": "2400" },
      }),
    ).toContain("must be a finite JSON number");
    expect(
      numericDesignDataWriteError(["canvasFrames"], {
        screen_a: { width: 800 },
        screen_b: { width: "800" },
      }),
    ).toContain("must be a finite JSON number");
  });

  it("rejects null and non-finite dimensions", () => {
    expect(
      numericDesignDataWriteError(["canvasFrames", "screen_a", "width"], null),
    ).toContain("received null");
    expect(
      numericDesignDataWriteError(
        ["canvasFrames", "screen_a", "width"],
        Number.NaN,
      ),
    ).toContain("non-finite number");
  });

  it("accepts numeric geometry and ignores unrelated paths", () => {
    expect(
      numericDesignDataWriteError(["canvasFrames", "screen_a"], {
        x: 0,
        y: 0,
        width: 300,
        height: 250,
      }),
    ).toBeNull();
    expect(
      numericDesignDataWriteError(
        ["screenMetadata", "screen_a", "title"],
        "Home",
      ),
    ).toBeNull();
    expect(
      numericDesignDataWriteError(["tweakSelections"], { accent: "blue" }),
    ).toBeNull();
  });
});

describe("getResponsiveBreakpointHeightPx", () => {
  it("ignores persisted heights above the frame dimension ceiling", () => {
    expect(
      getResponsiveBreakpointHeightPx(
        { breakpointHeights: { "390": MAX_SANE_FRAME_DIMENSION_PX } },
        390,
      ),
    ).toBe(MAX_SANE_FRAME_DIMENSION_PX);
    expect(
      getResponsiveBreakpointHeightPx(
        { breakpointHeights: { "390": MAX_SANE_FRAME_DIMENSION_PX + 1 } },
        390,
      ),
    ).toBeUndefined();
    expect(
      getResponsiveBreakpointHeightPx(
        { breakpointHeights: { "390": 1e308 } },
        390,
      ),
    ).toBeUndefined();
  });
});

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

describe("nextFreeCanvasRowY", () => {
  it("starts at the origin on an empty board", () => {
    expect(nextFreeCanvasRowY({}, 96)).toBe(0);
    expect(nextFreeCanvasRowY(undefined, 96)).toBe(0);
    expect(nextFreeCanvasRowY(null, 96)).toBe(0);
  });

  it("clears the lowest existing frame by the gap", () => {
    // Without this, a second variant set is placed at y=0 straight on top of
    // the first — the reported "Show another set" overlap.
    const existing = {
      a: { x: 0, y: 0, width: 390, height: 844 },
      b: { x: 486, y: 0, width: 390, height: 844 },
    };
    expect(nextFreeCanvasRowY(existing, 96)).toBe(844 + 96);
  });

  it("uses the lowest bottom edge, not the lowest y", () => {
    const existing = {
      tall: { x: 0, y: 0, width: 390, height: 2000 },
      low: { x: 500, y: 900, width: 390, height: 100 },
    };
    expect(nextFreeCanvasRowY(existing, 24)).toBe(2024);
  });

  it("clears responsive previews, not only the primary frame", () => {
    const existing = {
      mobile: { x: 0, y: 0, width: 390, height: 844 },
    };
    expect(
      nextFreeCanvasRowY(existing, 96, {
        responsiveLayout: {
          screenMetadataByFileId: {
            mobile: { width: 390, height: 844 },
          },
          breakpointWidths: [390, 768, 1440],
        },
      }),
    ).toBeCloseTo(96 + (1440 * 844) / 390);
  });

  it("clears rotated responsive previews using their full footprint", () => {
    const existing = {
      mobile: { x: 0, y: 0, width: 390, height: 844, rotation: 90 },
    };
    const responsiveWidth = 390 + 24 + 768 + 24 + 1440;
    expect(
      nextFreeCanvasRowY(existing, 96, {
        responsiveLayout: {
          screenMetadataByFileId: {
            mobile: { width: 390, height: 844 },
          },
          breakpointWidths: [390, 768, 1440],
        },
      }),
    ).toBeCloseTo(96 + 844 / 2 + responsiveWidth / 2);
  });

  it("reserves measured tall breakpoint heights when placing the next row", () => {
    const existing = {
      mobile: { x: 0, y: 0, width: 1440, height: 900 },
    };
    expect(
      nextFreeCanvasRowY(existing, 96, {
        responsiveLayout: {
          screenMetadataByFileId: {
            mobile: {
              width: 1440,
              height: 900,
              breakpointHeights: { "390": 2200 },
            },
          },
          breakpointWidths: [390],
        },
      }),
    ).toBe(2200 + 96);
  });

  it("ignores the frames being rewritten so a re-run stays put", () => {
    const existing = {
      keep: { x: 0, y: 0, width: 390, height: 500 },
      rewritten: { x: 0, y: 4000, width: 390, height: 500 },
    };
    expect(
      nextFreeCanvasRowY(existing, 96, { ignoreFileIds: ["rewritten"] }),
    ).toBe(596);
  });

  it("returns the origin when every frame is ignored", () => {
    const existing = { only: { x: 0, y: 900, width: 390, height: 500 } };
    expect(nextFreeCanvasRowY(existing, 96, { ignoreFileIds: ["only"] })).toBe(
      0,
    );
  });

  it("treats a frame with no height as zero-height rather than skipping it", () => {
    expect(nextFreeCanvasRowY({ a: { x: 0, y: 300 } }, 50)).toBe(350);
  });

  it("ignores malformed entries", () => {
    expect(nextFreeCanvasRowY({ a: "nope", b: 5 }, 96)).toBe(0);
  });
});
