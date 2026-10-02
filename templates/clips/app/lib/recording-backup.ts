const DB_NAME = "clips-web-recording-backups";
const DB_VERSION = 1;
const META_STORE = "recordings";
const CHUNK_STORE = "chunks";
const LOCK_PREFIX = "clips-local-recording:";

/**
 * A local copy is deleted only after the server reports the clip `ready`
 * ("processed"); every other state keeps the bytes in this browser.
 */
export type LocalRecordingState =
  | "recording"
  | "recorded-local"
  | "uploading"
  | "uploaded";

export type LocalRecordingEvent =
  | "stop"
  | "interrupt"
  | "upload"
  | "accepted"
  | "failed"
  | "processed";

const LOCAL_RECORDING_TRANSITIONS: Record<
  LocalRecordingState,
  Partial<Record<LocalRecordingEvent, LocalRecordingState | "processed">>
> = {
  recording: { stop: "recorded-local", interrupt: "recorded-local" },
  "recorded-local": { upload: "uploading" },
  uploading: {
    accepted: "uploaded",
    processed: "processed",
    failed: "recorded-local",
    interrupt: "recorded-local",
  },
  uploaded: { processed: "processed", failed: "recorded-local" },
};

export function nextLocalRecordingState(
  state: LocalRecordingState,
  event: LocalRecordingEvent,
): LocalRecordingState | "processed" {
  const next = LOCAL_RECORDING_TRANSITIONS[state][event];
  if (!next) {
    throw new Error(`A local recording cannot ${event} while ${state}.`);
  }
  return next;
}

export interface RecordingBackupMeta {
  recordingId: string;
  mimeType: string;
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
  hasCamera: boolean;
  bytes: number;
  chunkCount: number;
  savedAt: string;
  completedAt: string | null;
  state?: LocalRecordingState;
  /** Recorded before any server row existed (storage was not connected). */
  localOnly?: boolean;
  /** Server row currently holding this copy's upload, when one exists. */
  serverRecordingId?: string | null;
  /** Earlier attempts' rows that never became ready; trashed on success. */
  staleServerRecordingIds?: string[];
  ownerEmail?: string | null;
  title?: string | null;
  createdAt?: string;
  transcript?: string | null;
  transcriptFailureReason?: string | null;
  lastError?: string | null;
}

export function localRecordingState(
  meta: RecordingBackupMeta,
): LocalRecordingState {
  return meta.state ?? (meta.completedAt ? "recorded-local" : "recording");
}

export interface RecordingBackupChunk {
  recordingId: string;
  index: number;
  blob: Blob;
  bytes: number;
  createdAt: string;
}

type RecordingBackupChangeListener = () => void;

const backupChangeListeners = new Map<
  string,
  Set<RecordingBackupChangeListener>
>();

function notifyRecordingBackupChange(recordingId: string): void {
  for (const listener of backupChangeListeners.get(recordingId) ?? []) {
    listener();
  }
}

export function subscribeToRecordingBackupChanges(
  recordingId: string,
  listener: RecordingBackupChangeListener,
): () => void {
  const listeners =
    backupChangeListeners.get(recordingId) ??
    new Set<RecordingBackupChangeListener>();
  listeners.add(listener);
  backupChangeListeners.set(recordingId, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) backupChangeListeners.delete(recordingId);
  };
}

export function recordingBackupAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  if (!recordingBackupAvailable()) {
    return Promise.reject(new Error("IndexedDB is not available"));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "recordingId" });
      }
      if (!db.objectStoreNames.contains(CHUNK_STORE)) {
        const chunks = db.createObjectStore(CHUNK_STORE, {
          keyPath: ["recordingId", "index"],
        });
        chunks.createIndex("recordingId", "recordingId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open recording backups"));
  });
}

function waitForRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Recording backup request failed"));
  });
}

function waitForTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new Error("Recording backup transaction aborted"));
    tx.onerror = () =>
      reject(tx.error ?? new Error("Recording backup transaction failed"));
  });
}

/** Merges into the stored record so per-chunk writes keep upload state. */
export async function putRecordingBackupMeta(
  meta: RecordingBackupMeta,
): Promise<void> {
  await writeRecordingBackupMeta(meta.recordingId, (existing) => ({
    ...existing,
    ...meta,
  }));
}

export async function updateRecordingBackupMeta(
  recordingId: string,
  patch: Partial<Omit<RecordingBackupMeta, "recordingId">>,
): Promise<RecordingBackupMeta> {
  return writeRecordingBackupMeta(recordingId, (existing) => {
    if (!existing) {
      throw new Error("This recording's local copy is missing.");
    }
    return { ...existing, ...patch, recordingId };
  });
}

async function writeRecordingBackupMeta(
  recordingId: string,
  build: (existing: RecordingBackupMeta | undefined) => RecordingBackupMeta,
): Promise<RecordingBackupMeta> {
  const db = await openDb();
  const written: { meta?: RecordingBackupMeta; error?: unknown } = {};
  try {
    const tx = db.transaction(META_STORE, "readwrite");
    const store = tx.objectStore(META_STORE);
    const read = store.get(recordingId);
    read.onsuccess = () => {
      try {
        written.meta = build(read.result as RecordingBackupMeta | undefined);
        store.put(written.meta);
      } catch (error) {
        written.error = error;
        tx.abort();
      }
    };
    await waitForTransaction(tx).catch((error) => {
      throw written.error ?? error;
    });
  } finally {
    db.close();
  }
  if (!written.meta) throw new Error("This recording's local copy is missing.");
  notifyRecordingBackupChange(recordingId);
  return written.meta;
}

/**
 * Stamp the account a copy belongs to. Only an ownerless copy takes an owner;
 * a copy already owned by another account is never reassigned.
 */
export async function claimRecordingBackupOwner(
  recordingId: string,
  ownerEmail: string,
): Promise<RecordingBackupMeta> {
  return writeRecordingBackupMeta(recordingId, (existing) => {
    if (!existing) {
      throw new Error("This recording's local copy is missing.");
    }
    if (
      existing.ownerEmail &&
      existing.ownerEmail.toLowerCase() !== ownerEmail.toLowerCase()
    ) {
      throw new Error("This recording belongs to another account.");
    }
    return { ...existing, ownerEmail: existing.ownerEmail ?? ownerEmail };
  });
}

export async function listRecordingBackupMetas(): Promise<
  RecordingBackupMeta[]
> {
  const db = await openDb();
  try {
    const tx = db.transaction(META_STORE, "readonly");
    return await waitForRequest<RecordingBackupMeta[]>(
      tx.objectStore(META_STORE).getAll(),
    );
  } finally {
    db.close();
  }
}

export async function getRecordingBackupMeta(
  recordingId: string,
): Promise<RecordingBackupMeta | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(META_STORE, "readonly");
    const result = await waitForRequest<RecordingBackupMeta | undefined>(
      tx.objectStore(META_STORE).get(recordingId),
    );
    return result ?? null;
  } finally {
    db.close();
  }
}

export async function putRecordingBackupChunk(
  recordingId: string,
  index: number,
  blob: Blob,
): Promise<void> {
  const db = await openDb();
  try {
    const chunk: RecordingBackupChunk = {
      recordingId,
      index,
      blob,
      bytes: blob.size,
      createdAt: new Date().toISOString(),
    };
    const tx = db.transaction(CHUNK_STORE, "readwrite");
    tx.objectStore(CHUNK_STORE).put(chunk);
    await waitForTransaction(tx);
  } finally {
    db.close();
  }
}

export async function getRecordingBackupChunks(
  recordingId: string,
): Promise<RecordingBackupChunk[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(CHUNK_STORE, "readonly");
    const index = tx.objectStore(CHUNK_STORE).index("recordingId");
    const chunks = await waitForRequest<RecordingBackupChunk[]>(
      index.getAll(IDBKeyRange.only(recordingId)),
    );
    return chunks.slice().sort((a, b) => a.index - b.index);
  } finally {
    db.close();
  }
}

export async function deleteRecordingBackup(
  recordingId: string,
): Promise<void> {
  if (!recordingBackupAvailable()) return;
  const db = await openDb();
  try {
    const tx = db.transaction([META_STORE, CHUNK_STORE], "readwrite");
    tx.objectStore(META_STORE).delete(recordingId);
    const chunkIndex = tx.objectStore(CHUNK_STORE).index("recordingId");
    const cursorRequest = chunkIndex.openCursor(IDBKeyRange.only(recordingId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    await waitForTransaction(tx);
  } finally {
    db.close();
  }
  notifyRecordingBackupChange(recordingId);
}

export function isCompleteRecordingBackup(
  meta: RecordingBackupMeta,
  chunks: RecordingBackupChunk[],
): boolean {
  if (!meta.completedAt || meta.chunkCount <= 0 || meta.bytes <= 0)
    return false;
  if (chunks.length !== meta.chunkCount) return false;

  let bytes = 0;
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    if (chunk.index !== index || chunk.recordingId !== meta.recordingId) {
      return false;
    }
    if (!(chunk.blob instanceof Blob) || chunk.blob.size !== chunk.bytes) {
      return false;
    }
    bytes += chunk.bytes;
  }
  return bytes === meta.bytes;
}

/**
 * The chunks an upload may use. A finished copy must be whole; a copy cut off
 * by a closed tab or crash is usable as its contiguous prefix from chunk 0,
 * because MediaRecorder timeslices are cluster-aligned and chunk 0 carries the
 * container header.
 */
export function recoverableBackupChunks(
  meta: RecordingBackupMeta,
  chunks: RecordingBackupChunk[],
): RecordingBackupChunk[] | null {
  if (meta.completedAt) {
    return isCompleteRecordingBackup(meta, chunks) ? chunks : null;
  }
  const prefix: RecordingBackupChunk[] = [];
  for (const chunk of chunks) {
    if (
      chunk.index !== prefix.length ||
      chunk.recordingId !== meta.recordingId ||
      !(chunk.blob instanceof Blob) ||
      chunk.blob.size !== chunk.bytes ||
      chunk.bytes <= 0
    ) {
      break;
    }
    prefix.push(chunk);
  }
  return prefix.length > 0 ? prefix : null;
}

export function recordingBackupFilename(meta: RecordingBackupMeta): string {
  const extension = /mp4/i.test(meta.mimeType)
    ? "mp4"
    : /quicktime|mov/i.test(meta.mimeType)
      ? "mov"
      : "webm";
  const stamp = (meta.createdAt ?? meta.savedAt).replace(/[:.]/g, "-");
  return `clips-recording-${stamp}.${extension}`;
}

export async function readRecoverableRecordingBackup(recordingId: string) {
  const [meta, chunks] = await Promise.all([
    getRecordingBackupMeta(recordingId),
    getRecordingBackupChunks(recordingId),
  ]);
  if (!meta) return null;
  const usable = recoverableBackupChunks(meta, chunks);
  if (!usable) return { meta, blob: null };
  return {
    meta,
    blob: new Blob(
      usable.map((chunk) => chunk.blob),
      { type: meta.mimeType },
    ),
  };
}

/**
 * Holds a Web Lock for as long as this tab owns a local copy, so other tabs
 * never offer to upload (or discard) a recording that is still live here.
 * The browser releases it when the page goes away.
 */
export function holdRecordingBackupLock(recordingId: string): () => void {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) return () => {};
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  void locks
    .request(`${LOCK_PREFIX}${recordingId}`, () => held)
    .catch(() => {
      // coercion-ok: a lock request only fails when the page is going away.
    });
  return release;
}

/** Ids another tab (or this one) still owns; null when the browser can't say. */
export async function liveRecordingBackupIds(): Promise<Set<string> | null> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.query) return null;
  const snapshot = await locks.query();
  const ids = new Set<string>();
  for (const lock of [...(snapshot.held ?? []), ...(snapshot.pending ?? [])]) {
    if (lock.name?.startsWith(LOCK_PREFIX)) {
      ids.add(lock.name.slice(LOCK_PREFIX.length));
    }
  }
  return ids;
}

const UNLOCKED_LIVENESS_MS = 30_000;

/**
 * The local copies this signed-in user can finish uploading from this tab.
 * Copies owned by another account stay in this browser, untouched, until that
 * account signs in here again; they are never uploaded anywhere else. An
 * ownerless copy (recorded before the session loaded) is returned so the user
 * can claim it explicitly. A copy still owned by a live tab is left alone;
 * without Web Locks, a copy written in the last 30s counts as live.
 */
export function selectRecoverableRecordingBackups(
  metas: RecordingBackupMeta[],
  options: {
    liveIds: Set<string> | null;
    ownerEmail: string | null;
    nowMs?: number;
  },
): RecordingBackupMeta[] {
  const nowMs = options.nowMs ?? Date.now();
  return metas
    .filter((meta) => meta.bytes > 0 || meta.chunkCount > 0)
    .filter(
      (meta) =>
        !meta.ownerEmail ||
        meta.ownerEmail.toLowerCase() === options.ownerEmail?.toLowerCase(),
    )
    .filter((meta) =>
      options.liveIds
        ? !options.liveIds.has(meta.recordingId)
        : nowMs - Date.parse(meta.savedAt) > UNLOCKED_LIVENESS_MS,
    )
    .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
}

export async function hasRecordingBackup(
  recordingId: string,
): Promise<boolean> {
  if (!recordingBackupAvailable()) return false;
  try {
    const [meta, chunks] = await Promise.all([
      getRecordingBackupMeta(recordingId),
      getRecordingBackupChunks(recordingId),
    ]);
    return !!meta && isCompleteRecordingBackup(meta, chunks);
  } catch {
    // coercion-ok: an unreadable backup store is exactly as unusable for
    // retry as a missing one — both mean "can't replay from this browser".
    return false;
  }
}
