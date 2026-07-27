import { describe, expect, it } from "vitest";

import {
  getCanonicalScreenStack,
  getResponsiveInitialFrameGeometry,
  getResponsiveScreenCullGeometry,
  getResponsiveScreenGroupSize,
  reorderCanonicalScreenStack,
  resolveFrameGeometrySync,
} from "./frame-geometry";

describe("responsive overview group layout", () => {
  const screens = Array.from({ length: 4 }, (_, index) => ({
    id: `variation-${index + 1}`,
    metadata: { width: 1280, height: 800 },
    breakpointWidths: [390, 768, 1280],
  }));

  it("reserves the complete responsive row before placing the next variation", () => {
    const first = getResponsiveInitialFrameGeometry(0, screens);
    const second = getResponsiveInitialFrameGeometry(1, screens);
    const firstGroup = getResponsiveScreenGroupSize(screens[0]!);
    expect(second.x).toBeGreaterThanOrEqual(first.x + firstGroup.width + 56);
  });

  it("puts the next grid row below the tallest responsive group", () => {
    const first = getResponsiveInitialFrameGeometry(0, screens);
    const fourth = getResponsiveInitialFrameGeometry(3, screens);
    const firstGroup = getResponsiveScreenGroupSize(screens[0]!);
    expect(fourth.y).toBeGreaterThanOrEqual(
      first.y + firstGroup.height + 28 + 56,
    );
  });

  it("culls against the complete responsive row, not only its primary frame", () => {
    const primary = { x: 100, y: 200, width: 320, height: 200 };
    const group = getResponsiveScreenCullGeometry(screens[0]!, primary);
    const size = getResponsiveScreenGroupSize(screens[0]!, primary);

    expect(group).toMatchObject({ x: 100, y: 200, rotation: undefined });
    expect(group.width).toBe(size.width);
    expect(group.height).toBe(size.height);
    expect(group.width).toBeGreaterThan(primary.width);
  });

  it("returns a conservative AABB for a responsive row rotated around its primary", () => {
    const group = getResponsiveScreenCullGeometry(screens[0]!, {
      x: 100,
      y: 200,
      width: 320,
      height: 200,
      rotation: 90,
    });

    expect(group.rotation).toBeUndefined();
    expect(group.width).toBeGreaterThanOrEqual(200);
    expect(group.height).toBeGreaterThan(320);
  });

  it("self-heals persisted legacy lineup coordinates without moving custom layouts", () => {
    const legacy = {
      "variation-1": { x: 0, y: 0, width: 320, height: 200 },
      "variation-2": { x: 376, y: 0, width: 320, height: 200 },
    };
    const result = resolveFrameGeometrySync({
      screens: screens.slice(0, 2),
      currentGeometryById: legacy,
      persistedGeometryById: legacy,
    });
    expect(result.shouldNotifyParent).toBe(true);
    expect(result.next["variation-2"]!.x).toBeGreaterThan(376);

    const custom = resolveFrameGeometrySync({
      screens: screens.slice(0, 2),
      currentGeometryById: {
        ...legacy,
        "variation-2": { ...legacy["variation-2"], x: 999 },
      },
      persistedGeometryById: {
        ...legacy,
        "variation-2": { ...legacy["variation-2"], x: 999 },
      },
    });
    expect(custom.next["variation-2"]!.x).toBe(999);
  });

  it("reflows untouched generated variant sets using their authored frame widths", () => {
    const generated = screens.slice(0, 3).map((screen) => ({
      ...screen,
      metadata: { width: 1280, height: 900 },
      breakpointWidths: [390, 768],
      layoutGroupId: "set-1",
    }));
    const legacy = {
      "variation-1": { x: 0, y: 0, width: 1280, height: 900 },
      "variation-2": { x: 1376, y: 0, width: 1280, height: 900 },
      "variation-3": { x: 2752, y: 0, width: 1280, height: 900 },
    };
    const result = resolveFrameGeometrySync({
      screens: generated,
      currentGeometryById: legacy,
      persistedGeometryById: legacy,
    });
    const firstGroup = getResponsiveScreenGroupSize(
      generated[0]!,
      legacy["variation-1"],
    );
    expect(result.next["variation-2"]!.x).toBeGreaterThanOrEqual(
      firstGroup.width + 56,
    );
    expect(result.shouldNotifyParent).toBe(true);
  });

  it("does not reflow a generated variant set after a designer moves a frame", () => {
    const generated = screens.slice(0, 2).map((screen) => ({
      ...screen,
      metadata: { width: 1280, height: 900 },
      breakpointWidths: [390, 768],
      layoutGroupId: "set-1",
    }));
    const custom = {
      "variation-1": { x: 0, y: 0, width: 1280, height: 900 },
      "variation-2": { x: 1800, y: 250, width: 1280, height: 900 },
    };
    const result = resolveFrameGeometrySync({
      screens: generated,
      currentGeometryById: custom,
      persistedGeometryById: custom,
    });
    expect(result.next["variation-2"]).toEqual(custom["variation-2"]);
    expect(result.shouldNotifyParent).toBe(false);
  });

  it("stacks multiple untouched generated variation groups without overlap", () => {
    const grouped = screens.map((screen, index) => ({
      ...screen,
      metadata: { width: 1280, height: 900 },
      breakpointWidths: [390, 768],
      layoutGroupId: index < 2 ? "set-1" : "set-2",
    }));
    const legacy = {
      "variation-1": { x: 0, y: 0, width: 1280, height: 900 },
      "variation-2": { x: 1376, y: 0, width: 1280, height: 900 },
      "variation-3": { x: 0, y: 0, width: 1280, height: 900 },
      "variation-4": { x: 1376, y: 0, width: 1280, height: 900 },
    };
    const result = resolveFrameGeometrySync({
      screens: grouped,
      currentGeometryById: legacy,
      persistedGeometryById: legacy,
    });
    const firstGroupBottom = Math.max(
      result.next["variation-1"]!.y +
        getResponsiveScreenGroupSize(grouped[0]!, legacy["variation-1"]).height,
      result.next["variation-2"]!.y +
        getResponsiveScreenGroupSize(grouped[1]!, legacy["variation-2"]).height,
    );
    expect(result.next["variation-3"]!.y).toBeGreaterThan(firstGroupBottom);
    expect(result.next["variation-4"]!.y).toBeGreaterThan(firstGroupBottom);
  });

  it("preserves every frame in a generated group when any member was custom moved", () => {
    const grouped = screens.slice(0, 2).map((screen) => ({
      ...screen,
      metadata: { width: 1280, height: 900 },
      breakpointWidths: [390, 768],
      layoutGroupId: "set-1",
    }));
    const custom = {
      "variation-1": { x: 400, y: 200, width: 1280, height: 900 },
      "variation-2": { x: 1376, y: 0, width: 1280, height: 900 },
    };
    const result = resolveFrameGeometrySync({
      screens: grouped,
      currentGeometryById: custom,
      persistedGeometryById: custom,
    });
    expect(result.next).toEqual(custom);
    expect(result.shouldNotifyParent).toBe(false);
  });
});

describe("canonical overview screen stack", () => {
  const screens = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("uses persisted z and source order as the stable tie-break", () => {
    expect(
      getCanonicalScreenStack(screens, {
        a: { z: 20 },
        b: { z: -5 },
        c: { z: 20 },
      }),
    ).toEqual(["b", "d", "a", "c"]);
  });

  it("moves one or many screens below or above the target deterministically", () => {
    expect(
      reorderCanonicalScreenStack({
        orderedIds: ["a", "b", "c", "d"],
        draggedIds: ["b"],
        targetId: "d",
        placement: "after",
      }),
    ).toEqual(["a", "c", "d", "b"]);
    expect(
      reorderCanonicalScreenStack({
        orderedIds: ["a", "b", "c", "d"],
        draggedIds: ["c", "a"],
        targetId: "b",
        placement: "after",
      }),
    ).toEqual(["b", "a", "c", "d"]);
  });

  it("rejects inside, self-only, missing-target, and no-op moves", () => {
    expect(
      reorderCanonicalScreenStack({
        orderedIds: ["a", "b"],
        draggedIds: ["a"],
        targetId: "b",
        placement: "inside",
      }),
    ).toBeNull();
    expect(
      reorderCanonicalScreenStack({
        orderedIds: ["a", "b"],
        draggedIds: ["a"],
        targetId: "a",
        placement: "before",
      }),
    ).toBeNull();
    expect(
      reorderCanonicalScreenStack({
        orderedIds: ["a", "b"],
        draggedIds: ["a"],
        targetId: "missing",
        placement: "after",
      }),
    ).toBeNull();
    expect(
      reorderCanonicalScreenStack({
        orderedIds: ["a", "b"],
        draggedIds: ["a"],
        targetId: "b",
        placement: "before",
      }),
    ).toBeNull();
  });
});
