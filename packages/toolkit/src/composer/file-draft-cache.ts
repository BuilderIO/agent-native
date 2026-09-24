const DATABASE = "agent-native-unsent-composer-files";
const STORE = "drafts";
export const FILE_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export const FILE_DRAFT_MAX_BYTES = 32 * 1024 * 1024;
const CACHE_MAX_BYTES = 64 * 1024 * 1024;

type Draft = {
  key: string;
  revision: string;
  updatedAt: number;
  bytes: number;
  files: File[];
};

export function validateFileDraft(files: readonly File[]): number {
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  if (files.length > 12 || bytes > FILE_DRAFT_MAX_BYTES)
    throw new Error("draft_file_limit");
  return bytes;
}

function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("draft_storage_unavailable"));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("draft_storage_unreadable"));
    request.onblocked = () => reject(new Error("draft_storage_blocked"));
  });
}

export async function readFileDraft(key: string): Promise<File[] | null> {
  const db = await openCache();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => {
        const record = request.result as Draft | undefined;
        if (!record || Date.now() - record.updatedAt > FILE_DRAFT_TTL_MS) {
          resolve(null);
          return;
        }
        try {
          if (
            !Array.isArray(record.files) ||
            record.files.some((file) => !(file instanceof File))
          )
            throw new Error("draft_storage_invalid");
          validateFileDraft(record.files);
          resolve(record.files);
        } catch (cause) {
          reject(cause);
        }
      };
      request.onerror = () =>
        reject(request.error ?? new Error("draft_storage_unreadable"));
    });
  } finally {
    db.close();
  }
}

export async function writeFileDraft(
  key: string,
  files: readonly File[],
  revision = crypto.randomUUID(),
): Promise<void> {
  const bytes = validateFileDraft(files);
  const db = await openCache();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const request = store.getAll();
      request.onsuccess = () => {
        const now = Date.now();
        let retainedBytes = bytes;
        let retainedCount = files.length ? 1 : 0;
        const drafts = (request.result as Draft[])
          .filter((record) => record.key !== key)
          .sort((a, b) => b.updatedAt - a.updatedAt);
        for (const record of drafts) {
          if (
            now - record.updatedAt > FILE_DRAFT_TTL_MS ||
            retainedBytes + record.bytes > CACHE_MAX_BYTES ||
            retainedCount + 1 > 32
          ) {
            store.delete(record.key);
          } else {
            retainedBytes += record.bytes;
            retainedCount++;
          }
        }
        if (files.length)
          store.put({
            key,
            revision,
            files: [...files],
            bytes,
            updatedAt: now,
          } satisfies Draft);
        else store.delete(key);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("draft_storage_write_failed"));
      tx.onabort = () =>
        reject(tx.error ?? new Error("draft_storage_write_failed"));
    });
  } finally {
    db.close();
  }
}

export async function clearFileDraft(
  key: string,
  revision: string,
): Promise<void> {
  const db = await openCache();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const request = store.get(key);
      request.onsuccess = () => {
        if ((request.result as Draft | undefined)?.revision === revision)
          store.delete(key);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("draft_storage_write_failed"));
      tx.onabort = () =>
        reject(tx.error ?? new Error("draft_storage_write_failed"));
    });
  } finally {
    db.close();
  }
}
