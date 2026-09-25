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
      ? `Bounded preview only: showing the first ${TRANSCRIPT_PREVIEW_CHARS.toLocaleString()} of ${text.length.toLocaleString()} characters. It may end mid-sentence; do not infer that the transcript is incomplete. Call get-recording-player-data and follow nextFullTextOffset until it is null.`
      : "The complete transcript fits in this snapshot.",
  };
}

export interface BoundedAgentTranscript<T> {
  fullText: string | null;
  segments: T[];
  fullTextOffset: number;
  nextFullTextOffset: number | null;
  fullTextLength: number;
  segmentCount: number;
  previewTruncated: boolean;
  note: string;
}

export function boundTranscriptForAgent<T>({
  fullText,
  segments,
  fullTextOffset = 0,
}: {
  fullText: string | null | undefined;
  segments: T[];
  fullTextOffset?: number;
}): BoundedAgentTranscript<T> {
  const text = fullText ?? "";
  const offset = Math.min(Math.max(0, Math.floor(fullTextOffset)), text.length);
  const end = Math.min(offset + AGENT_TRANSCRIPT_MAX_CHARS, text.length);
  const boundedSegments: T[] = [];
  let segmentChars = 0;

  if (offset === 0) {
    for (const segment of segments) {
      const nextChars = JSON.stringify(segment)?.length ?? 0;
      if (segmentChars + nextChars > AGENT_TRANSCRIPT_SEGMENT_MAX_CHARS) {
        break;
      }
      boundedSegments.push(segment);
      segmentChars += nextChars;
    }
  }

  const nextFullTextOffset = end < text.length ? end : null;
  const previewTruncated =
    nextFullTextOffset !== null || boundedSegments.length < segments.length;

  return {
    fullText: fullText == null ? null : text.slice(offset, end),
    segments: boundedSegments,
    fullTextOffset: offset,
    nextFullTextOffset,
    fullTextLength: text.length,
    segmentCount: segments.length,
    previewTruncated,
    note:
      nextFullTextOffset !== null
        ? `Agent transcript payload is bounded to ${AGENT_TRANSCRIPT_MAX_CHARS.toLocaleString()} text characters. It may end mid-sentence; call get-recording-player-data again with transcriptOffset=${nextFullTextOffset} to continue.`
        : previewTruncated
          ? `This is the final transcript text chunk. Segments are bounded to ${AGENT_TRANSCRIPT_SEGMENT_MAX_CHARS.toLocaleString()} serialized characters.`
          : "The complete transcript fits in this agent payload.",
  };
}
