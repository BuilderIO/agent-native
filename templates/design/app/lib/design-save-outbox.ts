import { callAction } from "@agent-native/core/client/hooks";
import {
  SOURCE_FILE_NOT_FOUND_ERROR_CODE,
  SOURCE_VERSION_CONFLICT_ERROR_CODE,
  saveErrorCode,
} from "@shared/save-conflict";
import { sourceContentHash } from "@shared/source-workspace";

import { liveDesignSaveWriterSources } from "./design-save-outbox-writers";

export type DesignSaveActionName =
  | "update-file"
  | "update-design"
  | "apply-tweaks";

export interface DesignSaveOutboxEntry {
  key: string;
  designId: string;
  actorScope: string;
  actionName: DesignSaveActionName;
  resourceId: string;
  operationSource: string;
  operationRevision: number;
  payload: Record<string, unknown>;
  /**
   * The file text `payload.content` was edited from. Kept beside the payload,
   * never inside it, so replay can merge into a file that moved on while the
   * edit was queued. Absent when the text was not known to match
   * `payload.expectedVersionHash`.
   */
  baseContent?: string;
  updatedAt: number;
}

export interface DesignSaveOutboxStorage {
  putLatest(entry: DesignSaveOutboxEntry): Promise<void>;
  deleteIfRevision(entry: DesignSaveOutboxEntry): Promise<boolean>;
  list(designId: string, actorScope: string): Promise<DesignSaveOutboxEntry[]>;
  pruneOlderThan(updatedAt: number): Promise<number>;
}

export interface DrainDesignSaveOutboxResult {
  saved: DesignSaveOutboxEntry[];
  /** Saved after merging the queued edit into newer server content. */
  merged: DesignSaveOutboxEntry[];
  /** The server had already applied this save, so the copy was dropped, not replayed. */
  alreadyApplied: DesignSaveOutboxEntry[];
  failed: Array<{ entry: DesignSaveOutboxEntry; error: unknown }>;
  dropped: Array<{ entry: DesignSaveOutboxEntry; error: unknown }>;
  rebased: Array<{ entry: DesignSaveOutboxEntry; error: unknown }>;
}

export interface DesignSaveReplayMerge {
  readLiveFileContent: (fileId: string) => Promise<string>;
  mergeContent: (input: {
    base: string;
    mine: string;
    theirs: string;
  }) => string | null;
}

const MAX_REPLAY_MERGES = 3;

export function isTerminalSaveError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  // The merge's live read fails with this code when the file was deleted
  // after the save was refused; its wording differs from update-file's.
  if (saveErrorCode(error) === SOURCE_FILE_NOT_FOUND_ERROR_CODE) return true;
  const candidate = error as { status?: unknown; message?: unknown };
  return (
    candidate.status === 404 &&
    typeof candidate.message === "string" &&
    /file not found/i.test(candidate.message)
  );
}

export function isConflictSaveError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = saveErrorCode(error);
  if (code !== undefined) return code === SOURCE_VERSION_CONFLICT_ERROR_CODE;
  // Only a server that predates typed codes says it in words; a typed error
  // that is not a conflict can still quote the wording.
  const message = (error as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    /changed since it was read|re-read the file/i.test(message)
  );
}

const REJECTED_RESTORE_CLAIM_ERROR_CODES = new Set([
  "localhost_connection_scope_mismatch",
  "localhost_connection_scope_required",
  "screen_restore_claim_used",
]);

export function isRejectedRestoreClaimError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Record<string, unknown>;
  const data =
    candidate.data && typeof candidate.data === "object"
      ? (candidate.data as Record<string, unknown>)
      : undefined;
  const code = candidate.errorCode ?? candidate.code ?? data?.errorCode;
  return (
    typeof code === "string" && REJECTED_RESTORE_CLAIM_ERROR_CODES.has(code)
  );
}

export function rejectedRestoreClaimTargetFileIds(
  error: unknown,
  claims: readonly unknown[],
): string[] {
  if (!error || typeof error !== "object") return [];
  const candidate = error as Record<string, unknown>;
  const data = isRecord(candidate.data) ? candidate.data : undefined;
  const details = isRecord(candidate.details)
    ? candidate.details
    : data && isRecord(data.details)
      ? data.details
      : undefined;
  const targetFileIds = details?.restoreTargetFileIds;
  if (Array.isArray(targetFileIds)) {
    return [
      ...new Set(
        targetFileIds.filter(
          (value): value is string => typeof value === "string",
        ),
      ),
    ];
  }
  return [
    ...new Set(
      claims.flatMap((claim) =>
        isRecord(claim) && typeof claim.targetFileId === "string"
          ? [claim.targetFileId]
          : [],
      ),
    ),
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function stripRejectedRestoreClaimAssignments(
  operations: readonly unknown[],
  claims: readonly unknown[],
): { operations: unknown[]; removed: boolean } {
  const targetFileIds = new Set(
    claims.flatMap((claim) =>
      isRecord(claim) && typeof claim.targetFileId === "string"
        ? [claim.targetFileId]
        : [],
    ),
  );
  if (targetFileIds.size === 0)
    return { operations: [...operations], removed: false };

  let removedAssignment = false;
  const reconciledOperations = operations.flatMap((operation) => {
    if (!isRecord(operation) || !Array.isArray(operation.path)) {
      return [operation];
    }
    const [map, fileId, field] = operation.path;
    if (
      (map !== "screenMetadata" && map !== "localhostScreens") ||
      typeof fileId !== "string" ||
      !targetFileIds.has(fileId)
    ) {
      return [operation];
    }
    if (
      operation.op === "set" &&
      field === "connectionId" &&
      operation.path.length === 3
    ) {
      removedAssignment = true;
      return [];
    }
    if (
      operation.op === "set" &&
      operation.path.length === 2 &&
      isRecord(operation.value) &&
      typeof operation.value.connectionId === "string" &&
      operation.value.connectionId.length > 0
    ) {
      const metadata = { ...operation.value };
      delete metadata.connectionId;
      removedAssignment = true;
      return Object.keys(metadata).length > 0
        ? [{ ...operation, value: metadata }]
        : [];
    }
    return [operation];
  });
  return { operations: reconciledOperations, removed: removedAssignment };
}

/**
 * Drop a rejected restore's connection assignment while preserving its other
 * metadata and geometry writes so the rest of the queued save can proceed.
 */
export function reconcileRejectedRestoreClaimOutboxEntryResult(
  entry: DesignSaveOutboxEntry,
  rejectedTargetFileIds?: readonly string[],
):
  | { kind: "updated"; entry: DesignSaveOutboxEntry }
  | { kind: "empty" }
  | null {
  const claims = entry.payload.restoreClaims;
  const operations = entry.payload.dataOperations;
  if (!Array.isArray(claims) || !Array.isArray(operations)) return null;
  const rejectedTargetFileIdSet =
    rejectedTargetFileIds === undefined ? null : new Set(rejectedTargetFileIds);
  const rejectedClaims = claims.filter(
    (claim) =>
      rejectedTargetFileIdSet === null ||
      (isRecord(claim) &&
        typeof claim.targetFileId === "string" &&
        rejectedTargetFileIdSet.has(claim.targetFileId)),
  );
  if (rejectedClaims.length === 0) return null;
  const reconciliation = stripRejectedRestoreClaimAssignments(
    operations,
    rejectedClaims,
  );
  if (!reconciliation.removed) return null;
  if (reconciliation.operations.length === 0) return { kind: "empty" };

  const payload = { ...entry.payload };
  const remainingClaims = claims.filter(
    (claim) => !rejectedClaims.includes(claim),
  );
  if (remainingClaims.length === 0) delete payload.restoreClaims;
  else payload.restoreClaims = remainingClaims;
  return {
    kind: "updated",
    entry: {
      ...entry,
      payload: { ...payload, dataOperations: reconciliation.operations },
      updatedAt: Date.now(),
    },
  };
}

/**
 * Backward-compatible entry view for callers that acknowledge empty results.
 */
export function reconcileRejectedRestoreClaimOutboxEntry(
  entry: DesignSaveOutboxEntry,
  rejectedTargetFileIds?: readonly string[],
): DesignSaveOutboxEntry | null {
  const result = reconcileRejectedRestoreClaimOutboxEntryResult(
    entry,
    rejectedTargetFileIds,
  );
  return result?.kind === "updated" ? result.entry : null;
}

const DATABASE_NAME = "agent-native-design-save-outbox";
const DATABASE_VERSION = 2;
const ENTRY_STORE = "entries";
const DESIGN_ID_INDEX = "by-design-id";
const UPDATED_AT_INDEX = "by-updated-at";

export const DESIGN_SAVE_OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

let databasePromise: Promise<IDBDatabase> | null = null;

const outboxOperationChains = new WeakMap<
  DesignSaveOutboxStorage,
  Map<string, Promise<void>>
>();

function enqueueOutboxOperation<T>(
  storage: DesignSaveOutboxStorage,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const chains =
    outboxOperationChains.get(storage) ?? new Map<string, Promise<void>>();
  outboxOperationChains.set(storage, chains);
  const previous = chains.get(key) ?? Promise.resolve();
  const current = previous.then(operation);
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, settled);
  void settled.then(() => {
    if (chains.get(key) === settled) chains.delete(key);
  });
  return current;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("IndexedDB is unavailable; design changes cannot be journaled"),
    );
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(ENTRY_STORE)
        ? request.transaction?.objectStore(ENTRY_STORE)
        : database.createObjectStore(ENTRY_STORE, { keyPath: "key" });
      if (store && !store.indexNames.contains(DESIGN_ID_INDEX)) {
        store.createIndex(DESIGN_ID_INDEX, "designId", { unique: false });
      }
      if (store && !store.indexNames.contains(UPDATED_AT_INDEX)) {
        store.createIndex(UPDATED_AT_INDEX, "updatedAt", { unique: false });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(
        request.error ?? new Error("Failed to open the design save outbox"),
      );
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("The design save outbox database upgrade was blocked"));
    };
  });

  return databasePromise;
}

function transactionError(
  transaction: IDBTransaction,
  fallback: string,
): Error {
  return transaction.error ?? new Error(fallback);
}

const indexedDbStorage: DesignSaveOutboxStorage = {
  async putLatest(entry) {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(ENTRY_STORE, "readwrite");
      const store = transaction.objectStore(ENTRY_STORE);
      const request = store.get(entry.key);
      request.onsuccess = () => {
        const current = request.result as DesignSaveOutboxEntry | undefined;
        const shouldReplace =
          !current ||
          entry.operationRevision > current.operationRevision ||
          (entry.operationRevision === current.operationRevision &&
            entry.updatedAt >= current.updatedAt);
        if (shouldReplace) store.put(entry);
      };
      request.onerror = () => transaction.abort();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transactionError(transaction, "Failed to journal design changes"),
        );
      transaction.onabort = () =>
        reject(
          transactionError(transaction, "Failed to journal design changes"),
        );
    });
  },

  async deleteIfRevision(entry) {
    const database = await openDatabase();
    return await new Promise<boolean>((resolve, reject) => {
      const transaction = database.transaction(ENTRY_STORE, "readwrite");
      const store = transaction.objectStore(ENTRY_STORE);
      const request = store.get(entry.key);
      let deleted = false;
      request.onsuccess = () => {
        const current = request.result as DesignSaveOutboxEntry | undefined;
        if (
          current?.operationSource === entry.operationSource &&
          current.operationRevision === entry.operationRevision
        ) {
          store.delete(entry.key);
          deleted = true;
        }
      };
      request.onerror = () => transaction.abort();
      transaction.oncomplete = () => resolve(deleted);
      transaction.onerror = () =>
        reject(
          transactionError(transaction, "Failed to acknowledge design changes"),
        );
      transaction.onabort = () =>
        reject(
          transactionError(transaction, "Failed to acknowledge design changes"),
        );
    });
  },

  async list(designId, actorScope) {
    const database = await openDatabase();
    return await new Promise<DesignSaveOutboxEntry[]>((resolve, reject) => {
      const transaction = database.transaction(ENTRY_STORE, "readonly");
      const request = transaction
        .objectStore(ENTRY_STORE)
        .index(DESIGN_ID_INDEX)
        .getAll(designId);
      let entries: DesignSaveOutboxEntry[] = [];
      request.onsuccess = () => {
        entries = (request.result as DesignSaveOutboxEntry[])
          .filter((entry) => entry.actorScope === actorScope)
          .sort((left, right) => left.updatedAt - right.updatedAt);
      };
      request.onerror = () => transaction.abort();
      transaction.oncomplete = () => resolve(entries);
      transaction.onerror = () =>
        reject(transactionError(transaction, "Failed to read design changes"));
      transaction.onabort = () =>
        reject(transactionError(transaction, "Failed to read design changes"));
    });
  },

  async pruneOlderThan(updatedAt) {
    const database = await openDatabase();
    return await new Promise<number>((resolve, reject) => {
      const transaction = database.transaction(ENTRY_STORE, "readwrite");
      const request = transaction
        .objectStore(ENTRY_STORE)
        .index(UPDATED_AT_INDEX)
        .openCursor(IDBKeyRange.upperBound(updatedAt, true));
      let pruned = 0;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        pruned += 1;
        cursor.continue();
      };
      request.onerror = () => transaction.abort();
      transaction.oncomplete = () => resolve(pruned);
      transaction.onerror = () =>
        reject(
          transactionError(transaction, "Failed to prune old design changes"),
        );
      transaction.onabort = () =>
        reject(
          transactionError(transaction, "Failed to prune old design changes"),
        );
    });
  },
};

export function designSaveOutboxKey(input: {
  designId: string;
  actorScope: string;
  actionName: DesignSaveActionName;
  resourceId: string;
  operationSource: string;
}): string {
  return [
    input.designId,
    input.actorScope,
    input.actionName,
    input.resourceId,
    input.operationSource,
  ]
    .map(encodeURIComponent)
    .join(":");
}

export function createDesignSaveOutboxEntry(input: {
  designId: string;
  actorScope: string;
  actionName: DesignSaveActionName;
  resourceId: string;
  operationSource: string;
  operationRevision: number;
  payload: Record<string, unknown>;
  updatedAt?: number;
}): DesignSaveOutboxEntry {
  return {
    ...input,
    key: designSaveOutboxKey(input),
    updatedAt: input.updatedAt ?? Date.now(),
  };
}

/**
 * Keeps `baseContent` only when it provably is the version the edit was based
 * on. A base that cannot be proven would merge against the wrong ancestor, so
 * an entry without one is replayed without merging.
 */
export function withVerifiedBaseContent(
  entry: DesignSaveOutboxEntry,
  baseContent: string | undefined,
): DesignSaveOutboxEntry {
  if (
    baseContent === undefined ||
    entry.actionName !== "update-file" ||
    entry.payload.identityOnly === true ||
    sourceContentHash(baseContent) !== entry.payload.expectedVersionHash
  ) {
    return entry;
  }
  return { ...entry, baseContent };
}

export async function journalDesignSaveOutboxEntry(
  entry: DesignSaveOutboxEntry,
  storage: DesignSaveOutboxStorage = indexedDbStorage,
): Promise<void> {
  await enqueueOutboxOperation(storage, entry.key, () =>
    storage.putLatest(entry),
  );
}

export async function acknowledgeDesignSaveOutboxEntry(
  entry: DesignSaveOutboxEntry,
  storage: DesignSaveOutboxStorage = indexedDbStorage,
): Promise<boolean> {
  return await enqueueOutboxOperation(storage, entry.key, async () => {
    const current = (await storage.list(entry.designId, entry.actorScope)).find(
      (candidate) => candidate.key === entry.key,
    );
    if (
      !current ||
      current.operationSource !== entry.operationSource ||
      current.operationRevision > entry.operationRevision
    ) {
      return false;
    }
    return await storage.deleteIfRevision(current);
  });
}

export async function discardDesignSaveOutboxEntry(
  entry: DesignSaveOutboxEntry,
  storage: DesignSaveOutboxStorage = indexedDbStorage,
): Promise<boolean> {
  return await enqueueOutboxOperation(storage, entry.key, () =>
    storage.deleteIfRevision(entry),
  );
}

export function updateFileResultPersistedContent(
  actionResult: unknown,
  expectedContent: string,
  unconfirmedMessage = "The file save response did not confirm persistence",
): boolean {
  if (!actionResult || typeof actionResult !== "object") {
    throw new Error(unconfirmedMessage);
  }
  const result = actionResult as {
    updated?: unknown;
    skippedStaleMirror?: unknown;
    skippedStaleOperation?: unknown;
    versionHash?: unknown;
  };
  if (
    result.updated !== true ||
    (result.skippedStaleMirror !== undefined &&
      typeof result.skippedStaleMirror !== "boolean") ||
    (result.skippedStaleOperation !== undefined &&
      typeof result.skippedStaleOperation !== "boolean") ||
    (result.versionHash !== undefined && typeof result.versionHash !== "string")
  ) {
    throw new Error(unconfirmedMessage);
  }
  if (result.skippedStaleMirror) return false;
  if (result.versionHash !== undefined) {
    return result.versionHash === sourceContentHash(expectedContent);
  }
  return !result.skippedStaleOperation;
}

/** The server's answer that it already applied this save, though the file has since moved on. */
function isOperationAlreadyApplied(actionResult: unknown): boolean {
  if (!actionResult || typeof actionResult !== "object") return false;
  const result = actionResult as {
    updated?: unknown;
    operationAlreadyApplied?: unknown;
  };
  return result.updated === true && result.operationAlreadyApplied === true;
}

async function mergeQueuedFileEdit(
  entry: DesignSaveOutboxEntry,
  payload: Record<string, unknown>,
  base: string | undefined,
  merge: DesignSaveReplayMerge | undefined,
): Promise<{ payload: Record<string, unknown>; base: string } | null> {
  const mine = payload.content;
  if (
    !merge ||
    base === undefined ||
    typeof mine !== "string" ||
    entry.actionName !== "update-file" ||
    payload.identityOnly === true ||
    sourceContentHash(base) !== payload.expectedVersionHash
  ) {
    return null;
  }
  // A failed read propagates: the server's version is unknown, not conflicting.
  const theirs = await merge.readLiveFileContent(entry.resourceId);
  const merged = merge.mergeContent({ base, mine, theirs });
  if (merged === null) return null;
  return {
    payload: {
      ...payload,
      content: merged,
      expectedVersionHash: sourceContentHash(theirs),
    },
    base: theirs,
  };
}

async function replayEntry(
  entry: DesignSaveOutboxEntry,
  invokeAction: (
    actionName: DesignSaveActionName,
    payload: Record<string, unknown>,
  ) => Promise<unknown>,
  merge: DesignSaveReplayMerge | undefined,
): Promise<"saved" | "merged" | "alreadyApplied"> {
  if (
    entry.actionName === "update-file" &&
    typeof entry.payload.content === "string" &&
    (typeof entry.payload.expectedVersionHash !== "string" ||
      entry.payload.expectedVersionHash.trim().length === 0)
  ) {
    const conflict = new Error(
      "File changed since it was read. Re-read the file before retrying this saved change.",
    );
    (conflict as Error & { status?: number }).status = 409;
    throw conflict;
  }
  if (
    entry.actionName === "apply-tweaks" &&
    typeof entry.payload.expectedSelectionsHash !== "string"
  ) {
    const conflict = new Error(
      "A full tweak snapshot cannot be replayed without a known base version",
    );
    (conflict as Error & { status?: number }).status = 409;
    throw conflict;
  }
  let payload = entry.payload;
  let base = entry.baseContent;
  for (let merges = 0; ; merges += 1) {
    try {
      const actionResult = await invokeAction(entry.actionName, payload);
      if (
        entry.actionName === "update-file" &&
        typeof payload.content === "string"
      ) {
        // Merging a save the file already took would write it again into
        // content others have changed since, bringing back what they undid.
        if (isOperationAlreadyApplied(actionResult)) return "alreadyApplied";
        if (!updateFileResultPersistedContent(actionResult, payload.content)) {
          const conflict = new Error(
            "The saved file changed elsewhere before this edit could be replayed",
          );
          (conflict as Error & { status?: number }).status = 409;
          throw conflict;
        }
      }
      return merges > 0 ? "merged" : "saved";
    } catch (error) {
      if (!isConflictSaveError(error)) throw error;
      // Out of attempts is not a clash: the edit merged, the file just kept
      // moving. A conflict error here would make the drain drop the edit.
      if (merges >= MAX_REPLAY_MERGES) {
        throw Object.assign(
          new Error("The file kept changing while this edit was being merged"),
          { cause: error },
        );
      }
      const next = await mergeQueuedFileEdit(entry, payload, base, merge);
      if (next === null) throw error;
      payload = next.payload;
      base = next.base;
    }
  }
}

async function drainEntries(
  designId: string,
  actorScope: string,
  invokeAction: (
    actionName: DesignSaveActionName,
    payload: Record<string, unknown>,
  ) => Promise<unknown>,
  storage: DesignSaveOutboxStorage,
  merge: DesignSaveReplayMerge | undefined,
  isReplayable: (entry: DesignSaveOutboxEntry) => Promise<boolean>,
): Promise<DrainDesignSaveOutboxResult> {
  const result: DrainDesignSaveOutboxResult = {
    saved: [],
    merged: [],
    alreadyApplied: [],
    failed: [],
    dropped: [],
    rebased: [],
  };
  for (const entry of await storage.list(designId, actorScope)) {
    // An editor open in another tab is still sending this copy itself.
    if (!(await isReplayable(entry))) continue;
    try {
      const outcome = await replayEntry(entry, invokeAction, merge);
      await storage.deleteIfRevision(entry);
      result[outcome].push(entry);
    } catch (error) {
      if (
        isRejectedRestoreClaimError(error) &&
        Array.isArray(entry.payload.restoreClaims)
      ) {
        const rejectedTargetFileIds = rejectedRestoreClaimTargetFileIds(
          error,
          entry.payload.restoreClaims,
        );
        const reconciled = reconcileRejectedRestoreClaimOutboxEntryResult(
          entry,
          rejectedTargetFileIds,
        );
        if (reconciled?.kind === "updated") {
          await storage.putLatest(reconciled.entry);
          result.rebased.push({ entry, error });
          if (typeof console !== "undefined") {
            console.warn(
              `[design-save-outbox] removed rejected Screen restore connection metadata from ${entry.actionName} ${entry.resourceId}`,
            );
          }
        } else if (reconciled?.kind === "empty") {
          await storage.deleteIfRevision(entry);
          result.rebased.push({ entry, error });
          if (typeof console !== "undefined") {
            console.warn(
              `[design-save-outbox] discarded an empty reconciled save for ${entry.actionName} ${entry.resourceId}`,
            );
          }
        } else {
          result.failed.push({ entry, error });
        }
      } else if (isTerminalSaveError(error)) {
        await storage.deleteIfRevision(entry);
        result.dropped.push({ entry, error });
        if (typeof console !== "undefined") {
          console.warn(
            `[design-save-outbox] dropped unrecoverable save for ${entry.actionName} ${entry.resourceId} (file no longer exists)`,
          );
        }
      } else if (isConflictSaveError(error)) {
        await storage.deleteIfRevision(entry);
        result.rebased.push({ entry, error });
        if (typeof console !== "undefined") {
          console.warn(
            `[design-save-outbox] rebased superseded save for ${entry.actionName} ${entry.resourceId} (server content moved on)`,
          );
        }
      } else {
        result.failed.push({ entry, error });
      }
    }
  }
  return result;
}

export async function listDesignSaveOutboxEntries(
  designId: string,
  actorScope: string,
  storage: DesignSaveOutboxStorage = indexedDbStorage,
): Promise<DesignSaveOutboxEntry[]> {
  return await storage.list(designId, actorScope);
}

/**
 * The queued saves nothing is sending: not a live save in this tab, and not an
 * editor open in another tab. Only these are stuck, so only these are unsaved.
 */
export function stuckDesignSaveOutboxEntries(
  entries: readonly DesignSaveOutboxEntry[],
  options: {
    ownOperationSource: string;
    liveWriterSources: ReadonlySet<string> | null;
    sendingResourceIds: ReadonlySet<string>;
  },
): DesignSaveOutboxEntry[] {
  return entries.filter(
    (entry) =>
      !options.sendingResourceIds.has(entry.resourceId) &&
      (entry.operationSource === options.ownOperationSource ||
        !options.liveWriterSources?.has(entry.operationSource)),
  );
}

export async function drainDesignSaveOutbox(options: {
  designId: string;
  actorScope: string;
  invokeAction?: (
    actionName: DesignSaveActionName,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  storage?: DesignSaveOutboxStorage;
  merge?: DesignSaveReplayMerge;
  /**
   * The caller's own save session. With it, copies whose session is held open
   * by another tab are left for that tab; without it every copy is replayed.
   */
  ownOperationSource?: string;
  listLiveWriters?: () => Promise<ReadonlySet<string> | null>;
}): Promise<DrainDesignSaveOutboxResult> {
  const invokeAction =
    options.invokeAction ??
    ((actionName: DesignSaveActionName, payload: Record<string, unknown>) =>
      (
        callAction as (
          name: string,
          params: Record<string, unknown>,
        ) => Promise<unknown>
      )(actionName, payload));
  const storage = options.storage ?? indexedDbStorage;
  await storage.pruneOlderThan(Date.now() - DESIGN_SAVE_OUTBOX_RETENTION_MS);
  const { ownOperationSource } = options;
  const listLiveWriters =
    options.listLiveWriters ?? liveDesignSaveWriterSources;
  // Asked again for each copy: an editor can open while the drain is running.
  const isReplayable = async (entry: DesignSaveOutboxEntry) =>
    ownOperationSource === undefined ||
    entry.operationSource === ownOperationSource ||
    !(await listLiveWriters())?.has(entry.operationSource);
  const run = () =>
    drainEntries(
      options.designId,
      options.actorScope,
      invokeAction,
      storage,
      options.merge,
      isReplayable,
    );
  const lockManager =
    typeof navigator === "undefined"
      ? undefined
      : (
          navigator as Navigator & {
            locks?: {
              request<T>(name: string, callback: () => Promise<T>): Promise<T>;
            };
          }
        ).locks;

  if (!lockManager) return await run();
  return await lockManager.request(
    `agent-native-design-save-outbox:${options.designId}`,
    run,
  );
}
