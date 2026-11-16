import { describe, expect, it, vi } from "vitest";

import * as canvasFrames from "../../../../shared/canvas-frames";
import {
  type FrameGeometryInputScreen,
  resolveFrameGeometrySync,
  reuseFrameGeometryInputs,
} from "./frame-geometry";

vi.mock("../../../../shared/canvas-frames", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../shared/canvas-frames")>();
  return {
    ...actual,
    getResponsiveInitialCanvasFrameGeometries: vi.fn(
      actual.getResponsiveInitialCanvasFrameGeometries,
    ),
  };
});

function makeScreens(count: number, groupSize: number, groupCount: number) {
  return Array.from({ length: count }, (_, index) => {
    const groupIndex = Math.floor(index / groupSize);
    return {
      id: `screen-${index}`,
      metadata: { width: 1440, height: 900 + (index % 7) * 40 },
      breakpointWidths: [390, 768],
      layoutGroupId:
        groupIndex < groupCount ? `group-${groupIndex}` : undefined,
    };
  });
}

describe("frame geometry resolution scaling", () => {
  it("lays out each screen list once instead of once per screen", () => {
    const layout = vi.mocked(
      canvasFrames.getResponsiveInitialCanvasFrameGeometries,
    );
    layout.mockClear();
    const screens = makeScreens(500, 25, 4);

    const { next } = resolveFrameGeometrySync({
      screens,
      currentGeometryById: {},
      persistedGeometryById: {},
    });

    expect(Object.keys(next)).toHaveLength(500);
    const laidOutScreens = layout.mock.calls.reduce(
      (total, [list]) => total + list.length,
      0,
    );
    expect(layout.mock.calls.length).toBeLessThanOrEqual(1 + 4);
    expect(laidOutScreens).toBeLessThanOrEqual(2 * screens.length);
  });
});

describe("frame geometry inputs identity", () => {
  const grouped: FrameGeometryInputScreen = {
    id: "a",
    metadata: { width: 1440, height: 900 },
    breakpointWidths: [390],
    layoutGroupId: "group",
  };
  const plain: FrameGeometryInputScreen = {
    id: "b",
    metadata: { width: 390, height: 844 },
  };
  const inputs = [grouped, plain];

  it("keeps the previous array when only screen content changed", () => {
    const rebuilt = [
      {
        ...grouped,
        metadata: { width: 1440, height: 900 },
        breakpointWidths: [390],
      },
      { ...plain, metadata: { width: 390, height: 844 } },
    ];
    expect(reuseFrameGeometryInputs(inputs, rebuilt)).toBe(inputs);
  });

  it("takes the new array when any geometry input changed", () => {
    const changes = [
      [{ ...grouped, metadata: { width: 1280, height: 900 } }, plain],
      [{ ...grouped, breakpointWidths: [390, 768] }, plain],
      [{ ...grouped, layoutGroupId: undefined }, plain],
      [plain, grouped],
      [grouped],
    ];
    for (const next of changes) {
      expect(reuseFrameGeometryInputs(inputs, next)).toBe(next);
    }
  });
});
