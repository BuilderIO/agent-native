import type { CSSProperties } from "react";

import type { PortableStyleSnapshot } from "../types";
import { screenLocalRectToBoardGeometry } from "./coordinate-transforms";
import { SURFACE_PADDING } from "./overview-layout";
import type {
  CrossScreenDropAxis,
  CrossScreenDropGuide,
  CrossScreenDropMode,
  CrossScreenDropPlacement,
  CrossScreenHitTestAnchorRect,
  CrossScreenHitTestResult,
  FrameGeometry,
  Point,
} from "./types";

export function isFinitePoint(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function isPortableStyleSnapshot(
  value: unknown,
): value is PortableStyleSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  return snapshot.version === 1 && Array.isArray(snapshot.nodes);
}

export function isCrossScreenDropPlacement(
  value: unknown,
): value is CrossScreenDropPlacement {
  return value === "before" || value === "after" || value === "inside";
}

export function isCrossScreenDropAxis(
  value: unknown,
): value is CrossScreenDropAxis {
  return value === "x" || value === "y";
}

export function isCrossScreenDropMode(
  value: unknown,
): value is CrossScreenDropMode {
  return value === "flow-insert" || value === "absolute-container";
}

export function isCrossScreenHitTestAnchorRect(
  value: unknown,
): value is CrossScreenHitTestAnchorRect {
  if (!value || typeof value !== "object") return false;
  const rect = value as Record<string, unknown>;
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  );
}

export function getCrossScreenDropGuideForHitTest(args: {
  hit: CrossScreenHitTestResult;
  targetGeometry: FrameGeometry;
  targetMetadata: { width: number; height: number };
}): CrossScreenDropGuide | null {
  const rect = args.hit.anchorRect;
  if (!rect) return null;
  const placement = args.hit.placement ?? "inside";
  const axis = args.hit.axis ?? "y";
  return {
    placement,
    axis,
    boardRect: screenLocalRectToBoardGeometry(
      rect,
      args.targetGeometry,
      args.targetMetadata,
    ),
  };
}

export function getCrossScreenDropGuideStyle(args: {
  guide: CrossScreenDropGuide;
  pan: Point;
  scale: number;
}): CSSProperties {
  const { boardRect, placement, axis } = args.guide;
  const left = args.pan.x + (SURFACE_PADDING + boardRect.x) * args.scale;
  const top = args.pan.y + (SURFACE_PADDING + boardRect.y) * args.scale;
  const width = Math.max(1, boardRect.width * args.scale);
  const height = Math.max(1, boardRect.height * args.scale);
  const rotation = boardRect.rotation ?? 0;

  if (placement === "inside") {
    return {
      left,
      top,
      width,
      height,
      border: "2px solid var(--design-editor-accent-color)",
      background:
        "color-mix(in srgb, var(--design-editor-accent-color) 14%, transparent)",
      borderRadius: 2,
      boxShadow: "none",
      transform: rotation ? `rotate(${rotation}deg)` : undefined,
    };
  }

  if (axis === "x") {
    const x = placement === "before" ? left : left + width;
    const lineLeft = x - 1;
    return {
      left: lineLeft,
      top,
      width: 2,
      height: Math.max(8, height),
      background: "var(--design-editor-accent-color)",
      borderRadius: 999,
      boxShadow: "0 0 0 1px var(--design-editor-accent-color)",
      transform: rotation ? `rotate(${rotation}deg)` : undefined,
      // Rotate the insertion line around the anchor rect's center, not its
      // own center, so before/after edges stay attached to a rotated target.
      transformOrigin: rotation
        ? `${left + width / 2 - lineLeft}px ${height / 2}px`
        : undefined,
    };
  }

  const y = placement === "before" ? top : top + height;
  const lineTop = y - 1;
  return {
    left,
    top: lineTop,
    width: Math.max(8, width),
    height: 2,
    background: "var(--design-editor-accent-color)",
    borderRadius: 999,
    boxShadow: "0 0 0 1px var(--design-editor-accent-color)",
    transform: rotation ? `rotate(${rotation}deg)` : undefined,
    transformOrigin: rotation
      ? `${width / 2}px ${top + height / 2 - lineTop}px`
      : undefined,
  };
}
