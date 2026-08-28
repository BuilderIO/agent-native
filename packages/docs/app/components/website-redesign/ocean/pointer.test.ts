import { describe, expect, it } from "vitest";

import { oceanCamera } from "./camera";
import { projectPointerToOcean } from "./pointer";
import { OCEAN_TUNING } from "./tuning";

const SIZE = [1440, 700] as const;

/**
 * Projects a world point back through the same camera oceanCamera() builds, so
 * the assertion is a real round trip rather than a restatement of the maths
 * under test. A drift between the two is exactly the bug that would put the
 * pull somewhere other than under the cursor.
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
      const projected = projectPointerToOcean(ndcX, ndcY, SIZE);
      expect(projected).toBeDefined();
      expect(projected![0]).toBeCloseTo(point[0], 2);
      expect(projected![1]).toBeCloseTo(point[1], 2);
    }
  });

  it("finds no water where the pitched-up rig is looking at sky", () => {
    expect(projectPointerToOcean(0, 1, SIZE)).toBeUndefined();
  });

  it("rejects an intersection past the particle fade distance", () => {
    // Walking up toward the horizon, the first rejected row must be beyond the
    // fade -- otherwise the pull is being dropped where particles still draw.
    let lastAccepted: readonly [number, number] | undefined;
    for (let ndcY = -1; ndcY <= 1; ndcY += 0.01) {
      const projected = projectPointerToOcean(0, ndcY, SIZE);
      if (!projected) break;
      lastAccepted = projected;
    }
    expect(lastAccepted).toBeDefined();
    const distance = Math.hypot(
      lastAccepted![0] - OCEAN_TUNING.camera.eye[0],
      OCEAN_TUNING.camera.eye[1],
      lastAccepted![1] - OCEAN_TUNING.camera.eye[2],
    );
    expect(distance).toBeLessThanOrEqual(OCEAN_TUNING.particles.fadeFar);
  });

  it("tracks the aspect ratio rather than assuming one viewport", () => {
    const wide = projectPointerToOcean(0.5, -0.5, [1440, 700]);
    const narrow = projectPointerToOcean(0.5, -0.5, [390, 700]);
    expect(wide).toBeDefined();
    expect(narrow).toBeDefined();
    // Same normalized x on a wider viewport is further out in world x.
    expect(Math.abs(wide![0])).toBeGreaterThan(Math.abs(narrow![0]));
  });
});
