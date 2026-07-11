import type { TweakDefinition } from "@shared/api";
import {
  parseCanvasFrameGeometryById,
  type CanvasFrameGeometryById,
} from "@shared/canvas-frames";
import { type TweakSelections } from "@shared/resolve-tweaks";

import { viewportSizeFromFrameGeometry } from "./data-operations";
import { frameGeometryEquals } from "./geometry-persistence";
import type { GeometryHistoryEntry } from "./history";
import type { DesignData } from "./types";

export function isDesignData(
  data: DesignData | string | undefined,
): data is DesignData {
  return !!data && typeof data === "object" && Array.isArray(data.files);
}

export function areTweakSelectionsEqual(
  a: TweakSelections,
  b: TweakSelections,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.is(a[key], b[key]));
}

export function buildAuthoritativeTweakSelections(
  tweaks: TweakDefinition[],
  persistedSelections: TweakSelections,
): TweakSelections {
  const selections: TweakSelections = {};
  for (const tweak of tweaks) {
    selections[tweak.id] =
      persistedSelections[tweak.id] !== undefined
        ? persistedSelections[tweak.id]
        : tweak.defaultValue;
  }
  for (const [key, value] of Object.entries(persistedSelections)) {
    if (/^--[-_a-zA-Z0-9]+$/.test(key)) {
      selections[key] = value;
    }
  }
  return selections;
}

export function parseDesignDataJson(
  data?: string | null,
): Record<string, unknown> {
  if (!data) return {};
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

export function getDesignDataRecord(
  data: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = data[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function getCanvasFrameGeometry(
  data: Record<string, unknown>,
): CanvasFrameGeometryById {
  return parseCanvasFrameGeometryById(data.canvasFrames);
}

export function cloneCanvasFrameGeometry(
  geometryById: CanvasFrameGeometryById,
): CanvasFrameGeometryById {
  return Object.fromEntries(
    Object.entries(geometryById).map(([frameId, geometry]) => [
      frameId,
      { ...geometry },
    ]),
  );
}

/**
 * Freshness guard for geometry undo/redo. Returns the ids of frames that a
 * geometry history entry touched whose LIVE geometry no longer matches what the
 * entry expects (`expected` = the state this entry previously wrote). A
 * non-empty result means a concurrent peer/agent moved those frames since the
 * snapshot was captured, so replaying the entry's stored "before"/"after" would
 * clobber their change. Frames absent from live geometry (deleted) are treated
 * as changed. Only compares the frames the entry itself changed, so unrelated
 * concurrent edits to OTHER frames don't block this undo.
 */
export function staleGeometryFrameIds(
  entry: GeometryHistoryEntry,
  live: CanvasFrameGeometryById,
  expected: CanvasFrameGeometryById,
): string[] {
  // A frame is "touched" when ANY geometry field differs between before and
  // after — moves (x/y), rotation, and z-order count, not just viewport size.
  const touched = new Set<string>(
    [...Object.keys(entry.before), ...Object.keys(entry.after)].filter(
      (frameId) =>
        !frameGeometryEquals(entry.before[frameId], entry.after[frameId]),
    ),
  );
  const stale: string[] = [];
  for (const frameId of touched) {
    const expectedGeo = expected[frameId];
    const liveGeo = live[frameId];
    if (!expectedGeo) continue; // entry didn't establish this frame's geometry
    if (!liveGeo || JSON.stringify(liveGeo) !== JSON.stringify(expectedGeo)) {
      stale.push(frameId);
    }
  }
  return stale;
}

export function viewportChangedFrameIds(
  before: CanvasFrameGeometryById,
  after: CanvasFrameGeometryById,
) {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...ids].filter((frameId) => {
    const beforeSize = viewportSizeFromFrameGeometry(before[frameId]);
    const afterSize = viewportSizeFromFrameGeometry(after[frameId]);
    if (!beforeSize || !afterSize) return false;
    return (
      beforeSize.width !== afterSize.width ||
      beforeSize.height !== afterSize.height
    );
  });
}
