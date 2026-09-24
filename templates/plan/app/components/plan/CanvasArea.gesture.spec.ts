import { describe, expect, it } from "vitest";

import { viewForPinchGesture } from "./CanvasArea";

describe("CanvasArea pinch gestures", () => {
  it("zooms around the fingers' midpoint", () => {
    const view = viewForPinchGesture({
      gesture: {
        pointerIds: [1, 2],
        startDistance: 100,
        startMidpoint: { x: 200, y: 100 },
        startView: { zoom: 1, pan: { x: 100, y: 50 } },
      },
      currentDistance: 200,
      currentMidpoint: { x: 200, y: 100 },
    });

    expect(view).toEqual({ zoom: 2, pan: { x: 0, y: 0 } });
  });

  it("follows midpoint movement while preserving the zoom anchor", () => {
    const view = viewForPinchGesture({
      gesture: {
        pointerIds: [1, 2],
        startDistance: 100,
        startMidpoint: { x: 200, y: 100 },
        startView: { zoom: 1, pan: { x: 100, y: 50 } },
      },
      currentDistance: 200,
      currentMidpoint: { x: 220, y: 120 },
    });

    expect(view).toEqual({ zoom: 2, pan: { x: 20, y: 20 } });
  });

  it("clamps a pinch to the supported zoom range", () => {
    const view = viewForPinchGesture({
      gesture: {
        pointerIds: [1, 2],
        startDistance: 100,
        startMidpoint: { x: 200, y: 100 },
        startView: { zoom: 1, pan: { x: 100, y: 50 } },
      },
      currentDistance: 1,
      currentMidpoint: { x: 200, y: 100 },
    });

    expect(view.zoom).toBe(0.18);
  });
});
