import { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { getPropValueKeyframed } from "@/remotion/trackAnimation";
import type { AnimationTrack } from "@/types";
import { DEFAULTS } from "@/config/constants";

export interface CursorFrame {
  x: number;
  y: number;
  clicking: number;
}

/**
 * Calculates cursor position history once per frame.
 *
 * This is a critical performance optimization: instead of each hover zone
 * independently calculating frame history (6 zones × 6 frames = 36 calls),
 * we calculate it once and share it with all zones.
 *
 * @param cursorTrack - The cursor animation track
 * @param duration - Number of frames of history to track (default: 6)
 * @returns Array of cursor positions over the last N frames
 */
export function useCursorHistory(
  cursorTrack: AnimationTrack | undefined,
  duration: number = DEFAULTS.HOVER_DURATION,
): CursorFrame[] {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return useMemo(() => {
    if (!cursorTrack) return [];

    const history: CursorFrame[] = [];

    // Find all click keyframes for smart detection
    const clickProp = cursorTrack.animatedProps?.find(
      (p) => p.property === "isClicking",
    );
    const clickKeyframes = clickProp?.keyframes || [];

    // Build history from oldest to newest frame
    for (let i = 0; i < duration; i++) {
      const checkFrame = frame - (duration - 1 - i);
      if (checkFrame < 0) continue;

      // For clicking, check if we're within 6 frames AFTER any click keyframe where value = "1"
      // This makes each click "pulse" last 6 frames
      // CRITICAL: Only pulse on keyframes with value "1", not all keyframes!
      let clicking = 0;
      for (const kf of clickKeyframes) {
        // Only create pulse if this keyframe marks the START of a click (value = "1")
        if (kf.value === "1" || kf.value === 1) {
          const clickFrame = kf.frame;
          if (checkFrame >= clickFrame && checkFrame < clickFrame + 6) {
            clicking = 1;
            break;
          }
        }
      }

      history.push({
        x: getPropValueKeyframed(checkFrame, fps, cursorTrack, "x", 0),
        y: getPropValueKeyframed(checkFrame, fps, cursorTrack, "y", 0),
        clicking,
      });
    }

    return history;
  }, [frame, fps, cursorTrack, duration]);
}
