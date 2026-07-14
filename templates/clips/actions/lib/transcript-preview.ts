export const TRANSCRIPT_PREVIEW_CHARS = 2_000;

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
