import { expect, it } from "vitest";

import { planNativeExportRegion } from "./native-export-region";
import { nativeLocalExportOptionsSchema } from "./native-local-export";

it("bounds a 2x selected frame independently of its full board layout viewport", () => {
  expect(
    planNativeExportRegion({
      viewport: { width: 8192, height: 8192 },
      cropRect: { x: 4064, y: 3283, width: 1510, height: 270 },
      pixelRatio: 2,
    }),
  ).toEqual({
    ok: true,
    region: { x: 4064, y: 3283, width: 1510, height: 270 },
    width: 3020,
    height: 540,
  });
});
it("preserves visible overflow and fractional world origins", () => {
  expect(
    planNativeExportRegion({
      viewport: { width: 8192, height: 8192 },
      cropRect: { x: -32.25, y: 9000, width: 100, height: 80 },
      pixelRatio: 1,
    }),
  ).toMatchObject({ ok: true, region: { x: -32.25, y: 9000 } });
});
it.each([
  { cropRect: { x: NaN, y: 0, width: 100, height: 80 }, pixelRatio: 1 },
  { cropRect: { x: 0, y: 0, width: 0, height: 80 }, pixelRatio: 1 },
  { cropRect: { x: 0, y: 0, width: 3000, height: 3000 }, pixelRatio: 1 },
  { cropRect: { x: 0, y: 0, width: 1510, height: 270 }, pixelRatio: 4 },
])("rejects invalid or over-budget output instead of resizing it", (args) => {
  expect(
    planNativeExportRegion({ viewport: { width: 8192, height: 8192 }, ...args })
      .ok,
  ).toBe(false);
});

it("keeps the same bounded region contract in agent export requests", () => {
  const cropRect = { x: -32.25, y: 9000, width: 1510, height: 270 };
  expect(
    nativeLocalExportOptionsSchema.parse({
      format: "png",
      viewport: { width: 8192, height: 8192 },
      cropRect,
      pixelRatio: 2,
    }).cropRect,
  ).toEqual(cropRect);
  expect(
    nativeLocalExportOptionsSchema.safeParse({
      format: "png",
      viewport: { width: 8192, height: 8192 },
      pixelRatio: 2,
    }).success,
  ).toBe(false);
});
