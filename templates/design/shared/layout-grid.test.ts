import { describe, expect, it } from "vitest";

import { WHOLE_PIXEL_SNAP_STEP } from "./canvas-math";
import {
  DEFAULT_LAYOUT_GRID,
  MAX_LAYOUT_GRID_SIZE,
  normalizeLayoutGridSize,
  parseLayoutGrid,
  parseLayoutGridById,
  resolveLayoutGridSnapStep,
} from "./layout-grid";

describe("DEFAULT_LAYOUT_GRID", () => {
  it("starts on the same 8px step the big nudge uses, so a nudge cannot walk off the grid", () => {
    expect(DEFAULT_LAYOUT_GRID).toEqual({
      kind: "uniform",
      size: 8,
      visible: true,
    });
  });
});

describe("parseLayoutGrid", () => {
  it("reads a stored grid", () => {
    expect(
      parseLayoutGrid({ kind: "uniform", size: 8, visible: true }),
    ).toEqual({ kind: "uniform", size: 8, visible: true });
  });

  it("defaults visibility to on, since an absent flag predates the field", () => {
    expect(parseLayoutGrid({ size: 12 })).toEqual({
      kind: "uniform",
      size: 12,
      visible: true,
    });
  });

  it("treats a grid with no readable size as no grid rather than as an 8px one", () => {
    expect(parseLayoutGrid({ visible: true })).toBeNull();
    expect(parseLayoutGrid({ size: "8" })).toBeNull();
    expect(parseLayoutGrid({ size: Number.NaN })).toBeNull();
  });

  it("refuses a kind it cannot honour instead of silently snapping to uniform", () => {
    expect(parseLayoutGrid({ kind: "columns", size: 8 })).toBeNull();
  });

  it("reads nothing out of a non-object", () => {
    expect(parseLayoutGrid(null)).toBeNull();
    expect(parseLayoutGrid([])).toBeNull();
    expect(parseLayoutGrid("8px")).toBeNull();
  });
});

describe("parseLayoutGridById", () => {
  it("keeps readable frames and drops unreadable ones", () => {
    expect(
      parseLayoutGridById({
        "screen-1": { kind: "uniform", size: 8, visible: false },
        "screen-2": { size: "nope" },
      }),
    ).toEqual({
      "screen-1": { kind: "uniform", size: 8, visible: false },
    });
  });

  it("reads an absent map as no grids anywhere", () => {
    expect(parseLayoutGridById(undefined)).toEqual({});
  });
});

describe("normalizeLayoutGridSize", () => {
  it("clamps to the supported range and rounds to a whole pixel", () => {
    expect(normalizeLayoutGridSize(0)).toBe(1);
    expect(normalizeLayoutGridSize(-4)).toBe(1);
    expect(normalizeLayoutGridSize(8.4)).toBe(8);
    expect(normalizeLayoutGridSize(999999)).toBe(MAX_LAYOUT_GRID_SIZE);
  });

  it("falls back rather than inventing a size from an unreadable value", () => {
    expect(normalizeLayoutGridSize(undefined, 12)).toBe(12);
    expect(normalizeLayoutGridSize(Number.NaN, 12)).toBe(12);
  });
});

describe("resolveLayoutGridSnapStep", () => {
  const grids = {
    "screen-1": { kind: "uniform" as const, size: 8, visible: true },
    "screen-2": { kind: "uniform" as const, size: 8, visible: false },
  };

  it("returns the frame's own grid size", () => {
    expect(resolveLayoutGridSnapStep(grids, "screen-1")).toBe(8);
  });

  it("still snaps a hidden grid — its existence is the opt-in, not its lines", () => {
    expect(resolveLayoutGridSnapStep(grids, "screen-2")).toBe(8);
  });

  it("falls back to whole pixels for a frame with no grid and for the board", () => {
    expect(resolveLayoutGridSnapStep(grids, "screen-3")).toBe(
      WHOLE_PIXEL_SNAP_STEP,
    );
    expect(resolveLayoutGridSnapStep(grids, null)).toBe(WHOLE_PIXEL_SNAP_STEP);
  });
});
