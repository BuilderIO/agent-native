import { fail } from "@agent-native/core/action";

import { parseTranscriptSegments } from "../../shared/transcript-segments.js";

export interface SilenceTrimRange {
  startMs: number;
  endMs: number;
}

const SPEECH_BUFFER_MS = 200;

export function findSilenceTrimRanges(
  segmentsJson: string | null | undefined,
  thresholdMs: number,
  durationMs = 0,
): SilenceTrimRange[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(segmentsJson ?? "[]");
  } catch {
    fail(
      "Transcript segments are unreadable; regenerate the transcript and try again.",
      { errorCode: "transcript_unreadable", statusCode: 422 },
    );
  }
  if (!Array.isArray(parsed)) {
    fail(
      "Transcript segments are unreadable; regenerate the transcript and try again.",
      { errorCode: "transcript_unreadable", statusCode: 422 },
    );
  }

  const segments = parseTranscriptSegments(JSON.stringify(parsed));
  if (segments.length !== parsed.length || segments.length === 0) {
    fail("Timestamped transcript segments are required to remove silences.", {
      errorCode: "timestamped_transcript_required",
      statusCode: 422,
    });
  }

  const ordered = segments
    .map((segment) => ({
      startMs: Math.max(0, Math.min(segment.startMs, durationMs || Infinity)),
      endMs: Math.max(0, Math.min(segment.endMs, durationMs || Infinity)),
    }))
    .filter((segment) => segment.endMs > segment.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  if (ordered.length === 0) {
    fail("Timestamped transcript segments are required to remove silences.", {
      errorCode: "timestamped_transcript_required",
      statusCode: 422,
    });
  }

  const ranges: SilenceTrimRange[] = [];
  let previousEndMs = ordered[0].endMs;
  for (const segment of ordered.slice(1)) {
    const gapMs = segment.startMs - previousEndMs;
    if (gapMs > thresholdMs) {
      const startMs = previousEndMs + SPEECH_BUFFER_MS;
      const endMs = segment.startMs - SPEECH_BUFFER_MS;
      if (endMs > startMs) ranges.push({ startMs, endMs });
    }
    previousEndMs = Math.max(previousEndMs, segment.endMs);
  }

  return ranges;
}
