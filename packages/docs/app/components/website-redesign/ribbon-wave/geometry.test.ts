import { describe, expect, it } from "vitest";

import { buildRibbonSheet } from "./geometry";
import { RIBBON_SHEET } from "./presets";

const { columns, rows, size, foldGap } = RIBBON_SHEET;

function vertex(
  sheet: ReturnType<typeof buildRibbonSheet>,
  row: number,
  col: number,
) {
  const i = row * (columns + 1) + col;
  return {
    position: Array.from(sheet.positions.subarray(i * 3, i * 3 + 3)),
    uv: Array.from(sheet.uvs.subarray(i * 2, i * 2 + 2)),
  };
}

describe("buildRibbonSheet", () => {
  const sheet = buildRibbonSheet();

  it("builds one grid of quads that indexes only its own vertices", () => {
    const vertexCount = (columns + 1) * (rows + 1);
    expect(sheet.positions).toHaveLength(vertexCount * 3);
    expect(sheet.uvs).toHaveLength(vertexCount * 2);
    expect(sheet.indices).toHaveLength(columns * rows * 6);
    expect(sheet.indices.reduce((a, b) => Math.max(a, b), 0)).toBe(
      vertexCount - 1,
    );
  });

  it("folds the sheet back on itself so its two edges lie one gap apart", () => {
    // The top row is far from the pinched middle band, so the gap is full.
    const left = vertex(sheet, 0, 0);
    const right = vertex(sheet, 0, columns);

    expect(left.uv).toEqual([0, 1]);
    expect(right.uv).toEqual([1, 1]);
    // Same depth and height: the mirrored half sits directly behind.
    expect(right.position[0]).toBeCloseTo(left.position[0]);
    expect(right.position[2]).toBeCloseTo(left.position[2]);
    expect(left.position[1] - right.position[1]).toBeCloseTo(2 * foldGap);
    // Depth runs along u: the outer edge sits a quarter-width past the fold.
    expect(left.position[2]).toBeCloseTo(-size / 2 + size / 4);
  });

  it("narrows the fold through the middle row band", () => {
    const middleRow = rows / 2;
    const left = vertex(sheet, middleRow, 0);
    const right = vertex(sheet, middleRow, columns);
    expect(left.position[1] - right.position[1]).toBeCloseTo(foldGap);
  });
});
