export const CLIPS_AI_REQUEST_KINDS = [
  "generate-metadata",
  "regenerate-title",
  "regenerate-summary",
  "regenerate-chapters",
  "remove-filler-words",
  "remove-silences",
] as const;

export type ClipsAiRequestKind = (typeof CLIPS_AI_REQUEST_KINDS)[number];

export function aiRequestTabId(
  recordingId: string,
  kind: ClipsAiRequestKind,
  requestedAt: string,
): string {
  return `clips-ai-request:${encodeURIComponent(recordingId)}:${kind}:${encodeURIComponent(requestedAt)}`;
}

export function parseAiRequestTabId(tabId: string): {
  recordingId: string;
  kind: ClipsAiRequestKind;
  requestedAt: string;
} | null {
  const match = /^clips-ai-request:([^:]+):([^:]+):([^:]+)$/.exec(tabId);
  if (!match) return null;

  try {
    const [, encodedRecordingId, kind, encodedRequestedAt] = match;
    if (!CLIPS_AI_REQUEST_KINDS.includes(kind as ClipsAiRequestKind)) {
      return null;
    }
    const recordingId = decodeURIComponent(encodedRecordingId);
    const requestedAt = decodeURIComponent(encodedRequestedAt);
    return recordingId && requestedAt
      ? { recordingId, kind: kind as ClipsAiRequestKind, requestedAt }
      : null;
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

export interface ClipsAiRequestStatus {
  kind?: ClipsAiRequestKind;
  status?: "queued" | "working" | "completed" | "failed" | "cancelled";
  message?: string | null;
  requestedAt?: string;
  updatedAt?: string;
}
