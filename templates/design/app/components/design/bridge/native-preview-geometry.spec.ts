import { describe, expect, it } from "vitest";

import {
  nativePreviewAllocationViewport,
  nativePreviewPhysicalViewport,
  nativePreviewStablePhysicalViewport,
  nativePreviewStableAllocationOrExactViewport,
  planNativePreviewViewport,
  type NativePreviewBox,
} from "./native-preview-geometry";

describe("native preview allocation geometry", () => {
  it("keeps allocation dimensions stable while the raw viewport pans", () => {
    const clips = [{ x: 0, y: 0, width: 300, height: 200 }];
    const first = planNativePreviewViewport({
      width: 1000,
      height: 800,
      display: { x: 0, y: 0, width: 500, height: 400 },
      clips,
    })!;
    const panned = planNativePreviewViewport({
      width: 1000,
      height: 800,
      display: { x: -50, y: -25, width: 500, height: 400 },
      clips,
    })!;
    const allocate = (viewport: NativePreviewBox) =>
      nativePreviewAllocationViewport({
        viewport,
        rootWidth: 1000,
        rootHeight: 800,
        maxViewportWidth: first.maxViewportWidth,
        maxViewportHeight: first.maxViewportHeight,
      });

    const firstAllocation = allocate(first.viewport);
    const pannedAllocation = allocate(panned.viewport);
    expect(first.viewport).not.toEqual(panned.viewport);
    expect(firstAllocation.width).toBe(601);
    expect(firstAllocation.height).toBe(401);
    expect(pannedAllocation.width).toBe(firstAllocation.width);
    expect(pannedAllocation.height).toBe(firstAllocation.height);
    expect(pannedAllocation.x).toBeGreaterThan(firstAllocation.x);
    expect(pannedAllocation.x).toBeLessThanOrEqual(panned.viewport.x);
    expect(pannedAllocation.x + pannedAllocation.width).toBeGreaterThanOrEqual(
      panned.viewport.x + panned.viewport.width,
    );
  });

  it("absorbs subpixel display-scale jitter without changing backing dimensions", () => {
    const plan = (displayWidth: number) =>
      planNativePreviewViewport({
        width: 1000,
        height: 800,
        display: { x: 0, y: 0, width: displayWidth, height: 400 },
        clips: [{ x: 0, y: 0, width: 300, height: 200 }],
      })!;
    const allocation = (displayWidth: number) => {
      const planned = plan(displayWidth);
      const box = nativePreviewAllocationViewport({
        viewport: planned.viewport,
        rootWidth: 1000,
        rootHeight: 800,
        maxViewportWidth: planned.maxViewportWidth,
        maxViewportHeight: planned.maxViewportHeight,
      });
      return nativePreviewPhysicalViewport(box, 2);
    };

    expect(allocation(500)).toEqual(allocation(500.00002));
  });

  it("keeps backing dimensions constant as a stable allocation crosses physical pixel origins", () => {
    const dimensions = [0.01, 0.24, 0.51, 1.02].map((x) =>
      nativePreviewStablePhysicalViewport(
        { x, y: x / 2, width: 601, height: 401 },
        2,
      ),
    );
    expect(dimensions.map(({ width, height }) => [width, height])).toEqual(
      Array.from({ length: dimensions.length }, () => [1203, 803]),
    );
  });

  it("uses per-axis CSS scale and remains bounded at document edges", () => {
    const planned = planNativePreviewViewport({
      width: 800,
      height: 400,
      display: { x: -100, y: -40, width: 400, height: 400 },
      clips: [{ x: 0, y: 0, width: 300, height: 250 }],
    })!;

    expect(planned.scaleX).toBe(0.5);
    expect(planned.scaleY).toBe(1);
    expect(planned.maxViewportWidth).toBe(601);
    expect(planned.maxViewportHeight).toBe(251);
    expect(planned.viewport).toEqual({
      x: 200,
      y: 40,
      width: 600,
      height: 250,
    });
    const allocation = nativePreviewAllocationViewport({
      viewport: planned.viewport,
      rootWidth: 800,
      rootHeight: 400,
      maxViewportWidth: planned.maxViewportWidth,
      maxViewportHeight: planned.maxViewportHeight,
    });
    expect(allocation.x).toBe(199);
    expect(allocation.y).toBe(40);
    expect(allocation.x).toBeGreaterThanOrEqual(0);
    expect(allocation.x + allocation.width).toBeLessThanOrEqual(800);
    expect(allocation.y + allocation.height).toBeLessThanOrEqual(400);
  });

  it("falls back to the exact raw viewport when a stable allocation exceeds raster caps", () => {
    const viewport = { x: 250, y: 150, width: 500, height: 300 };
    expect(
      nativePreviewStableAllocationOrExactViewport({
        viewport,
        rootWidth: 3000,
        rootHeight: 2000,
        maxViewportWidth: 2000,
        maxViewportHeight: 1200,
        density: 2,
        maxDimension: 4096,
        maxPixels: 8_388_608,
      }),
    ).toEqual(viewport);
  });

  it("uses worker texture limits without relaxing the legacy raster cap", () => {
    const viewport = { x: 20, y: 30, width: 900, height: 700 };
    const input = {
      viewport,
      rootWidth: 1512,
      rootHeight: 862,
      maxViewportWidth: 1175.5,
      maxViewportHeight: 814,
      density: 2,
      maxDimension: 4096,
      pixelPadding: 1,
    };
    const workerAllocation = nativePreviewStableAllocationOrExactViewport({
      ...input,
      maxPixels: 8_388_608,
    });
    expect(
      nativePreviewStablePhysicalViewport(workerAllocation, 2),
    ).toMatchObject({
      width: 2352,
      height: 1629,
    });
    expect(workerAllocation).not.toEqual(viewport);

    const legacyAllocation = nativePreviewStableAllocationOrExactViewport({
      ...input,
      maxPixels: 3_355_443,
    });
    expect(legacyAllocation).toEqual(viewport);
  });

  it("rejects extents that cannot cover the raw visible viewport", () => {
    expect(() =>
      nativePreviewAllocationViewport({
        viewport: { x: 10, y: 10, width: 100, height: 100 },
        rootWidth: 500,
        rootHeight: 500,
        maxViewportWidth: 99,
        maxViewportHeight: 100,
      }),
    ).toThrow(RangeError);
  });
});
