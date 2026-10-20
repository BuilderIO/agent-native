import type { MotionPathSegmentV1 } from "@shared/motion-timeline";

export interface MotionTrackWire {
  id?: string;
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
  trackId?: string | null,
): MotionTrackWire | undefined {
  const positionTracks = tracks.filter(
    (track) =>
      track.targetNodeId === targetNodeId && track.property === "translate",
  );
  if (trackId) return positionTracks.find((track) => track.id === trackId);
  const authoredTracks = positionTracks.filter(
    (track) => track.nativeStyleIndex === undefined,
  );
  if (authoredTracks.length === 1) return authoredTracks[0];
  if (authoredTracks.length > 1) return undefined;
  return positionTracks.length === 1 ? positionTracks[0] : undefined;
}

export type MotionPathTracksChangeResult =
  | { status: "updated" }
  | {
      status: "unsupported";
      reason: "ambiguous-position-source" | "repeated-position-path";
    };
