/**
 * Motion timeline types for the Design Studio motion dock (§6.3 + §4.3).
 *
 * A MotionTimeline compiles into a managed `<style data-agent-native-motion>`
 * block. The CSS is the runtime truth; the JSON `tracks` aid editing only.
 * `compiledHash` keeps the two in lockstep — `apply-motion-edit` must update
 * both atomically.
 */

export type MotionEase =
  | "linear"
  | "ease"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "step-start"
  | "step-end"
  | string; // cubic-bezier(...) or steps(...)

export interface MotionKeyframe {
  /** Normalised time in [0, 1] where 0 = 0% and 1 = 100% of `durationMs`. */
  t: number;
  /** CSS property value at this keyframe (e.g. "0px", "1", "#ff0000"). */
  value: string;
  /** Per-keyframe easing applied between this keyframe and the next. */
  ease?: MotionEase;
}

/**
 * One property track for a single target node.
 * A node may have multiple tracks (e.g. opacity + transform).
 */
export interface MotionTrack {
  /** Matches `data-agent-native-node-id` stamped on the target DOM element. */
  targetNodeId: string;
  /** CSS property name being animated (e.g. "opacity", "transform", "color"). */
  property: string;
  keyframes: MotionKeyframe[];
}

/**
 * A complete animation timeline scoped to one design + source + screen/file.
 * A design may have many timelines (one per screen or logical animation group).
 */
export interface MotionTimeline {
  id: string;
  designId: string;
  /**
   * Opaque source reference identifying the screen or file this timeline
   * belongs to (fileId for inline designs, routeId for localhost/fusion).
   * `null` when scoped to the entire design.
   */
  sourceRef: string | null;
  /**
   * File path for real-app CSS module output.
   * `null` for inline designs (CSS lives in the managed `<style>` block).
   */
  filePath: string | null;
  tracks: MotionTrack[];
  /** Total animation duration in milliseconds. */
  durationMs: number;
  /** Default easing applied to keyframe intervals that omit a per-keyframe ease. */
  defaultEase: MotionEase;
  /**
   * Hash of the compiled CSS output. Used by `apply-motion-edit` to detect
   * drift between the stored JSON tracks and the managed `<style>` block.
   * Cleared to `null` when tracks are edited but CSS has not yet been recompiled.
   */
  compiledHash: string | null;
  createdAt: string;
  updatedAt: string;
}
