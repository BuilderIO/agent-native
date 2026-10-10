import type { ScreenHistoryStatus } from "@shared/screen-history-context";

// Item shape returned by the `list-recording-context` action.
export interface RecordingContextItem {
  id: string;
  recordingId: string;
  kind: string;
  label: string | null;
  requestedSeconds: number;
  originalStartedAt: string;
  originalEndedAt: string;
  startedAt: string;
  endedAt: string;
  status: ScreenHistoryStatus;
  mediaRecordingId: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListRecordingContextResult {
  items: RecordingContextItem[];
}

export function isContextItemUnfinished(item: RecordingContextItem): boolean {
  return item.status === "pending" || item.status === "processing";
}

// The desktop worker finishes these, so the panel polls until none remain.
export function hasUnfinishedContextItems(
  items: readonly RecordingContextItem[],
): boolean {
  return items.some(isContextItemUnfinished);
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
