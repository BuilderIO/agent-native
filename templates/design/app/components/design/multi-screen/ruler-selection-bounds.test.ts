import { getFrameBounds } from "@shared/canvas-math";
import { describe, expect, it } from "vitest";

import { rulerSelectionBounds } from "./ruler-selection-bounds";

const home = { x: 100, y: 200, width: 1200, height: 800 };
const screenGeometry = (id: string) => (id === "home" ? home : undefined);

describe("rulerSelectionBounds", () => {
  it("marks a layer selected inside a screen in canvas space", () => {
    expect(
      rulerSelectionBounds({
        layerSelection: {
          screenId: "home",
          rect: { left: 80, top: 40, width: 320, height: 220 },
        },
        selectedElementScreenId: "home",
        screenGeometry,
        selectedFrames: [{ geometry: home }],
        boardSelection: null,
      }),
    ).toEqual({ left: 180, top: 240, right: 500, bottom: 460 });
  });

  it("falls back to the selected screens once no layer in them is selected", () => {
    const other = { x: 1400, y: 200, width: 400, height: 300 };
    expect(
      rulerSelectionBounds({
        layerSelection: {
          screenId: "home",
          rect: { left: 80, top: 40, width: 320, height: 220 },
        },
        selectedElementScreenId: null,
        screenGeometry,
        selectedFrames: [{ geometry: home }, { geometry: other }],
        boardSelection: null,
      }),
    ).toEqual({ left: 100, top: 200, right: 1800, bottom: 1000 });
  });

  it("marks a board selection, and nothing when nothing is selected", () => {
    const board = getFrameBounds({ x: 10, y: 20, width: 30, height: 40 });
    expect(
      rulerSelectionBounds({
        layerSelection: null,
        selectedElementScreenId: null,
        screenGeometry,
        selectedFrames: [],
        boardSelection: board,
      }),
    ).toEqual({ left: 10, top: 20, right: 40, bottom: 60 });
    expect(
      rulerSelectionBounds({
        layerSelection: null,
        selectedElementScreenId: null,
        screenGeometry,
        selectedFrames: [],
        boardSelection: null,
      }),
    ).toBeNull();
  });
});
