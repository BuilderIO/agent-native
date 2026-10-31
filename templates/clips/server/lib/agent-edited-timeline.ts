/**
 * External agents see a clip the way the player plays it: with the owner's
 * cuts removed. Stored times (transcript, chapters, comments, media) are in
 * the original recording; this maps them to and from the edited timeline.
 */

import {
  editedToOriginal,
  effectiveDuration,
  getExcludedRanges,
  isExcluded,
  originalToEdited,
  parseEdits,
  type EditsJson,
} from "../../app/lib/timestamp-mapping.js";
import {
  formatAgentTimestamp,
  type AgentTranscriptSegment,
} from "../../shared/agent-context.js";

export interface AgentEditedTimeline {
  hasCuts: boolean;
  durationMs: number;
  toSourceMs: (editedMs: number) => number;
  fromSourceMs: (sourceMs: number) => number;
  /** Edited times at which a cut begins; a continuous range cannot cross one. */
  cutBoundariesMs: number[];
  mapSegments: (segments: AgentTranscriptSegment[]) => AgentTranscriptSegment[];
  mapChapters: <T extends { startMs: number }>(chapters: T[]) => T[];
}

function cutOverlapMs(startMs: number, endMs: number, edits: EditsJson) {
  let overlap = 0;
  for (const range of getExcludedRanges(edits)) {
    overlap += Math.max(
      0,
      Math.min(endMs, range.endMs) - Math.max(startMs, range.startMs),
    );
  }
  return overlap;
}

export function buildAgentEditedTimeline(
  editsJson: string | null | undefined,
  sourceDurationMs: number,
): AgentEditedTimeline {
  const edits = parseEdits(editsJson);
  const hasCuts = getExcludedRanges(edits).length > 0;
  if (!hasCuts) {
    return {
      hasCuts,
      durationMs: sourceDurationMs,
      toSourceMs: (ms) => ms,
      fromSourceMs: (ms) => ms,
      cutBoundariesMs: [],
      mapSegments: (segments) => segments,
      mapChapters: (chapters) => chapters,
    };
  }
  const fromSourceMs = (ms: number) => originalToEdited(ms, edits);
  return {
    hasCuts,
    durationMs: effectiveDuration(sourceDurationMs, edits),
    toSourceMs: (ms) => editedToOriginal(ms, edits),
    fromSourceMs,
    cutBoundariesMs: getExcludedRanges(edits).map((range) =>
      fromSourceMs(range.startMs),
    ),
    mapSegments: (segments) =>
      segments
        .filter((segment) =>
          segment.endMs > segment.startMs
            ? segment.endMs - segment.startMs >
              cutOverlapMs(segment.startMs, segment.endMs, edits)
            : !isExcluded(segment.startMs, edits),
        )
        .map((segment) => {
          const startMs = fromSourceMs(segment.startMs);
          const endMs = Math.max(startMs, fromSourceMs(segment.endMs));
          const start = formatAgentTimestamp(startMs);
          return {
            ...segment,
            startMs,
            endMs,
            timestamp: start,
            range: `${start}-${formatAgentTimestamp(endMs)}`,
          };
        }),
    mapChapters: (chapters) =>
      chapters
        .filter((chapter) => !isExcluded(chapter.startMs, edits))
        .map((chapter) => ({
          ...chapter,
          startMs: fromSourceMs(chapter.startMs),
        })),
  };
}
