import { getDbExec, type DbExec } from "../db/client.js";
import { ensureTableExists, ensureColumnExists } from "../db/ddl-guard.js";
import { defineStore } from "../db/store-registry.js";

export const collabDocsStore = defineStore({
  id: "collab_docs",
  migrations: [
    {
      name: "baseline",
      run: async () => {
        const nowDefault = "NOW()::text";
        const createSql = `
          CREATE TABLE IF NOT EXISTS _collab_docs (
            doc_id TEXT PRIMARY KEY,
            yjs_state TEXT NOT NULL,
            text_snapshot TEXT NOT NULL DEFAULT '',
            version INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT (${nowDefault})
          )
        `;

        await ensureTableExists("_collab_docs", createSql);
        await ensureColumnExists(
          "_collab_docs",
          "version",
          `ALTER TABLE _collab_docs ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0`,
        );
      },
    },
  ],
});

export function ensureTable(): Promise<void> {
  return collabDocsStore.ready();
}

export interface YDocStateRecord {
  state: Uint8Array;
  version: number;
}

export async function loadYDocRecord(
  docId: string,
): Promise<YDocStateRecord | null> {
  await ensureTable();
  return loadYDocRecordWithClient(getDbExec(), docId);
}

export async function loadYDocRecordWithClient(
  client: DbExec,
  docId: string,
): Promise<YDocStateRecord | null> {
  const { rows } = await client.execute({
    sql: `SELECT yjs_state, version FROM _collab_docs WHERE doc_id = ?`,
    args: [docId],
  });
  if (rows.length === 0) return null;
  return {
    state: base64ToUint8Array(rows[0].yjs_state as string),
    version: Number(rows[0].version ?? 0),
  };
}

export type CollabStateMalformedReason = "base64" | "version" | "yjs";

/** A stored `_collab_docs` row that cannot be read. Never treat it as empty. */
export class CollabStateMalformedError extends Error {
  readonly code = "collab_state_malformed";
  readonly docId: string;
  readonly reason: CollabStateMalformedReason;

  constructor(
    docId: string,
    reason: CollabStateMalformedReason,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "CollabStateMalformedError";
    this.docId = docId;
    this.reason = reason;
  }
}

/**
 * Absent means no row. A row whose `yjs_state` is `''` is present with a
 * zero-byte state; callers that seed must update it at its version rather
 * than insert.
 */
export type StrictYDocRecord =
  | { kind: "absent" }
  | { kind: "present"; state: Uint8Array; version: number };

/**
 * Decodes canonical base64, or returns null; `Buffer` silently skips junk.
 * A round trip instead of a pattern: a repeated-group regex overflows the
 * stack on a few megabytes.
 */
export function strictBase64ToUint8Array(value: string): Uint8Array | null {
  let bytes: Uint8Array;
  try {
    bytes = base64ToUint8Array(value);
    // coercion-ok: null is this reader's typed "not base64"; callers raise malformed_state
  } catch {
    return null;
  }
  return uint8ArrayToBase64(bytes) === value ? bytes : null;
}

export async function loadYDocRecordStrict(
  client: DbExec,
  docId: string,
  options: { forUpdate?: boolean } = {},
): Promise<StrictYDocRecord> {
  const { rows } = await client.execute({
    sql: `SELECT yjs_state, version FROM _collab_docs WHERE doc_id = ?${options.forUpdate ? " FOR UPDATE" : ""}`,
    args: [docId],
  });
  if (rows.length === 0) return { kind: "absent" };
  const stored = rows[0].yjs_state;
  if (typeof stored !== "string") {
    throw new CollabStateMalformedError(
      docId,
      "base64",
      `_collab_docs.yjs_state for ${docId} is not text`,
    );
  }
  const state = strictBase64ToUint8Array(stored);
  if (!state) {
    throw new CollabStateMalformedError(
      docId,
      "base64",
      `_collab_docs.yjs_state for ${docId} is not valid base64`,
    );
  }
  const version = Number(rows[0].version);
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new CollabStateMalformedError(
      docId,
      "version",
      `_collab_docs.version for ${docId} is unreadable: ${String(rows[0].version)}`,
    );
  }
  return { kind: "present", state, version };
}

export async function loadYDocVersion(docId: string): Promise<number | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT version FROM _collab_docs WHERE doc_id = ?`,
    args: [docId],
  });
  if (rows.length === 0) return null;
  const version = Number(rows[0].version);
  if (!Number.isFinite(version)) {
    throw new Error(
      `_collab_docs.version for ${docId} is unreadable: ${String(rows[0].version)}`,
    );
  }
  return version;
}

/**
 * A row's version and a SHA-256 of its stored text. A version alone repeats:
 * a row deleted and inserted again starts back at 0.
 */
export interface YDocStamp {
  version: number;
  digest: string;
}

const STATE_DIGEST_SQL = `encode(sha256(convert_to(yjs_state, 'UTF8')), 'hex')`;

export async function loadYDocStamp(docId: string): Promise<YDocStamp | null> {
  await ensureTable();
  return loadYDocStampWithClient(getDbExec(), docId);
}

export async function loadYDocStampWithClient(
  client: DbExec,
  docId: string,
  options: { forShare?: boolean } = {},
): Promise<YDocStamp | null> {
  const { rows } = await client.execute({
    sql: `SELECT version, ${STATE_DIGEST_SQL} AS digest FROM _collab_docs WHERE doc_id = ?${options.forShare ? " FOR SHARE" : ""}`,
    args: [docId],
  });
  if (rows.length === 0) return null;
  const version = Number(rows[0].version);
  const digest = rows[0].digest;
  if (!Number.isFinite(version) || typeof digest !== "string") {
    throw new Error(
      `_collab_docs row for ${docId} is unreadable: version ${String(rows[0].version)}`,
    );
  }
  return { version, digest };
}

/** The digest `loadYDocStamp` reports for a row this module wrote `state` to. */
export async function collabStateDigest(state: Uint8Array): Promise<string> {
  const text = new TextEncoder().encode(uint8ArrayToBase64(state));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", text);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function loadYDocState(docId: string): Promise<Uint8Array | null> {
  const record = await loadYDocRecord(docId);
  return record?.state ?? null;
}

export async function trySaveYDocState(
  docId: string,
  state: Uint8Array,
  textSnapshot: string,
  expectedVersion: number | null,
): Promise<boolean> {
  await ensureTable();
  return trySaveYDocStateWithClient(
    getDbExec(),
    docId,
    state,
    textSnapshot,
    expectedVersion,
  );
}

export async function trySaveYDocStateWithClient(
  client: DbExec,
  docId: string,
  state: Uint8Array,
  textSnapshot: string,
  expectedVersion: number | null,
  /** Also requires the stored text to have this digest; see `YDocStamp`. */
  expectedDigest?: string,
): Promise<boolean> {
  const b64 = uint8ArrayToBase64(state);
  const nowExpr = "NOW()::text";
  if (expectedVersion === null) {
    const result = await client.execute({
      sql: `INSERT INTO _collab_docs (doc_id, yjs_state, text_snapshot, version, updated_at) VALUES (?, ?, ?, 0, ${nowExpr}) ON CONFLICT (doc_id) DO NOTHING`,
      args: [docId, b64, textSnapshot],
    });
    return result.rowsAffected > 0;
  }

  const result = await client.execute(
    expectedDigest === undefined
      ? {
          sql: `UPDATE _collab_docs SET yjs_state = ?, text_snapshot = ?, version = version + 1, updated_at = ${nowExpr} WHERE doc_id = ? AND version = ?`,
          args: [b64, textSnapshot, docId, expectedVersion],
        }
      : {
          sql: `UPDATE _collab_docs SET yjs_state = ?, text_snapshot = ?, version = version + 1, updated_at = ${nowExpr} WHERE doc_id = ? AND version = ? AND ${STATE_DIGEST_SQL} = ?`,
          args: [b64, textSnapshot, docId, expectedVersion, expectedDigest],
        },
  );
  return result.rowsAffected > 0;
}

export async function saveYDocState(
  docId: string,
  state: Uint8Array,
  textSnapshot: string,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const b64 = uint8ArrayToBase64(state);
  const nowExpr = "NOW()::text";
  const updated = await client.execute({
    sql: `UPDATE _collab_docs SET yjs_state = ?, text_snapshot = ?, version = version + 1, updated_at = ${nowExpr} WHERE doc_id = ?`,
    args: [b64, textSnapshot, docId],
  });
  if (updated.rowsAffected > 0) return;

  const inserted = await client.execute({
    sql: `INSERT INTO _collab_docs (doc_id, yjs_state, text_snapshot, version, updated_at) VALUES (?, ?, ?, 0, ${nowExpr}) ON CONFLICT (doc_id) DO NOTHING`,
    args: [docId, b64, textSnapshot],
  });
  if (inserted.rowsAffected > 0) return;

  await client.execute({
    sql: `UPDATE _collab_docs SET yjs_state = ?, text_snapshot = ?, version = version + 1, updated_at = ${nowExpr} WHERE doc_id = ?`,
    args: [b64, textSnapshot, docId],
  });
}

export async function hasCollabState(docId: string): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT 1 FROM _collab_docs WHERE doc_id = ? AND yjs_state <> ''`,
    args: [docId],
  });
  return rows.length > 0;
}

export async function deleteCollabState(docId: string): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  await client.execute({
    sql: `DELETE FROM _collab_docs WHERE doc_id = ?`,
    args: [docId],
  });
}

function uint8ArrayToBase64(arr: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(arr).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const binary = atob(b64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    arr[i] = binary.charCodeAt(i);
  }
  return arr;
}

export { uint8ArrayToBase64, base64ToUint8Array };
