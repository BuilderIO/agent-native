import { appStateGet } from "@agent-native/core/application-state";

export const MEDIA_VERIFICATION_STATE_PREFIX = "recording-media-verification-";

export type MediaVerificationMarker = {
  recordingId: string;
  status: "pending" | "leased";
  completedAttempts: number;
  nextAttemptAt: string;
  leaseUntil: string | null;
  updatedAt: string;
  uploadAttemptId?: string | null;
  uploadGenerationId?: string | null;
};

export function mediaVerificationStateKey(recordingId: string): string {
  return `${MEDIA_VERIFICATION_STATE_PREFIX}${recordingId}`;
}

export function mediaVerificationMarkerMatchesUpload(
  marker: MediaVerificationMarker,
  uploadAttemptId: string | null,
  uploadGenerationId: string | null,
): boolean {
  const hasAttemptFence = marker.uploadAttemptId !== undefined;
  const hasGenerationFence = marker.uploadGenerationId !== undefined;
  if (hasAttemptFence !== hasGenerationFence) return false;
  if (!hasAttemptFence) {
    return uploadAttemptId === null && uploadGenerationId === null;
  }
  return (
    marker.uploadAttemptId === uploadAttemptId &&
    marker.uploadGenerationId === uploadGenerationId
  );
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
  if (
    (state.uploadAttemptId !== undefined &&
      state.uploadAttemptId !== null &&
      typeof state.uploadAttemptId !== "string") ||
    (state.uploadGenerationId !== undefined &&
      state.uploadGenerationId !== null &&
      typeof state.uploadGenerationId !== "string")
  ) {
    return null;
  }
  return state as MediaVerificationMarker;
}

export async function isMediaVerificationPending(args: {
  ownerEmail: string;
  recordingId: string;
  recordingStatus: string;
}): Promise<boolean> {
  if (args.recordingStatus !== "processing") return false;

  const value = await appStateGet(
    args.ownerEmail,
    mediaVerificationStateKey(args.recordingId),
  ).catch(() => null);
  const marker = parseMediaVerificationMarker(value);
  return marker?.recordingId === args.recordingId;
}
