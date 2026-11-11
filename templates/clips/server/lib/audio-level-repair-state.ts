import {
  deleteAppState,
  listAppState,
  writeAppState,
} from "@agent-native/core/application-state";

/**
 * A clip whose audio-level job could not be queued after finalize. The marker
 * stays until a leveling run reaches a final result, so a sweep
 * (`level-recording-audio` with `all: true`) picks the clip up again instead of
 * it silently missing leveling.
 */
export const AUDIO_LEVEL_REPAIR_STATE_PREFIX = "recording-audio-level-repair-";

export type AudioLevelRepairMarker = {
  recordingId: string;
  status: "pending";
  reason: string;
  markedAt: string;
};

export function audioLevelRepairStateKey(recordingId: string): string {
  return `${AUDIO_LEVEL_REPAIR_STATE_PREFIX}${recordingId}`;
}

export function parseAudioLevelRepairMarker(
  value: unknown,
): AudioLevelRepairMarker | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Record<string, unknown>;
  if (
    typeof state.recordingId !== "string" ||
    !state.recordingId ||
    state.status !== "pending" ||
    typeof state.reason !== "string" ||
    typeof state.markedAt !== "string" ||
    !Number.isFinite(Date.parse(state.markedAt))
  ) {
    return null;
  }
  return state as AudioLevelRepairMarker;
}

export async function markAudioLevelRepairPending(params: {
  recordingId: string;
  reason: string;
}): Promise<void> {
  await writeAppState(audioLevelRepairStateKey(params.recordingId), {
    recordingId: params.recordingId,
    status: "pending",
    reason: params.reason,
    markedAt: new Date().toISOString(),
  } satisfies AudioLevelRepairMarker);
}

export async function clearAudioLevelRepairPending(
  recordingId: string,
): Promise<void> {
  await deleteAppState(audioLevelRepairStateKey(recordingId));
}

/**
 * Up to `limit` recording ids with a pending repair marker, oldest first.
 * Application state is scoped to the signed-in user, so this lists only the
 * caller's own markers.
 */
export async function listAudioLevelRepairIds(limit: number): Promise<string[]> {
  if (limit <= 0) return [];
  const entries = await listAppState(AUDIO_LEVEL_REPAIR_STATE_PREFIX);
  return entries
    .map((entry) => parseAudioLevelRepairMarker(entry.value))
    .filter((marker): marker is AudioLevelRepairMarker => marker !== null)
    .sort((a, b) => Date.parse(a.markedAt) - Date.parse(b.markedAt))
    .slice(0, limit)
    .map((marker) => marker.recordingId);
}
