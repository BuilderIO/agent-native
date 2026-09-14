import { useActionMutation } from "@agent-native/core/client/hooks";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { DesignSaveOutboxEntry } from "@/lib/design-save-outbox";
import { updateFileResultPersistedContent } from "@/lib/design-save-outbox";
import type { PatchProofState } from "@/pages/design-editor/command-types";
import type { FileContentSaveRequest } from "@/pages/design-editor/editor-state";
import { shouldClearLatestUnloadSave } from "@/pages/design-editor/editor-state";
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

export function runSaveFileContent(
  {
    acknowledgeOutboxEntry,
    canEditDesignRef,
    createFileSaveOutboxEntry,
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
        if (persistedContentMatches && outboxEntry) {
          await acknowledgeOutboxEntry(outboxEntry);
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
            !persistedContentMatches,
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
