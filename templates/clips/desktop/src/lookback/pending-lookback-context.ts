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
