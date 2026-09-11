import { describe, expect, it } from "vitest";

import {
  MAX_FILMSTRIP_FRAME_COUNT,
  filmstripGrid,
  filmstripSpriteFilter,
} from "./video-filmstrip-sprite.js";

const grid = (frameCount: number, columns = 10) =>
  filmstripGrid({ frameCount, columns, frameWidth: 160, frameHeight: 90 });

describe("filmstripGrid", () => {
  it("lays frames out into rows of at most `columns`", () => {
    expect(grid(40)).toEqual({
      frameCount: 40,
      columns: 10,
      rows: 4,
      frameWidth: 160,
      frameHeight: 90,
    });
  });

  it("never leaves an empty trailing row", () => {
    expect(grid(41).rows).toBe(5);
    expect(grid(40).rows).toBe(4);
  });

  it("narrows the grid when there are fewer frames than columns", () => {
    const small = grid(7);
    expect(small.columns).toBe(7);
    expect(small.rows).toBe(1);
  });

  it("clamps to a decodable sprite size", () => {
    expect(grid(10_000).frameCount).toBe(MAX_FILMSTRIP_FRAME_COUNT);
  });

  it("always produces at least one cell", () => {
    expect(grid(0).frameCount).toBe(1);
    expect(grid(5, 0).columns).toBe(1);
  });
});

describe("filmstripSpriteFilter", () => {
  it("seeks half a cell in so each tile is its slot's midpoint", () => {
    // 5 cells across 10s => 2s cells => first sample at 1s.
    const { seekSeconds } = filmstripSpriteFilter({
      durationMs: 10_000,
      grid: grid(5),
    });
    expect(Number(seekSeconds)).toBeCloseTo(1, 6);
  });

  it("samples at frameCount / duration so the frames span the clip", () => {
    const { filter } = filmstripSpriteFilter({
      durationMs: 10_000,
      grid: grid(5),
    });
    expect(filter).toContain("fps=0.500000");
  });

  it("pads each cell to an exact size so the grid geometry needs no probe", () => {
    const { filter } = filmstripSpriteFilter({
      durationMs: 60_000,
      grid: grid(40),
    });
    expect(filter).toContain(
      "scale=160:90:force_original_aspect_ratio=decrease",
    );
    expect(filter).toContain("pad=160:90:-1:-1:color=black");
    expect(filter).toContain("tile=10x4");
  });

  it("keeps the filter stages in decode order", () => {
    const { filter } = filmstripSpriteFilter({
      durationMs: 30_000,
      grid: grid(12, 4),
    });
    const stages = filter.split(",").map((stage) => stage.split("=")[0]);
    expect(stages).toEqual(["fps", "scale", "pad", "tile"]);
  });
});
