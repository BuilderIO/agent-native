import type { CSSProperties } from "react";

import { SURFACE_PADDING } from "../MultiScreenCanvas";
import type { PortableStyleSnapshot } from "../types";
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
  const scaleX =
    args.targetGeometry.width / Math.max(1, args.targetMetadata.width);
  const scaleY =
    args.targetGeometry.height / Math.max(1, args.targetMetadata.height);
  return {
    placement,
    axis,
    boardRect: {
      x: args.targetGeometry.x + rect.left * scaleX,
      y: args.targetGeometry.y + rect.top * scaleY,
      width: Math.max(1, rect.width * scaleX),
      height: Math.max(1, rect.height * scaleY),
    },
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
    };
  }

  if (axis === "x") {
    const x = placement === "before" ? left : left + width;
    return {
      left: x - 1,
      top,
      width: 2,
      height: Math.max(8, height),
      background: "var(--design-editor-accent-color)",
      borderRadius: 999,
      boxShadow: "0 0 0 1px var(--design-editor-accent-color)",
    };
  }

  const y = placement === "before" ? top : top + height;
  return {
    left,
    top: y - 1,
    width: Math.max(8, width),
    height: 2,
    background: "var(--design-editor-accent-color)",
    borderRadius: 999,
    boxShadow: "0 0 0 1px var(--design-editor-accent-color)",
  };
}
