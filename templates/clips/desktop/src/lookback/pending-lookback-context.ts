import type { ClipsActionTarget } from "../lib/clips-action";
import type {
  RecordingContextItem,
  RecordingContextRequestInput,
} from "./context-api";
import { sameLookbackRemovalScope } from "./pending-lookback-removal";

export interface PendingLookbackContext {
  recordingId: string;
  request: RecordingContextRequestInput;
  target: ClipsActionTarget;
  account: string;
  item: Promise<RecordingContextItem | null>;
  stopFailed?: boolean;
  removalItemId?: string;
  removalInProgress?: boolean;
  cleanupIntentPersisted?: boolean;
  removalItemQueued?: boolean;
  cleanupIntentCleared?: boolean;
}

export interface PendingLookbackCleanupLifecycle {
  persistIntent: (context: PendingLookbackContext, itemId?: string) => void;
  persistRemovalItem: (context: PendingLookbackContext, itemId: string) => void;
  clearIntent: (context: PendingLookbackContext) => void;
}

export function pendingFailedLookbackContexts(
  contexts: Map<string, PendingLookbackContext>,
  scope?: { serverUrl: string; account: string | null },
): PendingLookbackContext[] {
  return [...contexts.values()].filter(
    (context) =>
      context.stopFailed &&
      (!scope ||
        sameLookbackRemovalScope(
          { serverUrl: context.target.serverUrl, account: context.account },
          scope,
        )),
  );
}

export function hasPendingFailedLookbackRemoval(
  contexts: Map<string, PendingLookbackContext>,
  scope?: { serverUrl: string; account: string | null },
): boolean {
  return pendingFailedLookbackContexts(contexts, scope).length > 0;
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
  removeItem: (
    target: ClipsActionTarget,
    itemId: string,
    account: string,
  ) => Promise<unknown>,
  cleanupLifecycle?: PendingLookbackCleanupLifecycle,
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
    if (cleanupLifecycle && !pending.cleanupIntentPersisted) {
      cleanupLifecycle.persistIntent(pending);
      pending.cleanupIntentPersisted = true;
    }
    const item = await pending.item;
    if (item) {
      pending.removalItemId = item.id;
      if (cleanupLifecycle) {
        if (!pending.removalItemQueued) {
          cleanupLifecycle.persistIntent(pending, item.id);
          cleanupLifecycle.persistRemovalItem(pending, item.id);
          pending.removalItemQueued = true;
        }
        if (!pending.cleanupIntentCleared) {
          cleanupLifecycle.clearIntent(pending);
          pending.cleanupIntentCleared = true;
        }
      }
      await removeItem(pending.target, item.id, pending.account);
    }
    if (contexts.get(recordingId) === pending) contexts.delete(recordingId);
  } finally {
    pending.removalInProgress = false;
  }
}
