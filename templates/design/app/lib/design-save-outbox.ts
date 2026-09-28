import { callAction } from "@agent-native/core/client/hooks";
import { sourceContentHash } from "@shared/source-workspace";

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
  failed: Array<{ entry: DesignSaveOutboxEntry; error: unknown }>;
  dropped: Array<{ entry: DesignSaveOutboxEntry; error: unknown }>;
  rebased: Array<{ entry: DesignSaveOutboxEntry; error: unknown }>;
}

export function isTerminalSaveError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; message?: unknown };
  return (
    candidate.status === 404 &&
    typeof candidate.message === "string" &&
    /file not found/i.test(candidate.message)
  );
}

export function isConflictSaveError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === "client_build_mismatch") return false;
  return (
    typeof candidate.message === "string" &&
    /changed since it was read|re-read the file/i.test(candidate.message)
  );
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

async function drainEntries(
  designId: string,
  actorScope: string,
  invokeAction: (
    actionName: DesignSaveActionName,
    payload: Record<string, unknown>,
  ) => Promise<unknown>,
  storage: DesignSaveOutboxStorage,
): Promise<DrainDesignSaveOutboxResult> {
  const result: DrainDesignSaveOutboxResult = {
    saved: [],
    failed: [],
    dropped: [],
    rebased: [],
  };
  for (const entry of await storage.list(designId, actorScope)) {
    try {
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
      const actionResult = await invokeAction(entry.actionName, entry.payload);
      if (
        entry.actionName === "update-file" &&
        typeof entry.payload.content === "string" &&
        !updateFileResultPersistedContent(actionResult, entry.payload.content)
      ) {
        const conflict = new Error(
          "The saved file changed elsewhere before this edit could be replayed",
        );
        (conflict as Error & { status?: number }).status = 409;
        throw conflict;
      }
      await storage.deleteIfRevision(entry);
      result.saved.push(entry);
    } catch (error) {
      if (isTerminalSaveError(error)) {
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

export async function drainDesignSaveOutbox(options: {
  designId: string;
  actorScope: string;
  invokeAction?: (
    actionName: DesignSaveActionName,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  storage?: DesignSaveOutboxStorage;
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
  const run = () =>
    drainEntries(options.designId, options.actorScope, invokeAction, storage);
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
