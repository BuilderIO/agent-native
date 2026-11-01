/**
 * The collab docs this browser has opened, each kept as the state the server
 * had already acknowledged, so a page opened again can be drawn and edited
 * before the server answers.
 *
 * A copy is a cache of the server's doc, never a source of its own. It only
 * ever holds state the server already has: a connection saves it only while
 * none of its own edits are waiting for an acknowledgment. On open the client
 * asks the server for everything after the copy, and throws the copy away if
 * the server's doc does not hold all of it.
 *
 * Copies are kept per account and doc, and one account never reads another's.
 * The database remembers which account its copies belong to; when a different
 * account reads or writes, every copy is deleted first. Signing out clears
 * them all. The total is bounded, and the least recently opened copies go
 * first.
 */

/** A copy read: found, not kept, or storage could not be read. */
export type CollabLocalCopyRead =
  | { status: "hit"; state: Uint8Array }
  | { status: "miss" }
  | { status: "unavailable"; error: unknown };

/** Where copies persist between page loads. IndexedDB unless a test swaps it. */
export interface CollabLocalCopyPersistence {
  /** Reads a copy, deleting every copy first if they belong to another account. */
  read(account: string, key: string): Promise<CollabLocalCopyRead>;
  /** The account the kept copies belong to, or null when none are kept. */
  account(): Promise<string | null>;
  /** Writes copies for one account, deleting another account's first. */
  write(
    account: string,
    copies: ReadonlyArray<{ key: string; state: Uint8Array }>,
  ): Promise<void>;
  remove(account: string, key: string): Promise<void>;
  clear(): Promise<void>;
}

const DB_NAME = "agent-native-collab-local-copies";
const DB_VERSION = 1;
/** The shape of a kept copy. A copy of any other format is deleted on read. */
const COPY_FORMAT = 1;
const COPIES = "copies";
const STATES = "states";
const META = "meta";
const ACCOUNT_KEY = "account";

/** Bounds on what is kept. A copy over the per-copy limit is not kept. */
export const COLLAB_LOCAL_COPY_LIMITS = Object.freeze({
  totalBytes: 32 * 1024 * 1024,
  copies: 400,
  copyBytes: 4 * 1024 * 1024,
  memoryBytes: 16 * 1024 * 1024,
});

interface CopyEntry {
  key: string;
  bytes: number;
  accessedAt: number;
}

interface StateRecord {
  key: string;
  format: number;
  state: Uint8Array;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Transaction aborted"));
  });
}

/** Copies kept in IndexedDB: metadata in one store, bytes in another. */
export function indexedDbCollabLocalCopies(
  factory: () => IDBFactory | undefined = () =>
    typeof indexedDB === "undefined" ? undefined : indexedDB,
): CollabLocalCopyPersistence {
  let opening: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    if (opening) return opening;
    const attempt = new Promise<IDBDatabase>((resolve, reject) => {
      const idb = factory();
      if (!idb) {
        reject(new Error("IndexedDB is not available"));
        return;
      }
      const request = idb.open(DB_NAME, DB_VERSION);
      // Copies are disposable: a new version starts from nothing.
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of Array.from(db.objectStoreNames)) {
          db.deleteObjectStore(name);
        }
        db.createObjectStore(COPIES, { keyPath: "key" }).createIndex(
          "accessedAt",
          "accessedAt",
        );
        db.createObjectStore(STATES, { keyPath: "key" });
        db.createObjectStore(META);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          if (opening === attempt) opening = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("The local copy database is held open elsewhere"));
    });
    opening = attempt;
    // A failed open is retried on the next call rather than remembered.
    attempt.catch(() => {
      if (opening === attempt) opening = null;
    });
    return attempt;
  };

  const clearStores = (transaction: IDBTransaction) => {
    transaction.objectStore(COPIES).clear();
    transaction.objectStore(STATES).clear();
  };

  return {
    async read(account, key) {
      let db: IDBDatabase;
      try {
        db = await open();
      } catch (error) {
        return { status: "unavailable", error };
      }
      try {
        const transaction = db.transaction([META, COPIES, STATES], "readwrite");
        const done = transactionDone(transaction);
        const meta = transaction.objectStore(META);
        const owner = await requestResult(meta.get(ACCOUNT_KEY));
        if (owner !== undefined && owner !== account) {
          clearStores(transaction);
          meta.put(account, ACCOUNT_KEY);
          await done;
          return { status: "miss" };
        }
        const record = (await requestResult(
          transaction.objectStore(STATES).get(key),
        )) as StateRecord | undefined;
        if (!record) {
          await done;
          return { status: "miss" };
        }
        const copies = transaction.objectStore(COPIES);
        if (
          record.format !== COPY_FORMAT ||
          !(record.state instanceof Uint8Array)
        ) {
          copies.delete(key);
          transaction.objectStore(STATES).delete(key);
          await done;
          return { status: "miss" };
        }
        const entry = (await requestResult(copies.get(key))) as
          | CopyEntry
          | undefined;
        copies.put({
          key,
          bytes: entry?.bytes ?? record.state.byteLength,
          accessedAt: Date.now(),
        } satisfies CopyEntry);
        await done;
        return { status: "hit", state: record.state };
      } catch (error) {
        return { status: "unavailable", error };
      }
    },

    async account() {
      const db = await open();
      const transaction = db.transaction(META, "readonly");
      const owner = await requestResult(
        transaction.objectStore(META).get(ACCOUNT_KEY),
      );
      return typeof owner === "string" ? owner : null;
    },

    async write(account, writes) {
      const db = await open();
      const transaction = db.transaction([META, COPIES, STATES], "readwrite");
      const done = transactionDone(transaction);
      const meta = transaction.objectStore(META);
      const copies = transaction.objectStore(COPIES);
      const states = transaction.objectStore(STATES);
      const owner = await requestResult(meta.get(ACCOUNT_KEY));
      if (owner !== account) {
        clearStores(transaction);
        meta.put(account, ACCOUNT_KEY);
      }
      const now = Date.now();
      for (const { key, state } of writes) {
        states.put({ key, format: COPY_FORMAT, state } satisfies StateRecord);
        copies.put({
          key,
          bytes: state.byteLength,
          accessedAt: now,
        } satisfies CopyEntry);
      }
      const entries = (await requestResult(copies.getAll())) as CopyEntry[];
      entries.sort((a, b) => b.accessedAt - a.accessedAt);
      let total = 0;
      entries.forEach((entry, index) => {
        total += entry.bytes;
        if (
          index >= COLLAB_LOCAL_COPY_LIMITS.copies ||
          total > COLLAB_LOCAL_COPY_LIMITS.totalBytes
        ) {
          copies.delete(entry.key);
          states.delete(entry.key);
        }
      });
      await done;
    },

    async remove(account, key) {
      const db = await open();
      const transaction = db.transaction([META, COPIES, STATES], "readwrite");
      const done = transactionDone(transaction);
      const owner = await requestResult(
        transaction.objectStore(META).get(ACCOUNT_KEY),
      );
      if (owner === account) {
        transaction.objectStore(COPIES).delete(key);
        transaction.objectStore(STATES).delete(key);
      }
      await done;
    },

    async clear() {
      const db = await open();
      const transaction = db.transaction([META, COPIES, STATES], "readwrite");
      const done = transactionDone(transaction);
      clearStores(transaction);
      transaction.objectStore(META).delete(ACCOUNT_KEY);
      await done;
    },
  };
}

let persistence: CollabLocalCopyPersistence = indexedDbCollabLocalCopies();

// The copies this tab read or wrote, so a page opened again in the same tab
// is drawn from memory without waiting on IndexedDB. One account at a time.
let memoryAccount: string | null = null;
const memory = new Map<string, Uint8Array>();
let memoryBytes = 0;

// Writes coalesce per copy; the newest state wins.
const pendingWrites = new Map<string, Uint8Array>();
let pendingWritesAccount: string | null = null;
let scheduledFlush: symbol | null = null;
let flushing: Promise<void> = Promise.resolve();
// A clear drops every write queued before it.
let clearGeneration = 0;
let warnedUnavailable = false;

function warnOnce(message: string, error: unknown): void {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  console.warn(message, error);
}

/** The key one doc's copy is kept under, for one collab endpoint. */
export function collabLocalCopyKey(baseUrl: string, docId: string): string {
  return `${baseUrl}\0${docId}`;
}

function rememberInMemory(
  account: string,
  key: string,
  state: Uint8Array,
): void {
  if (memoryAccount !== account) {
    memory.clear();
    memoryBytes = 0;
    memoryAccount = account;
  }
  forgetInMemory(key);
  if (state.byteLength > COLLAB_LOCAL_COPY_LIMITS.memoryBytes) return;
  memory.set(key, state);
  memoryBytes += state.byteLength;
  for (const [oldest, bytes] of memory) {
    if (memoryBytes <= COLLAB_LOCAL_COPY_LIMITS.memoryBytes) break;
    memory.delete(oldest);
    memoryBytes -= bytes.byteLength;
  }
}

function forgetInMemory(key: string): void {
  const previous = memory.get(key);
  if (!previous) return;
  memory.delete(key);
  memoryBytes -= previous.byteLength;
}

/**
 * The copy this tab already holds in memory, without touching IndexedDB, so a
 * doc opened again in the same tab can be drawn in the same task.
 */
export function peekCollabLocalCopy(
  account: string,
  key: string,
): Uint8Array | undefined {
  if (!account || memoryAccount !== account) return undefined;
  const state = memory.get(key);
  if (!state) return undefined;
  // Most recently opened last, so it is evicted last.
  memory.delete(key);
  memory.set(key, state);
  return state;
}

/** Reads one account's copy of a doc: from memory first, then IndexedDB. */
export async function readCollabLocalCopy(
  account: string,
  key: string,
): Promise<CollabLocalCopyRead> {
  if (!account) return { status: "miss" };
  const inMemory = peekCollabLocalCopy(account, key);
  if (inMemory) return { status: "hit", state: inMemory };
  const generation = clearGeneration;
  const read = await persistence.read(account, key);
  if (read.status === "unavailable") {
    warnOnce("Saved page copies could not be read", read.error);
    return read;
  }
  // A sign-out while the read was in flight: its answer is someone else's now.
  if (generation !== clearGeneration) return { status: "miss" };
  if (read.status !== "hit") return read;
  // A copy saved while the read was in flight is newer than the one it found.
  const saved = peekCollabLocalCopy(account, key);
  if (saved) return { status: "hit", state: saved };
  rememberInMemory(account, key, read.state);
  return read;
}

/** The account whose copies this browser keeps, or null when there are none. */
export async function collabLocalCopyAccount(): Promise<string | null> {
  if (memoryAccount) return memoryAccount;
  try {
    return await persistence.account();
  } catch (error) {
    warnOnce("Saved page copies could not be read", error);
    return null;
  }
}

/**
 * Keeps a doc's acknowledged state for one account. The memory copy updates
 * at once; IndexedDB is written in the background, and a copy that cannot be
 * written is simply not kept.
 */
export function saveCollabLocalCopy(
  account: string,
  key: string,
  state: Uint8Array,
): void {
  if (!account) return;
  if (state.byteLength > COLLAB_LOCAL_COPY_LIMITS.copyBytes) {
    deleteCollabLocalCopy(account, key);
    return;
  }
  rememberInMemory(account, key, state);
  if (pendingWritesAccount !== account) {
    pendingWrites.clear();
    pendingWritesAccount = account;
  }
  pendingWrites.set(key, state);
  if (scheduledFlush) return;
  const token = Symbol("collab-local-copy-flush");
  scheduledFlush = token;
  const generation = clearGeneration;
  flushing = flushing.then(async () => {
    if (scheduledFlush === token) scheduledFlush = null;
    // A clear since: what was queued before it is gone, and anything queued
    // after it has its own flush.
    if (generation !== clearGeneration || pendingWrites.size === 0) return;
    const writes = Array.from(pendingWrites, ([key, state]) => ({
      key,
      state,
    }));
    const writeAccount = pendingWritesAccount;
    if (!writeAccount) return;
    pendingWrites.clear();
    try {
      await persistence.write(writeAccount, writes);
    } catch (error) {
      warnOnce("Page copies could not be saved in this browser", error);
    }
  });
}

/** Forgets one account's copy of a doc. */
export function deleteCollabLocalCopy(account: string, key: string): void {
  if (memoryAccount === account) forgetInMemory(key);
  if (pendingWritesAccount === account) pendingWrites.delete(key);
  flushing = flushing.then(() =>
    persistence.remove(account, key).catch((error) => {
      warnOnce("A saved page copy could not be removed", error);
    }),
  );
}

/** Deletes every copy this browser keeps, for every account. */
export function clearCollabLocalCopies(): Promise<void> {
  clearGeneration += 1;
  memory.clear();
  memoryBytes = 0;
  memoryAccount = null;
  pendingWrites.clear();
  pendingWritesAccount = null;
  scheduledFlush = null;
  const cleared = flushing.then(() => persistence.clear());
  flushing = cleared.catch(() => {});
  return cleared;
}

/** Waits for writes queued so far. @internal */
export function _flushCollabLocalCopiesForTests(): Promise<void> {
  return flushing;
}

/** Swaps where copies persist, and forgets what memory holds. @internal */
export function _setCollabLocalCopyPersistenceForTests(
  next: CollabLocalCopyPersistence | null,
): void {
  persistence = next ?? indexedDbCollabLocalCopies();
  clearGeneration += 1;
  memory.clear();
  memoryBytes = 0;
  memoryAccount = null;
  pendingWrites.clear();
  pendingWritesAccount = null;
  scheduledFlush = null;
  flushing = Promise.resolve();
  warnedUnavailable = false;
}

/** Forgets what memory holds, as a new page load would. @internal */
export function _forgetCollabLocalCopiesInMemoryForTests(): void {
  memory.clear();
  memoryBytes = 0;
  memoryAccount = null;
}
