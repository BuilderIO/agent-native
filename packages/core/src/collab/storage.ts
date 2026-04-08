/**
 * SQL storage for Yjs collaborative document state.
 *
 * Uses a framework-level `_collab_docs` table (TEXT columns with base64
 * encoding for binary Yjs state) that works across SQLite and Postgres.
 */

import { getDbExec, isPostgres } from "../db/client.js";

let _initPromise: Promise<void> | undefined;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const nowDefault = isPostgres() ? "NOW()::text" : "datetime('now')";
      await client.execute(`
        CREATE TABLE IF NOT EXISTS _collab_docs (
          doc_id TEXT PRIMARY KEY,
          yjs_state TEXT NOT NULL,
          text_snapshot TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL DEFAULT (${nowDefault})
        )
      `);
    })();
  }
  return _initPromise;
}

/** Load Yjs state as Uint8Array, or null if not found. */
export async function loadYDocState(docId: string): Promise<Uint8Array | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT yjs_state FROM _collab_docs WHERE doc_id = ?`,
    args: [docId],
  });
  if (rows.length === 0) return null;
  return base64ToUint8Array(rows[0].yjs_state as string);
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
  await client.execute({
    sql: isPostgres()
      ? `INSERT INTO _collab_docs (doc_id, yjs_state, text_snapshot, updated_at) VALUES (?, ?, ?, ${nowExpr}) ON CONFLICT (doc_id) DO UPDATE SET yjs_state = EXCLUDED.yjs_state, text_snapshot = EXCLUDED.text_snapshot, updated_at = EXCLUDED.updated_at`
      : `INSERT OR REPLACE INTO _collab_docs (doc_id, yjs_state, text_snapshot, updated_at) VALUES (?, ?, ?, ${nowExpr})`,
    args: [docId, b64, textSnapshot],
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
