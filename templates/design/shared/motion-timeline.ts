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

// ─── Animatable-property catalog + track factory ──────────────────────────────
//
// Shared by the MotionDock UI (the "add a track" picker) and unit tests. These
// are pure helpers so the first-track-creation flow can be tested without
// mounting React. They power the "create the FIRST track" path: a freshly
// selected element has no tracks, so the dock seeds a default track from one of
// these presets and the keyframes below.

/**
 * One animatable-property preset offered when creating a brand-new track.
 * `from`/`to` seed the two default keyframes so the track is immediately
 * compilable and previewable (a track with < 1 keyframe is rejected by
 * `apply-motion-edit`).
 */
export interface MotionPropertyPreset {
  /** CSS property animated by the track (e.g. "opacity", "transform"). */
  property: string;
  /** Human-readable label for the picker (e.g. "Opacity", "Slide up"). */
  label: string;
  /** Value at t = 0. */
  from: string;
  /** Value at t = 1. */
  to: string;
}

/**
 * Built-in property presets for the "add a track" picker. Ordered most-common
 * first. Every preset is a valid CSS identifier accepted by
 * `assertSafeCssProperty` and yields two safe keyframe values.
 */
export const MOTION_PROPERTY_PRESETS: MotionPropertyPreset[] = [
  { property: "opacity", label: "Fade (opacity)", from: "0", to: "1" },
  {
    property: "transform",
    label: "Slide up (translateY)",
    from: "translateY(16px)",
    to: "translateY(0px)",
  },
  {
    property: "transform",
    label: "Scale (zoom in)",
    from: "scale(0.8)",
    to: "scale(1)",
  },
  {
    property: "filter",
    label: "Blur in",
    from: "blur(8px)",
    to: "blur(0px)",
  },
  {
    property: "color",
    label: "Color",
    from: "#000000",
    to: "#000000",
  },
  {
    property: "background-color",
    label: "Background color",
    from: "#ffffff",
    to: "#ffffff",
  },
];

/**
 * Build a brand-new {@link MotionTrack} for a target node + property, seeded
 * with two keyframes (start/end) so it is immediately valid for both the live
 * preview bridge and the `apply-motion-edit` managed CSS persist path. Used by
 * the MotionDock "create first track" path.
 *
 * When `preset` is omitted, a neutral 0 → 1 opacity-style pair is used so the
 * track still compiles; callers normally pass a {@link MotionPropertyPreset}.
 */
export function createMotionTrack(
  targetNodeId: string,
  property: string,
  options: { from?: string; to?: string; ease?: MotionEase } = {},
): MotionTrack {
  const from = options.from ?? "0";
  const to = options.to ?? "1";
  return {
    targetNodeId,
    property,
    keyframes: [
      { t: 0, value: from, ...(options.ease ? { ease: options.ease } : {}) },
      { t: 1, value: to, ...(options.ease ? { ease: options.ease } : {}) },
    ],
  };
}

/**
 * Build a track from a {@link MotionPropertyPreset}. Thin wrapper over
 * {@link createMotionTrack} that forwards the preset's seed values.
 */
export function createMotionTrackFromPreset(
  targetNodeId: string,
  preset: MotionPropertyPreset,
  ease?: MotionEase,
): MotionTrack {
  return createMotionTrack(targetNodeId, preset.property, {
    from: preset.from,
    to: preset.to,
    ease,
  });
}

/**
 * Return `true` when a track for the given (targetNodeId, property) pair already
 * exists in `tracks`. The dock uses this to decide between "create a new track"
 * and "add a keyframe to the existing track" so a property is never duplicated.
 */
export function hasTrackFor(
  tracks: MotionTrack[],
  targetNodeId: string,
  property: string,
): boolean {
  return tracks.some(
    (t) => t.targetNodeId === targetNodeId && t.property === property,
  );
}
