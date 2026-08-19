import { useActionMutation } from "@agent-native/core/client/hooks";
import { sourceContentHash } from "@shared/source-workspace";
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
} from "@/pages/design-editor/save-failure";

export interface SaveFileContentArgs {
  acknowledgeOutboxEntry: (entry: DesignSaveOutboxEntry) => Promise<void>;
  canEditDesignRef: RefObject<boolean>;
  createFileSaveOutboxEntry: (
    pending: FileContentSaveRequest,
    expectedVersionHash?: string | undefined,
  ) => DesignSaveOutboxEntry | null;
  fileSaveChainsRef: RefObject<Record<string, Promise<void>>>;
  journalOutboxEntry: (entry: DesignSaveOutboxEntry) => Promise<boolean>;
  lastAckedFileContentHashRef: RefObject<Record<string, string>>;
  latestFileSaveForUnloadRef: RefObject<Record<string, FileContentSaveRequest>>;
  markPendingLocalFileContent: (
    fileId: string,
    content: string,
    baseUpdatedAt?: string | null,
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
    lastAckedFileContentHashRef,
    latestFileSaveForUnloadRef,
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
  markPendingLocalFileContent(pending.id, pending.content);
  // Stamp the CURRENTLY-known acked hash onto the object kept for the
  // pagehide/unload keepalive only — that path has no "resolve at send
  // time" luxury (unload can fire the instant this runs), so best-effort
  // now is all it gets. Does NOT feed the real mutateAsync call below,
  // which still re-resolves the hash fresh at send time; see that call's
  // comment for why an already-set pending.expectedVersionHash must not
  // be allowed to shadow a fresher ref read there.
  latestFileSaveForUnloadRef.current[pending.id] =
    pending.expectedVersionHash !== undefined
      ? pending
      : {
          ...pending,
          ...(lastAckedFileContentHashRef.current[pending.id]
            ? {
                expectedVersionHash:
                  lastAckedFileContentHashRef.current[pending.id],
              }
            : {}),
        };
  const queuedOutboxEntry = createFileSaveOutboxEntry(
    latestFileSaveForUnloadRef.current[pending.id],
  );
  if (queuedOutboxEntry) void journalOutboxEntry(queuedOutboxEntry);
  const previous = fileSaveChainsRef.current[pending.id] ?? Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(async () => {
      try {
        // Resolve the optimistic-concurrency hash at SEND time (after any
        // earlier chained save for this file has landed and refreshed the
        // acked hash), not at queue time — the freshest ref value always
        // wins here regardless of anything queue-time code may have
        // stamped onto `pending` for the unload path above. Attached
        // whenever a hash is known, on BOTH syncCollab true and false
        // saves — see lastAckedFileContentHashRef's doc comment. Never
        // invent a hash when one isn't known yet; omit as before.
        const expectedVersionHash =
          lastAckedFileContentHashRef.current[pending.id] ??
          pending.expectedVersionHash;
        const outboxEntry = createFileSaveOutboxEntry(
          pending,
          expectedVersionHash,
        );
        if (outboxEntry) await journalOutboxEntry(outboxEntry);
        const result = await updateFileMutation.mutateAsync({
          id: pending.id,
          content: pending.content,
          syncCollab: pending.syncCollab,
          operationSource: pending.operationSource,
          operationRevision: pending.operationRevision,
          ...(expectedVersionHash ? { expectedVersionHash } : {}),
        } as any);
        const resultInfo = result as
          | {
              skippedStaleMirror?: boolean;
              skippedStaleOperation?: boolean;
              versionHash?: string;
            }
          | undefined;
        const skippedStaleMirror = Boolean(resultInfo?.skippedStaleMirror);
        // skippedStaleMirror: the server intentionally left the SQL
        // mirror column untouched because our expectedVersionHash no
        // longer matched the live collab text (a live editor moved past
        // the base this write was computed from). The mirror was NOT
        // updated to pending.content, so recording pending.content's hash
        // as "acked" here would be wrong — it would make a later guarded
        // save believe the server holds content it doesn't. Leave the
        // previously-acked hash in place instead; the DB-reconcile effect
        // (activeFile watcher) will pick up the true live content and
        // refresh the acked hash from that.
        if (!skippedStaleMirror) {
          lastAckedFileContentHashRef.current[pending.id] =
            resultInfo?.versionHash ?? sourceContentHash(pending.content);
        }
        const persistedContentMatches = updateFileResultPersistedContent(
          resultInfo,
          pending.content,
        );
        if (persistedContentMatches && outboxEntry) {
          await acknowledgeOutboxEntry(outboxEntry);
        } else if (!persistedContentMatches) {
          // A stale/no-op save result is a source conflict, not a lost
          // connection. Refetch below rebases the editor; never promise
          // that simply reconnecting will save this obsolete snapshot.
          queryClient.invalidateQueries({
            queryKey: ["action", "get-design"],
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
        setPatchProof((prev) =>
          prev && prev.fileId === pending.id && prev.status === "queued"
            ? { ...prev, status: "applied" }
            : prev,
        );
      } catch (error) {
        // Drop the (evidently wrong) acked hash so the failure is
        // one-shot: the DB-reconcile effect pulls the fresh server
        // content, and the next save proceeds unguarded from that
        // rebased state instead of failing forever on a dead hash.
        delete lastAckedFileContentHashRef.current[pending.id];
        queryClient.invalidateQueries({
          queryKey: ["action", "get-design"],
        });
        const failureKind = classifyDesignSaveFailure(error, navigator.onLine);
        if (failureKind === "offline") {
          warnChangesWillRetry();
        } else if (
          failureKind !== "intentional-abort" &&
          failureKind !== "conflict"
        ) {
          // Conflicts already rebased above (acked-hash reset + get-design
          // invalidation); a red toast for a routine rebase is just noise.
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
