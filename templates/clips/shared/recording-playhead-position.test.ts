import { describe, expect, it } from "vitest";

import {
  dockRecordingPlayhead,
  positionRecordingPlayheadAtEdge,
  positionRecordingPlayheadAtDock,
  resizeRecordingPlayheadPosition,
} from "./recording-playhead-position";

const viewport = { left: 0, top: 0, width: 1_440, height: 900 };
const sizes = {
  horizontal: { width: 150, height: 42 },
  vertical: { width: 42, height: 118 },
};

describe("recording playhead positioning", () => {
  it("switches to a vertical left dock with top, middle, and bottom slots", () => {
    expect(dockRecordingPlayhead(20, 40, sizes, viewport)).toEqual({
      left: 16,
      top: 16,
      orientation: "vertical",
      dock: "left",
      slot: "top",
    });
    expect(dockRecordingPlayhead(20, 400, sizes, viewport)).toEqual({
      left: 16,
      top: 391,
      orientation: "vertical",
      dock: "left",
      slot: "middle",
    });
    expect(dockRecordingPlayhead(20, 800, sizes, viewport)).toEqual({
      left: 16,
      top: 766,
      orientation: "vertical",
      dock: "left",
      slot: "bottom",
    });
  });

  it("switches to a vertical right dock without leaving the viewport", () => {
    expect(dockRecordingPlayhead(1_300, 400, sizes, viewport)).toEqual({
      left: 1_382,
      top: 391,
      orientation: "vertical",
      dock: "right",
      slot: "middle",
    });
  });

  it("centers horizontal top and bottom dock presets", () => {
    expect(
      positionRecordingPlayheadAtDock("top", null, sizes.horizontal, viewport),
    ).toEqual({ left: 645, top: 16 });
    expect(
      positionRecordingPlayheadAtDock(
        "bottom",
        null,
        sizes.horizontal,
        viewport,
      ),
    ).toEqual({ left: 645, top: 842 });
  });

  it("preserves the cross-axis coordinate when snapping to an edge", () => {
    expect(
      positionRecordingPlayheadAtEdge(
        "left",
        420,
        237,
        sizes.vertical,
        viewport,
      ),
    ).toEqual({ left: 16, top: 237 });
    expect(
      positionRecordingPlayheadAtEdge(
        "right",
        420,
        237,
        sizes.vertical,
        viewport,
      ),
    ).toEqual({ left: 1_382, top: 237 });
    expect(
      positionRecordingPlayheadAtEdge(
        "top",
        734,
        237,
        sizes.horizontal,
        viewport,
      ),
    ).toEqual({ left: 734, top: 16 });
    expect(
      positionRecordingPlayheadAtEdge(
        "bottom",
        734,
        237,
        sizes.horizontal,
        viewport,
      ),
    ).toEqual({ left: 734, top: 842 });
  });

  it("clamps the preserved edge coordinate into the visible viewport", () => {
    expect(
      positionRecordingPlayheadAtEdge(
        "right",
        2_000,
        850,
        sizes.vertical,
        viewport,
      ),
    ).toEqual({ left: 1_382, top: 766 });
    expect(
      positionRecordingPlayheadAtEdge(
        "bottom",
        -200,
        850,
        sizes.horizontal,
        viewport,
      ),
    ).toEqual({ left: 16, top: 842 });
  });

  it("keeps a free playhead horizontal and clamps it during resize", () => {
    const free = dockRecordingPlayhead(700, 300, sizes, viewport);
    expect(free).toEqual({
      left: 700,
      top: 300,
      orientation: "horizontal",
      dock: "free",
      slot: null,
    });
    expect(
      resizeRecordingPlayheadPosition(
        { ...free, left: 1_400, top: 880 },
        sizes,
        viewport,
      ),
    ).toMatchObject({ left: 1_274, top: 842, orientation: "horizontal" });
  });

  it("recomputes a docked position when the playhead grows", () => {
    expect(
      positionRecordingPlayheadAtDock(
        "right",
        "middle",
        { width: 60, height: 180 },
        viewport,
      ),
    ).toEqual({ left: 1_364, top: 360 });
    expect(
      resizeRecordingPlayheadPosition(
        {
          left: 1_382,
          top: 391,
          orientation: "vertical",
          dock: "right",
          slot: "middle",
        },
        { ...sizes, vertical: { width: 60, height: 180 } },
        viewport,
      ),
    ).toEqual({
      left: 1_364,
      top: 360,
      orientation: "vertical",
      dock: "right",
      slot: "middle",
    });
  });

  it("keeps a docked playhead inside a viewport smaller than its bounds", () => {
    expect(
      positionRecordingPlayheadAtDock(
        "right",
        "bottom",
        { width: 220, height: 220 },
        { left: 0, top: 0, width: 180, height: 180 },
      ),
    ).toEqual({ left: 16, top: 16 });
  });
});
