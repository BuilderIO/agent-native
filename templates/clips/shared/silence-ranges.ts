import type { TranscriptSegment } from "./transcript-segments.js";

export interface TrimRange {
  startMs: number;
  endMs: number;
}

export const SILENCE_SPEECH_BUFFER_MS = 200;

export function computeSilenceTrimRanges(
  segments: readonly Pick<TranscriptSegment, "startMs" | "endMs">[],
  thresholdMs: number,
  bufferMs = SILENCE_SPEECH_BUFFER_MS,
): TrimRange[] {
  // Mic and system segments overlap in meetings, so gaps are measured on the union.
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);
  const ranges: TrimRange[] = [];
  let speechEnd = -1;
  for (const segment of sorted) {
    if (speechEnd >= 0 && segment.startMs - speechEnd > thresholdMs) {
      const startMs = speechEnd + bufferMs;
      const endMs = segment.startMs - bufferMs;
      if (endMs > startMs) ranges.push({ startMs, endMs });
    }
    speechEnd = Math.max(speechEnd, segment.endMs);
  }
  return ranges;
}
