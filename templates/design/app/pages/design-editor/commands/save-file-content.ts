import { useActionMutation } from "@agent-native/core/client/hooks";
import { sourceContentHash } from "@shared/source-workspace";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { DesignSaveOutboxEntry } from "@/lib/design-save-outbox";
import { updateFileResultPersistedContent } from "@/lib/design-save-outbox";
import type { PatchProofState } from "@/pages/design-editor/command-types";
import type { FileContentSaveRequest } from "@/pages/design-editor/editor-state";
import {
  advanceLatestUnloadSaveBase,
  prepareFileContentSaveKeepalive,
  shouldClearLatestUnloadSave,
} from "@/pages/design-editor/editor-state";
import {
  classifyDesignSaveFailure,
  designSaveErrorMessage,
  isDesignSaveSuccessConflict,
  patchProofStatusAfterPersistedSave,
} from "@/pages/design-editor/save-failure";

// Sonner's `id` only dedupes a toast while the earlier one is still mounted —
// once it auto-dismisses, the same id shows again on the next call. Track
// warned designs ourselves so a design that stays over the checkpoint size
// threshold gets exactly one "version history unavailable" toast per design,
// not one on every autosave.
const warnedVersionHistoryDesigns = new Set<string>();

/** Test-only: this module-level set otherwise leaks a warned designId across specs. */
export function __clearVersionHistoryWarningsForTests(): void {
  warnedVersionHistoryDesigns.clear();
}

export interface SaveFileContentArgs {
  acknowledgeOutboxEntry: (entry: DesignSaveOutboxEntry) => Promise<void>;
  canEditDesignRef: RefObject<boolean>;
  createFileSaveOutboxEntry: (
    pending: FileContentSaveRequest,
  ) => DesignSaveOutboxEntry | null;
  designId?: string;
  fileSaveChainsRef: RefObject<Record<string, Promise<void>>>;
  journalOutboxEntry: (entry: DesignSaveOutboxEntry) => Promise<boolean>;
  latestFileSaveForUnloadRef: RefObject<Record<string, FileContentSaveRequest>>;
  rollbackPendingLocalFileContent: (
    fileId: string,
    expectedContent: string,
  ) => void;
  markPendingLocalFileContent: (
    fileId: string,
    content: string,
    baseUpdatedAt?: string | null,
    identityMigrationSourceContent?: string,
  ) => void;
  queryClient: QueryClient;
  setPatchProof: Dispatch<SetStateAction<PatchProofState | null>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  updateFileMutation: ReturnType<
    typeof useActionMutation<undefined, undefined, "update-file">
  >;
  warnChangesWillRetry: () => void;
}

type FileContentSaveKeepaliveAttempt =
  | { accepted: true; completion: Promise<unknown> }
  | { accepted: false; completion: null };

export type FileContentSaveCompletion =
  | "persisted"
  | "conflict"
  | "retryable"
  | "failed";

export interface SaveFileContentKeepaliveArgs {
  acknowledgeOutboxEntry: (entry: DesignSaveOutboxEntry) => Promise<void>;
  createFileSaveOutboxEntry: (
    pending: FileContentSaveRequest,
  ) => DesignSaveOutboxEntry | null;
  journalOutboxEntry: (entry: DesignSaveOutboxEntry) => Promise<boolean>;
  latestFileSaveForUnloadRef: RefObject<Record<string, FileContentSaveRequest>>;
  sendKeepalive: (
    payload: Record<string, unknown>,
  ) => FileContentSaveKeepaliveAttempt;
}

export function runFileContentSaveKeepalive(
  {
    acknowledgeOutboxEntry,
    createFileSaveOutboxEntry,
    journalOutboxEntry,
    latestFileSaveForUnloadRef,
    sendKeepalive,
  }: SaveFileContentKeepaliveArgs,
  pending: FileContentSaveRequest,
) {
  // Keep the folded oldest-base entry durable while the direct request uses
  // this edit's own base. If the predecessor never lands, replay must start
  // from the oldest known version rather than the successor's base.
  const durableEntry = createFileSaveOutboxEntry(pending);
  const keepaliveEntry = createFileSaveOutboxEntry(
    prepareFileContentSaveKeepalive(pending),
  );
  if (!durableEntry || !keepaliveEntry) return;
  const journalPromise = journalOutboxEntry(durableEntry);
  const attempt = sendKeepalive(keepaliveEntry.payload);
  if (!attempt.accepted) {
    void journalPromise.catch(() => {});
    return;
  }
  void attempt.completion
    .then(async (result: unknown) => {
      await journalPromise;
      const persistedContentMatches = updateFileResultPersistedContent(
        result,
        pending.content,
      );
      if (!persistedContentMatches) return;
      const resultInfo = result as { versionHash?: string } | undefined;
      const latest = latestFileSaveForUnloadRef.current[pending.id];
      if (shouldClearLatestUnloadSave(latest, pending)) {
        await acknowledgeOutboxEntry(durableEntry);
        delete latestFileSaveForUnloadRef.current[pending.id];
        return;
      }
      if (
        advanceLatestUnloadSaveBase(
          latest,
          pending,
          resultInfo?.versionHash ?? sourceContentHash(pending.content),
        )
      ) {
        const advancedOutboxEntry = latest
          ? createFileSaveOutboxEntry(latest)
          : null;
        if (advancedOutboxEntry) {
          await journalOutboxEntry(advancedOutboxEntry);
        }
      }
      await acknowledgeOutboxEntry(durableEntry);
    })
    .catch(() => {});
}

export function runSaveFileContent(
  {
    acknowledgeOutboxEntry,
    canEditDesignRef,
    createFileSaveOutboxEntry,
    designId,
    fileSaveChainsRef,
    journalOutboxEntry,
    latestFileSaveForUnloadRef,
    rollbackPendingLocalFileContent,
    markPendingLocalFileContent,
    queryClient,
    setPatchProof,
    t,
    updateFileMutation,
    warnChangesWillRetry,
  }: SaveFileContentArgs,
  pending: FileContentSaveRequest,
  outboxJournalPromise?: Promise<boolean>,
): Promise<FileContentSaveCompletion> {
  if (!canEditDesignRef.current) return Promise.resolve("failed");
  markPendingLocalFileContent(
    pending.id,
    pending.content,
    undefined,
    pending.identityMigrationSourceContent,
  );
  latestFileSaveForUnloadRef.current[pending.id] = pending;
  const queuedOutboxEntry = createFileSaveOutboxEntry(pending);
  const durableOutboxJournal =
    outboxJournalPromise ??
    (queuedOutboxEntry
      ? journalOutboxEntry(queuedOutboxEntry)
      : Promise.resolve(false));
  const previous = fileSaveChainsRef.current[pending.id] ?? Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(async () => {
      // An identity migration is disposable. Never send a queued old snapshot
      // after a newer source publication or user edit has replaced it.
      if (
        pending.identityMigrationSourceContent !== undefined &&
        latestFileSaveForUnloadRef.current[pending.id] !== pending
      ) {
        if (queuedOutboxEntry)
          void acknowledgeOutboxEntry(queuedOutboxEntry).catch(() => {});
        return "failed";
      }
      try {
        await durableOutboxJournal;
        const expectedVersionHash = pending.expectedVersionHash;
        const outboxEntry = createFileSaveOutboxEntry(pending);
        const result = await updateFileMutation.mutateAsync({
          id: pending.id,
          content: pending.content,
          syncCollab: pending.syncCollab,
          operationSource: pending.operationSource,
          operationRevision: pending.operationRevision,
          expectedVersionHash,
          ...(pending.identityMigrationSourceContent !== undefined
            ? { identityOnly: true }
            : {}),
        } as any);
        if (
          pending.identityMigrationSourceContent !== undefined &&
          latestFileSaveForUnloadRef.current[pending.id] !== pending
        ) {
          if (outboxEntry)
            void acknowledgeOutboxEntry(outboxEntry).catch(() => {});
          return "failed";
        }
        const resultInfo = result as
          | {
              skippedStaleMirror?: boolean;
              skippedStaleOperation?: boolean;
              versionHash?: string;
              checkpoint?: { skipped: true; reason: string };
              updatedAt?: unknown;
            }
          | undefined;
        const persistedContentMatches = updateFileResultPersistedContent(
          resultInfo,
          pending.content,
          t("common.genericError"),
        );
        const latest = latestFileSaveForUnloadRef.current[pending.id];
        if (
          persistedContentMatches &&
          advanceLatestUnloadSaveBase(
            latest,
            pending,
            resultInfo?.versionHash ?? sourceContentHash(pending.content),
          )
        ) {
          const advancedOutboxEntry = latest
            ? createFileSaveOutboxEntry(latest)
            : null;
          if (advancedOutboxEntry)
            await journalOutboxEntry(advancedOutboxEntry);
        }
        if (
          persistedContentMatches &&
          pending.identityMigrationSourceContent !== undefined &&
          latestFileSaveForUnloadRef.current[pending.id] === pending
        ) {
          // Identity repair has landed. Retire its raw-base marker so the next
          // user edit publishes against the canonical bytes it already sees.
          markPendingLocalFileContent(pending.id, pending.content);
        }
        if (persistedContentMatches && outboxEntry)
          void acknowledgeOutboxEntry(outboxEntry).catch(() => {});
        if (persistedContentMatches && designId) {
          const designQueryKey = ["action", "get-design", { id: designId }];
          const persistedUpdatedAt =
            typeof resultInfo?.updatedAt === "string"
              ? resultInfo.updatedAt
              : undefined;
          queryClient.setQueryData(designQueryKey, (old: any) => {
            if (!old || typeof old !== "object" || !Array.isArray(old.files)) {
              return old;
            }
            return {
              ...old,
              files: old.files.map((file: { id?: unknown }) =>
                file.id === pending.id
                  ? {
                      ...file,
                      content: pending.content,
                      ...(persistedUpdatedAt !== undefined
                        ? { updatedAt: persistedUpdatedAt }
                        : {}),
                    }
                  : file,
              ),
            };
          });
          if (
            resultInfo?.checkpoint?.skipped &&
            !warnedVersionHistoryDesigns.has(designId)
          ) {
            warnedVersionHistoryDesigns.add(designId);
            toast.warning(t("designEditor.toasts.versionHistoryUnavailable"), {
              id: `design-version-history-unavailable:${designId}`,
            });
          }
          // The pending overlay retires only once the row's updatedAt moves
          // (shouldRetirePendingLocalFileContent), and a read already in
          // flight may carry pre-write bytes; invalidating cancels it. Only a
          // server-confirmed updatedAt with no read in flight can skip
          // refetching every file's content.
          if (
            persistedUpdatedAt === undefined ||
            queryClient.isFetching({ queryKey: designQueryKey }) > 0
          ) {
            void queryClient.invalidateQueries({
              queryKey: ["action", "get-design"],
            });
          }
        } else if (!persistedContentMatches) {
          // A stale/no-op save result is a source conflict, not a lost
          // connection. Drop the rejected overlay before refetch — leaving
          // it active keeps painting the skipped snapshot and can write it
          // back into Yjs when newer remote content arrives. expectedContent
          // keeps a newer in-flight overlay (the user kept typing).
          rollbackPendingLocalFileContent(pending.id, pending.content);
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-design"],
          });
        }
        if (isDesignSaveSuccessConflict(persistedContentMatches)) {
          toast.error(t("designEditor.toasts.saveConflict"), {
            id: `design-save-conflict:${pending.id}`,
            duration: 4000,
          });
        }
        if (
          shouldClearLatestUnloadSave(
            latestFileSaveForUnloadRef.current[pending.id],
            pending,
          )
        ) {
          delete latestFileSaveForUnloadRef.current[pending.id];
        }
        setPatchProof((prev) => {
          if (
            !(prev && prev.fileId === pending.id && prev.status === "queued")
          ) {
            return prev;
          }
          const status = patchProofStatusAfterPersistedSave(
            persistedContentMatches,
          );
          return status === "failed"
            ? {
                ...prev,
                status,
                error: t("designEditor.toasts.saveConflict"),
              }
            : { ...prev, status };
        });
        return persistedContentMatches ? "persisted" : "conflict";
      } catch (error) {
        if (
          pending.identityMigrationSourceContent !== undefined &&
          latestFileSaveForUnloadRef.current[pending.id] !== pending
        ) {
          if (queuedOutboxEntry)
            void acknowledgeOutboxEntry(queuedOutboxEntry).catch(() => {});
          return "failed";
        }
        // The queued source hash stays paired with its content until the
        // editor adopts a fresh source and creates a new save request.
        const failureKind = classifyDesignSaveFailure(error, navigator.onLine);
        if (failureKind === "conflict") {
          // Roll back our optimistic bytes before the refetch can race ahead.
          rollbackPendingLocalFileContent(pending.id, pending.content);
          if (latestFileSaveForUnloadRef.current[pending.id] === pending) {
            delete latestFileSaveForUnloadRef.current[pending.id];
          }
        }
        void queryClient.invalidateQueries({
          queryKey: ["action", "get-design"],
        });
        if (failureKind === "offline") {
          warnChangesWillRetry();
        } else if (failureKind === "conflict") {
          // A fresh source read is needed before the next edit can be saved.
          toast.error(t("designEditor.toasts.saveConflict"), {
            id: `design-save-conflict:${pending.id}`,
          });
        } else if (failureKind !== "intentional-abort") {
          toast.error(
            designSaveErrorMessage(error) ?? t("common.genericError"),
            { id: `design-save-error:${pending.id}` },
          );
        }
        setPatchProof((prev) =>
          prev && prev.fileId === pending.id && prev.status === "queued"
            ? {
                ...prev,
                status: "failed",
                error:
                  error instanceof Error
                    ? error.message
                    : t("common.genericError"),
              }
            : prev,
        );
        return failureKind === "offline"
          ? "retryable"
          : failureKind === "conflict"
            ? "conflict"
            : "failed";
      }
    });
  const chain = current.then(() => {});
  fileSaveChainsRef.current[pending.id] = chain;
  void current.finally(() => {
    if (fileSaveChainsRef.current[pending.id] === chain) {
      delete fileSaveChainsRef.current[pending.id];
    }
  });
  return current;
}
