import { useCurrentFrame, useVideoConfig } from "remotion";
import type { AnimationTrack, AnimatedProp } from "@/types";
import { getPropValueKeyframed } from "../trackAnimation";

/**
 * Defines a rectangular hover zone for collision detection
 */
export interface HoverZone {
  x: number; // Element left position (px)
  y: number; // Element top position (px)
  width: number; // Element width (px)
  height: number; // Element height (px)
  padding?: number; // Extra hitbox padding - hover activates before cursor touches (default: 0)
  cursorType?: "default" | "pointer" | "text"; // Cursor type to show when hovering (optional)
}

export interface HoverAnimationOptions {
  hoverDuration?: number; // Frames to smooth transition (default: 6, ~200ms at 30fps)
  cursorSize?: number; // Cursor hitbox size in pixels (default: 32)
}

export interface HoverAnimationResult {
  isHovering: boolean; // True if cursor is currently over the element
  hoverProgress: number; // 0→1 progress (0 = not hovered, 1 = fully hovered)
  cursorX: number; // Current cursor X position
  cursorY: number; // Current cursor Y position
  isClicking: boolean; // True if clicking while hovered
  clickProgress: number; // 0→1 for click animation
  desiredCursorType?: "default" | "pointer" | "text"; // Cursor type this zone wants (when hovering)
}

/**
 * Hook for detecting cursor hover over a rectangular zone.
 * Returns instant on/off state (no smoothing).
 *
 * @example
 * const { isHovering, hoverProgress, isClicking } = useHoverAnimation(cursorTrack, {
 *   x: 800, y: 400, width: 320, height: 80, padding: 10
 * });
 */
export function useHoverAnimation(
  cursorTrack: AnimationTrack | undefined,
  hoverZone: HoverZone,
  options: HoverAnimationOptions = {},
): HoverAnimationResult {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const { cursorSize = 32 } = options;

  // Read cursor position from track keyframes
  const xProp = cursorTrack?.animatedProps?.find((p) => p.property === "x");
  const yProp = cursorTrack?.animatedProps?.find((p) => p.property === "y");
  const clickingProp = cursorTrack?.animatedProps?.find(
    (p) => p.property === "isClicking",
  );

  const cursorX = getPropValueKeyframed(frame, fps, cursorTrack, "x", 0);
  const cursorY = getPropValueKeyframed(frame, fps, cursorTrack, "y", 0);
  const isClickingRaw = getPropValueKeyframed(
    frame,
    fps,
    cursorTrack,
    "isClicking",
    0,
  );

  // Calculate if cursor hitbox overlaps with hover zone (with padding)
  const padding = hoverZone.padding ?? 0;
  const isHovering =
    cursorX + cursorSize > hoverZone.x - padding &&
    cursorX < hoverZone.x + hoverZone.width + padding &&
    cursorY + cursorSize > hoverZone.y - padding &&
    cursorY < hoverZone.y + hoverZone.height + padding;

  // Only count as clicking if also hovering
  const isClicking = isHovering && isClickingRaw > 0.5;

  // Instant on/off (no smooth transition)
  const hoverProgress = isHovering ? 1 : 0;
  const clickProgress = isClicking ? 1 : 0;

  // Return the desired cursor type if hovering and zone specifies one
  const desiredCursorType = isHovering ? hoverZone.cursorType : undefined;

  return {
    isHovering,
    hoverProgress,
    cursorX,
    cursorY,
    isClicking,
    clickProgress,
    desiredCursorType,
  };
}
