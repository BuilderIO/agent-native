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
  stopSucceeded?: boolean;
  requestFailedAfterStop?: boolean;
  settlingAfterStop?: boolean;
  removalItemId?: string;
  removalInProgress?: boolean;
  cleanupIntentPersisted?: boolean;
  removalItemQueued?: boolean;
  cleanupIntentCleared?: boolean;
}

export interface PendingLookbackCleanupLifecycle {
  persistIntent: (
    context: PendingLookbackContext,
    itemId?: string,
    mode?: "remove" | "retain",
  ) => void;
  persistRemovalItem: (context: PendingLookbackContext, itemId: string) => void;
  clearIntent: (context: PendingLookbackContext) => void;
}

export function pendingSuccessfulLookbackRequests(
  contexts: Map<string, PendingLookbackContext>,
  scope?: { serverUrl: string; account: string | null },
): PendingLookbackContext[] {
  return [...contexts.values()].filter(
    (context) =>
      context.stopSucceeded &&
      context.requestFailedAfterStop &&
      !context.stopFailed &&
      (!scope ||
        sameLookbackRemovalScope(
          { serverUrl: context.target.serverUrl, account: context.account },
          scope,
        )),
  );
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

function tryPersistCleanupStep(step: string, persist: () => void): boolean {
  try {
    persist();
    return true;
  } catch (error) {
    console.error(
      `[lookback] failed to persist ${step}; attempting direct server cleanup:`,
      error,
    );
    return false;
  }
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
    pending.stopSucceeded = true;
    if (pending.requestFailedAfterStop) {
      if (!cleanupLifecycle || pending.cleanupIntentPersisted) return;
      try {
        cleanupLifecycle.persistIntent(pending, undefined, "retain");
        pending.cleanupIntentPersisted = true;
        if (contexts.get(recordingId) === pending) contexts.delete(recordingId);
      } catch (error) {
        console.error(
          "[lookback] failed to persist the successful-stop request for retry; keeping it in memory:",
          error,
        );
      }
      return;
    }
    if (pending.settlingAfterStop) return;
    pending.settlingAfterStop = true;
    if (cleanupLifecycle) {
      try {
        cleanupLifecycle.persistIntent(pending, undefined, "retain");
        pending.cleanupIntentPersisted = true;
      } catch (error) {
        console.error(
          "[lookback] failed to persist the successful-stop request for retry; keeping it in memory:",
          error,
        );
      }
    }
    void pending.item
      .then(
        () => {
          if (pending.cleanupIntentPersisted && cleanupLifecycle) {
            try {
              cleanupLifecycle.clearIntent(pending);
            } catch (error) {
              console.warn(
                "[lookback] the request succeeded but its retry intent could not be cleared:",
                error,
              );
            }
          }
          if (!pending.stopFailed && contexts.get(recordingId) === pending) {
            contexts.delete(recordingId);
          }
        },
        (error) => {
          if (pending.stopFailed) return;
          pending.requestFailedAfterStop = true;
          if (pending.cleanupIntentPersisted) {
            if (contexts.get(recordingId) === pending) {
              contexts.delete(recordingId);
            }
            return;
          }
          console.warn(
            "[lookback] keeping the successful-stop request available for retry:",
            error,
          );
        },
      )
      .finally(() => {
        pending.settlingAfterStop = false;
      });
    return;
  }

  pending.stopSucceeded = false;
  pending.requestFailedAfterStop = false;
  pending.stopFailed = true;
  if (pending.removalInProgress) return;
  pending.removalInProgress = true;
  try {
    if (cleanupLifecycle && !pending.cleanupIntentPersisted) {
      if (
        tryPersistCleanupStep("failed-stop cleanup intent", () =>
          cleanupLifecycle.persistIntent(pending),
        )
      ) {
        pending.cleanupIntentPersisted = true;
      }
    }
    let item: RecordingContextItem | null;
    try {
      item = await pending.item;
    } catch (error) {
      if (pending.cleanupIntentPersisted) {
        console.warn(
          "[lookback] failed-stop context request failed; releasing its durable cleanup intent for recovery:",
          error,
        );
        if (contexts.get(recordingId) === pending) contexts.delete(recordingId);
        return;
      }
      throw error;
    }
    if (item) {
      pending.removalItemId = item.id;
      if (cleanupLifecycle) {
        if (!pending.removalItemQueued) {
          if (
            tryPersistCleanupStep("failed-stop cleanup item", () =>
              cleanupLifecycle.persistIntent(pending, item.id),
            )
          ) {
            pending.cleanupIntentPersisted = true;
          }
          if (
            tryPersistCleanupStep("failed-stop removal queue", () =>
              cleanupLifecycle.persistRemovalItem(pending, item.id),
            )
          ) {
            pending.removalItemQueued = true;
          }
        }
        if (pending.removalItemQueued && !pending.cleanupIntentCleared) {
          if (
            tryPersistCleanupStep("failed-stop cleanup intent removal", () =>
              cleanupLifecycle.clearIntent(pending),
            )
          ) {
            pending.cleanupIntentCleared = true;
          }
        }
      }
      await removeItem(pending.target, item.id, pending.account);
    }
    if (contexts.get(recordingId) === pending) contexts.delete(recordingId);
  } finally {
    pending.removalInProgress = false;
  }
}
