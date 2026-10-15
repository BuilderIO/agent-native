import type { ClipsActionTarget } from "../lib/clips-action";
import type { RecordingContextItem } from "./context-api";

export interface PendingLookbackContext {
  recordingId: string;
  target: ClipsActionTarget;
  item: Promise<RecordingContextItem | null>;
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

export async function settlePendingLookbackContextAfterStop(
  contexts: Map<string, PendingLookbackContext>,
  recordingId: string | null | undefined,
  stopSucceeded: boolean,
  removeItem: (target: ClipsActionTarget, itemId: string) => Promise<unknown>,
): Promise<void> {
  const pending = takePendingLookbackContext(contexts, recordingId);
  if (!pending || stopSucceeded) return;

  const item = await pending.item;
  if (item) await removeItem(pending.target, item.id);
}
