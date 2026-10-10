import { describe, expect, it } from "vitest";

import { planNativeSourceCoordinateScale } from "./native-source-coordinate-scale";

const geometry = {
  sourceWidth: 200,
  sourceHeight: 100,
  localWidth: 100,
  localHeight: 50,
  viewportWidth: 150,
  viewportHeight: 25,
};

describe("native source coordinate scaling", () => {
  it("uses selected target local CSS dimensions despite its transformed world box", () => {
    expect(
      planNativeSourceCoordinateScale({
        ...geometry,
        spaces: ["target-local", "target-local"],
      }),
    ).toEqual({ ok: true, x: 2, y: 2 });
  });

  it("retains viewport bounds for backdrop records and refuses mixed coordinates", () => {
    expect(
      planNativeSourceCoordinateScale({
        ...geometry,
        spaces: ["target-viewport-axis-aligned"],
      }),
    ).toEqual({ ok: true, x: 200 / 150, y: 4 });
    expect(
      planNativeSourceCoordinateScale({
        ...geometry,
        spaces: ["target-local", "target-viewport-axis-aligned"],
      }),
    ).toEqual({ ok: false, code: "source-coordinate-space-mixed" });
    expect(
      planNativeSourceCoordinateScale({
        ...geometry,
        spaces: ["target-local"],
        localWidth: 0,
      }),
    ).toEqual({ ok: false, code: "source-coordinate-space-unreadable" });
  });
});

it("uses receiver-local physical density for globally captured backdrop paint", () => {
  expect(
    planNativeSourceCoordinateScale({
      ...geometry,
      spaces: ["target-local-global"],
      sourceWidth: 137 * 1.6,
      sourceHeight: 73 * 1.6,
      localWidth: 137,
      localHeight: 73,
    }),
  ).toEqual({ ok: true, x: 1.6, y: 1.6 });
  expect(
    planNativeSourceCoordinateScale({
      ...geometry,
      spaces: ["target-local-global", "target-local"],
    }),
  ).toEqual({ ok: false, code: "source-coordinate-space-mixed" });
});
