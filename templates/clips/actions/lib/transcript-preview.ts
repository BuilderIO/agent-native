export const TRANSCRIPT_PREVIEW_CHARS = 2_000;
export const AGENT_TRANSCRIPT_MAX_CHARS = 12_000;
export const AGENT_TRANSCRIPT_SEGMENT_MAX_CHARS = 12_000;

export interface TranscriptPreview {
  recordingId: string;
  language: string | null | undefined;
  status: string | null | undefined;
  fullTextSnippet: string;
  fullTextLength: number;
  previewTruncated: boolean;
  omittedCharacterCount: number;
  segmentCount: number;
  note: string;
}

export function buildTranscriptPreview({
  recordingId,
  language,
  status,
  fullText,
  segments,
}: {
  recordingId: string;
  language: string | null | undefined;
  status: string | null | undefined;
  fullText: string | null | undefined;
  segments: unknown;
}): TranscriptPreview {
  const text = fullText ?? "";
  const previewTruncated = text.length > TRANSCRIPT_PREVIEW_CHARS;
  const omittedCharacterCount = Math.max(
    0,
    text.length - TRANSCRIPT_PREVIEW_CHARS,
  );

  return {
    recordingId,
    language,
    status,
    fullTextSnippet: text.slice(0, TRANSCRIPT_PREVIEW_CHARS),
    fullTextLength: text.length,
    previewTruncated,
    omittedCharacterCount,
    segmentCount: Array.isArray(segments) ? segments.length : 0,
    note: previewTruncated
      ? `Bounded preview only: showing the first ${TRANSCRIPT_PREVIEW_CHARS.toLocaleString()} of ${text.length.toLocaleString()} characters. It may end mid-sentence; do not infer that the transcript is incomplete. Call get-recording-player-data for the complete transcript and segments.`
      : "The complete transcript fits in this snapshot.",
  };
}

export interface BoundedAgentTranscript<T> {
  fullText: string | null;
  segments: T[];
  fullTextLength: number;
  segmentCount: number;
  previewTruncated: boolean;
  note: string;
}

export function boundTranscriptForAgent<T>({
  fullText,
  segments,
}: {
  fullText: string | null | undefined;
  segments: T[];
}): BoundedAgentTranscript<T> {
  const text = fullText ?? "";
  const boundedSegments: T[] = [];
  let segmentChars = 0;

  for (const segment of segments) {
    const nextChars = JSON.stringify(segment)?.length ?? 0;
    if (
      boundedSegments.length > 0 &&
      segmentChars + nextChars > AGENT_TRANSCRIPT_SEGMENT_MAX_CHARS
    ) {
      break;
    }
    boundedSegments.push(segment);
    segmentChars += nextChars;
  }

  const previewTruncated =
    text.length > AGENT_TRANSCRIPT_MAX_CHARS ||
    boundedSegments.length < segments.length;

  return {
    fullText:
      fullText == null ? null : text.slice(0, AGENT_TRANSCRIPT_MAX_CHARS),
    segments: boundedSegments,
    fullTextLength: text.length,
    segmentCount: segments.length,
    previewTruncated,
    note: previewTruncated
      ? `Agent transcript payload is bounded to ${AGENT_TRANSCRIPT_MAX_CHARS.toLocaleString()} text characters and ${AGENT_TRANSCRIPT_SEGMENT_MAX_CHARS.toLocaleString()} serialized segment characters. It may end mid-sentence; do not infer that transcription stopped early.`
      : "The complete transcript fits in this agent payload.",
  };
}
