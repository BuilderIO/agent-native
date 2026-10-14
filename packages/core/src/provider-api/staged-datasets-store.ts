import { createHash } from "node:crypto";

import { getDbExec, type DbExec } from "../db/client.js";
import { ensureTableExists, ensureIndexExists } from "../db/ddl-guard.js";
import { retainRequestDbPoolScope } from "../db/request-pool-context.js";

export const MAX_ROWS_PER_APP = 200_000;
export const MAX_BYTES_PER_APP = 50 * 1024 * 1024;
export const STAGED_DATASET_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const INSERT_BATCH_ROWS = 500;
const INSERT_BATCH_BYTES = 1024 * 1024;

let _initPromise: Promise<void> | undefined;

export async function ensureTables(): Promise<void> {
  if (!_initPromise) {
    const _initPromiseWithRequestDbPoolScope = (async () => {
      const db = getDbExec();
      const integerType = "BIGINT";
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
      await ensureTableExists("staged_datasets", createDatasetsSql);
      await ensureTableExists("staged_dataset_rows", createRowsSql);
      await widenPostgresIntegerColumns(db);
      await ensureIndexExists(
        "staged_datasets_scope_idx",
        `CREATE INDEX IF NOT EXISTS staged_datasets_scope_idx ON staged_datasets (app_id, owner_email)`,
      );
      await ensureIndexExists(
        "staged_dataset_rows_dataset_idx",
        `CREATE INDEX IF NOT EXISTS staged_dataset_rows_dataset_idx ON staged_dataset_rows (dataset_id)`,
      );
    })().catch((err) => {
      _initPromise = undefined;
      throw err;
    });
    _initPromise = retainRequestDbPoolScope(_initPromiseWithRequestDbPoolScope);
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

/**
 * What readers compare to tell that a dataset was replaced mid-read. The write
 * time alone could repeat if an id is deleted and recreated within one
 * millisecond, so the shape of the data is part of the token.
 */
export function stagedDatasetVersion(
  meta: Pick<StagedDatasetMeta, "updatedAt" | "rowCount" | "byteSize">,
): string {
  return `${meta.updatedAt}.${meta.rowCount}.${meta.byteSize}`;
}

export interface UpsertDatasetOptions {
  id: string;
  appId: string;
  ownerEmail: string;
  name: string;
  rows: Record<string, unknown>[];
  columns: string[];
  append?: boolean;
  /**
   * An older id for the same app, owner, and name. A dataset still stored
   * under it is removed in the same transaction, so a re-stage replaces it
   * instead of leaving a second copy that counts against the app's cap.
   */
  supersedes?: string;
}

function generateId(): string {
  return `ds_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The id a named staging request writes to. Readable prefix plus a hash of the
 * unsanitized app, owner, and name: sanitizing and truncating alone let
 * `a.b@x.com` and `a_b@x.com`, or two long names with a shared prefix, land on
 * one id, where the second writer was refused or silently replaced the first.
 */
export function stagedDatasetId(scope: {
  appId: string;
  ownerEmail: string;
  name: string;
}): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([scope.appId, scope.ownerEmail, scope.name]))
    .digest("hex")
    .slice(0, 16);
  const label = scope.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
  return `ds_${label}_${digest}`;
}

/** The id `stageAs` requests used before ids carried a hash. */
export function legacyStagedDatasetId(scope: {
  appId: string;
  ownerEmail: string;
  name: string;
}): string {
  return `ds_${scope.appId}_${scope.ownerEmail}_${scope.name}`
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);
}

// The caps are app-wide, so one writer per app plans, evicts, and writes at a
// time, and an explicit delete takes the same lock so it cannot land between a
// writer's eviction plan and its deletes.
async function lockStagedDatasetApp(tx: DbExec, appId: string): Promise<void> {
  await tx.execute({
    sql: `SELECT pg_advisory_xact_lock(hashtext(?))`,
    args: [`staged-datasets:${appId}`],
  });
}

export function deriveColumns(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows.slice(0, 20)) {
    for (const key of Object.keys(row)) seen.add(key);
  }
  return Array.from(seen);
}

export interface StagedDatasetEvictionCandidate {
  id: string;
  owner_email: string;
  byte_size: number;
  row_count: number;
  updated_at: number;
}

/**
 * Picks which datasets of an app to drop so a write fits. Datasets older than
 * `staleBefore` always go (any owner); then the writer's own datasets, then
 * other owners', least recently written first, until both caps hold. `fits` is
 * false when dropping every candidate still leaves the write over a cap, in
 * which case callers must evict nothing.
 */
export function selectStagedDatasetsToEvict(options: {
  candidates: StagedDatasetEvictionCandidate[];
  ownerEmail: string;
  projectedBytes: number;
  projectedRows: number;
  staleBefore?: number;
  maxBytes?: number;
  maxRows?: number;
}): { evictIds: string[]; fits: boolean } {
  const maxBytes = options.maxBytes ?? MAX_BYTES_PER_APP;
  const maxRows = options.maxRows ?? MAX_ROWS_PER_APP;
  const staleBefore = options.staleBefore ?? 0;
  const rank = (c: StagedDatasetEvictionCandidate) =>
    c.updated_at < staleBefore
      ? 0
      : c.owner_email === options.ownerEmail
        ? 1
        : 2;
  let bytes = options.projectedBytes;
  let rows = options.projectedRows;
  const evictIds: string[] = [];
  const ordered = [...options.candidates].sort(
    (a, b) => rank(a) - rank(b) || a.updated_at - b.updated_at,
  );
  for (const candidate of ordered) {
    const stale = rank(candidate) === 0;
    if (!stale && bytes <= maxBytes && rows <= maxRows) break;
    evictIds.push(candidate.id);
    bytes -= candidate.byte_size;
    rows -= candidate.row_count;
  }
  return { evictIds, fits: bytes <= maxBytes && rows <= maxRows };
}

function prepareDatasetRows(
  rows: Record<string, unknown>[],
  columns: string[],
) {
  const serialized = rows.map((row) => JSON.stringify(row));
  return {
    rows,
    serialized,
    byteSize: serialized.reduce((sum, s) => sum + s.length, 0),
    columns: columns.length ? columns : deriveColumns(rows),
  };
}

export async function upsertStagedDataset(
  options: UpsertDatasetOptions,
): Promise<StagedDatasetMeta> {
  await ensureTables();
  const db = getDbExec();
  const now = Date.now();
  const id = options.id || generateId();

  // An append builds on the rows stored at the moment it holds the app lock, so
  // it is prepared inside the transaction below; anything else is prepared here
  // to keep the lock short.
  const upfront = options.append
    ? null
    : prepareDatasetRows(options.rows, options.columns);

  const { updatedAt, prepared } = await withDbTransaction(db, async (tx) => {
    // Totals, eviction and the write all happen under this lock in this
    // transaction: nothing is planned against a stale snapshot, and a failure
    // rolls the evictions back with the write.
    await lockStagedDatasetApp(tx, options.appId);
    // A caller-chosen or legacy id can still name another owner's dataset, and
    // the id-keyed write below would replace its rows in place.
    const { rows: idOwner } = await tx.execute({
      sql: `SELECT app_id, owner_email, updated_at FROM staged_datasets WHERE id = ?`,
      args: [id],
    });
    if (
      idOwner[0] &&
      (idOwner[0].app_id !== options.appId ||
        idOwner[0].owner_email !== options.ownerEmail)
    ) {
      throw new Error(
        `Staged dataset id ${id} belongs to another owner. Use a different name.`,
      );
    }
    let prepared = upfront;
    if (!prepared) {
      // The owner check above passed, so a stored dataset under this id is
      // this writer's.
      const existing = idOwner[0]
        ? (
            await tx.execute({
              sql: `SELECT row_data FROM staged_dataset_rows WHERE dataset_id = ? ORDER BY row_index ASC`,
              args: [id],
            })
          ).rows.map(
            (r) => JSON.parse(r.row_data as string) as Record<string, unknown>,
          )
        : [];
      prepared = prepareDatasetRows(
        [...existing, ...options.rows],
        options.columns,
      );
    }
    const { rows: allRows, serialized, byteSize } = prepared;
    // Readers verify a dataset did not change mid-read by comparing this value,
    // so a replacement has to move it even inside the same millisecond or on a
    // clock behind the previous writer's.
    const writtenAt = Math.max(now, Number(idOwner[0]?.updated_at ?? 0) + 1);
    // Matched on owner and name so a legacy id that truncation shared with
    // another dataset is never removed on this writer's behalf.
    if (options.supersedes && options.supersedes !== id) {
      const { rows: legacy } = await tx.execute({
        sql: `SELECT id FROM staged_datasets WHERE id = ? AND app_id = ? AND owner_email = ? AND name = ?`,
        args: [
          options.supersedes,
          options.appId,
          options.ownerEmail,
          options.name,
        ],
      });
      if (legacy.length > 0) {
        await tx.execute({
          sql: `DELETE FROM staged_dataset_rows WHERE dataset_id = ?`,
          args: [options.supersedes],
        });
        await tx.execute({
          sql: `DELETE FROM staged_datasets WHERE id = ? AND app_id = ?`,
          args: [options.supersedes, options.appId],
        });
      }
    }
    const { rows: others } = await tx.execute({
      sql: `SELECT COALESCE(SUM(row_count), 0) AS total_rows, COALESCE(SUM(byte_size), 0) AS total_bytes FROM staged_datasets WHERE app_id = ? AND id <> ?`,
      args: [options.appId, id],
    });
    const projectedRows = Number(others[0]?.total_rows ?? 0) + allRows.length;
    const projectedBytes = Number(others[0]?.total_bytes ?? 0) + byteSize;

    if (
      projectedRows > MAX_ROWS_PER_APP ||
      projectedBytes > MAX_BYTES_PER_APP
    ) {
      const { rows: peers } = await tx.execute({
        sql: `SELECT id, owner_email, byte_size, row_count, updated_at FROM staged_datasets WHERE app_id = ? AND id <> ?`,
        args: [options.appId, id],
      });
      const { evictIds, fits } = selectStagedDatasetsToEvict({
        candidates: peers.map((r) => ({
          id: r.id as string,
          owner_email: r.owner_email as string,
          byte_size: Number(r.byte_size),
          row_count: Number(r.row_count),
          updated_at: Number(r.updated_at),
        })),
        ownerEmail: options.ownerEmail,
        projectedBytes,
        projectedRows,
        staleBefore: now - STAGED_DATASET_MAX_AGE_MS,
      });
      if (!fits) {
        throw new Error(
          allRows.length > MAX_ROWS_PER_APP
            ? `Staged dataset cap exceeded: this dataset alone has ${allRows.length} rows ` +
                `(limit ${MAX_ROWS_PER_APP} per app, shared by all datasets). Stage fewer rows.`
            : `Staged dataset byte cap exceeded: this dataset alone is ` +
                `${(byteSize / 1024 / 1024).toFixed(1)} MB ` +
                `(limit ${MAX_BYTES_PER_APP / 1024 / 1024} MB per app, shared by all datasets). ` +
                `Stage fewer rows or columns.`,
        );
      }
      for (const victimId of evictIds) {
        await tx.execute({
          sql: `DELETE FROM staged_dataset_rows WHERE dataset_id = ?`,
          args: [victimId],
        });
        await tx.execute({
          sql: `DELETE FROM staged_datasets WHERE id = ? AND app_id = ?`,
          args: [victimId, options.appId],
        });
      }
    }

    await tx.execute({
      sql: `DELETE FROM staged_dataset_rows WHERE dataset_id = ?`,
      args: [id],
    });

    // The app lock is held across these inserts, so they go in multi-row
    // statements: one round trip per batch, not per row, keeps a large stage
    // from holding every same-app stage and delete for minutes.
    for (let start = 0; start < serialized.length; ) {
      let end = start;
      let bytes = 0;
      while (
        end < serialized.length &&
        end - start < INSERT_BATCH_ROWS &&
        (end === start || bytes + serialized[end]!.length <= INSERT_BATCH_BYTES)
      ) {
        bytes += serialized[end]!.length;
        end += 1;
      }
      const slice = serialized.slice(start, end);
      await tx.execute({
        sql: `INSERT INTO staged_dataset_rows (dataset_id, row_index, row_data) VALUES ${slice
          .map(() => "(?, ?, ?)")
          .join(", ")}`,
        args: slice.flatMap((data, offset) => [id, start + offset, data]),
      });
      start = end;
    }

    await tx.execute({
      sql: `INSERT INTO staged_datasets (id, app_id, owner_email, name, columns, row_count, byte_size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, columns=EXCLUDED.columns, row_count=EXCLUDED.row_count, byte_size=EXCLUDED.byte_size, updated_at=EXCLUDED.updated_at`,
      args: [
        id,
        options.appId,
        options.ownerEmail,
        options.name,
        JSON.stringify(prepared.columns),
        allRows.length,
        byteSize,
        now,
        writtenAt,
      ],
    });
    return { updatedAt: writtenAt, prepared };
  });

  return {
    id,
    appId: options.appId,
    ownerEmail: options.ownerEmail,
    name: options.name,
    columns: prepared.columns,
    rowCount: prepared.rows.length,
    byteSize: prepared.byteSize,
    createdAt: now,
    updatedAt,
  };
}

export async function getStagedDatasetRows(options: {
  id: string;
  appId: string;
  ownerEmail: string;
}): Promise<Record<string, unknown>[]> {
  await ensureTables();
  const db = getDbExec();
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

export async function deleteStagedDataset(options: {
  id: string;
  appId: string;
  ownerEmail: string;
}): Promise<boolean> {
  await ensureTables();
  const db = getDbExec();
  return withDbTransaction(db, async (tx) => {
    await lockStagedDatasetApp(tx, options.appId);
    const removed = await tx.execute({
      sql: `DELETE FROM staged_datasets WHERE id = ? AND app_id = ? AND owner_email = ?`,
      args: [options.id, options.appId, options.ownerEmail],
    });
    if (removed.rowsAffected === 0) return false;
    await tx.execute({
      sql: `DELETE FROM staged_dataset_rows WHERE dataset_id = ?`,
      args: [options.id],
    });
    return true;
  });
}

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

export function _resetInitPromiseForTests(): void {
  _initPromise = undefined;
}
