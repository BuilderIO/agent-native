import { describe, expect, it } from "vitest";

import { resolveFrameGeometrySync } from "./multi-screen/frame-geometry";
import type { FrameGeometry } from "./multi-screen/types";

describe("resolveFrameGeometrySync", () => {
  it("does not notify the parent when a new screen has no persisted geometry yet", () => {
    const result = resolveFrameGeometrySync({
      screens: [{ id: "source" }, { id: "new-duplicate" }],
      currentGeometryById: {
        source: { x: 0, y: 0, width: 878, height: 640 },
      },
      persistedGeometryById: {
        source: { x: 0, y: 0, width: 878, height: 640 },
        // "new-duplicate" intentionally absent — this is the in-flight gap
        // between the duplicate's create-file mutation resolving (so it
        // appears in `screens`) and its geometry save round-tripping back.
      },
    });

    expect(result.changed).toBe(true);
    expect(result.shouldNotifyParent).toBe(false);
    expect(result.next["new-duplicate"]).toBeDefined();
  });

  it("keeps an optimistic duplicate geometry ahead of the fallback", () => {
    const duplicateGeometry = {
      x: 900,
      y: 300,
      width: 878,
      height: 640,
    };
    const result = resolveFrameGeometrySync({
      screens: [{ id: "source" }, { id: "duplicate" }],
      currentGeometryById: {
        source: { x: 0, y: 0, width: 878, height: 640 },
        duplicate: { x: 0, y: 0, width: 320, height: 640 },
      },
      persistedGeometryById: {
        source: { x: 0, y: 0, width: 878, height: 640 },
      },
      geometryOverridesById: { duplicate: duplicateGeometry },
    });

    expect(result.next.duplicate).toEqual(duplicateGeometry);
    expect(result.shouldNotifyParent).toBe(false);
  });

  it("adopts persisted geometry locally without echoing it back to the parent", () => {
    const currentGeometryById: Record<string, FrameGeometry> = {
      home: { x: 0, y: 0, width: 878, height: 640 },
    };
    const result = resolveFrameGeometrySync({
      screens: [{ id: "home" }],
      currentGeometryById,
      persistedGeometryById: {
        home: { x: 0, y: 0, width: 1024, height: 640 },
      },
    });

    expect(result.changed).toBe(true);
    expect(result.shouldNotifyParent).toBe(false);
    expect(result.next.home).toMatchObject({ width: 1024 });
  });

  it("does nothing when nothing changed", () => {
    const currentGeometryById: Record<string, FrameGeometry> = {
      home: { x: 0, y: 0, width: 878, height: 640 },
    };
    const result = resolveFrameGeometrySync({
      screens: [{ id: "home" }],
      currentGeometryById,
      persistedGeometryById: {
        home: { x: 0, y: 0, width: 878, height: 640 },
      },
    });

    expect(result.changed).toBe(false);
    expect(result.shouldNotifyParent).toBe(false);
  });

  it("notifies the parent when a screen was removed", () => {
    const currentGeometryById: Record<string, FrameGeometry> = {
      home: { x: 0, y: 0, width: 878, height: 640 },
      deleted: { x: 500, y: 0, width: 878, height: 640 },
    };
    const result = resolveFrameGeometrySync({
      screens: [{ id: "home" }],
      currentGeometryById,
      persistedGeometryById: {
        home: { x: 0, y: 0, width: 878, height: 640 },
      },
    });

    expect(result.changed).toBe(true);
    expect(result.shouldNotifyParent).toBe(true);
    expect(result.next.deleted).toBeUndefined();
  });

  it("uses the duplicate's own persisted geometry once it round-trips, not the fallback width", () => {
    const result = resolveFrameGeometrySync({
      screens: [{ id: "source" }, { id: "duplicate" }],
      currentGeometryById: {
        source: { x: 0, y: 0, width: 878, height: 640 },
        duplicate: { x: 0, y: 0, width: 320, height: 640 },
      },
      persistedGeometryById: {
        source: { x: 0, y: 0, width: 878, height: 640 },
        duplicate: { x: 900, y: 300, width: 878, height: 640 },
      },
    });

    expect(result.next.duplicate).toEqual({
      x: 900,
      y: 300,
      width: 878,
      height: 640,
    });
    expect(result.changed).toBe(true);
    expect(result.shouldNotifyParent).toBe(false);
  });
});
