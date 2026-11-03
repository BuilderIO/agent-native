import type { DiagnosticContextInput } from "@shared/diagnostic-context";

const DB_NAME = "clips-private-diagnostic-outbox";
const STORE = "captures";
const MAX_PENDING = 10;
const MAX_BYTES = 2_000_000;

export interface DiagnosticOutboxOwner {
  ownerEmail: string;
  orgId: string;
}

export interface DiagnosticOutboxEntry extends DiagnosticOutboxOwner {
  id: string;
  payload?: DiagnosticContextInput;
  status: "pending" | "failed" | "cancelled";
  failureCode?: string;
  updatedAt: string;
}

const volatileDrafts = new Map<string, DiagnosticOutboxEntry>();
const draftListeners = new Set<() => void>();

export function subscribeDiagnosticDrafts(listener: () => void): () => void {
  draftListeners.add(listener);
  return () => {
    draftListeners.delete(listener);
  };
}

export function listDiagnosticDrafts(): DiagnosticOutboxEntry[] {
  return [...volatileDrafts.values()];
}

export function discardDiagnosticDraft(id: string): void {
  volatileDrafts.delete(id);
}

export function retainDiagnosticDraft(
  owner: DiagnosticOutboxOwner,
  payload: DiagnosticContextInput,
  stillOwner: () => boolean,
): void {
  if (!stillOwner()) return;
  const id = `${payload.recordingId}:${payload.captureId}:${payload.contextVersion ?? 1}`;
  if (!volatileDrafts.has(id) && volatileDrafts.size >= MAX_PENDING)
    throw new Error("Diagnostic recovery memory is full");
  volatileDrafts.set(id, {
    id,
    ...owner,
    ownerEmail: owner.ownerEmail.toLowerCase(),
    payload: structuredClone(payload),
    status: "failed",
    failureCode: "local_store_failed",
    updatedAt: new Date().toISOString(),
  });
  for (const listener of draftListeners) listener();
}

function sameOwner(
  entry: DiagnosticOutboxOwner,
  owner: DiagnosticOutboxOwner | null,
): boolean {
  return (
    !!owner &&
    entry.ownerEmail === owner.ownerEmail.toLowerCase() &&
    entry.orgId === owner.orgId
  );
}

function openOutbox(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Diagnostic outbox is blocked"));
  });
}

async function updateOutbox<T>(
  run: (entries: DiagnosticOutboxEntry[], store: IDBObjectStore) => T,
): Promise<T> {
  const db = await openOutbox();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const request = store.getAll();
      let result: T;
      let failure: unknown;
      request.onsuccess = () => {
        try {
          result = run(request.result, store);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(failure ?? tx.error);
      tx.onabort = () =>
        reject(failure ?? tx.error ?? new Error("Diagnostic outbox aborted"));
    });
  } finally {
    db.close();
  }
}

export async function listDiagnosticOutbox(): Promise<DiagnosticOutboxEntry[]> {
  return updateOutbox((entries) => entries);
}

export async function enqueueDiagnosticContext(
  owner: DiagnosticOutboxOwner,
  payload: DiagnosticContextInput,
  stillOwner: () => boolean,
): Promise<DiagnosticOutboxEntry> {
  if (!owner.ownerEmail.trim() || !owner.orgId.trim())
    throw new Error("Diagnostic capture requires an owner and organization");
  const frozen = structuredClone(payload);
  const bytes = new TextEncoder().encode(JSON.stringify(frozen)).byteLength;
  if (bytes > MAX_BYTES)
    throw new Error("Diagnostic outbox payload exceeds its limit");
  const id = `${payload.recordingId}:${payload.captureId}:${payload.contextVersion ?? 1}`;
  return updateOutbox((entries, store) => {
    if (!stillOwner())
      throw new Error("Diagnostic payload belongs to another session");
    const prior = entries.find((entry) => entry.id === id);
    if (prior) {
      if (
        !sameOwner(prior, owner) ||
        JSON.stringify(prior.payload) !== JSON.stringify(frozen)
      ) {
        throw new Error(
          "Diagnostic capture identity already has different content",
        );
      }
      return prior;
    }
    if (entries.filter((entry) => entry.payload).length >= MAX_PENDING)
      throw new Error("Diagnostic outbox is full");
    const entry: DiagnosticOutboxEntry = {
      id,
      ownerEmail: owner.ownerEmail.toLowerCase(),
      orgId: owner.orgId,
      payload: frozen,
      status: "pending",
      updatedAt: new Date().toISOString(),
    };
    store.put(entry);
    const cancelled = entries
      .filter((entry) => entry.status === "cancelled")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const stale of cancelled.slice(50)) store.delete(stale.id);
    return entry;
  });
}

export async function cancelOtherDiagnosticOwners(
  owner: DiagnosticOutboxOwner | null,
): Promise<void> {
  for (const [id, draft] of volatileDrafts) {
    if (!sameOwner(draft, owner)) volatileDrafts.delete(id);
  }
  await updateOutbox((entries, store) => {
    for (const entry of entries) {
      if (entry.payload && !sameOwner(entry, owner)) {
        const { payload: _payload, ...metadata } = entry;
        store.put({
          ...metadata,
          status: "cancelled",
          failureCode: "signed_out",
          updatedAt: new Date().toISOString(),
        });
      }
    }
  });
}

export async function retryDiagnosticContext(
  id: string,
  owner: DiagnosticOutboxOwner,
  save: (payload: DiagnosticContextInput) => Promise<unknown>,
  stillOwner: () => boolean,
): Promise<void> {
  const entry = (await listDiagnosticOutbox()).find(
    (candidate) => candidate.id === id,
  );
  if (!entry?.payload) throw new Error("Diagnostic payload is unavailable");
  if (!sameOwner(entry, owner) || !stillOwner())
    throw new Error("Diagnostic payload belongs to another session");
  try {
    await save(entry.payload);
    await updateOutbox((_entries, store) => store.delete(id));
  } catch (error) {
    if (stillOwner()) {
      await updateOutbox((entries, store) => {
        const current = entries.find((candidate) => candidate.id === id);
        if (current?.payload && sameOwner(current, owner))
          store.put({
            ...current,
            status: "failed",
            failureCode: "save_failed",
            updatedAt: new Date().toISOString(),
          });
      });
    }
    throw error;
  }
}
