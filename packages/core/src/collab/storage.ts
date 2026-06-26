/**
 * SQL storage for Yjs collaborative document state.
 *
 * Uses a framework-level `_collab_docs` table (TEXT columns with base64
 * encoding for binary Yjs state) that works across SQLite and Postgres.
 */

import { getDbExec, isPostgres } from "../db/client.js";
import { ensureTableExists, ensureColumnExists } from "../db/ddl-guard.js";

let _initPromise: Promise<void> | undefined;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const nowDefault = isPostgres() ? "NOW()::text" : "datetime('now')";
      const createSql = `
        CREATE TABLE IF NOT EXISTS _collab_docs (
          doc_id TEXT PRIMARY KEY,
          yjs_state TEXT NOT NULL,
          text_snapshot TEXT NOT NULL DEFAULT '',
          version INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT (${nowDefault})
        )
      `;

      if (isPostgres()) {
        // PG-guard: probe information_schema first (no lock) and only issue
        // DDL when the table/column is actually missing, wrapped in a
        // transaction-scoped lock_timeout so a contended lock fails fast.
        await ensureTableExists("_collab_docs", createSql);
        await ensureColumnExists(
          "_collab_docs",
          "version",
          `ALTER TABLE _collab_docs ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0`,
        );
        return;
      }

      // SQLite (local dev): no ACCESS EXCLUSIVE lock problem — keep existing
      // create-then-additive-alter behaviour.
      await client.execute(createSql);
      try {
        await client.execute(
          `ALTER TABLE _collab_docs ADD COLUMN version INTEGER NOT NULL DEFAULT 0`,
        );
      } catch {
        // Existing deployments already have the column after the first run.
      }
    })().catch((err) => {
      // Retry init on the next call after a failed startup.
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

export interface YDocStateRecord {
  state: Uint8Array;
  version: number;
}

/** Load Yjs state plus optimistic concurrency version. */
export async function loadYDocRecord(
  docId: string,
): Promise<YDocStateRecord | null> {
  await ensureTable();
  const client = getDbExec();
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

/** Load Yjs state as Uint8Array, or null if not found. */
export async function loadYDocState(docId: string): Promise<Uint8Array | null> {
  const record = await loadYDocRecord(docId);
  return record?.state ?? null;
}

/** Save only if the stored row still has the version the caller merged from. */
export async function trySaveYDocState(
  docId: string,
  state: Uint8Array,
  textSnapshot: string,
  expectedVersion: number | null,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const b64 = uint8ArrayToBase64(state);
  const nowExpr = isPostgres() ? "NOW()::text" : "datetime('now')";
  if (expectedVersion === null) {
    const result = await client.execute({
      sql: isPostgres()
        ? `INSERT INTO _collab_docs (doc_id, yjs_state, text_snapshot, version, updated_at) VALUES (?, ?, ?, 0, ${nowExpr}) ON CONFLICT (doc_id) DO NOTHING`
        : `INSERT OR IGNORE INTO _collab_docs (doc_id, yjs_state, text_snapshot, version, updated_at) VALUES (?, ?, ?, 0, ${nowExpr})`,
      args: [docId, b64, textSnapshot],
    });
    return result.rowsAffected > 0;
  }

  const result = await client.execute({
    sql: `UPDATE _collab_docs SET yjs_state = ?, text_snapshot = ?, version = version + 1, updated_at = ${nowExpr} WHERE doc_id = ? AND version = ?`,
    args: [b64, textSnapshot, docId, expectedVersion],
  });
  return result.rowsAffected > 0;
}

/** Save Yjs state (Uint8Array) and a plain-text snapshot. */
export async function saveYDocState(
  docId: string,
  state: Uint8Array,
  textSnapshot: string,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const b64 = uint8ArrayToBase64(state);
  const nowExpr = isPostgres() ? "NOW()::text" : "datetime('now')";
  const updated = await client.execute({
    sql: `UPDATE _collab_docs SET yjs_state = ?, text_snapshot = ?, version = version + 1, updated_at = ${nowExpr} WHERE doc_id = ?`,
    args: [b64, textSnapshot, docId],
  });
  if (updated.rowsAffected > 0) return;

  const inserted = await client.execute({
    sql: isPostgres()
      ? `INSERT INTO _collab_docs (doc_id, yjs_state, text_snapshot, version, updated_at) VALUES (?, ?, ?, 0, ${nowExpr}) ON CONFLICT (doc_id) DO NOTHING`
      : `INSERT OR IGNORE INTO _collab_docs (doc_id, yjs_state, text_snapshot, version, updated_at) VALUES (?, ?, ?, 0, ${nowExpr})`,
    args: [docId, b64, textSnapshot],
  });
  if (inserted.rowsAffected > 0) return;

  await client.execute({
    sql: `UPDATE _collab_docs SET yjs_state = ?, text_snapshot = ?, version = version + 1, updated_at = ${nowExpr} WHERE doc_id = ?`,
    args: [b64, textSnapshot, docId],
  });
}

/** Check if a document has collaborative state. */
export async function hasCollabState(docId: string): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT 1 FROM _collab_docs WHERE doc_id = ?`,
    args: [docId],
  });
  return rows.length > 0;
}

/** Delete collaborative state for a document. */
export async function deleteCollabState(docId: string): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  await client.execute({
    sql: `DELETE FROM _collab_docs WHERE doc_id = ?`,
    args: [docId],
  });
}

// ─── Base64 helpers ──────────────────────────────────────────────────

function uint8ArrayToBase64(arr: Uint8Array): string {
  // Works in both Node.js and edge runtimes
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
