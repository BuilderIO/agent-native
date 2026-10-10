import { describe, expect, it } from "vitest";

import { projectNativeSourceBox } from "./native-source-local-geometry";

describe("target-local native source boxes", () => {
  it("keeps source geometry independent of the target's own translation, rotation, and scale", () => {
    const projected = projectNativeSourceBox(
      { x: 4108, y: 4120, width: 40, height: 20 },
      { x: 4096, y: 4096 },
      [],
    );
    expect(projected).toEqual({ x: 12, y: 24, width: 40, height: 20 });
    // The selected target's affine transform is shared by its authored children
    // and the sibling native presentation surface; it does not enter this box.
    expect(projected).toEqual(
      projectNativeSourceBox(
        { x: 4108, y: 4120, width: 40, height: 20 },
        { x: 4096, y: 4096 },
        [],
      ),
    );
  });

  it("projects nested axis-aligned transforms in child-to-parent order", () => {
    expect(
      projectNativeSourceBox(
        { x: 130, y: 70, width: 20, height: 10 },
        { x: 100, y: 50 },
        [
          {
            anchorX: 120,
            anchorY: 60,
            originX: 10,
            originY: 5,
            scaleX: 2,
            scaleY: 3,
            translateX: 4,
            translateY: -2,
          },
          {
            anchorX: 110,
            anchorY: 55,
            originX: 0,
            originY: 0,
            scaleX: 1.5,
            scaleY: 0.5,
            translateX: 6,
            translateY: 8,
          },
        ],
      ),
    ).toEqual({ x: 52, y: 24.5, width: 60, height: 15 });
  });

  it("rejects invalid dimensions and nonpositive or unreadable transforms", () => {
    expect(
      projectNativeSourceBox(
        { x: 0, y: 0, width: 0, height: 10 },
        { x: 0, y: 0 },
        [],
      ),
    ).toBeNull();
    expect(
      projectNativeSourceBox(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 0, y: 0 },
        [
          {
            anchorX: 0,
            anchorY: 0,
            originX: 0,
            originY: 0,
            scaleX: Number.NaN,
            scaleY: 1,
            translateX: 0,
            translateY: 0,
          },
        ],
      ),
    ).toBeNull();
  });
});
