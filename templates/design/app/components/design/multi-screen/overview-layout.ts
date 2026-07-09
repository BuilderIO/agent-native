import type { CSSProperties } from "react";

import type { FrameGeometry } from "./types";

export const OVERVIEW_FRAME_WIDTH = 320;
export const SURFACE_PADDING = 240;

export const LINEUP_RECENTER_SUPPRESS_MAX_AGE_MS = 10_000;

export interface LineupRecenterDuplicateArm {
  atMs: number;
  fromCount: number;
  addedCount: number;
}

export function shouldSuppressLineupRecenter(args: {
  armed: LineupRecenterDuplicateArm | null;
  nowMs: number;
  screenCount: number;
  deviceFrameChanged: boolean;
  maxAgeMs?: number;
}): boolean {
  if (!args.armed) return false;
  if (args.deviceFrameChanged) return false;
  const age = args.nowMs - args.armed.atMs;
  if (age < 0 || age > (args.maxAgeMs ?? LINEUP_RECENTER_SUPPRESS_MAX_AGE_MS)) {
    return false;
  }
  return (
    args.screenCount > args.armed.fromCount && // i18n-ignore -- comparison, not visible copy
    args.screenCount <= args.armed.fromCount + args.armed.addedCount
  );
}

export function isLineupShrinkOnlyChange(args: {
  previousCount: number | null;
  screenCount: number;
  deviceFrameChanged: boolean;
}): boolean {
  return (
    !args.deviceFrameChanged &&
    args.previousCount !== null &&
    args.screenCount < args.previousCount
  );
}

export function getBoardSurfaceLayerStyle(args: {
  geometry: FrameGeometry;
  interactive: boolean;
}): CSSProperties {
  return {
    position: "absolute",
    left: SURFACE_PADDING + args.geometry.x,
    top: SURFACE_PADDING + args.geometry.y,
    width: args.geometry.width,
    height: args.geometry.height,
    overflow: "hidden",
    pointerEvents: args.interactive ? "auto" : "none",
    background: "transparent",
    zIndex: 0,
  };
}
