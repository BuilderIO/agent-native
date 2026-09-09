import { getDbExec, type DbExec } from "../db/client.js";

export interface CollabLifecyclePolicy {
  table: string;
  idColumn: string;
  deletedAtColumn: string;
  resolveSourceId?: (docId: string) => string | null | Promise<string | null>;
}

export class CollabDocumentLifecycleError extends Error {
  readonly code: "DOCUMENT_TRASHED" | "DOCUMENT_NOT_FOUND";
  readonly errorCode: "DOCUMENT_TRASHED" | "DOCUMENT_NOT_FOUND";
  readonly statusCode: number;
  readonly data: { errorCode: string };

  constructor(trashed: boolean) {
    super(trashed ? "Document is in Trash." : "Document not found.");
    this.name = "CollabDocumentLifecycleError";
    this.code = this.errorCode = trashed
      ? "DOCUMENT_TRASHED"
      : "DOCUMENT_NOT_FOUND";
    this.statusCode = trashed ? 409 : 404;
    this.data = { errorCode: this.errorCode };
  }
}

let lifecyclePolicy: CollabLifecyclePolicy | undefined;

function identifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid collaboration lifecycle SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

/** Register the source lifecycle for this process's shared collab store. */
export function registerCollabLifecycle(
  policy: CollabLifecyclePolicy,
): () => void {
  identifier(policy.table);
  identifier(policy.idColumn);
  identifier(policy.deletedAtColumn);
  if (
    lifecyclePolicy &&
    (lifecyclePolicy.table !== policy.table ||
      lifecyclePolicy.idColumn !== policy.idColumn ||
      lifecyclePolicy.deletedAtColumn !== policy.deletedAtColumn ||
      lifecyclePolicy.resolveSourceId !== policy.resolveSourceId)
  ) {
    throw new Error(
      "The collaboration store already has a different lifecycle policy.",
    );
  }
  const registered = { ...policy };
  lifecyclePolicy = registered;
  return () => {
    if (lifecyclePolicy === registered) lifecyclePolicy = undefined;
  };
}

export async function withCollabLifecycleWrite<T>(
  docId: string,
  write: (tx: DbExec) => Promise<T>,
): Promise<T> {
  const client = getDbExec();
  const policy = lifecyclePolicy;
  if (!policy) return write(client);
  const sourceId = policy.resolveSourceId
    ? await policy.resolveSourceId(docId)
    : docId;
  if (!sourceId) throw new CollabDocumentLifecycleError(false);
  if (!client.transaction) {
    throw new Error(
      "Collaboration lifecycle writes require interactive database transactions.",
    );
  }
  return client.transaction(async (tx) => {
    const table = identifier(policy.table);
    const id = identifier(policy.idColumn);
    const deletedAt = identifier(policy.deletedAtColumn);
    // The source lock and collab write must share a transaction so deletion
    // cannot commit between the live check and the durable Yjs update.
    const { rows } = await tx.execute({
      sql: `UPDATE ${table} SET ${id} = ${id} WHERE ${id} = ? RETURNING ${deletedAt} AS deleted_at`,
      args: [sourceId],
    });
    if (rows.length !== 1) throw new CollabDocumentLifecycleError(false);
    if (!("deleted_at" in rows[0]) || rows[0].deleted_at === undefined) {
      throw new Error("Document lifecycle state is unreadable.");
    }
    if (rows[0].deleted_at !== null)
      throw new CollabDocumentLifecycleError(true);
    return write(tx);
  });
}
