import type { AnimationTrack } from "@/types";

export interface CursorTrackOptions {
  /** Starting position before entering (default: off-screen left) */
  startPosition?: { x: number; y: number };
  /** Position where cursor hovers over the component */
  hoverPosition: { x: number; y: number };
  /** Position where cursor exits to (default: off-screen right) */
  exitPosition?: { x: number; y: number };
  /** Frame when click happens (default: 80) */
  clickFrame?: number;
  /** Frame when hover starts (default: 40) */
  hoverStartFrame?: number;
  /** Frame when hover ends (default: 110) */
  hoverEndFrame?: number;
}

/**
 * Creates a standardized 5-second (150 frames @ 30fps) cursor track for component previews
 * Demonstrates hover and click interactions clearly
 */
export function createComponentCursorTrack(
  options: CursorTrackOptions,
): AnimationTrack {
  const {
    startPosition = { x: 200, y: 200 }, // Start from top-left visible area
    hoverPosition,
    exitPosition = { x: 1720, y: 200 }, // Exit to top-right
    clickFrame = 80,
    hoverStartFrame = 40,
    hoverEndFrame = 110,
  } = options;

  return {
    id: "cursor",
    label: "Cursor",
    startFrame: 0,
    endFrame: 150,
    easing: "linear",
    animatedProps: [
      {
        property: "x",
        from: "0",
        to: "0",
        unit: "px",
        keyframes: [
          { frame: 0, value: String(startPosition.x) },
          { frame: hoverStartFrame, value: String(hoverPosition.x) },
          { frame: hoverEndFrame, value: String(hoverPosition.x) },
          { frame: 130, value: String(exitPosition.x) },
          { frame: 150, value: String(exitPosition.x) },
        ],
      },
      {
        property: "y",
        from: "0",
        to: "0",
        unit: "px",
        keyframes: [
          { frame: 0, value: String(startPosition.y) },
          { frame: hoverStartFrame, value: String(hoverPosition.y) },
          { frame: hoverEndFrame, value: String(hoverPosition.y) },
          { frame: 130, value: String(exitPosition.y) },
          { frame: 150, value: String(exitPosition.y) },
        ],
      },
      {
        property: "isClicking",
        from: "0",
        to: "0",
        unit: "",
        keyframes: [
          { frame: 0, value: "0" },
          { frame: clickFrame - 1, value: "0" },
          { frame: clickFrame, value: "1" },
          { frame: clickFrame + 10, value: "0" },
          { frame: 150, value: "0" },
        ],
      },
      // CRITICAL: type must be constant "default" — autoCursorType switches to "pointer" on hover automatically
      // Never use "0"/"1" values or keyframes here
      {
        property: "type",
        from: "default",
        to: "default",
        unit: "",
      },
      {
        property: "opacity",
        from: "1",
        to: "1",
        unit: "",
        keyframes: [
          { frame: 0, value: "1" },
          { frame: 150, value: "1" },
        ],
      },
    ],
  };
}

/**
 * Pre-configured cursor track for centered component
 */
export function createCenteredCursorTrack(
  width: number,
  height: number,
): AnimationTrack {
  return createComponentCursorTrack({
    hoverPosition: {
      x: width / 2 - 16, // -16 to account for cursor size
      y: height / 2 - 16,
    },
  });
}

/**
 * Pre-configured cursor track for component at specific position
 */
export function createPositionedCursorTrack(
  x: number,
  y: number,
  width: number,
  height: number,
): AnimationTrack {
  return createComponentCursorTrack({
    hoverPosition: {
      x: x + width / 2 - 16,
      y: y + height / 2 - 16,
    },
  });
}
