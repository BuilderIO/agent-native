import { useMemo } from "react";
import type { TranscriptSegment } from "@/../shared/api";

export type TalkTracks = Record<string, number[]>;

export function useTalkTracks(
  segments: TranscriptSegment[],
  durationMs: number,
  bucketCount = 400,
): TalkTracks {
  return useMemo(() => {
    const tracks: TalkTracks = {};
    if (!segments?.length || durationMs <= 0 || bucketCount <= 0) return tracks;
    const bucketMs = durationMs / bucketCount;

    for (const seg of segments) {
      const speaker = seg.speakerLabel || "Unknown";
      if (!tracks[speaker]) tracks[speaker] = new Array(bucketCount).fill(0);
      const startBucket = Math.max(
        0,
        Math.floor(seg.startMs / bucketMs),
      );
      const endBucket = Math.min(
        bucketCount - 1,
        Math.floor(seg.endMs / bucketMs),
      );
      for (let b = startBucket; b <= endBucket; b++) {
        const bStart = b * bucketMs;
        const bEnd = bStart + bucketMs;
        const overlapStart = Math.max(seg.startMs, bStart);
        const overlapEnd = Math.min(seg.endMs, bEnd);
        const overlap = Math.max(0, overlapEnd - overlapStart);
        tracks[speaker][b] = Math.min(
          1,
          tracks[speaker][b] + overlap / bucketMs,
        );
      }
    }
    return tracks;
  }, [segments, durationMs, bucketCount]);
}
