import { describe, expect, it } from "vitest";

import { getOverscannedViewportCanvasBounds } from "./culling";
import { SURFACE_PADDING } from "./overview-layout";
import {
  selectSourceDemand,
  SOURCE_PREVIEW_DEMAND_BUDGET,
} from "./source-demand";

const COLUMNS = 25;

function board(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `screen-${i}`,
    geometry: {
      x: (i % COLUMNS) * 1600,
      y: Math.floor(i / COLUMNS) * 1100,
      width: 1440,
      height: 1000,
    },
  }));
}

function viewportAt(
  zoom: number,
  center: { x: number; y: number },
  surface = { width: 1600, height: 1000 },
) {
  const viewport = getOverscannedViewportCanvasBounds(
    surface,
    {
      x: surface.width / 2 - (center.x + SURFACE_PADDING) * zoom,
      y: surface.height / 2 - (center.y + SURFACE_PADDING) * zoom,
    },
    zoom * 100,
    0,
  );
  if (!viewport) throw new Error("Test surface has no viewport");
  return viewport;
}

describe("source demand", () => {
  it("bounds a 7,185-screen fit-all view while retaining selected screens", () => {
    const frames = board(7185);
    const all = new Set(frames.map((frame) => frame.id));
    expect(
      selectSourceDemand({
        frames,
        liveIds: all,
        protectedIds: new Set(["screen-7184"]),
        zoom: 0.01,
      }).pinned,
    ).toEqual(["screen-7184"]);
    const { pinned } = selectSourceDemand({
      frames,
      liveIds: all,
      protectedIds: new Set(["screen-7184"]),
      zoom: 1,
    });
    expect(pinned).toHaveLength(33);
    expect(pinned).toContain("screen-7184");
    expect(pinned).not.toContain("screen-100");
  });

  it("bounds a select-all set and keeps the active and export screens", () => {
    const frames = board(7185);
    const all = new Set(frames.map((frame) => frame.id));
    const required = new Set(["screen-7184", "screen-7183"]);
    const { pinned } = selectSourceDemand({
      frames,
      liveIds: all,
      protectedIds: all,
      zoom: 0.01,
      requiredIds: required,
    });
    expect(pinned.length).toBeLessThanOrEqual(34);
    expect(pinned.slice(0, 2)).toEqual(["screen-7184", "screen-7183"]);
  });

  it("previews every visible screen outside the live pool, nearest first", () => {
    const frames = board(500);
    const zoom = 0.04;
    const center = { x: 12 * 1600 + 720, y: 10 * 1100 + 500 };
    const viewport = viewportAt(zoom, center, { width: 480, height: 320 });
    const live = new Set(["screen-262", "screen-263"]);
    const { pinned, preview } = selectSourceDemand({
      frames,
      liveIds: live,
      protectedIds: new Set(["screen-0"]),
      zoom,
      viewport,
    });
    // Live screens 58 px wide are not worth an editor's source.
    expect(pinned).toEqual(["screen-0"]);
    expect(preview[0]).toBe("screen-262");
    expect(preview).toContain("screen-263");
    expect(preview).not.toContain("screen-0");
    const visible = frames.filter(
      (frame) =>
        frame.id !== "screen-0" &&
        frame.geometry.x + frame.geometry.width >= viewport.left &&
        frame.geometry.x <= viewport.right &&
        frame.geometry.y + frame.geometry.height >= viewport.top &&
        frame.geometry.y <= viewport.bottom,
    );
    expect(visible.length).toBeGreaterThan(40);
    expect(visible.length).toBeLessThanOrEqual(SOURCE_PREVIEW_DEMAND_BUDGET);
    expect(new Set(preview)).toEqual(new Set(visible.map(({ id }) => id)));
    const distance = (id: string) => {
      const geometry = frames.find((frame) => frame.id === id)?.geometry;
      if (!geometry) throw new Error(`No frame ${id}`);
      return Math.hypot(
        geometry.x + geometry.width / 2 - center.x,
        geometry.y + geometry.height / 2 - center.y,
      );
    };
    const distances = preview.map(distance);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it("caps previews at what the canvas can paint and keeps the nearest", () => {
    const frames = board(500);
    const zoom = 0.005;
    const { preview } = selectSourceDemand({
      frames,
      liveIds: new Set(),
      protectedIds: new Set(),
      zoom,
      viewport: viewportAt(zoom, { x: 20000, y: 11000 }),
    });
    expect(preview).toHaveLength(SOURCE_PREVIEW_DEMAND_BUDGET);
    expect(preview[0]).toBe("screen-262");
    expect(preview).not.toContain("screen-0");
  });

  it("ranks every on-screen screen ahead of nearby off-screen ones", () => {
    // A tall screen whose top is in view has its center far below it.
    const frames = [
      {
        id: "short-above",
        geometry: { x: 0, y: -1400, width: 1440, height: 1000 },
      },
      {
        id: "tall-in-view",
        geometry: { x: 1600, y: 800, width: 1440, height: 40000 },
      },
    ];
    const { preview } = selectSourceDemand({
      frames,
      liveIds: new Set(),
      protectedIds: new Set(),
      zoom: 0.1,
      viewport: { left: 0, top: 0, right: 3200, bottom: 1000 },
      overscannedViewport: {
        left: -1600,
        top: -1500,
        right: 4800,
        bottom: 2500,
      },
    });
    expect(preview).toEqual(["tall-in-view", "short-above"]);
  });

  it("holds the source of every painted screen in view, even past the byte budget", () => {
    const frames = board(500);
    const zoom = 0.04;
    const viewport = viewportAt(
      zoom,
      { x: 12 * 1600 + 720, y: 10 * 1100 + 500 },
      { width: 480, height: 320 },
    );
    const painted = new Set(["screen-262", "screen-263", "screen-0"]);
    const { pinned, preview } = selectSourceDemand({
      frames,
      liveIds: new Set(),
      protectedIds: new Set(),
      zoom,
      paintedIds: painted,
      viewport,
    });
    expect(pinned).toEqual(["screen-262", "screen-263"]);
    expect(preview).not.toContain("screen-262");
    // A painted screen out of view is only a preview candidate, never held.
    expect(pinned).not.toContain("screen-0");
  });

  it("previews nothing without a viewport", () => {
    expect(
      selectSourceDemand({
        frames: board(10),
        liveIds: new Set(),
        protectedIds: new Set(),
        zoom: 1,
      }).preview,
    ).toEqual([]);
  });
});
