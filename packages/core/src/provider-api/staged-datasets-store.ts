/**
 * Scratch storage for staged provider-API datasets.
 *
 * Rows are stored as JSON text — no dialect-specific JSON-column types needed.
 * Aggregation is done in TypeScript server-side (portable across Postgres and
 * SQLite) rather than via JSON SQL fragments. See `staged-datasets-aggregate.ts`.
 *
 * Storage caps:
 *   - MAX_ROWS_PER_APP: 200 000 rows
 *   - MAX_BYTES_PER_APP: 50 MB (approximate, measured as raw JSON text length)
 *
 * Scoping: datasets are owned by (app_id, owner_email) so different apps or
 * different users never share or cross-read each other's scratch data.
 */

import { getDbExec, intType, isPostgres, type DbExec } from "../db/client.js";
import { ensureTableExists, ensureIndexExists } from "../db/ddl-guard.js";

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------
export const MAX_ROWS_PER_APP = 200_000;
export const MAX_BYTES_PER_APP = 50 * 1024 * 1024; // 50 MB

// ---------------------------------------------------------------------------
// Table initialisation
// ---------------------------------------------------------------------------

let _initPromise: Promise<void> | undefined;

async function ensureTables(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const db = getDbExec();
      const integerType = intType();
      const createDatasetsSql = `
        CREATE TABLE IF NOT EXISTS staged_datasets (
          id TEXT NOT NULL,
          app_id TEXT NOT NULL,
          owner_email TEXT NOT NULL,
          name TEXT NOT NULL,
          columns TEXT NOT NULL,
          row_count ${integerType} NOT NULL DEFAULT 0,
          byte_size ${integerType} NOT NULL DEFAULT 0,
          created_at ${integerType} NOT NULL,
          updated_at ${integerType} NOT NULL,
          PRIMARY KEY (id)
        )
      `;
      const createRowsSql = `
        CREATE TABLE IF NOT EXISTS staged_dataset_rows (
          dataset_id TEXT NOT NULL,
          row_index ${integerType} NOT NULL,
          row_data TEXT NOT NULL,
          PRIMARY KEY (dataset_id, row_index)
        )
      `;
      if (isPostgres()) {
        // PG guard: probe via information_schema, only issue DDL if missing, bounded lock_timeout
        await ensureTableExists("staged_datasets", createDatasetsSql);
        await ensureTableExists("staged_dataset_rows", createRowsSql);
        await widenPostgresIntegerColumns(db); // best-effort type widening — unchanged
        await ensureIndexExists(
          "staged_datasets_scope_idx",
          `CREATE INDEX IF NOT EXISTS staged_datasets_scope_idx ON staged_datasets (app_id, owner_email)`,
        );
        await ensureIndexExists(
          "staged_dataset_rows_dataset_idx",
          `CREATE INDEX IF NOT EXISTS staged_dataset_rows_dataset_idx ON staged_dataset_rows (dataset_id)`,
        );
        return;
      }
      // SQLite (local dev): keep existing behavior
      await db.execute(createDatasetsSql);
      await db.execute(createRowsSql);
      // Note: widenPostgresIntegerColumns is Postgres-only, skip on SQLite
      for (const ddl of [
        `CREATE INDEX IF NOT EXISTS staged_datasets_scope_idx ON staged_datasets (app_id, owner_email)`,
        `CREATE INDEX IF NOT EXISTS staged_dataset_rows_dataset_idx ON staged_dataset_rows (dataset_id)`,
      ]) {
        try {
          await db.execute(ddl);
        } catch {
          // Index already exists — harmless.
        }
      }
    })().catch((err) => {
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

async function widenPostgresIntegerColumns(db: DbExec): Promise<void> {
  const statements = [
    `ALTER TABLE staged_datasets ALTER COLUMN row_count TYPE BIGINT USING row_count::bigint`,
    `ALTER TABLE staged_datasets ALTER COLUMN byte_size TYPE BIGINT USING byte_size::bigint`,
    `ALTER TABLE staged_datasets ALTER COLUMN created_at TYPE BIGINT USING created_at::bigint`,
    `ALTER TABLE staged_datasets ALTER COLUMN updated_at TYPE BIGINT USING updated_at::bigint`,
    `ALTER TABLE staged_dataset_rows ALTER COLUMN row_index TYPE BIGINT USING row_index::bigint`,
  ];
  for (const sql of statements) {
    try {
      await db.execute(sql);
    } catch {
      // Best-effort compatibility for older deployments. Widening is
      // non-destructive; if a database role cannot ALTER, the later write will
      // still surface the real DB error.
    }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StagedDatasetMeta {
  id: string;
  appId: string;
  ownerEmail: string;
  name: string;
  columns: string[];
  rowCount: number;
  byteSize: number;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertDatasetOptions {
  id: string;
  appId: string;
  ownerEmail: string;
  name: string;
  /** All rows to store; replaces any existing rows. */
  rows: Record<string, unknown>[];
  columns: string[];
  /** When true, append rows instead of replacing. */
  append?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `ds_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Derive column names from a set of rows (first 20 rows surveyed). */
export function deriveColumns(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows.slice(0, 20)) {
    for (const key of Object.keys(row)) seen.add(key);
  }
  return Array.from(seen);
}

// ---------------------------------------------------------------------------
// Scope check
// ---------------------------------------------------------------------------

async function getAppRowCount(appId: string): Promise<number> {
  const db = getDbExec();
  const { rows } = await db.execute({
    sql: `SELECT COALESCE(SUM(row_count), 0) as total FROM staged_datasets WHERE app_id = ?`,
    args: [appId],
  });
  return Number(rows[0]?.total ?? 0);
}

async function getAppByteSize(appId: string): Promise<number> {
  const db = getDbExec();
  const { rows } = await db.execute({
    sql: `SELECT COALESCE(SUM(byte_size), 0) as total FROM staged_datasets WHERE app_id = ?`,
    args: [appId],
  });
  return Number(rows[0]?.total ?? 0);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Create or replace a staged dataset.  Returns metadata including the
 * resolved dataset ID (generated when not supplied in options).
 */
export async function upsertStagedDataset(
  options: UpsertDatasetOptions,
): Promise<StagedDatasetMeta> {
  await ensureTables();
  const db = getDbExec();
  const now = Date.now();
  const id = options.id || generateId();

  // If appending, load existing rows first.
  let existingRows: Record<string, unknown>[] = [];
  if (options.append) {
    existingRows = await getStagedDatasetRows({
      id,
      appId: options.appId,
      ownerEmail: options.ownerEmail,
    });
  }

  const allRows = options.append
    ? [...existingRows, ...options.rows]
    : options.rows;

  // Check caps (net new count after this write).
  const currentAppRows = await getAppRowCount(options.appId);
  const currentDatasetRows = options.append
    ? existingRows.length
    : await (async () => {
        const { rows } = await db.execute({
          sql: `SELECT row_count FROM staged_datasets WHERE id = ?`,
          args: [id],
        });
        return Number(rows[0]?.row_count ?? 0);
      })();
  const netNewRows = allRows.length - currentDatasetRows;
  if (currentAppRows + netNewRows > MAX_ROWS_PER_APP) {
    throw new Error(
      `Staged dataset cap exceeded: this app already has ${currentAppRows} rows stored ` +
        `(limit ${MAX_ROWS_PER_APP}). Delete older datasets before staging more data.`,
    );
  }

  // Serialize rows and measure byte size.
  const serialized = allRows.map((row) => JSON.stringify(row));
  const byteSize = serialized.reduce((sum, s) => sum + s.length, 0);

  const currentAppBytes = await getAppByteSize(options.appId);
  const existingDatasetBytes = options.append
    ? await (async () => {
        const { rows } = await db.execute({
          sql: `SELECT byte_size FROM staged_datasets WHERE id = ?`,
          args: [id],
        });
        return Number(rows[0]?.byte_size ?? 0);
      })()
    : 0;
  const netNewBytes = byteSize - existingDatasetBytes;
  if (currentAppBytes + netNewBytes > MAX_BYTES_PER_APP) {
    throw new Error(
      `Staged dataset byte cap exceeded: this app already stores ` +
        `${(currentAppBytes / 1024 / 1024).toFixed(1)} MB (limit 50 MB). ` +
        `Delete older datasets before staging more data.`,
    );
  }

  const columns = options.columns.length
    ? options.columns
    : deriveColumns(allRows);
  const columnsJson = JSON.stringify(columns);

  await withDbTransaction(db, async (tx) => {
    // Delete old rows and insert the replacement row set atomically with the
    // metadata update so a failed batch cannot leave an empty or partial dataset.
    await tx.execute({
      sql: `DELETE FROM staged_dataset_rows WHERE dataset_id = ?`,
      args: [id],
    });

    const BATCH = 500;
    for (let i = 0; i < serialized.length; i += BATCH) {
      const slice = serialized.slice(i, i + BATCH);
      for (let j = 0; j < slice.length; j++) {
        await tx.execute({
          sql: `INSERT INTO staged_dataset_rows (dataset_id, row_index, row_data) VALUES (?, ?, ?)`,
          args: [id, i + j, slice[j]],
        });
      }
    }

    await tx.execute({
      sql: isPostgres()
        ? `INSERT INTO staged_datasets (id, app_id, owner_email, name, columns, row_count, byte_size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, columns=EXCLUDED.columns, row_count=EXCLUDED.row_count, byte_size=EXCLUDED.byte_size, updated_at=EXCLUDED.updated_at`
        : `INSERT OR REPLACE INTO staged_datasets (id, app_id, owner_email, name, columns, row_count, byte_size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        options.appId,
        options.ownerEmail,
        options.name,
        columnsJson,
        allRows.length,
        byteSize,
        now,
        now,
      ],
    });
  });

  return {
    id,
    appId: options.appId,
    ownerEmail: options.ownerEmail,
    name: options.name,
    columns,
    rowCount: allRows.length,
    byteSize,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Fetch all rows for a dataset, asserting scope (appId + ownerEmail).
 */
export async function getStagedDatasetRows(options: {
  id: string;
  appId: string;
  ownerEmail: string;
}): Promise<Record<string, unknown>[]> {
  await ensureTables();
  const db = getDbExec();
  // Scope check
  const { rows: meta } = await db.execute({
    sql: `SELECT id FROM staged_datasets WHERE id = ? AND app_id = ? AND owner_email = ?`,
    args: [options.id, options.appId, options.ownerEmail],
  });
  if (meta.length === 0) return [];

  const { rows } = await db.execute({
    sql: `SELECT row_data FROM staged_dataset_rows WHERE dataset_id = ? ORDER BY row_index ASC`,
    args: [options.id],
  });
  return rows.map(
    (r) => JSON.parse(r.row_data as string) as Record<string, unknown>,
  );
}

/**
 * Get dataset metadata (no rows), asserting scope.
 */
export async function getStagedDatasetMeta(options: {
  id: string;
  appId: string;
  ownerEmail: string;
}): Promise<StagedDatasetMeta | null> {
  await ensureTables();
  const db = getDbExec();
  const { rows } = await db.execute({
    sql: `SELECT id, app_id, owner_email, name, columns, row_count, byte_size, created_at, updated_at FROM staged_datasets WHERE id = ? AND app_id = ? AND owner_email = ?`,
    args: [options.id, options.appId, options.ownerEmail],
  });
  if (rows.length === 0) return null;
  return rowToMeta(rows[0]);
}

/**
 * List all datasets scoped to (appId, ownerEmail), newest first.
 */
export async function listStagedDatasets(options: {
  appId: string;
  ownerEmail: string;
}): Promise<StagedDatasetMeta[]> {
  await ensureTables();
  const db = getDbExec();
  const { rows } = await db.execute({
    sql: `SELECT id, app_id, owner_email, name, columns, row_count, byte_size, created_at, updated_at FROM staged_datasets WHERE app_id = ? AND owner_email = ? ORDER BY updated_at DESC`,
    args: [options.appId, options.ownerEmail],
  });
  return rows.map(rowToMeta);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteStagedDataset(options: {
  id: string;
  appId: string;
  ownerEmail: string;
}): Promise<boolean> {
  await ensureTables();
  const db = getDbExec();
  // Scope check
  const { rows: meta } = await db.execute({
    sql: `SELECT id FROM staged_datasets WHERE id = ? AND app_id = ? AND owner_email = ?`,
    args: [options.id, options.appId, options.ownerEmail],
  });
  if (meta.length === 0) return false;

  const result = await withDbTransaction(db, async (tx) => {
    await tx.execute({
      sql: `DELETE FROM staged_dataset_rows WHERE dataset_id = ?`,
      args: [options.id],
    });
    return tx.execute({
      sql: `DELETE FROM staged_datasets WHERE id = ? AND app_id = ? AND owner_email = ?`,
      args: [options.id, options.appId, options.ownerEmail],
    });
  });
  return result.rowsAffected > 0;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function rowToMeta(row: Record<string, unknown>): StagedDatasetMeta {
  return {
    id: row.id as string,
    appId: row.app_id as string,
    ownerEmail: row.owner_email as string,
    name: row.name as string,
    columns: JSON.parse(row.columns as string) as string[],
    rowCount: Number(row.row_count),
    byteSize: Number(row.byte_size),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

async function withDbTransaction<T>(
  db: DbExec,
  fn: (tx: DbExec) => Promise<T>,
): Promise<T> {
  if (db.transaction) return db.transaction(fn);

  await db.execute("BEGIN");
  try {
    const result = await fn(db);
    await db.execute("COMMIT");
    return result;
  } catch (err) {
    await db.execute("ROLLBACK").catch(() => {});
    throw err;
  }
}

/** Reset the init promise (only used in tests). */
export function _resetInitPromiseForTests(): void {
  _initPromise = undefined;
}
