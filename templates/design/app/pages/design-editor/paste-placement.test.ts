import type { FrameBounds } from "@shared/canvas-math";
import { describe, expect, it } from "vitest";

import {
  CASCADE_STEP_PX,
  type PastePlacement,
  type PastePlacementEntry,
  type PastePlacementInput,
  resolvePastePlacement,
  SAME_SCREEN_NUDGE_PX,
} from "./paste-placement";

function makeBounds(
  left: number,
  top: number,
  width: number,
  height: number,
): FrameBounds {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

function makeEntry(
  index: number,
  overrides: Partial<PastePlacementEntry> = {},
): PastePlacementEntry {
  return {
    index,
    sourceFileId: "screen-a",
    sourcePosition: { x: 100, y: 100 },
    kind: "layer",
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<PastePlacementInput> = {},
): PastePlacementInput {
  return {
    entries: [makeEntry(0)],
    target: { fileId: "screen-a", isSourceScreen: true, frameBounds: null },
    selection: null,
    viewport: { visibleCanvasBounds: makeBounds(0, 0, 1000, 1000), zoom: 100 },
    explicitPoint: null,
    origin: "same-screen",
    cascadeCount: 0,
    ...overrides,
  };
}

/** Narrow a placement to its absolute position or fail loudly. */
function pos(placement: PastePlacement): { x: number; y: number } {
  if (placement.mode !== "absolute") {
    throw new Error(`expected absolute placement, got ${placement.mode}`);
  }
  return placement.position;
}

describe("Rule 1 — flow-after", () => {
  it("pastes as flow sibling when a flow-container is selected (no position)", () => {
    const result = resolvePastePlacement(
      baseInput({
        entries: [makeEntry(0), makeEntry(1)],
        selection: { selector: "#hero", isFlowContainer: true },
      }),
    );
    expect(result.placements).toEqual([
      { mode: "flow-after", anchorSelector: "#hero" },
      { mode: "flow-after", anchorSelector: "#hero" },
    ]);
    // Flow-after emits no absolute coordinates.
    expect(result.placements.every((p) => p.mode === "flow-after")).toBe(true);
  });

  it("treats any selected element with a selector as a flow sibling", () => {
    const result = resolvePastePlacement(
      baseInput({ selection: { selector: ".card", isFlowContainer: false } }),
    );
    expect(result.placements[0]).toEqual({
      mode: "flow-after",
      anchorSelector: ".card",
    });
  });

  it("falls through to absolute placement when the selector is null", () => {
    const result = resolvePastePlacement(
      baseInput({ selection: { selector: null, isFlowContainer: true } }),
    );
    expect(result.placements[0].mode).toBe("absolute");
  });

  it("does not flow-after when an explicit point is provided", () => {
    const result = resolvePastePlacement(
      baseInput({
        selection: { selector: "#hero", isFlowContainer: true },
        explicitPoint: { x: 40, y: 40 },
      }),
    );
    expect(result.placements[0].mode).toBe("absolute");
  });

  it("does not flow-after for non-layer (screen/image) entries", () => {
    const result = resolvePastePlacement(
      baseInput({
        entries: [makeEntry(0, { kind: "screen" })],
        selection: { selector: "#hero", isFlowContainer: true },
      }),
    );
    expect(result.placements[0].mode).toBe("absolute");
  });
});

describe("Rule 2 — same container", () => {
  it("places at source + nudge with no cascade on the first paste", () => {
    const result = resolvePastePlacement(
      baseInput({
        entries: [makeEntry(0, { sourcePosition: { x: 100, y: 200 } })],
      }),
    );
    expect(pos(result.placements[0])).toEqual({
      x: 100 + SAME_SCREEN_NUDGE_PX,
      y: 200 + SAME_SCREEN_NUDGE_PX,
    });
    expect(result.ensureVisible).toBe(false);
  });

  it("preserves each entry's own source coords (uniform nudge)", () => {
    const result = resolvePastePlacement(
      baseInput({
        entries: [
          makeEntry(0, { sourcePosition: { x: 100, y: 100 } }),
          makeEntry(1, { sourcePosition: { x: 300, y: 180 } }),
        ],
      }),
    );
    const a = pos(result.placements[0]);
    const b = pos(result.placements[1]);
    expect(a).toEqual({ x: 110, y: 110 });
    expect(b).toEqual({ x: 310, y: 190 });
    // Spacing between the two entries is identical before and after.
    expect(b.x - a.x).toBe(200);
    expect(b.y - a.y).toBe(80);
  });

  it("applies the cascade offset uniformly to the group", () => {
    const result = resolvePastePlacement(
      baseInput({
        entries: [
          makeEntry(0, { sourcePosition: { x: 100, y: 100 } }),
          makeEntry(1, { sourcePosition: { x: 300, y: 100 } }),
        ],
        cascadeCount: 2,
      }),
    );
    const offset = SAME_SCREEN_NUDGE_PX + 2 * CASCADE_STEP_PX;
    expect(pos(result.placements[0])).toEqual({
      x: 100 + offset,
      y: 100 + offset,
    });
    expect(pos(result.placements[1])).toEqual({
      x: 300 + offset,
      y: 100 + offset,
    });
  });
});

describe("Rule 3 — cross-screen relative", () => {
  const destFrame = makeBounds(500, 500, 400, 400);

  it("anchors the group top-left to the destination frame origin", () => {
    const result = resolvePastePlacement(
      baseInput({
        origin: "cross-screen",
        target: {
          fileId: "screen-b",
          isSourceScreen: false,
          frameBounds: destFrame,
        },
        entries: [makeEntry(0, { sourcePosition: { x: 100, y: 100 } })],
        viewport: {
          visibleCanvasBounds: makeBounds(400, 400, 800, 800),
          zoom: 100,
        },
      }),
    );
    expect(pos(result.placements[0])).toEqual({ x: 500, y: 500 });
    expect(result.ensureVisible).toBe(false);
  });

  it("preserves internal spacing of a multi-entry group", () => {
    const entries = [
      makeEntry(0, { sourcePosition: { x: 100, y: 100 } }),
      makeEntry(1, { sourcePosition: { x: 260, y: 190 } }),
    ];
    const beforeDx = 260 - 100;
    const beforeDy = 190 - 100;
    const result = resolvePastePlacement(
      baseInput({
        origin: "cross-screen",
        target: {
          fileId: "screen-b",
          isSourceScreen: false,
          frameBounds: destFrame,
        },
        entries,
        viewport: {
          visibleCanvasBounds: makeBounds(400, 400, 800, 800),
          zoom: 100,
        },
      }),
    );
    const a = pos(result.placements[0]);
    const b = pos(result.placements[1]);
    expect(a).toEqual({ x: 500, y: 500 });
    // Two-entry spacing is identical before and after the cross-screen paste.
    expect(b.x - a.x).toBe(beforeDx);
    expect(b.y - a.y).toBe(beforeDy);
  });

  it("applies cascade offset to the whole group when kept visible", () => {
    const run = (cascadeCount: number) =>
      resolvePastePlacement(
        baseInput({
          origin: "cross-screen",
          target: {
            fileId: "screen-b",
            isSourceScreen: false,
            frameBounds: destFrame,
          },
          entries: [makeEntry(0, { sourcePosition: { x: 100, y: 100 } })],
          viewport: {
            visibleCanvasBounds: makeBounds(400, 400, 2000, 2000),
            zoom: 100,
          },
          cascadeCount,
        }),
      );
    expect(pos(run(0).placements[0])).toEqual({ x: 500, y: 500 });
    expect(pos(run(1).placements[0])).toEqual({ x: 516, y: 516 });
    expect(pos(run(2).placements[0])).toEqual({ x: 532, y: 532 });
  });
});

describe("Rule 4 — off-screen visibility", () => {
  const destFrame = makeBounds(0, 0, 400, 400);

  function crossInput(
    bounds: FrameBounds,
    entries: PastePlacementEntry[],
  ): PastePlacementInput {
    return baseInput({
      origin: "cross-screen",
      target: {
        fileId: "screen-b",
        isSourceScreen: false,
        frameBounds: destFrame,
      },
      entries,
      viewport: { visibleCanvasBounds: bounds, zoom: 100 },
    });
  }

  it("centers the group when it is fully off-screen", () => {
    // Group lands at frame origin (0,0); visible region is far away.
    const bounds = makeBounds(2000, 2000, 1000, 1000);
    const result = resolvePastePlacement(
      crossInput(bounds, [
        makeEntry(0, { sourcePosition: { x: 100, y: 100 } }),
      ]),
    );
    expect(result.ensureVisible).toBe(true);
    // Single-entry group center lands exactly on the viewport center.
    expect(pos(result.placements[0])).toEqual({
      x: bounds.centerX,
      y: bounds.centerY,
    });
  });

  it("centers when less than 50% of the group's AABB is visible", () => {
    // Group AABB spans (0,0)-(400,400) = 160000 area. Visible starts at
    // (200,200) so only a 200x200 corner (40000 = 25%) overlaps.
    const entries = [
      makeEntry(0, { sourcePosition: { x: 100, y: 100 } }),
      makeEntry(1, { sourcePosition: { x: 500, y: 500 } }),
    ];
    const bounds = makeBounds(200, 200, 800, 800);
    const result = resolvePastePlacement(crossInput(bounds, entries));
    expect(result.ensureVisible).toBe(true);
    const a = pos(result.placements[0]);
    const b = pos(result.placements[1]);
    // Whole group translated by one vector: internal spacing preserved.
    expect(b.x - a.x).toBe(400);
    expect(b.y - a.y).toBe(400);
    // Group center matches viewport center after the single translation.
    expect((a.x + b.x) / 2).toBe(bounds.centerX);
    expect((a.y + b.y) / 2).toBe(bounds.centerY);
  });

  it("does not center when the group is mostly visible", () => {
    // Group AABB (0,0)-(400,400) fully inside a large viewport → 100% visible.
    const entries = [
      makeEntry(0, { sourcePosition: { x: 100, y: 100 } }),
      makeEntry(1, { sourcePosition: { x: 500, y: 500 } }),
    ];
    const bounds = makeBounds(0, 0, 2000, 2000);
    const result = resolvePastePlacement(crossInput(bounds, entries));
    expect(result.ensureVisible).toBe(false);
    expect(pos(result.placements[0])).toEqual({ x: 0, y: 0 });
  });

  it("centers under a zoomed-in (small) viewport that excludes the group", () => {
    // Highly zoomed-in: the visible canvas region is a small window that does
    // not contain the group placed at the destination frame origin.
    const entries = [
      makeEntry(0, { sourcePosition: { x: 100, y: 100 } }),
      makeEntry(1, { sourcePosition: { x: 300, y: 250 } }),
    ];
    const bounds = makeBounds(1200, 900, 200, 150);
    const result = resolvePastePlacement(crossInput(bounds, entries));
    expect(result.ensureVisible).toBe(true);
    const a = pos(result.placements[0]);
    const b = pos(result.placements[1]);
    expect(b.x - a.x).toBe(200);
    expect(b.y - a.y).toBe(150);
    expect((a.x + b.x) / 2).toBe(bounds.centerX);
    expect((a.y + b.y) / 2).toBe(bounds.centerY);
  });
});

describe("Rule 5 — explicit point", () => {
  it("places the group top-left at the explicit point, offsets preserved", () => {
    const entries = [
      makeEntry(0, { sourcePosition: { x: 100, y: 100 } }),
      makeEntry(1, { sourcePosition: { x: 240, y: 170 } }),
    ];
    const result = resolvePastePlacement(
      baseInput({ explicitPoint: { x: 40, y: 60 }, entries }),
    );
    const a = pos(result.placements[0]);
    const b = pos(result.placements[1]);
    expect(a).toEqual({ x: 40, y: 60 });
    // Relative spacing preserved from the source group.
    expect(b.x - a.x).toBe(140);
    expect(b.y - a.y).toBe(70);
    expect(result.ensureVisible).toBe(false);
  });

  it("staggers by index when the group has no source positions", () => {
    const entries = [
      makeEntry(0, { sourcePosition: null, kind: "image" }),
      makeEntry(1, { sourcePosition: null, kind: "image" }),
    ];
    const result = resolvePastePlacement(
      baseInput({ explicitPoint: { x: 40, y: 60 }, entries }),
    );
    expect(pos(result.placements[0])).toEqual({ x: 40, y: 60 });
    expect(pos(result.placements[1])).toEqual({
      x: 40 + CASCADE_STEP_PX,
      y: 60 + CASCADE_STEP_PX,
    });
  });
});

describe("Rule 6 — last resort stagger", () => {
  it("staggers from the viewport center when there are no source positions", () => {
    const entries = [
      makeEntry(0, { sourcePosition: null, kind: "image", sourceFileId: null }),
      makeEntry(1, { sourcePosition: null, kind: "image", sourceFileId: null }),
    ];
    const bounds = makeBounds(0, 0, 1000, 800);
    const result = resolvePastePlacement(
      baseInput({
        origin: "external",
        entries,
        viewport: { visibleCanvasBounds: bounds, zoom: 100 },
      }),
    );
    expect(pos(result.placements[0])).toEqual({
      x: bounds.centerX,
      y: bounds.centerY,
    });
    expect(pos(result.placements[1])).toEqual({
      x: bounds.centerX + CASCADE_STEP_PX,
      y: bounds.centerY + CASCADE_STEP_PX,
    });
    expect(result.ensureVisible).toBe(true);
  });

  it("falls back to {120,120} when no viewport is available", () => {
    const result = resolvePastePlacement(
      baseInput({
        origin: "assets",
        entries: [makeEntry(0, { sourcePosition: null, kind: "image" })],
        viewport: null,
      }),
    );
    expect(pos(result.placements[0])).toEqual({ x: 120, y: 120 });
    expect(result.ensureVisible).toBe(true);
  });
});

describe("Rule 7 — cascade", () => {
  it("increments cascade for same-screen keyboard pastes (V,V,V → 0,16,32)", () => {
    const source = { x: 100, y: 100 };
    let cascadeCount = 0;
    const offsets: number[] = [];
    for (let i = 0; i < 3; i++) {
      const result = resolvePastePlacement(
        baseInput({
          entries: [makeEntry(0, { sourcePosition: source })],
          cascadeCount,
        }),
      );
      offsets.push(
        pos(result.placements[0]).x - source.x - SAME_SCREEN_NUDGE_PX,
      );
      cascadeCount = result.nextCascadeCount;
    }
    expect(offsets).toEqual([0, CASCADE_STEP_PX, 2 * CASCADE_STEP_PX]);
    // Monotonically increasing group offset.
    expect(offsets[1]).toBeGreaterThan(offsets[0]);
    expect(offsets[2]).toBeGreaterThan(offsets[1]);
  });

  it("increments cascade for cross-screen keyboard pastes", () => {
    const result = resolvePastePlacement(
      baseInput({
        origin: "cross-screen",
        target: {
          fileId: "screen-b",
          isSourceScreen: false,
          frameBounds: makeBounds(0, 0, 400, 400),
        },
        explicitPoint: null,
      }),
    );
    expect(result.nextCascadeCount).toBe(1);
  });

  it("does NOT increment for explicit-point (mouse) pastes", () => {
    const result = resolvePastePlacement(
      baseInput({ explicitPoint: { x: 10, y: 10 }, cascadeCount: 3 }),
    );
    expect(result.nextCascadeCount).toBe(3);
  });

  it("does NOT increment for non-keyboard origins (assets/figma/external)", () => {
    for (const origin of ["assets", "figma", "external"] as const) {
      const result = resolvePastePlacement(
        baseInput({
          origin,
          entries: [makeEntry(0, { sourcePosition: null, kind: "image" })],
          cascadeCount: 5,
        }),
      );
      expect(result.nextCascadeCount).toBe(5);
    }
  });
});

describe("Screen entries", () => {
  it("treats screen-kind entries like layers (they always carry positions)", () => {
    const result = resolvePastePlacement(
      baseInput({
        origin: "cross-screen",
        target: {
          fileId: "screen-b",
          isSourceScreen: false,
          frameBounds: makeBounds(500, 500, 400, 400),
        },
        entries: [
          makeEntry(0, { kind: "screen", sourcePosition: { x: 100, y: 100 } }),
          makeEntry(1, { kind: "screen", sourcePosition: { x: 300, y: 100 } }),
        ],
        viewport: {
          visibleCanvasBounds: makeBounds(400, 400, 2000, 2000),
          zoom: 100,
        },
      }),
    );
    const a = pos(result.placements[0]);
    const b = pos(result.placements[1]);
    expect(a).toEqual({ x: 500, y: 500 });
    // Screen spacing preserved in the destination frame.
    expect(b.x - a.x).toBe(200);
  });
});
