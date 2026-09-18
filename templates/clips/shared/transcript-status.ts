export const STALE_PENDING_TRANSCRIPT_MS = 5 * 60 * 1000;

/**
 * How often a worker that is still transcribing must re-stamp its pending row.
 *
 * `updatedAt` is the only liveness signal a pending row carries, so this must
 * stay well under STALE_PENDING_TRANSCRIPT_MS: a run whose slowest single step
 * (media fetch, ffmpeg extraction, provider call) outlives the heartbeat is
 * indistinguishable from a worker that died.
 */
export const PENDING_TRANSCRIPT_HEARTBEAT_MS = 60 * 1000;

export const STALE_PENDING_TRANSCRIPT_REASON =
  "Transcription stopped before it finished. Retry transcription to start a fresh attempt.";

export function resolveTranscriptPresentation(
  transcript:
    | {
        status?: string | null;
        updatedAt?: string | null;
        failureReason?: string | null;
      }
    | null
    | undefined,
  nowMs = Date.now(),
): {
  status: string | null;
  failureReason: string | null;
  stalePending: boolean;
} {
  const status = transcript?.status ?? null;
  const failureReason = transcript?.failureReason ?? null;
  if (status !== "pending") {
    return { status, failureReason, stalePending: false };
  }

  const updatedAtMs = Date.parse(transcript?.updatedAt ?? "");
  const stalePending =
    !Number.isFinite(updatedAtMs) ||
    nowMs - updatedAtMs >= STALE_PENDING_TRANSCRIPT_MS;
  if (!stalePending) {
    return { status, failureReason, stalePending: false };
  }

  return {
    status: "failed",
    failureReason: failureReason || STALE_PENDING_TRANSCRIPT_REASON,
    stalePending: true,
  };
}
