import { canvasToScreenPoint, screenToCanvasPoint } from "@shared/canvas-math";
import { describe, expect, it } from "vitest";

import {
  boardPointToScreenLocalPoint,
  screenLocalPointToBoardPoint,
  screenLocalRectToBoardGeometry,
} from "./coordinate-transforms";

const VIEWPORT = { width: 400, height: 800 };

describe("board <-> screen-local point conversion", () => {
  it.each([50, 100, 200])(
    "keeps overview and iframe points aligned at %d%% zoom",
    (zoom) => {
      const camera = { x: -80, y: 120, zoom };
      const surfaceOrigin = { x: 12, y: 18 };
      const canvasPoint = { x: 640, y: 380 };
      const clientPoint = canvasToScreenPoint(
        canvasPoint,
        camera,
        surfaceOrigin,
        64,
      );
      const roundTrippedCanvasPoint = screenToCanvasPoint(
        clientPoint,
        camera,
        surfaceOrigin,
        64,
      );

      expect(roundTrippedCanvasPoint.x).toBeCloseTo(canvasPoint.x, 6);
      expect(roundTrippedCanvasPoint.y).toBeCloseTo(canvasPoint.y, 6);

      const frame = { x: 420, y: 160, width: 720, height: 480 };
      const localPoint = { x: 384, y: 256 };
      const boardPoint = screenLocalPointToBoardPoint(
        localPoint,
        frame,
        VIEWPORT,
      );
      const overviewPoint = canvasToScreenPoint(
        boardPoint,
        camera,
        surfaceOrigin,
        64,
      );
      const boardPointFromOverview = screenToCanvasPoint(
        overviewPoint,
        camera,
        surfaceOrigin,
        64,
      );
      const composedLocalPoint = boardPointToScreenLocalPoint(
        boardPointFromOverview,
        frame,
        VIEWPORT,
      );
      expect(composedLocalPoint.x).toBeCloseTo(localPoint.x, 6);
      expect(composedLocalPoint.y).toBeCloseTo(localPoint.y, 6);
      const roundTrippedLocalPoint = boardPointToScreenLocalPoint(
        boardPoint,
        frame,
        VIEWPORT,
      );
      expect(roundTrippedLocalPoint.x).toBeCloseTo(localPoint.x, 6);
      expect(roundTrippedLocalPoint.y).toBeCloseTo(localPoint.y, 6);
    },
  );

  it("round-trips a point through an offset, scaled frame", () => {
    const frame = { x: 120, y: -40, width: 200, height: 400 };
    const local = { x: 137, y: 268 };
    const roundTripped = boardPointToScreenLocalPoint(
      screenLocalPointToBoardPoint(local, frame, VIEWPORT),
      frame,
      VIEWPORT,
    );
    expect(roundTripped.x).toBeCloseTo(local.x, 6);
    expect(roundTripped.y).toBeCloseTo(local.y, 6);
  });

  it("round-trips a point through a rotated frame", () => {
    const frame = { x: 60, y: 90, width: 200, height: 400, rotation: 37 };
    const local = { x: 21, y: 615 };
    const roundTripped = boardPointToScreenLocalPoint(
      screenLocalPointToBoardPoint(local, frame, VIEWPORT),
      frame,
      VIEWPORT,
    );
    expect(roundTripped.x).toBeCloseTo(local.x, 6);
    expect(roundTripped.y).toBeCloseTo(local.y, 6);
  });

  it.each([
    ["unrotated", 0],
    ["rotated", 24],
  ])(
    "maps a board point inside a %s mapped rect back inside the source rect",
    (_label, rotation) => {
      const frame = { x: 300, y: 150, width: 200, height: 400, rotation };
      const rect = { left: 40, top: 120, width: 160, height: 90 };
      const geometry = screenLocalRectToBoardGeometry(rect, frame, VIEWPORT);

      const boardCentre = {
        x: geometry.x + geometry.width / 2,
        y: geometry.y + geometry.height / 2,
      };
      const local = boardPointToScreenLocalPoint(boardCentre, frame, VIEWPORT);

      expect(local.x).toBeGreaterThanOrEqual(rect.left);
      expect(local.x).toBeLessThanOrEqual(rect.left + rect.width);
      expect(local.y).toBeGreaterThanOrEqual(rect.top);
      expect(local.y).toBeLessThanOrEqual(rect.top + rect.height);
      expect(local.x).toBeCloseTo(rect.left + rect.width / 2, 6);
      expect(local.y).toBeCloseTo(rect.top + rect.height / 2, 6);
    },
  );
});
