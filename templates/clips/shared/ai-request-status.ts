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

/** A request still `queued` this long was never started by any tab. */
export const AI_REQUEST_STALL_MS = 45_000;
/** A `working` request older than this no longer blocks a new one. */
export const AI_REQUEST_WORKING_LEASE_MS = 15 * 60_000;

function statusAgeMs(status: ClipsAiRequestStatus, now: number): number {
  const updatedAt = Date.parse(status.updatedAt ?? status.requestedAt ?? "");
  return Number.isFinite(updatedAt) ? now - updatedAt : Number.POSITIVE_INFINITY;
}

export function isAiRequestStalled(
  status: ClipsAiRequestStatus | null | undefined,
  now = Date.now(),
): boolean {
  return (
    status?.status === "queued" && statusAgeMs(status, now) > AI_REQUEST_STALL_MS
  );
}

export function isAiRequestLive(
  status: ClipsAiRequestStatus | null | undefined,
  now = Date.now(),
): boolean {
  if (!status) return false;
  if (status.status === "queued") return !isAiRequestStalled(status, now);
  return (
    status.status === "working" &&
    statusAgeMs(status, now) <= AI_REQUEST_WORKING_LEASE_MS
  );
}

/** A recording the browser bridge may auto-title once it is old enough. */
export interface AutoTitleCandidate {
  id: string;
  createdAt: string;
}
