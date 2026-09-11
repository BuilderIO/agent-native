import {
  appStateGet,
  deleteAppState,
  writeAppState,
} from "@agent-native/core/application-state";

export const SEEKABLE_REPAIR_STATE_PREFIX = "recording-seekable-repair-";
export const SEEKABLE_REPAIR_PENDING_TTL_MS = 10 * 60 * 1000;

export type SeekableRepairMarker = {
  recordingId: string;
  status: "pending";
  videoUrl: string;
  startedAt: string;
  expiresAt: string;
};

export function seekableRepairStateKey(recordingId: string): string {
  return `${SEEKABLE_REPAIR_STATE_PREFIX}${recordingId}`;
}

export function parseSeekableRepairMarker(
  value: unknown,
): SeekableRepairMarker | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Record<string, unknown>;
  if (
    typeof state.recordingId !== "string" ||
    !state.recordingId ||
    state.status !== "pending" ||
    typeof state.videoUrl !== "string" ||
    !state.videoUrl ||
    typeof state.startedAt !== "string" ||
    !Number.isFinite(Date.parse(state.startedAt)) ||
    typeof state.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(state.expiresAt))
  ) {
    return null;
  }
  return state as SeekableRepairMarker;
}

export async function markSeekableRepairPending(params: {
  recordingId: string;
  videoUrl: string;
}): Promise<void> {
  const startedAt = Date.now();
  await writeAppState(seekableRepairStateKey(params.recordingId), {
    recordingId: params.recordingId,
    status: "pending",
    videoUrl: params.videoUrl,
    startedAt: new Date(startedAt).toISOString(),
    expiresAt: new Date(
      startedAt + SEEKABLE_REPAIR_PENDING_TTL_MS,
    ).toISOString(),
  });
}

export async function clearSeekableRepairPending(
  recordingId: string,
): Promise<void> {
  await deleteAppState(seekableRepairStateKey(recordingId));
}

export async function isSeekableRepairPending(args: {
  ownerEmail: string;
  recordingId: string;
  recordingStatus: string;
  videoUrl?: string | null;
}): Promise<boolean> {
  if (args.recordingStatus !== "ready") return false;

  const value = await appStateGet(
    args.ownerEmail,
    seekableRepairStateKey(args.recordingId),
  );
  if (value === null) return false;
  const marker = parseSeekableRepairMarker(value);
  if (!marker) {
    throw new Error(
      `Malformed seekable repair marker for recording ${args.recordingId}`,
    );
  }
  if (marker.recordingId !== args.recordingId) return false;
  if (args.videoUrl !== undefined && marker.videoUrl !== args.videoUrl) {
    return false;
  }

  return Date.parse(marker.expiresAt) > Date.now();
}
