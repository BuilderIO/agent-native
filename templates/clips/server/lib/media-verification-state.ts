export const MEDIA_VERIFICATION_STATE_PREFIX = "recording-media-verification-";

export type MediaVerificationMarker = {
  recordingId: string;
  status: "pending" | "leased";
  completedAttempts: number;
  nextAttemptAt: string;
  leaseUntil: string | null;
  updatedAt: string;
};

export function mediaVerificationStateKey(recordingId: string): string {
  return `${MEDIA_VERIFICATION_STATE_PREFIX}${recordingId}`;
}

export function parseMediaVerificationMarker(
  value: unknown,
): MediaVerificationMarker | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Record<string, unknown>;
  if (
    typeof state.recordingId !== "string" ||
    !state.recordingId ||
    (state.status !== "pending" && state.status !== "leased") ||
    typeof state.completedAttempts !== "number" ||
    !Number.isInteger(state.completedAttempts) ||
    state.completedAttempts < 0 ||
    typeof state.nextAttemptAt !== "string" ||
    !Number.isFinite(Date.parse(state.nextAttemptAt)) ||
    (state.leaseUntil !== null &&
      (typeof state.leaseUntil !== "string" ||
        !Number.isFinite(Date.parse(state.leaseUntil)))) ||
    typeof state.updatedAt !== "string"
  ) {
    return null;
  }
  return state as MediaVerificationMarker;
}
