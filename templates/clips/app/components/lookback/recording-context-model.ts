import type { ScreenHistoryStatus } from "@shared/screen-history-context";

// Item shape returned by the `list-recording-context` action.
export interface RecordingContextItem {
  id: string;
  recordingId: string;
  kind?: string;
  label: string | null;
  requestedSeconds?: number;
  originalStartedAt?: string;
  originalEndedAt?: string;
  startedAt: string;
  endedAt: string;
  status: ScreenHistoryStatus;
  mediaRecordingId: string | null;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  error?: string | null;
  // Share viewers receive only this state, never the desktop's device ID.
  capturedDeviceId?: string | null;
  waitingForDevice?: boolean;
  // Calculated by the server so share viewers stop polling stale claims.
  processingClaimFresh?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ListRecordingContextResult {
  items: RecordingContextItem[];
}

export function isContextItemUnfinished(item: RecordingContextItem): boolean {
  return item.status === "pending" || item.status === "processing";
}

export function isWaitingOnOtherDevice(item: RecordingContextItem): boolean {
  return (
    item.status === "pending" &&
    (item.waitingForDevice ?? Boolean(item.capturedDeviceId))
  );
}

// Owner recording pages poll unclaimed requests; every viewer can observe
// requests already being processed. An item held by another device is excluded.
export function hasUnfinishedContextItems(
  items: readonly RecordingContextItem[],
  canPollUnclaimedPending = true,
): boolean {
  return items.some(
    (item) =>
      isContextItemUnfinished(item) &&
      !isWaitingOnOtherDevice(item) &&
      (item.status !== "pending" || canPollUnclaimedPending) &&
      (item.status !== "processing" ||
        canPollUnclaimedPending ||
        item.processingClaimFresh === true),
  );
}

export function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

// The saved window's length in whole seconds, as shown to the viewer.
export function contextWindowSeconds(item: RecordingContextItem): number {
  return Math.max(
    1,
    Math.round((Date.parse(item.endedAt) - Date.parse(item.startedAt)) / 1000),
  );
}
