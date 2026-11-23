import { describe, expect, it } from "vitest";

import { buildFoldedStrip } from "./folded-ribbon-renderer";

const ACROSS = 129;

function vertex(positions: Float32Array, row: number, col: number) {
  const i = (row * ACROSS + col) * 3;
  return {
    along: positions[i],
    thickness: positions[i + 1],
    width: positions[i + 2],
  };
}

describe("buildFoldedStrip", () => {
  const strip = buildFoldedStrip();

  it("builds a 128 x 256 grid of quads", () => {
    expect(strip.positions.length).toBe(129 * 257 * 3);
    expect(strip.uvs.length).toBe(129 * 257 * 2);
    expect(strip.indices.length).toBe(128 * 256 * 6);
    expect(strip.indices.reduce((a, b) => Math.max(a, b), 0)).toBe(
      129 * 257 - 1,
    );
  });

  it("folds the strip into two layers four units apart at its ends", () => {
    const outer = vertex(strip.positions, 0, 0);
    const inner = vertex(strip.positions, 0, 128);
    expect(outer.thickness).toBeCloseTo(4);
    expect(inner.thickness).toBeCloseTo(-4);
    // Both layers cover the same width once folded.
    expect(outer.width).toBeCloseTo(inner.width);
  });

  it("pinches the layers to two units apart mid-length", () => {
    const outer = vertex(strip.positions, 128, 0);
    const inner = vertex(strip.positions, 128, 128);
    expect(outer.thickness - inner.thickness).toBeCloseTo(4);
    expect(vertex(strip.positions, 128, 64).width).toBeCloseTo(86);
  });
});
