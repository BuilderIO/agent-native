import type { MotionPathSegmentV1 } from "@shared/motion-timeline";

export interface MotionTrackWire {
  targetNodeId: string;
  property: string;
  keyframes: Array<{
    t: number;
    value: string;
    ease?: string;
    motionPath?: MotionPathSegmentV1;
  }>;
  nativeStyleIndex?: number;
  delayMs?: number;
  durationMs?: number;
}

export function motionPathTrackForTarget(
  tracks: readonly MotionTrackWire[],
  targetNodeId: string,
): MotionTrackWire | undefined {
  const positionTracks = tracks.filter(
    (track) =>
      track.targetNodeId === targetNodeId && track.property === "translate",
  );
  return (
    positionTracks.find((track) => track.nativeStyleIndex === undefined) ??
    positionTracks[0]
  );
}

export type MotionPathTracksChangeResult =
  | { status: "updated" }
  | { status: "unsupported"; reason: "ambiguous-position-source" };
