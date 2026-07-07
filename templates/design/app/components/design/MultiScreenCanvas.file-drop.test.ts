import { getCameraForBounds } from "@shared/canvas-math";
import { describe, expect, it } from "vitest";

import {
  findTopFrameEntryAtPoint,
  isOsFileDrag,
  type FrameGeometry,
} from "./MultiScreenCanvas";

function dragEventWithTypes(types: string[]) {
  return {
    dataTransfer: {
      types: types as unknown as DOMStringList,
    },
  };
}

describe("isOsFileDrag", () => {
  it("returns true when dataTransfer.types includes Files", () => {
    expect(isOsFileDrag(dragEventWithTypes(["Files"]))).toBe(true);
  });

  it("returns false for an internal DOM drag (e.g. native-asset panel drag)", () => {
    expect(isOsFileDrag(dragEventWithTypes(["text/plain"]))).toBe(false);
  });

  it("returns false when types is empty or dataTransfer is null", () => {
    expect(isOsFileDrag(dragEventWithTypes([]))).toBe(false);
    expect(isOsFileDrag({ dataTransfer: null })).toBe(false);
  });
});

function frame(id: string, geometry: FrameGeometry) {
  return { id, geometry };
}

describe("findTopFrameEntryAtPoint (OS file drop-target resolution)", () => {
  it("returns undefined when the point is outside every frame", () => {
    const entries = [frame("a", { x: 0, y: 0, width: 100, height: 100 })];
    expect(
      findTopFrameEntryAtPoint(entries, { x: 500, y: 500 }),
    ).toBeUndefined();
  });

  it("returns the single frame containing the point", () => {
    const entries = [
      frame("a", { x: 0, y: 0, width: 100, height: 100 }),
      frame("b", { x: 200, y: 0, width: 100, height: 100 }),
    ];
    expect(findTopFrameEntryAtPoint(entries, { x: 250, y: 50 })?.id).toBe("b");
  });

  it("picks the higher z-order frame when two overlap", () => {
    const entries = [
      frame("back", { x: 0, y: 0, width: 200, height: 200, z: 1 }),
      frame("front", { x: 0, y: 0, width: 200, height: 200, z: 5 }),
    ];
    expect(findTopFrameEntryAtPoint(entries, { x: 50, y: 50 })?.id).toBe(
      "front",
    );
  });

  it("breaks a z tie using later DOM index (topmost paint order)", () => {
    const entries = [
      frame("first", { x: 0, y: 0, width: 200, height: 200 }),
      frame("second", { x: 0, y: 0, width: 200, height: 200 }),
    ];
    expect(findTopFrameEntryAtPoint(entries, { x: 50, y: 50 })?.id).toBe(
      "second",
    );
  });

  it("accounts for frame rotation when hit-testing", () => {
    // A 100x40 frame centered at (50,20), rotated 90deg, occupies a tall
    // silhouette in world space even though its unrotated bounds are wide.
    const entries = [
      frame("rotated", {
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        rotation: 90,
      }),
    ];
    // (50, 20) is the frame's center — always inside regardless of rotation.
    expect(findTopFrameEntryAtPoint(entries, { x: 50, y: 20 })?.id).toBe(
      "rotated",
    );
    // (90, 20) sits inside the UNROTATED bounds (x:0-100,y:0-40) but outside
    // the rotated silhouette (which after a 90deg turn spans roughly
    // x:30-70, y:-30..70 around the same center) — must NOT match.
    expect(findTopFrameEntryAtPoint(entries, { x: 90, y: 20 })).toBeUndefined();
  });
});

describe("getCameraForBounds (Figma zoom-to-fit camera math, reused by cameraCommand)", () => {
  it("centers a single screen's bounds in the viewport at a fit zoom", () => {
    const bounds = {
      left: 0,
      top: 0,
      right: 1280,
      bottom: 2560,
      width: 1280,
      height: 2560,
      centerX: 640,
      centerY: 1280,
    };
    const camera = getCameraForBounds(
      bounds,
      { width: 1000, height: 800 },
      { paddingScreenPx: 64, minZoom: 2, maxZoom: 800, fallbackZoom: 100 },
    );
    // Height-constrained: (800 - 128) / 2560 ≈ 26.25% zoom.
    expect(camera.zoom).toBeCloseTo(26.25, 1);
    // The fitted content should be horizontally centered in the viewport.
    const scale = camera.zoom / 100;
    const contentCenterX = camera.x + bounds.centerX * scale;
    expect(contentCenterX).toBeCloseTo(500, 0);
  });

  it("clamps to maxZoom instead of zooming past it for a tiny bounds", () => {
    const bounds = {
      left: 0,
      top: 0,
      right: 10,
      bottom: 10,
      width: 10,
      height: 10,
      centerX: 5,
      centerY: 5,
    };
    const camera = getCameraForBounds(
      bounds,
      { width: 1000, height: 800 },
      { paddingScreenPx: 64, minZoom: 2, maxZoom: 800, fallbackZoom: 100 },
    );
    expect(camera.zoom).toBe(800);
  });

  it("falls back to fallbackZoom with a degenerate (zero-size) viewport", () => {
    const bounds = {
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      centerX: 50,
      centerY: 50,
    };
    const camera = getCameraForBounds(
      bounds,
      { width: 0, height: 0 },
      { fallbackZoom: 123 },
    );
    expect(camera).toEqual({ x: 0, y: 0, zoom: 123 });
  });
});
