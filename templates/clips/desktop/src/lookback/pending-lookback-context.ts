import type { ClipsActionTarget } from "../lib/clips-action";
import type { RecordingContextItem } from "./context-api";

export interface PendingLookbackContext {
  recordingId: string;
  target: ClipsActionTarget;
  item: Promise<RecordingContextItem | null>;
  stopFailed?: boolean;
  removalInProgress?: boolean;
}

export function takePendingLookbackContext(
  contexts: Map<string, PendingLookbackContext>,
  recordingId: string | null | undefined,
): PendingLookbackContext | null {
  if (!recordingId) return null;
  const pending = contexts.get(recordingId);
  if (!pending) return null;
  contexts.delete(recordingId);
  return pending;
}

export function takePendingLookbackContextAfterStop(
  contexts: Map<string, PendingLookbackContext>,
  recordingId: string,
  stoppedRecordingId: string,
): PendingLookbackContext | null {
  if (recordingId !== stoppedRecordingId) return null;
  return takePendingLookbackContext(contexts, recordingId);
}

export function isLookbackContextAwaitingStop(
  contexts: Map<string, PendingLookbackContext>,
  recordingId: string,
): boolean {
  return contexts.has(recordingId);
}

export async function settlePendingLookbackContextAfterStop(
  contexts: Map<string, PendingLookbackContext>,
  recordingId: string | null | undefined,
  stopSucceeded: boolean,
  removeItem: (target: ClipsActionTarget, itemId: string) => Promise<unknown>,
): Promise<void> {
  if (!recordingId) return;
  const pending = contexts.get(recordingId);
  if (!pending) return;
  if (stopSucceeded) {
    contexts.delete(recordingId);
    return;
  }

  pending.stopFailed = true;
  if (pending.removalInProgress) return;
  pending.removalInProgress = true;
  try {
    const item = await pending.item;
    if (item) await removeItem(pending.target, item.id);
    if (contexts.get(recordingId) === pending) contexts.delete(recordingId);
  } finally {
    pending.removalInProgress = false;
  }
}
