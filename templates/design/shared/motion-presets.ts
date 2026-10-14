import type {
  MotionEase,
  MotionPropertyPreset,
  MotionTrack,
} from "./motion-timeline";
import { createMotionTrackFromPreset } from "./motion-timeline";

export const MOTION_PRESET_MIN_DURATION_MS = 50;

export interface CreateMotionPresetTracksOptions {
  targetNodeId: string;
  preset: MotionPropertyPreset;
  defaultEase: MotionEase;
  currentTimeMs: number;
  timelineDurationMs: number;
  currentValues?: Readonly<Record<string, string>>;
  existingTracks: readonly MotionTrack[];
}

export interface CreatedMotionPresetTracks {
  tracks: MotionTrack[];
  timelineDurationMs: number;
}

export interface MotionPresetTarget {
  nodeId: string;
  label: string;
  currentValues?: Readonly<Record<string, string>>;
}

export type MotionPresetTrack = MotionTrack & { label: string };

export function createMotionPresetTracks({
  targetNodeId,
  preset,
  defaultEase,
  currentTimeMs,
  timelineDurationMs,
  currentValues = {},
  existingTracks,
}: CreateMotionPresetTracksOptions): CreatedMotionPresetTracks {
  if (!Number.isFinite(timelineDurationMs) || timelineDurationMs <= 0) {
    throw new Error("Motion timeline duration must be a positive number.");
  }

  const properties = preset.additionalProperties ?? [preset.property];
  const missingProperties = properties.filter(
    (property) =>
      !existingTracks.some(
        (track) =>
          track.targetNodeId === targetNodeId && track.property === property,
      ),
  );
  if (missingProperties.length === 0) {
    return { tracks: [], timelineDurationMs };
  }

  const startMs = Math.min(
    timelineDurationMs,
    Math.max(0, Math.round(Number.isFinite(currentTimeMs) ? currentTimeMs : 0)),
  );
  const trackDurationMs = Math.max(
    MOTION_PRESET_MIN_DURATION_MS,
    timelineDurationMs - startMs,
  );
  const nextTimelineDurationMs = Math.max(
    timelineDurationMs,
    startMs + trackDurationMs,
  );

  const tracks = missingProperties.map((property) => {
    const trackPreset = { ...preset, property };
    if (property === "width" || property === "height") {
      trackPreset.from = "0px";
      trackPreset.to = currentValues[property] ?? preset.to ?? "0px";
    }

    const track = createMotionTrackFromPreset(
      targetNodeId,
      trackPreset,
      defaultEase,
    );
    if (startMs > 0) track.delayMs = startMs;
    if (startMs > 0 || trackDurationMs !== timelineDurationMs) {
      track.durationMs = trackDurationMs;
    }
    return track;
  });

  return { tracks, timelineDurationMs: nextTimelineDurationMs };
}

export function createMotionPresetTracksForTargets(args: {
  targets: readonly MotionPresetTarget[];
  preset: MotionPropertyPreset;
  defaultEase: MotionEase;
  currentTimeMs: number;
  timelineDurationMs: number;
  existingTracks: readonly MotionTrack[];
}): { tracks: MotionPresetTrack[]; timelineDurationMs: number } {
  const tracks: MotionPresetTrack[] = [];
  let timelineDurationMs = args.timelineDurationMs;

  for (const target of args.targets) {
    const created = createMotionPresetTracks({
      targetNodeId: target.nodeId,
      preset: args.preset,
      defaultEase: args.defaultEase,
      currentTimeMs: args.currentTimeMs,
      timelineDurationMs,
      currentValues: target.currentValues,
      existingTracks: [...args.existingTracks, ...tracks],
    });
    timelineDurationMs = Math.max(
      timelineDurationMs,
      created.timelineDurationMs,
    );
    tracks.push(
      ...created.tracks.map((track) => ({ ...track, label: target.label })),
    );
  }

  return { tracks, timelineDurationMs };
}
