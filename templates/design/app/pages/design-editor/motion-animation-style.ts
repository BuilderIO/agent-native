import { createMotionPresetTracksForTargets } from "@shared/motion-presets";
import type {
  MotionEase,
  MotionPropertyPreset,
  MotionTrack,
} from "@shared/motion-timeline";

export interface MotionAnimationStyle {
  label: string;
  kind: "individual" | "composite";
  preset: MotionPropertyPreset;
}

export function createMotionAnimationStyleTracks(args: {
  targets: Parameters<typeof createMotionPresetTracksForTargets>[0]["targets"];
  style: MotionAnimationStyle;
  defaultEase: MotionEase;
  currentTimeMs: number;
  timelineDurationMs: number;
  existingTracks: readonly MotionTrack[];
}) {
  return createMotionPresetTracksForTargets({
    targets: args.targets,
    preset: args.style.preset,
    defaultEase: args.defaultEase,
    currentTimeMs: args.currentTimeMs,
    timelineDurationMs: args.timelineDurationMs,
    existingTracks: args.existingTracks,
  });
}
