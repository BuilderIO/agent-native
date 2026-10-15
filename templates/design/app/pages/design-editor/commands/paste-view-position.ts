import type { FrameEntry } from "@shared/canvas-math";

import type { VisibleCanvasRect } from "@/components/design/multi-screen/types";
import { findScreenFrameAtCanvasPoint } from "@/pages/design-editor/overview-camera";

interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewPastePosition {
  // The screen frame under the view center, or the board when it is empty canvas.
  fileId: string;
  x: number;
  y: number;
}

function rectsIntersect(a: CanvasRect, b: CanvasRect) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function visibleCenter(rect: VisibleCanvasRect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Where a keyboard paste should land when the copy's original is off-screen,
 * or null to keep pasting next to the original.
 *
 * Only a copy whose every source is a screen frame outside the view counts as
 * off-screen: the board and another design's files have no frame here, so
 * their pastes stay beside the original rather than jump on a guess.
 */
export function resolveViewPastePosition(args: {
  visibleRect: VisibleCanvasRect | null;
  frames: ReadonlyArray<FrameEntry>;
  boardFileId: string | undefined;
  sourceFileIds: ReadonlyArray<string>;
  selectedFrameIds: ReadonlyArray<string>;
  cascadeOffset: number;
}): ViewPastePosition | null {
  const { visibleRect, boardFileId } = args;
  if (!visibleRect || args.sourceFileIds.length === 0) return null;
  const frames = args.frames.filter((frame) => frame.id !== boardFileId);
  const frameIsInView = (fileId: string) => {
    const frame = frames.find((candidate) => candidate.id === fileId);
    return frame ? rectsIntersect(frame.geometry, visibleRect) : null;
  };
  if (args.selectedFrameIds.some((fileId) => frameIsInView(fileId) === true)) {
    return null;
  }
  if (args.sourceFileIds.some((fileId) => frameIsInView(fileId) !== false)) {
    return null;
  }
  const center = visibleCenter(visibleRect);
  const frame = findScreenFrameAtCanvasPoint(center, frames);
  if (frame) {
    return {
      fileId: frame.id,
      x: center.x - frame.geometry.x + args.cascadeOffset,
      y: center.y - frame.geometry.y + args.cascadeOffset,
    };
  }
  if (!boardFileId) return null;
  return {
    fileId: boardFileId,
    x: center.x + args.cascadeOffset,
    y: center.y + args.cascadeOffset,
  };
}

export interface CopiedScreenSourceFrame {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/**
 * Where a copied screen's original sits now. `canvasFrame` is only where it sat
 * when copied, so it answers only when the original has no current frame
 * (deleted, or copied from another design).
 */
export function resolveCopiedScreenSourceFrame(
  screen: { sourceScreenId?: string; canvasFrame?: CopiedScreenSourceFrame },
  currentFrames: ReadonlyArray<FrameEntry>,
): CopiedScreenSourceFrame | undefined {
  const current = screen.sourceScreenId
    ? currentFrames.find((frame) => frame.id === screen.sourceScreenId)
    : undefined;
  return current?.geometry ?? screen.canvasFrame;
}

function locatedScreenFrame(
  frame: CopiedScreenSourceFrame | undefined,
): CanvasRect | null {
  if (
    !frame ||
    !Number.isFinite(frame.x) ||
    !Number.isFinite(frame.y) ||
    !Number.isFinite(frame.width) ||
    !Number.isFinite(frame.height)
  ) {
    return null;
  }
  return {
    x: frame.x!,
    y: frame.y!,
    width: frame.width!,
    height: frame.height!,
  };
}

/**
 * Top-left canvas positions that center copied screens in the view, or null to
 * keep pasting beside the originals.
 *
 * A screen copied before it ever had a saved position has no recorded
 * location, so it counts as off-screen: the alternative is the canvas origin.
 */
export function resolveScreenViewPastePositions(args: {
  visibleRect: VisibleCanvasRect | null;
  sourceFrames: ReadonlyArray<CopiedScreenSourceFrame | undefined>;
  cascadeOffset: number;
}): Array<{ x: number; y: number }> | null {
  const { visibleRect, sourceFrames, cascadeOffset } = args;
  if (!visibleRect || sourceFrames.length === 0) return null;
  const located = sourceFrames.map(locatedScreenFrame);
  if (located.some((rect) => rect && rectsIntersect(rect, visibleRect))) {
    return null;
  }
  const center = visibleCenter(visibleRect);
  const rects = located.filter((rect): rect is CanvasRect => rect !== null);
  if (rects.length !== located.length) {
    return located.map((_, index) => ({
      x: center.x + cascadeOffset + index * 16,
      y: center.y + cascadeOffset + index * 16,
    }));
  }
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  const originX = center.x - (right - left) / 2 + cascadeOffset;
  const originY = center.y - (bottom - top) / 2 + cascadeOffset;
  return rects.map((rect) => ({
    x: originX + rect.x - left,
    y: originY + rect.y - top,
  }));
}
