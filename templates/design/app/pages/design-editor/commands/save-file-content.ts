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
) {
  if (!canEditDesignRef.current) return;
  markPendingLocalFileContent(
    pending.id,
    pending.content,
    undefined,
    pending.identityMigrationSourceContent,
  );
  latestFileSaveForUnloadRef.current[pending.id] = pending;
  const queuedOutboxEntry = createFileSaveOutboxEntry(
    latestFileSaveForUnloadRef.current[pending.id],
  );
  if (queuedOutboxEntry) void journalOutboxEntry(queuedOutboxEntry);
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
        if (queuedOutboxEntry) await acknowledgeOutboxEntry(queuedOutboxEntry);
        return;
      }
      try {
        const expectedVersionHash = pending.expectedVersionHash;
        const outboxEntry = createFileSaveOutboxEntry(pending);
        if (outboxEntry) await journalOutboxEntry(outboxEntry);
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
          if (outboxEntry) await acknowledgeOutboxEntry(outboxEntry);
          return;
        }
        const resultInfo = result as
          | {
              skippedStaleMirror?: boolean;
              skippedStaleOperation?: boolean;
              versionHash?: string;
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
        if (persistedContentMatches && outboxEntry) {
          await acknowledgeOutboxEntry(outboxEntry);
        }
        if (persistedContentMatches && designId) {
          queryClient.setQueryData(
            ["action", "get-design", { id: designId }],
            (old: any) => {
              if (
                !old ||
                typeof old !== "object" ||
                !Array.isArray(old.files)
              ) {
                return old;
              }
              return {
                ...old,
                files: old.files.map((file: { id?: unknown }) =>
                  file.id === pending.id
                    ? { ...file, content: pending.content }
                    : file,
                ),
              };
            },
          );
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
      } catch (error) {
        if (
          pending.identityMigrationSourceContent !== undefined &&
          latestFileSaveForUnloadRef.current[pending.id] !== pending
        ) {
          if (queuedOutboxEntry)
            await acknowledgeOutboxEntry(queuedOutboxEntry);
          return;
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
      }
    });
  fileSaveChainsRef.current[pending.id] = current;
  void current.finally(() => {
    if (fileSaveChainsRef.current[pending.id] === current) {
      delete fileSaveChainsRef.current[pending.id];
    }
  });
}
