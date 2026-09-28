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

export function isPointerInsideSourceIframe(args: {
  iframeX: number;
  iframeY: number;
  viewportW: number;
  viewportH: number;
  frameWidth?: number;
  frameHeight?: number;
}): boolean {
  const width = args.frameWidth ?? args.viewportW;
  const height = args.frameHeight ?? args.viewportH;
  const scaleX =
    args.frameWidth !== undefined ? width / Math.max(1, args.viewportW) : 1;
  const scaleY =
    args.frameHeight !== undefined ? height / Math.max(1, args.viewportH) : 1;
  const x = args.iframeX * scaleX;
  const y = args.iframeY * scaleY;
  return x >= 0 && y >= 0 && x <= width && y <= height;
}

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

export function captureCrossScreenSourceHtmlSnapshot(
  sourceDocument: Document | null,
  sourceNodeId: string | undefined,
): string | undefined {
  if (!sourceDocument || !sourceNodeId) return undefined;
  const matches = sourceDocument.querySelectorAll(
    `[data-agent-native-node-id="${CSS.escape(sourceNodeId)}"]`,
  );
  if (matches.length !== 1) return undefined;
  return matches.item(0)?.outerHTML;
}

export function validateCrossScreenSourceHtmlSnapshot(
  snapshot: string,
  sourceNodeId: string,
): string | undefined {
  if (typeof document === "undefined") return undefined;
  const template = document.createElement("template");
  template.innerHTML = snapshot.trim();
  const meaningfulNodes = Array.from(template.content.childNodes).filter(
    (node) => node.nodeType !== Node.TEXT_NODE || node.textContent?.trim(),
  );
  if (
    meaningfulNodes.length !== 1 ||
    meaningfulNodes[0]?.nodeType !== Node.ELEMENT_NODE
  ) {
    return undefined;
  }
  const root = meaningfulNodes[0] as Element;
  if (root.getAttribute("data-agent-native-node-id") !== sourceNodeId) {
    return undefined;
  }
  return root.outerHTML;
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

export const COMPACT_CROSS_SCREEN_GHOST_PX = 16;

export function getCrossScreenGhostStyle(args: {
  ghost: { boardX: number; boardY: number; width?: number; height?: number };
  pan: Point;
  scale: number;
}): CSSProperties {
  const { boardX, boardY, width: boardWidth, height: boardHeight } = args.ghost;
  const width = boardWidth
    ? Math.max(1, boardWidth * args.scale)
    : COMPACT_CROSS_SCREEN_GHOST_PX;
  const height = boardHeight
    ? Math.max(1, boardHeight * args.scale)
    : COMPACT_CROSS_SCREEN_GHOST_PX;
  return {
    left:
      args.pan.x +
      (SURFACE_PADDING + boardX) * args.scale -
      (boardWidth ? 0 : width / 2),
    top:
      args.pan.y +
      (SURFACE_PADDING + boardY) * args.scale -
      (boardHeight ? 0 : height / 2),
    width,
    height,
  };
}
