import { spring, interpolate } from "remotion";
import type { AnimationTrack, EasingKey } from "@/types";
import { getEasingFunction } from "./easingFunctions";

type SpringConfig = {
  damping?: number;
  stiffness?: number;
  mass?: number;
  overshootClamping?: boolean;
};

/**
 * Maps an EasingKey to a Remotion spring config.
 * "spring" → bouncy (low damping), others → tightly tuned for each curve shape.
 */
export function easingToSpringConfig(easing: EasingKey): SpringConfig {
  switch (easing) {
    case "spring":       return { damping: 25, stiffness: 150, mass: 0.5 };
    case "ease-out":     return { damping: 200, stiffness: 400 };
    case "ease-in":      return { damping: 200, stiffness: 20 };
    case "ease-in-out":  return { damping: 200, stiffness: 80 };
    case "linear":       return { damping: 200, stiffness: 200, overshootClamping: true };
    default:             return { damping: 200 };
  }
}

/**
 * Returns a 0 → 1 progress value driven by an AnimationTrack.
 *
 * • "spring" easing  → Remotion spring(), starts at track.startFrame.
 * • All other easings → GSAP-style easing curves over [startFrame, endFrame].
 */
export function trackProgress(
  frame: number,
  fps: number,
  track: AnimationTrack
): number {
  const { startFrame, endFrame, easing } = track;

  if (easing === "spring") {
    return spring({
      frame,
      fps,
      delay: startFrame,
      config: easingToSpringConfig(easing),
    });
  }

  const elapsed = Math.max(0, frame - startFrame);
  const duration = Math.max(1, endFrame - startFrame);
  const t = Math.min(1, elapsed / duration);

  // Use new easing functions
  const easingFn = getEasingFunction(easing);
  return easingFn(t);
}

/**
 * Looks up a track by id from an array, returning a fallback if not found.
 */
export function findTrack(
  tracks: AnimationTrack[],
  id: string,
  fallback: AnimationTrack
): AnimationTrack {
  return tracks.find((t) => t.id === id) ?? fallback;
}

/**
 * Reads the from/to numeric values for a CSS property from a track's
 * animatedProps list and returns the interpolated value at the given progress.
 *
 * Falls back to defaultFrom/defaultTo if the property isn't defined on the track.
 */
export function getPropValue(
  progress: number,
  track: AnimationTrack,
  property: string,
  defaultFrom: number,
  defaultTo: number
): number {
  const prop = track.animatedProps?.find((p) => p.property === property);
  const fromNum = prop ? parseFloat(prop.from) : NaN;
  const toNum   = prop ? parseFloat(prop.to)   : NaN;
  const from = Number.isFinite(fromNum) ? fromNum : defaultFrom;
  const to   = Number.isFinite(toNum)   ? toNum   : defaultTo;
  return interpolate(progress, [0, 1], [from, to]);
}

/**
 * Reads a CSS property value from a track using keyframe-based interpolation.
 * If the property has keyframes, interpolates between nearest keyframes.
 * Otherwise, falls back to from/to behavior using track progress.
 *
 * Keyframe behavior:
 * - Before first keyframe → hold first value
 * - After last keyframe → hold last value
 * - Between keyframes → linear interpolation
 * - No keyframes → use from/to with trackProgress
 */
export function getPropValueKeyframed(
  frame: number,
  fps: number,
  track: AnimationTrack,
  property: string,
  defaultValue: number
): number {
  const prop = track.animatedProps?.find((p) => p.property === property);

  // No property defined → use default
  if (!prop) return defaultValue;

  // Has keyframes → interpolate between nearest keyframes
  if (prop.keyframes && prop.keyframes.length > 0) {
    const sorted = [...prop.keyframes].sort((a, b) => a.frame - b.frame);

    // Before first keyframe → hold first value
    if (frame <= sorted[0].frame) {
      const val = parseFloat(sorted[0].value);
      return Number.isFinite(val) ? val : defaultValue;
    }

    // After last keyframe → hold last value
    if (frame >= sorted[sorted.length - 1].frame) {
      const val = parseFloat(sorted[sorted.length - 1].value);
      return Number.isFinite(val) ? val : defaultValue;
    }

    // Between keyframes → interpolation with easing
    for (let i = 0; i < sorted.length - 1; i++) {
      const curr = sorted[i];
      const next = sorted[i + 1];

      if (frame >= curr.frame && frame <= next.frame) {
        const from = parseFloat(curr.value);
        const to = parseFloat(next.value);

        // Safety check: if either value is invalid, use defaults
        if (!Number.isFinite(from) || !Number.isFinite(to)) {
          return defaultValue;
        }

        const frameDiff = next.frame - curr.frame;
        // Prevent division by zero
        if (frameDiff === 0) return from;

        const t = (frame - curr.frame) / frameDiff;

        // Apply easing: read from destination keyframe (the one we're arriving at)
        // This way, setting easing on a keyframe affects the motion arriving at it
        const easing = next.easing ?? prop.easing ?? "linear";
        const easingFn = getEasingFunction(easing);
        const easedT = easingFn(t);

        return from + (to - from) * easedT;
      }
    }
  }

  // Fall back to from/to (existing behavior)
  const from = parseFloat(prop.from);
  const to = parseFloat(prop.to);

  // Safety check for from/to values
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return defaultValue;
  }

  const progress = trackProgress(frame, fps, track);
  return interpolate(progress, [0, 1], [from, to]);
}
