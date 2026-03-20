import type {
  FileSyncAdapter,
  FileRecord,
  FileChange,
  Unsubscribe,
} from "../sync/types.js";

// ---------------------------------------------------------------------------
// Minimal Firestore interfaces (avoids hard firebase-admin dependency)
// ---------------------------------------------------------------------------

export interface FirestoreCollection {
  doc(id: string): FirestoreDocRef;
  where(field: string, op: string, value: any): FirestoreQuery;
}

export interface FirestoreDocRef {
  get(): Promise<FirestoreDocSnapshot>;
  set(data: any, options?: { merge?: boolean }): Promise<any>;
  delete(): Promise<any>;
  collection(name: string): FirestoreCollection;
}

export interface FirestoreQuery {
  where(field: string, op: string, value: any): FirestoreQuery;
  get(): Promise<FirestoreQuerySnapshot>;
  onSnapshot(
    onNext: (snapshot: FirestoreQuerySnapshot) => void,
    onError: (error: unknown) => void,
  ): () => void;
}

export interface FirestoreDocSnapshot {
  exists: boolean;
  id: string;
  data(): any;
}

export interface FirestoreQuerySnapshot {
  docs: FirestoreDocSnapshot[];
  size: number;
  docChanges(): Array<{
    type: "added" | "modified" | "removed";
    doc: FirestoreDocSnapshot;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Firestore doc IDs cannot contain `/` (it's a path separator).
// Encode `/` as `%2F` for storage, decode on retrieval.
function encodeDocId(id: string): string {
  return id.replace(/\//g, "%2F");
}

function decodeDocId(id: string): string {
  return id.replace(/%2F/g, "/");
}

// ---------------------------------------------------------------------------
// Firestore adapter
// ---------------------------------------------------------------------------

export class FirestoreFileSyncAdapter implements FileSyncAdapter {
  constructor(private getCollection: () => FirestoreCollection) {}

  async query(
    appId: string,
    ownerId: string,
  ): Promise<{ id: string; data: FileRecord }[]> {
    const snapshot = await this.getCollection()
      .where("app", "==", appId)
      .where("ownerId", "==", ownerId)
      .get();

    return snapshot.docs.map((doc) => ({
      id: decodeDocId(doc.id),
      data: doc.data() as FileRecord,
    }));
  }

  async get(id: string): Promise<{ id: string; data: FileRecord } | null> {
    const doc = await this.getCollection().doc(encodeDocId(id)).get();
    if (!doc.exists) return null;
    return { id: decodeDocId(doc.id), data: doc.data() as FileRecord };
  }

  async set(id: string, record: Partial<FileRecord>): Promise<void> {
    await this.getCollection().doc(encodeDocId(id)).set(record, { merge: true });
  }

  async delete(id: string): Promise<void> {
    await this.getCollection().doc(encodeDocId(id)).delete();
  }

  subscribe(
    appId: string,
    ownerId: string,
    onChange: (changes: FileChange[]) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe {
    return this.getCollection()
      .where("app", "==", appId)
      .where("ownerId", "==", ownerId)
      .onSnapshot((snapshot) => {
        const changes: FileChange[] = snapshot.docChanges().map((change) => ({
          type: change.type,
          id: decodeDocId(change.doc.id),
          data: change.doc.data() as FileRecord,
        }));
        onChange(changes);
      }, onError);
  }

  async dispose(): Promise<void> {
    // No persistent connections to clean up in the duck-typed interface.
    // Real Firebase apps should call app.delete() separately.
  }
}
