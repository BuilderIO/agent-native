/**
 * Local IndexedDB mirror of the raw chunks a web recording captures, so a
 * failed or stalled upload can be retried from the library without
 * re-recording. This is the browser-tab equivalent of the desktop app's
 * "pending recording upload" backup — same idea (mirror every raw
 * `MediaRecorder` blob as it's produced, keep it until the upload succeeds),
 * scoped to a plain browser tab instead of a Tauri webview.
 *
 * Retry can only work in the browser/profile that made the recording:
 * IndexedDB is per-origin, per-browser-profile storage. Callers must treat a
 * missing backup as "not retryable here", not as an error.
 */

const DB_NAME = "clips-web-recording-backups";
const DB_VERSION = 1;
const META_STORE = "recordings";
const CHUNK_STORE = "chunks";

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

export async function putRecordingBackupMeta(
  meta: RecordingBackupMeta,
): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(META_STORE, "readwrite");
    tx.objectStore(META_STORE).put(meta);
    await waitForTransaction(tx);
  } finally {
    db.close();
  }
  notifyRecordingBackupChange(meta.recordingId);
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

/** IndexedDB entries in recording order, with indexes retained for validation. */
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

/** Whether this browser holds a locally-recoverable backup for `recordingId`. */
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
