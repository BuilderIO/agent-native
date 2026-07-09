import { describe, expect, it, vi } from "vitest";

import {
  isSaneCanvasFrameGeometryForPersist,
  MAX_SANE_FRAME_ASPECT_RATIO,
  MAX_SANE_FRAME_DIMENSION_PX,
  sanitizeCanvasFrameGeometryForPersist,
} from "./design-editor/geometry-persistence";

/**
 * Frame-geometry persistence guard: while the overview zoom scalar was
 * corrupted (board zoom-basis flip, displayed zoom 10241.49%), ANY frame
 * interaction translated pointer deltas through the garbage scale and
 * persisted absurd canvasFrames/screenMetadata (observed in the wild:
 * 120x14976) that survived reload. Every canvasFrames persist path now runs
 * through sanitizeCanvasFrameGeometryForPersist; these specs pin the
 * accept/refuse decision.
 */

describe("isSaneCanvasFrameGeometryForPersist", () => {
  it("accepts normal screen-frame geometry", () => {
    expect(
      isSaneCanvasFrameGeometryForPersist({
        x: 120,
        y: 240,
        width: 1280,
        height: 2560,
      }),
    ).toBe(true);
  });

  it("refuses the observed corrupt product (120x14976 — aspect far beyond the sane bound)", () => {
    expect(
      isSaneCanvasFrameGeometryForPersist({
        x: 0,
        y: 0,
        width: 120,
        height: 14976,
      }),
    ).toBe(false);
    expect(14976 / 120).toBeGreaterThan(MAX_SANE_FRAME_ASPECT_RATIO);
  });

  it("refuses non-finite fields, non-positive dimensions, and beyond-max dimensions", () => {
    expect(isSaneCanvasFrameGeometryForPersist({ x: NaN, y: 0 })).toBe(false);
    expect(
      isSaneCanvasFrameGeometryForPersist({ width: Infinity, height: 100 }),
    ).toBe(false);
    expect(isSaneCanvasFrameGeometryForPersist({ width: 0, height: 100 })).toBe(
      false,
    );
    expect(
      isSaneCanvasFrameGeometryForPersist({ width: -320, height: 100 }),
    ).toBe(false);
    expect(
      isSaneCanvasFrameGeometryForPersist({
        width: MAX_SANE_FRAME_DIMENSION_PX + 1,
        height: 1000,
      }),
    ).toBe(false);
  });

  it("does not range-bound x/y positions — frames legitimately sit far out on the board surface", () => {
    expect(
      isSaneCanvasFrameGeometryForPersist({
        x: -60000,
        y: 48000,
        width: 1280,
        height: 800,
      }),
    ).toBe(true);
  });

  it("accepts a long-page frame whose aspect stays within the bound", () => {
    // 1280 x 19000 → aspect ~14.8, a legitimately long scrolling page.
    expect(
      isSaneCanvasFrameGeometryForPersist({ width: 1280, height: 19000 }),
    ).toBe(true);
  });

  it("accepts a very tall but sane-aspect scrolling page beyond the old 20000px cap", () => {
    // 1440 x 30000 → aspect ~20.8, well under MAX_SANE_FRAME_ASPECT_RATIO (50).
    // The old 20000px absolute dimension ceiling used to silently revert this
    // even though it's ordinary long-page content, not corruption.
    expect(30000 / 1440).toBeLessThan(MAX_SANE_FRAME_ASPECT_RATIO);
    expect(
      isSaneCanvasFrameGeometryForPersist({ width: 1440, height: 30000 }),
    ).toBe(true);
  });

  it("still refuses truly insane dimensions beyond the raised 100000px ceiling", () => {
    expect(
      isSaneCanvasFrameGeometryForPersist({
        width: MAX_SANE_FRAME_DIMENSION_PX + 1,
        height: MAX_SANE_FRAME_DIMENSION_PX + 1,
      }),
    ).toBe(false);
  });
});

describe("sanitizeCanvasFrameGeometryForPersist", () => {
  const previous = {
    "screen-1": { x: 0, y: 0, width: 1280, height: 800 },
    "screen-2": { x: 1500, y: 0, width: 390, height: 844 },
  };

  it("passes a fully sane map through as the SAME reference (no churn)", () => {
    const next = {
      "screen-1": { x: 10, y: 20, width: 1280, height: 800 },
      "screen-2": { x: 1500, y: 0, width: 390, height: 844 },
    };
    const result = sanitizeCanvasFrameGeometryForPersist(next, previous);
    expect(result.geometryById).toBe(next);
    expect(result.rejectedFrameIds).toEqual([]);
  });

  it("refuses a corrupt frame (observed 120x14976) and falls back to its previously persisted geometry", () => {
    const next = {
      "screen-1": { x: 10, y: 20, width: 120, height: 14976 },
      "screen-2": { x: 1500, y: 0, width: 390, height: 844 },
    };
    const result = sanitizeCanvasFrameGeometryForPersist(next, previous);
    expect(result.rejectedFrameIds).toEqual(["screen-1"]);
    expect(result.geometryById["screen-1"]).toEqual(previous["screen-1"]);
    // Untouched frames pass through unchanged.
    expect(result.geometryById["screen-2"]).toEqual(next["screen-2"]);
  });

  it("drops a corrupt frame entirely when it has no sane previously persisted geometry", () => {
    const next = {
      "new-screen": { x: 0, y: 0, width: NaN, height: 800 },
      "screen-2": { x: 1500, y: 0, width: 390, height: 844 },
    };
    const result = sanitizeCanvasFrameGeometryForPersist(next, {});
    expect(result.rejectedFrameIds).toEqual(["new-screen"]);
    expect("new-screen" in result.geometryById).toBe(false);
    expect(result.geometryById["screen-2"]).toEqual(next["screen-2"]);
  });

  it("also refuses the fallback when the previously persisted entry is itself insane", () => {
    const next = {
      "screen-1": { x: 0, y: 0, width: 120, height: 14976 },
    };
    const corruptPrevious = {
      "screen-1": { x: 0, y: 0, width: 22000, height: 300 },
    };
    const result = sanitizeCanvasFrameGeometryForPersist(next, corruptPrevious);
    expect(result.rejectedFrameIds).toEqual(["screen-1"]);
    expect("screen-1" in result.geometryById).toBe(false);
  });

  it("exempts the board frame id — its surface is a legitimate 131k square", () => {
    const boardId = "board-file";
    const next = {
      [boardId]: { x: -65536, y: -65536, width: 131072, height: 131072 },
      "screen-1": { x: 0, y: 0, width: 1280, height: 800 },
    };
    const result = sanitizeCanvasFrameGeometryForPersist(next, {}, [boardId]);
    expect(result.geometryById).toBe(next);
    expect(result.rejectedFrameIds).toEqual([]);
  });

  it("does not mutate the input maps", () => {
    const next = {
      "screen-1": { x: 10, y: 20, width: 120, height: 14976 },
    };
    const nextCopy = JSON.parse(JSON.stringify(next));
    const previousCopy = JSON.parse(JSON.stringify(previous));
    sanitizeCanvasFrameGeometryForPersist(next, previous);
    expect(next).toEqual(nextCopy);
    expect(previous).toEqual(previousCopy);
  });

  it("emits a console.warn with the offending frame id and dimensions when a revert fires (detectability)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const next = {
        "screen-1": { x: 10, y: 20, width: 120, height: 14976 },
      };
      sanitizeCanvasFrameGeometryForPersist(next, previous);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [message, details] = warnSpy.mock.calls[0];
      expect(String(message)).toContain("canvas frame geometry");
      expect(details).toMatchObject({
        frameId: "screen-1",
        rejected: next["screen-1"],
        revertedTo: previous["screen-1"],
      });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("does not warn when nothing is rejected", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const next = {
        "screen-1": { x: 10, y: 20, width: 1280, height: 800 },
      };
      sanitizeCanvasFrameGeometryForPersist(next, previous);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
