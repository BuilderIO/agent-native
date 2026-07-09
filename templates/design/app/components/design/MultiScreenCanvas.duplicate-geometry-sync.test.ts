import { describe, expect, it } from "vitest";

import { resolveFrameGeometrySync } from "./multi-screen/frame-geometry";
import type { FrameGeometry } from "./multi-screen/types";

/**
 * B5-9 regression coverage: alt-drag duplicating a screen (or drawing a new
 * frame) used to land the new screen overlapping the original and narrower
 * than the source. Root cause: MultiScreenCanvas's screens/geometryById
 * prop-sync effect treated a brand-new screen's absence of persisted
 * geometry as a real change worth notifying the parent about
 * (onGeometryChange -> queueFrameGeometrySave), using the disposable
 * getInitialFrameGeometry() fallback (hardcoded SCREEN_WIDTH=320) as the
 * payload. That notify shares its debounce timer with the caller's own
 * "create the duplicate at the source's real geometry" save, so the
 * fallback-driven notify could fire AFTER and silently overwrite the
 * correct pending write. resolveFrameGeometrySync is the extracted pure
 * decision this effect now uses: it must mark a brand-new, not-yet-persisted
 * screen as a LOCAL-only change (changed=true) without ever asking the
 * effect to notify the parent for that reason (shouldNotifyParent=false).
 */
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
    // The local render state still gets a placeholder so the screen renders
    // something (the shared getInitialFrameGeometry fallback), it just must
    // never be pushed back to the server.
    expect(result.next["new-duplicate"]).toBeDefined();
  });

  it("notifies the parent when a screen's persisted geometry actually changed", () => {
    const currentGeometryById: Record<string, FrameGeometry> = {
      home: { x: 0, y: 0, width: 878, height: 640 },
    };
    const result = resolveFrameGeometrySync({
      screens: [{ id: "home" }],
      currentGeometryById,
      persistedGeometryById: {
        // A concurrent peer/agent resized this screen — the persisted value
        // now differs from what's locally known.
        home: { x: 0, y: 0, width: 1024, height: 640 },
      },
    });

    expect(result.changed).toBe(true);
    expect(result.shouldNotifyParent).toBe(true);
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
    // Simulates the tick right after handleDuplicateScreen's
    // writeFrameGeometrySnapshot has landed in the query cache: the
    // duplicate now has real persisted geometry matching the source.
    const result = resolveFrameGeometrySync({
      screens: [{ id: "source" }, { id: "duplicate" }],
      currentGeometryById: {
        source: { x: 0, y: 0, width: 878, height: 640 },
        // Previously resolved to the disposable fallback on a prior tick.
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
    expect(result.shouldNotifyParent).toBe(true);
  });
});
