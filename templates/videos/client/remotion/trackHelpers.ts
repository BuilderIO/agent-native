/**
 * Track Creation Helpers
 *
 * Standalone helpers for creating standard camera and cursor tracks.
 * Kept separate from registry.ts to avoid circular imports:
 *   registry.ts → compositions → createInteractiveComposition → trackHelpers (no cycle!)
 *
 * CRITICAL CURSOR PATTERN:
 *   Cursor "type" must always be the string "default" (never "0" or "1").
 *   The autoCursorType system automatically overrides it to "pointer" on hover.
 */

import type { AnimationTrack } from "@/types";

/**
 * Create a standard camera track with default values (no movement).
 */
export function createCameraTrack(durationInFrames: number): AnimationTrack {
  return {
    id: "camera",
    label: "Camera",
    startFrame: 0,
    endFrame: durationInFrames,
    easing: "linear",
    animatedProps: [
      { property: "translateX", from: "0", to: "0", unit: "px", keyframes: [] },
      { property: "translateY", from: "0", to: "0", unit: "px", keyframes: [] },
      { property: "scale", from: "1", to: "1", unit: "", keyframes: [] },
      { property: "rotateX", from: "0", to: "0", unit: "deg", keyframes: [] },
      { property: "rotateY", from: "0", to: "0", unit: "deg", keyframes: [] },
      {
        property: "perspective",
        from: "800",
        to: "800",
        unit: "px",
        keyframes: [],
      },
    ],
  };
}

/**
 * Create a standard cursor track with the correct configuration.
 *
 * CRITICAL: The "type" property must be "default" (not "0" or "1").
 * Never add keyframes to the type property — autoCursorType handles hover changes.
 */
export function createCursorTrack(
  durationInFrames: number,
  options?: {
    startX?: number;
    startY?: number;
    startOpacity?: number;
    easing?: string;
  },
): AnimationTrack {
  const {
    startX = 960,
    startY = 540,
    startOpacity = 1,
    easing = "expo.inOut",
  } = options || {};

  return {
    id: "cursor",
    label: "Cursor",
    startFrame: 0,
    endFrame: durationInFrames,
    easing,
    animatedProps: [
      {
        property: "x",
        from: String(startX),
        to: String(startX),
        unit: "px",
        keyframes: [],
      },
      {
        property: "y",
        from: String(startY),
        to: String(startY),
        unit: "px",
        keyframes: [],
      },
      {
        property: "opacity",
        from: String(startOpacity),
        to: String(startOpacity),
        unit: "",
        keyframes: [],
      },
      { property: "scale", from: "1", to: "1", unit: "", keyframes: [] },
      // CRITICAL: Must be "default" — autoCursorType overrides to "pointer" on hover
      { property: "type", from: "default", to: "default", unit: "" },
      { property: "isClicking", from: "0", to: "0", unit: "", keyframes: [] },
    ],
  };
}

/**
 * Create standard camera + cursor tracks for a new composition.
 */
export function createStandardTracks(
  durationInFrames: number,
): AnimationTrack[] {
  return [
    createCameraTrack(durationInFrames),
    createCursorTrack(durationInFrames),
  ];
}
