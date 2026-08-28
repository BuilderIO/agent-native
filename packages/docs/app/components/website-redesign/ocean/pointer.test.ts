import { describe, expect, it } from "vitest";

import { oceanCamera } from "./camera";
import {
  easingAlpha,
  POINTER_POSITION_TAU_MS,
  projectPointerToOcean,
} from "./pointer";
import { OCEAN_TUNING } from "./tuning";

const SIZE = [1440, 700] as const;

/**
 * Projects a world point back through the same camera oceanCamera() builds, so
 * the assertion is a real round trip rather than a restatement of the maths
 * under test. A drift between the two is exactly the bug that would put the
 * deformation somewhere other than under the cursor.
 */
function worldToNdc(x: number, z: number, size: readonly [number, number]) {
  const { view, projection } = oceanCamera(size);
  const column = (index: number, row: number) => view[index * 4 + row]!;
  const world = [x, 0, z, 1] as const;
  const viewSpace = [0, 1, 2, 3].map((row) =>
    world.reduce((sum, value, index) => sum + value * column(index, row), 0),
  );
  const clipX = viewSpace[0]! * projection[0]!;
  const clipY = viewSpace[1]! * projection[5]!;
  const clipW = -viewSpace[2]!;
  return [clipX / clipW, clipY / clipW] as const;
}

describe("projectPointerToOcean", () => {
  it("lands under the cursor, round-tripping through the real camera", () => {
    for (const point of [
      [0, 0],
      [40, -30],
      [-120, 60],
    ] as const) {
      const [ndcX, ndcY] = worldToNdc(point[0], point[1], SIZE);
      const aim = projectPointerToOcean(ndcX, ndcY, SIZE);
      expect(aim.worldX).toBeCloseTo(point[0], 2);
      expect(aim.worldZ).toBeCloseTo(point[1], 2);
    }
  });

  it("still acts on the water when the cursor is above the horizon", () => {
    // The rig is pitched up, so this ray never meets the plane. Returning
    // nothing here is what made the cursor feel dead over the upper hero.
    const sky = projectPointerToOcean(0.4, 1, SIZE);
    expect(Number.isFinite(sky.worldX)).toBe(true);
    expect(Number.isFinite(sky.worldZ)).toBe(true);
    // Off to the same side the cursor is on, so it still tracks horizontally.
    expect(sky.worldX).toBeGreaterThan(0);
  });

  it("recedes monotonically up the hero and never doubles back", () => {
    // World distance genuinely races away near the horizon, and that is correct
    // perspective -- on screen the well still sits under the cursor. What would
    // read as a teleport is the aim reversing or jumping past the cap as the
    // cursor crosses the horizon, which is where the old undefined branch cut
    // in. Monotone and bounded is the property that rules that out.
    let previous = projectPointerToOcean(0, -1, SIZE);
    for (let ndcY = -0.99; ndcY <= 1; ndcY += 0.01) {
      const aim = projectPointerToOcean(0, ndcY, SIZE);
      expect(aim.distance).toBeGreaterThanOrEqual(previous.distance - 1e-9);
      // Once the reach is capped the aim rides a sphere of that radius, so its
      // z recedes by a fraction of a unit per step. Bounding the step is what
      // matters there; the direction is free to tilt.
      expect(Math.abs(aim.worldZ - previous.worldZ)).toBeLessThan(
        OCEAN_TUNING.particles.fadeFar,
      );
      previous = aim;
    }
    expect(previous.distance).toBeCloseTo(OCEAN_TUNING.particles.fadeFar, 6);
  });

  it("never reaches further than the particles are drawn", () => {
    for (let ndcY = -1; ndcY <= 1; ndcY += 0.05) {
      const aim = projectPointerToOcean(0, ndcY, SIZE);
      expect(aim.distance).toBeLessThanOrEqual(
        OCEAN_TUNING.particles.fadeFar + 1e-6,
      );
    }
  });

  it("reports a growing distance toward the horizon, so the well scales", () => {
    const near = projectPointerToOcean(0, -0.9, SIZE);
    const far = projectPointerToOcean(0, 0.2, SIZE);
    expect(far.distance).toBeGreaterThan(near.distance);
  });

  it("tracks the aspect ratio rather than assuming one viewport", () => {
    const wide = projectPointerToOcean(0.5, -0.5, [1440, 700]);
    const narrow = projectPointerToOcean(0.5, -0.5, [390, 700]);
    // Same normalized x on a wider viewport is further out in world x.
    expect(Math.abs(wide.worldX)).toBeGreaterThan(Math.abs(narrow.worldX));
  });
});

describe("easingAlpha", () => {
  it("is frame-rate independent: two half steps match one whole one", () => {
    const once = easingAlpha(32, POINTER_POSITION_TAU_MS);
    const half = easingAlpha(16, POINTER_POSITION_TAU_MS);
    // Approaching a target: 1 - (1-a)(1-a) over two 16ms frames has to equal the
    // single 32ms step, or the lag depends on frame cadence and a hitch shows.
    expect(1 - (1 - half) ** 2).toBeCloseTo(once, 12);
  });

  it("approaches but never overshoots the target", () => {
    expect(easingAlpha(10_000, POINTER_POSITION_TAU_MS)).toBeLessThanOrEqual(1);
    expect(easingAlpha(0, POINTER_POSITION_TAU_MS)).toBe(0);
  });
});
