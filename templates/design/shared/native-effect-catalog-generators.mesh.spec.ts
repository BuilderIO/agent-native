import { describe, expect, it } from "vitest";

import { CATALOG_GENERATOR_CANDIDATES } from "./native-effect-catalog-generators";
import { packNativeProperties } from "./native-effects";

const mesh = CATALOG_GENERATOR_CANDIDATES.find(
  (definition) => definition.id === "an-native-mesh-anchors",
);

function linearSrgb(component: number): number {
  return component <= 0.04045
    ? component / 12.92
    : ((component + 0.055) / 1.055) ** 2.4;
}

describe("Mesh Gradient v5 color field", () => {
  it("keeps the v4 four-color default and reads each packed color/position pair", () => {
    expect(mesh?.version).toBe(5);
    expect(mesh).toBeDefined();
    const palette = mesh!.properties.palette!;
    expect(palette.type).toBe("color-ramp");
    if (palette.type !== "color-ramp") throw new Error("mesh-ramp-missing");
    expect(palette.default.map((stop) => stop.position)).toEqual([
      0,
      1 / 3,
      2 / 3,
      1,
    ]);
    expect(palette.default.map(({ color }) => color.components)).toEqual([
      [1, 0.604, 0.62],
      [0.631, 0.549, 0.82],
      [0.984, 0.761, 0.922],
      [0.98, 0.816, 0.769],
    ]);

    const packed = packNativeProperties(mesh!);
    expect(packed[0]).toBe(4);
    palette.default.forEach((stop, index) => {
      const colorOffset = (1 + index * 2) * 4;
      const positionOffset = (2 + index * 2) * 4;
      const expectedColor = [
        ...stop.color.components.map(linearSrgb),
        stop.color.alpha,
      ];
      Array.from(packed.slice(colorOffset, colorOffset + 4)).forEach(
        (component, channel) => {
          expect(component).toBeCloseTo(expectedColor[channel]!, 6);
        },
      );
      expect(packed[positionOffset]).toBeCloseTo(stop.position, 6);
    });

    const source = mesh!.passes[0]!.wgsl;
    expect(source).toContain("let stopOffset = 0u + 1u + i * 2u;");
    expect(source).toContain("globals.params[stopOffset + 1u].x");
  });
});
