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
  coalescePendingFileContentSave,
  prepareFileContentSaveKeepalive,
  shouldClearLatestUnloadSave,
} from "@/pages/design-editor/editor-state";
import {
  classifyDesignSaveFailure,
  designSaveErrorMessage,
  isDesignSaveSuccessConflict,
  patchProofStatusAfterPersistedSave,
} from "@/pages/design-editor/save-failure";
import { threeWayMergeContent } from "@/pages/design-editor/three-way-merge";

const warnedVersionHistoryDesigns = new Set<string>();

export function __clearVersionHistoryWarningsForTests(): void {
  warnedVersionHistoryDesigns.clear();
}

const MAX_CONFLICT_MERGES = 3;
const KNOWN_SAVE_CONTENT_LIMIT = 24;
// A 409 means the server moved past the content this save was computed from.
// Merging needs that content back, and the request only carries its hash, so
// remember the contents this tab has sent or merged against, keyed by hash.
const knownSaveContents = new Map<string, string>();

function knownSaveContentKey(fileId: string, content: string): string {
  return `${fileId}\0${sourceContentHash(content)}`;
}

function rememberSaveContent(fileId: string, content: string): void {
  const key = knownSaveContentKey(fileId, content);
  knownSaveContents.delete(key);
  knownSaveContents.set(key, content);
  if (knownSaveContents.size > KNOWN_SAVE_CONTENT_LIMIT) {
    knownSaveContents.delete(knownSaveContents.keys().next().value!);
  }
}

export function __clearKnownSaveContentsForTests(): void {
  knownSaveContents.clear();
}

export interface SaveFileContentArgs {
  acknowledgeOutboxEntry: (entry: DesignSaveOutboxEntry) => Promise<void>;
  canEditDesignRef: RefObject<boolean>;
  createFileSaveOutboxEntry: (
    pending: FileContentSaveRequest,
  ) => DesignSaveOutboxEntry | null;
  designId?: string;
  fileSaveChainsRef: RefObject<Record<string, Promise<void>>>;
  fileSaveOutboxJournalPromisesRef?: RefObject<
    WeakMap<FileContentSaveRequest, Promise<boolean>>
  >;
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
  /** The server content the file's first unsaved local edit was made from. */
  getPendingBaseContent?: (fileId: string) => string | undefined;
  /** Reads the file's current live content, the version a CAS write must match. */
  readLiveFileContent?: (fileId: string) => Promise<string>;
  queryClient: QueryClient;
  setPatchProof: Dispatch<SetStateAction<PatchProofState | null>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  updateFileMutation: ReturnType<
    typeof useActionMutation<undefined, undefined, "update-file">
  >;
  warnChangesWillRetry: () => void;
}

export interface QueueFileContentSaveArgs {
  canEditDesignRef: RefObject<boolean>;
  createFileSaveOutboxEntry: (
    pending: FileContentSaveRequest,
  ) => DesignSaveOutboxEntry | null;
  fileSaveOperationRevisionRef: RefObject<Record<string, number>>;
  fileSaveOutboxJournalPromisesRef: RefObject<
    WeakMap<FileContentSaveRequest, Promise<boolean>>
  >;
  fileSaveTimersRef: RefObject<Record<string, number>>;
  journalOutboxEntry: (entry: DesignSaveOutboxEntry) => Promise<boolean>;
  latestFileSaveForUnloadRef: RefObject<Record<string, FileContentSaveRequest>>;
  markPendingLocalFileContent: (
    fileId: string,
    content: string,
    baseUpdatedAt?: string | null,
    identityMigrationSourceContent?: string,
  ) => void;
  operationSource: string;
  pendingFileSavesRef: RefObject<Record<string, FileContentSaveRequest>>;
  saveFileContent: (
    pending: FileContentSaveRequest,
    outboxJournalPromise?: Promise<boolean>,
  ) => Promise<FileContentSaveCompletion | false>;
  setTimer: (callback: () => void, delayMs: number) => number;
  clearTimer: (timerId: number) => void;
}

export interface QueueFileContentSaveOptions {
  expectedVersionHash: string;
  syncCollab?: boolean;
  immediate?: boolean;
  identityMigrationSourceContent?: string;
}

type FileContentSaveKeepaliveAttempt =
  | { accepted: true; completion: Promise<unknown> }
  | { accepted: false; completion: null };

export type FileContentSaveCompletion =
  | "persisted"
  | "conflict"
  | "retryable"
  | "failed";

export function runQueueFileContentSave(
  args: QueueFileContentSaveArgs,
  fileId: string,
  content: string,
  options: QueueFileContentSaveOptions,
): Promise<FileContentSaveCompletion | false> | void {
  const {
    canEditDesignRef,
    createFileSaveOutboxEntry,
    fileSaveOperationRevisionRef,
    fileSaveOutboxJournalPromisesRef,
    fileSaveTimersRef,
    journalOutboxEntry,
    latestFileSaveForUnloadRef,
    markPendingLocalFileContent,
    operationSource,
    pendingFileSavesRef,
    saveFileContent,
    setTimer,
    clearTimer,
  } = args;
  if (!canEditDesignRef.current) return Promise.resolve(false);

  const queuedIdentityMigration = pendingFileSavesRef.current[fileId];
  const latestIdentityMigration = latestFileSaveForUnloadRef.current[fileId];
  const identityMigrationIsInFlight =
    options.identityMigrationSourceContent === undefined &&
    queuedIdentityMigration === undefined &&
    latestIdentityMigration?.identityMigrationSourceContent !== undefined;
  const expectedVersionHash = identityMigrationIsInFlight
    ? sourceContentHash(latestIdentityMigration.content)
    : options.expectedVersionHash;
  const operationRevision =
    (fileSaveOperationRevisionRef.current[fileId] ?? 0) + 1;
  fileSaveOperationRevisionRef.current[fileId] = operationRevision;
  const nextPending = coalescePendingFileContentSave(
    {
      id: fileId,
      content,
      syncCollab: options.syncCollab ?? true,
      operationSource,
      operationRevision,
      expectedVersionHash,
      identityMigrationSourceContent: options.identityMigrationSourceContent,
    },
    pendingFileSavesRef.current[fileId],
  );
  const pending = {
    ...nextPending,
    unloadExpectedVersionHash:
      pendingFileSavesRef.current[fileId]?.unloadExpectedVersionHash ??
      latestFileSaveForUnloadRef.current[fileId]?.unloadExpectedVersionHash ??
      nextPending.expectedVersionHash,
  };
  markPendingLocalFileContent(
    fileId,
    content,
    undefined,
    options.identityMigrationSourceContent,
  );
  latestFileSaveForUnloadRef.current[fileId] = pending;

  const outboxEntry = createFileSaveOutboxEntry(pending);
  const outboxJournalPromise = outboxEntry
    ? journalOutboxEntry(outboxEntry)
    : Promise.resolve(false);
  fileSaveOutboxJournalPromisesRef.current.set(pending, outboxJournalPromise);

  if (options.immediate) {
    const timer = fileSaveTimersRef.current[fileId];
    if (timer) {
      clearTimer(timer);
      delete fileSaveTimersRef.current[fileId];
    }
    delete pendingFileSavesRef.current[fileId];
    return saveFileContent(pending, outboxJournalPromise);
  }

  pendingFileSavesRef.current[fileId] = pending;
  const timer = fileSaveTimersRef.current[fileId];
  if (timer) clearTimer(timer);
  fileSaveTimersRef.current[fileId] = setTimer(() => {
    const queued = pendingFileSavesRef.current[fileId];
    delete pendingFileSavesRef.current[fileId];
    delete fileSaveTimersRef.current[fileId];
    if (!queued) return;
    saveFileContent(
      queued,
      fileSaveOutboxJournalPromisesRef.current.get(queued),
    );
  }, 400);
}

export interface SaveFileContentKeepaliveArgs {
  acknowledgeOutboxEntry: (entry: DesignSaveOutboxEntry) => Promise<void>;
  createFileSaveOutboxEntry: (
    pending: FileContentSaveRequest,
  ) => DesignSaveOutboxEntry | null;
  journalOutboxEntry: (entry: DesignSaveOutboxEntry) => Promise<boolean>;
  latestFileSaveForUnloadRef: RefObject<Record<string, FileContentSaveRequest>>;
  outboxJournalPromise?: Promise<boolean>;
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
    outboxJournalPromise,
    sendKeepalive,
  }: SaveFileContentKeepaliveArgs,
  pending: FileContentSaveRequest,
) {
  const durableEntry = createFileSaveOutboxEntry(pending);
  const keepaliveEntry = createFileSaveOutboxEntry(
    prepareFileContentSaveKeepalive(pending),
  );
  if (!durableEntry || !keepaliveEntry) return;
  const journalPromise =
    outboxJournalPromise ?? journalOutboxEntry(durableEntry);
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
    fileSaveOutboxJournalPromisesRef,
    journalOutboxEntry,
    latestFileSaveForUnloadRef,
    rollbackPendingLocalFileContent,
    markPendingLocalFileContent,
    getPendingBaseContent,
    readLiveFileContent,
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
    fileSaveOutboxJournalPromisesRef?.current.get(pending) ??
    (queuedOutboxEntry
      ? journalOutboxEntry(queuedOutboxEntry)
      : Promise.resolve(false));
  let outboxEntryJournaled = false;
  // Re-applies the edit this save carries onto the content the server holds
  // now. Null means it could not be merged exactly, which the caller must
  // surface as a conflict.
  const mergeIntoLiveContent = async (
    request: FileContentSaveRequest,
  ): Promise<FileContentSaveRequest | null> => {
    if (!readLiveFileContent) return null;
    let base = knownSaveContents.get(
      `${request.id}\0${request.expectedVersionHash}`,
    );
    if (base === undefined) {
      const pendingBase = getPendingBaseContent?.(request.id);
      if (
        pendingBase === undefined ||
        sourceContentHash(pendingBase) !== request.expectedVersionHash
      ) {
        return null;
      }
      base = pendingBase;
    }
    let theirs: string;
    try {
      theirs = await readLiveFileContent(request.id);
      // coercion-ok: null is not success; the caller still rolls back and shows the save-conflict toast.
    } catch {
      return null;
    }
    rememberSaveContent(request.id, base);
    rememberSaveContent(request.id, theirs);
    const merged = threeWayMergeContent({
      base,
      mine: request.content,
      theirs,
      keepBothInsertionsAtSamePoint: true,
    });
    if (merged === null) return null;
    const theirsHash = sourceContentHash(theirs);
    const mergedRequest: FileContentSaveRequest = {
      ...request,
      content: merged,
      expectedVersionHash: theirsHash,
      unloadExpectedVersionHash: theirsHash,
    };
    if (latestFileSaveForUnloadRef.current[request.id] === request) {
      latestFileSaveForUnloadRef.current[request.id] = mergedRequest;
      markPendingLocalFileContent(request.id, merged);
      const mergedOutboxEntry = createFileSaveOutboxEntry(mergedRequest);
      if (mergedOutboxEntry) {
        outboxEntryJournaled = await journalOutboxEntry(mergedOutboxEntry);
      }
    }
    return mergedRequest;
  };
  const attempt = async (
    pending: FileContentSaveRequest,
    mergesLeft: number,
  ): Promise<FileContentSaveCompletion> => {
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
      outboxEntryJournaled = await durableOutboxJournal;
      const expectedVersionHash = pending.expectedVersionHash;
      const outboxEntry = createFileSaveOutboxEntry(pending);
      rememberSaveContent(pending.id, pending.content);
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
        if (advancedOutboxEntry) await journalOutboxEntry(advancedOutboxEntry);
      }
      if (
        persistedContentMatches &&
        pending.identityMigrationSourceContent !== undefined &&
        latestFileSaveForUnloadRef.current[pending.id] === pending
      ) {
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
        if (
          persistedUpdatedAt === undefined ||
          queryClient.isFetching({ queryKey: designQueryKey }) > 0
        ) {
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-design"],
          });
        }
      } else if (!persistedContentMatches) {
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
        if (!(prev && prev.fileId === pending.id && prev.status === "queued")) {
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
      const failureKind = classifyDesignSaveFailure(error, navigator.onLine);
      if (
        failureKind === "conflict" &&
        mergesLeft > 0 &&
        pending.identityMigrationSourceContent === undefined
      ) {
        const mergedRequest = await mergeIntoLiveContent(pending);
        if (mergedRequest) return attempt(mergedRequest, mergesLeft - 1);
      }
      if (failureKind === "conflict") {
        rollbackPendingLocalFileContent(pending.id, pending.content);
        if (latestFileSaveForUnloadRef.current[pending.id] === pending) {
          delete latestFileSaveForUnloadRef.current[pending.id];
        }
      }
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-design"],
      });
      if (failureKind === "offline" && outboxEntryJournaled) {
        warnChangesWillRetry();
      } else if (failureKind === "offline") {
        toast.error(t("common.genericError"), {
          id: `design-save-error:${pending.id}`,
        });
      } else if (failureKind === "conflict") {
        toast.error(t("designEditor.toasts.saveConflict"), {
          id: `design-save-conflict:${pending.id}`,
        });
      } else if (failureKind !== "intentional-abort") {
        toast.error(designSaveErrorMessage(error) ?? t("common.genericError"), {
          id: `design-save-error:${pending.id}`,
        });
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
      return failureKind === "offline" && outboxEntryJournaled
        ? "retryable"
        : failureKind === "conflict"
          ? "conflict"
          : "failed";
    }
  };
  const previous = fileSaveChainsRef.current[pending.id] ?? Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(() => attempt(pending, MAX_CONFLICT_MERGES));
  const chain = current.then(() => {});
  fileSaveChainsRef.current[pending.id] = chain;
  void current.finally(() => {
    if (fileSaveChainsRef.current[pending.id] === chain) {
      delete fileSaveChainsRef.current[pending.id];
    }
  });
  return current;
}
