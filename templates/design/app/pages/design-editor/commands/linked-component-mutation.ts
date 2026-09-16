import { sourceContentHash } from "@shared/source-workspace";
import type { RefObject } from "react";

import type { FileContentSaveRequest } from "@/pages/design-editor/editor-state";
import type {
  ContentHistoryChange,
  ContentHistoryReservation,
} from "@/pages/design-editor/history";

import type { ApplyFileContentUpdateResult } from "./apply-file-content-update";

export type LinkedComponentEdit =
  | { kind: "style"; property: string; value: string }
  | { kind: "styleBatch"; values: Record<string, string> }
  | {
      kind: "styleTargetsBatch";
      targets: Array<{
        fileId: string;
        nodeId: string;
        styles: Record<string, string>;
      }>;
    }
  | { kind: "textContent"; value: string }
  | { kind: "layerName"; value: string }
  | { kind: "resetOverrides" };

export interface LinkedComponentEditPayload {
  designId: string;
  fileId: string;
  nodeId: string;
  edit: LinkedComponentEdit;
  source: {
    expectedFiles: Array<{ fileId: string; versionHash: string }>;
  };
}

export interface LinkedComponentActionChange {
  fileId: string;
  before: string;
  after: string;
  beforeVersionHash: string;
  afterVersionHash: string;
  updatedAt: string;
}

export interface LinkedComponentActionResult {
  persisted?: boolean;
  conflict?: boolean;
  error?: string;
  ctaRequired?: boolean;
  ctaMessage?: string;
  changes?: LinkedComponentActionChange[];
  sourceBases?: Array<{
    fileId: string;
    versionHash: string;
    updatedAt: string;
  }>;
}

interface LinkedComponentSaveGates {
  byFileId: Map<string, Promise<void>>;
  release: () => void;
}

export interface LinkedComponentMutationQueueArgs {
  designId: string;
  fileIds: () => string[];
  getContent: (fileId: string) => string;
  getSourceBaseContent: (fileId: string) => string;
  canonicalizeSourceContent: (fileId: string, content: string) => string;
  flushPendingSaves: () => void;
  hasPendingSave: (fileId: string) => boolean;
  fileSaveChainsRef: RefObject<Record<string, Promise<void>>>;
  pendingFileSavesRef: RefObject<Record<string, FileContentSaveRequest>>;
  invokeAction: (
    payload: LinkedComponentEditPayload,
  ) => Promise<LinkedComponentActionResult>;
  applyFileContentUpdate: (
    fileId: string,
    content: string,
    options: {
      persist: false;
      recordHistory: false;
      historyBeforeContent: string;
      sourceBaseContent: string;
      updatedAt: string;
    },
  ) => ApplyFileContentUpdateResult;
  reserveContentHistory: () => ContentHistoryReservation;
  waitForHostWrites: (fileIds: string[]) => Promise<void>;
  syncUndoRedoState: () => void;
  refreshAfterConflict: () => void | Promise<unknown>;
  reportFailure: (message: string) => void;
}

interface QueueBatch {
  fileIds: string[];
  initialSourceContent: Map<string, string>;
  content: Map<string, string>;
  sourceBases: Map<
    string,
    { fileId: string; versionHash: string; updatedAt: string }
  >;
  gates: LinkedComponentSaveGates;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function acquireSaveGates(
  fileIds: readonly string[],
  chainsRef: RefObject<Record<string, Promise<void>>>,
): LinkedComponentSaveGates {
  const gates = fileIds.map((fileId) => {
    const previous = chainsRef.current[fileId] ?? Promise.resolve();
    const gate = deferred();
    const chain = previous.catch(() => {}).then(() => gate.promise);
    chainsRef.current[fileId] = chain;
    return { fileId, chain, resolve: gate.resolve };
  });
  return {
    byFileId: new Map(gates.map(({ fileId, chain }) => [fileId, chain])),
    release: () => {
      for (const { fileId, chain, resolve } of gates) {
        resolve();
        if (chainsRef.current[fileId] === chain) {
          delete chainsRef.current[fileId];
        }
      }
    },
  };
}

function failureMessage(result: LinkedComponentActionResult): string {
  return (
    result.error ??
    (result.ctaRequired
      ? (result.ctaMessage ?? "This edit requires an unavailable capability.")
      : result.conflict
        ? "The design changed while this component edit was being saved. Refresh and retry."
        : "The linked component edit could not be applied.")
  );
}

function validateActionResult(
  batch: QueueBatch,
  result: LinkedComponentActionResult,
): LinkedComponentActionChange[] {
  if (result.conflict || result.error || result.ctaRequired)
    throw new Error(failureMessage(result));
  const changes = result.changes ?? [];
  const nextBases = result.sourceBases ?? [];
  if (nextBases.length !== batch.fileIds.length) {
    throw new Error(
      "The linked component action returned an incomplete source version set.",
    );
  }
  const basesById = new Map(nextBases.map((base) => [base.fileId, base]));
  if (
    basesById.size !== batch.fileIds.length ||
    batch.fileIds.some((fileId) => !basesById.has(fileId))
  ) {
    throw new Error(
      "The linked component action returned a different source file set.",
    );
  }

  const changedById = new Map<string, LinkedComponentActionChange>();
  for (const change of changes) {
    const before = batch.content.get(change.fileId);
    const priorBase = batch.sourceBases.get(change.fileId);
    if (
      before === undefined ||
      !priorBase ||
      changedById.has(change.fileId) ||
      before !== change.before ||
      sourceContentHash(change.before) !== change.beforeVersionHash ||
      sourceContentHash(change.after) !== change.afterVersionHash ||
      !change.updatedAt
    ) {
      throw new Error(
        "The linked component action returned a stale or invalid file change.",
      );
    }
    changedById.set(change.fileId, change);
  }

  for (const fileId of batch.fileIds) {
    const nextBase = basesById.get(fileId)!;
    const expectedHash =
      changedById.get(fileId)?.afterVersionHash ??
      batch.sourceBases.get(fileId)?.versionHash;
    if (
      !nextBase.updatedAt ||
      !expectedHash ||
      nextBase.versionHash !== expectedHash
    ) {
      throw new Error(
        "The linked component action returned a stale source version.",
      );
    }
  }
  if (changes.length > 0 && result.persisted !== true) {
    throw new Error("The linked component action did not confirm persistence.");
  }
  return changes;
}

function assertEditorSourceUnchanged(
  args: LinkedComponentMutationQueueArgs,
  batch: QueueBatch,
  allowedResponseChanges: readonly LinkedComponentActionChange[] = [],
): void {
  const allowedSourceContent = new Map<string, Set<string>>();
  for (const fileId of batch.fileIds) {
    allowedSourceContent.set(
      fileId,
      new Set([
        batch.initialSourceContent.get(fileId) ?? "",
        batch.content.get(fileId) ?? "",
      ]),
    );
  }
  for (const change of allowedResponseChanges) {
    allowedSourceContent.get(change.fileId)?.add(change.after);
  }
  if (
    batch.fileIds.some((fileId) => {
      const acceptedSource = allowedSourceContent.get(fileId)!;
      const sourceContent = args.getSourceBaseContent(fileId);
      const sourceAccepted = acceptedSource.has(sourceContent);
      const editorAccepted = [...acceptedSource].some(
        (content) =>
          args.getContent(fileId) ===
          args.canonicalizeSourceContent(fileId, content),
      );
      return (
        !sourceAccepted ||
        !editorAccepted ||
        args.hasPendingSave(fileId) ||
        Boolean(args.pendingFileSavesRef.current[fileId]) ||
        (args.fileSaveChainsRef.current[fileId] !== undefined &&
          args.fileSaveChainsRef.current[fileId] !==
            batch.gates.byFileId.get(fileId))
      );
    })
  ) {
    throw new Error(
      "A newer editor change arrived during the linked component edit. Refresh the design and retry.",
    );
  }
}

function createBatch(
  args: LinkedComponentMutationQueueArgs,
  fileIds: string[],
  gates: LinkedComponentSaveGates,
): QueueBatch {
  const initialSourceContent = new Map(
    fileIds.map((fileId) => [fileId, args.getSourceBaseContent(fileId)]),
  );
  const sourceBases = new Map(
    fileIds.map((fileId) => {
      const content = initialSourceContent.get(fileId)!;
      return [
        fileId,
        {
          fileId,
          versionHash: sourceContentHash(content),
          updatedAt: "editor-base",
        },
      ] as const;
    }),
  );
  return {
    fileIds,
    initialSourceContent,
    content: new Map(initialSourceContent),
    sourceBases,
    gates,
  };
}

/** Serializes source actions and history barriers on the existing save chains. */
export function createLinkedComponentMutationQueue(
  args: LinkedComponentMutationQueueArgs,
) {
  let chain: Promise<void> = Promise.resolve();
  let queued = 0;
  let barriers = 0;
  let batch: QueueBatch | null = null;
  let failure: Error | null = null;
  let observing = false;
  let externalCheckpoints: Array<{
    change: ContentHistoryChange;
    record: () => void;
  }> = [];
  const acknowledgedContent = new Map<string, string>();

  const releaseBatch = () => {
    batch?.gates.release();
    batch = null;
  };
  const startBatch = async (): Promise<QueueBatch> => {
    const fileIds = [...new Set(args.fileIds())].sort();
    if (fileIds.length === 0)
      throw new Error(
        "No HTML source files are available for this linked component.",
      );
    await args.waitForHostWrites(fileIds);
    args.flushPendingSaves();
    await Promise.all(
      fileIds.map((fileId) => args.fileSaveChainsRef.current[fileId]),
    );
    if (fileIds.some(args.hasPendingSave)) {
      args.flushPendingSaves();
      await Promise.all(
        fileIds.map((fileId) => args.fileSaveChainsRef.current[fileId]),
      );
    }
    const gates = acquireSaveGates(fileIds, args.fileSaveChainsRef);
    try {
      return createBatch(args, fileIds, gates);
    } catch (error) {
      gates.release();
      throw error;
    }
  };
  const drainExternalCheckpoints = (
    changes: readonly LinkedComponentActionChange[],
  ) => {
    observing = false;
    for (const change of changes) {
      acknowledgedContent.set(
        change.fileId,
        args.canonicalizeSourceContent(change.fileId, change.after),
      );
    }
    const checkpoints = externalCheckpoints;
    externalCheckpoints = [];
    for (const { change, record } of checkpoints) {
      if (acknowledgedContent.get(change.fileId) !== change.after) record();
    }
  };
  const schedule = (run: () => Promise<void>): Promise<void> => {
    queued += 1;
    args.syncUndoRedoState();
    const operation = chain.then(run).finally(() => {
      queued -= 1;
      if (queued === 0) {
        releaseBatch();
        failure = null;
      }
      args.syncUndoRedoState();
    });
    chain = operation.catch(() => {});
    return operation;
  };
  return {
    hasPending: () => queued > 0,
    interceptExternalCheckpoint: (
      change: ContentHistoryChange,
      record: () => void,
    ): boolean => {
      if (acknowledgedContent.get(change.fileId) === change.after) return true;
      acknowledgedContent.delete(change.fileId);
      if (!observing || !batch?.fileIds.includes(change.fileId)) return false;
      externalCheckpoints.push({ change, record });
      return true;
    },
    enqueue: (
      fileId: string,
      nodeId: string,
      edit: LinkedComponentEdit,
    ): Promise<void> => {
      // Edits after an Undo barrier reserve only after that Undo has consumed its entry.
      let reservation =
        barriers === 0 ? args.reserveContentHistory() : undefined;
      if (queued === 0) failure = null;
      return schedule(async () => {
        let changes: LinkedComponentActionChange[] = [];
        let confirmed = false;
        try {
          if (failure) throw failure;
          reservation ??= args.reserveContentHistory();
          batch ??= await startBatch();
          assertEditorSourceUnchanged(args, batch);
          observing = true;
          const result = await args.invokeAction({
            designId: args.designId,
            fileId,
            nodeId,
            edit,
            source: {
              expectedFiles: batch.fileIds.map((id) => ({
                fileId: id,
                versionHash: batch!.sourceBases.get(id)!.versionHash,
              })),
            },
          });
          changes = validateActionResult(batch, result);
          for (const change of changes)
            acknowledgedContent.set(
              change.fileId,
              args.canonicalizeSourceContent(change.fileId, change.after),
            );
          // A committed server operation stays in history even if local publication must recover.
          reservation.commit(
            changes.map(({ fileId, before, after }) => ({
              fileId,
              before: args.canonicalizeSourceContent(fileId, before),
              after: args.canonicalizeSourceContent(fileId, after),
            })),
          );
          confirmed = true;
          assertEditorSourceUnchanged(args, batch, changes);
          await args.waitForHostWrites(batch.fileIds);
          assertEditorSourceUnchanged(args, batch, changes);
          for (const change of changes) {
            const applied = args.applyFileContentUpdate(
              change.fileId,
              change.after,
              {
                persist: false,
                recordHistory: false,
                historyBeforeContent: change.before,
                sourceBaseContent: change.before,
                updatedAt: change.updatedAt,
              },
            );
            if (applied.status === "deferred") {
              await args.waitForHostWrites([change.fileId]);
              if (
                args.getContent(change.fileId) !==
                args.canonicalizeSourceContent(change.fileId, change.after)
              ) {
                throw new Error(
                  "The saved linked component update has not reached the editor.",
                );
              }
            } else if (applied.status !== "accepted") {
              throw new Error(
                "The editor refused the saved linked component update.",
              );
            }
            batch.content.set(change.fileId, change.after);
          }
          batch.sourceBases = new Map(
            result.sourceBases!.map((base) => [base.fileId, base]),
          );
        } catch (error) {
          if (!confirmed) reservation?.cancel();
          if (!failure) {
            failure = error instanceof Error ? error : new Error(String(error));
            // Release before refreshing: canonical reconciliation may itself enqueue a save.
            releaseBatch();
            const message = failure.message;
            try {
              await args.refreshAfterConflict();
              if (
                confirmed &&
                changes.length > 0 &&
                changes.every(
                  (change) =>
                    args.getContent(change.fileId) ===
                    args.canonicalizeSourceContent(change.fileId, change.after),
                )
              ) {
                failure = null;
              }
            } finally {
              args.reportFailure(message);
            }
          }
          throw error;
        } finally {
          drainExternalCheckpoints(changes);
        }
      });
    },
    deferHistoryChange: (run: () => void): boolean => {
      if (barriers === 0) return false;
      void schedule(async () => run()).catch((error) =>
        args.reportFailure(String(error)),
      );
      return true;
    },
    dispatchHistory: (run: () => void): void | Promise<void> => {
      if (queued === 0 && !failure) {
        run();
        return;
      }
      barriers += 1;
      return schedule(async () => {
        releaseBatch();
        barriers -= 1;
        // A rejected edit consumes its queued Undo instead of undoing an older gesture.
        if (failure) {
          failure = null;
          return;
        }
        run();
      });
    },
  };
}
