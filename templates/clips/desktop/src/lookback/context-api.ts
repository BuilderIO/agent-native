import type { ScreenHistoryStatus } from "../../../shared/screen-history-context";
import {
  callClipsActionFor,
  type ClipsActionTarget,
} from "../lib/clips-action";

// Mirrors the ContextItem returned by the recording-context actions.
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
  // The footage the current 'processing' claim reserved. Only a ready write
  // naming this id can link it, so a worker reconciling its own write checks it.
  pendingMediaRecordingId: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

// A type alias, not an interface: the action body parameter is a
// Record<string, unknown>, which interfaces are not assignable to.
export type RecordingContextUpdate = {
  id: string;
  status: "processing" | "ready" | "failed";
  mediaRecordingId?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  error?: string;
};

export function requestRecordingContext(
  target: ClipsActionTarget,
  input: { recordingId: string; seconds: number; endedAt: string },
): Promise<RecordingContextItem> {
  return callClipsActionFor<RecordingContextItem>(
    target,
    "request-recording-context",
    input,
  );
}

export function removeRecordingContext(
  target: ClipsActionTarget,
  id: string,
): Promise<RecordingContextItem> {
  return callClipsActionFor<RecordingContextItem>(
    target,
    "remove-recording-context",
    { id },
  );
}

export async function listRecordingContext(
  target: ClipsActionTarget,
  recordingId: string,
): Promise<RecordingContextItem[]> {
  const result = await callClipsActionFor<{ items: RecordingContextItem[] }>(
    target,
    "list-recording-context",
    { recordingId },
    { method: "GET" },
  );
  return result.items;
}

// Null only when the server reports the item absent or removed. A failed read
// throws, so an unreadable item is never mistaken for an absent one.
export async function getRecordingContextItem(
  target: ClipsActionTarget,
  recordingId: string,
  id: string,
): Promise<RecordingContextItem | null> {
  const items = await listRecordingContext(target, recordingId);
  return items.find((item) => item.id === id) ?? null;
}

export async function listPendingRecordingContext(
  target: ClipsActionTarget,
  input: { excludeIds?: string[] } = {},
): Promise<RecordingContextItem[]> {
  const result = await callClipsActionFor<{ items: RecordingContextItem[] }>(
    target,
    "list-pending-recording-context",
    { excludeIds: input.excludeIds },
    { method: "GET" },
  );
  return result.items;
}

export function updateRecordingContext(
  target: ClipsActionTarget,
  input: RecordingContextUpdate,
): Promise<RecordingContextItem> {
  return callClipsActionFor<RecordingContextItem>(
    target,
    "update-recording-context",
    input,
  );
}

export function setRecordingContextWindow(
  target: ClipsActionTarget,
  input: { id: string; startedAt: string; endedAt: string },
): Promise<RecordingContextItem> {
  return callClipsActionFor<RecordingContextItem>(
    target,
    "set-recording-context-window",
    input,
  );
}
