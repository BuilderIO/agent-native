import { getDbExec, type DbExec } from "../db/client.js";
import { ensureTableExists, ensureIndexExists } from "../db/ddl-guard.js";
import { retainRequestDbPoolScope } from "../db/request-pool-context.js";

export const MAX_ROWS_PER_APP = 200_000;
export const MAX_BYTES_PER_APP = 50 * 1024 * 1024;
export const STAGED_DATASET_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

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

export interface UpsertDatasetOptions {
  id: string;
  appId: string;
  ownerEmail: string;
  name: string;
  rows: Record<string, unknown>[];
  columns: string[];
  append?: boolean;
}

function generateId(): string {
  return `ds_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function deriveColumns(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows.slice(0, 20)) {
    for (const key of Object.keys(row)) seen.add(key);
  }
  return Array.from(seen);
}

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

async function planStagedDatasetEviction(options: {
  db: DbExec;
  appId: string;
  ownerEmail: string;
  excludeId: string;
  projectedBytes: number;
  projectedRows: number;
  now: number;
}): Promise<{ evict: { id: string; updatedAt: number }[]; fits: boolean }> {
  const { rows } = await options.db.execute({
    sql: `SELECT id, owner_email, byte_size, row_count, updated_at FROM staged_datasets WHERE app_id = ? AND id <> ?`,
    args: [options.appId, options.excludeId],
  });
  const candidates = rows.map((r) => ({
    id: r.id as string,
    owner_email: r.owner_email as string,
    byte_size: Number(r.byte_size),
    row_count: Number(r.row_count),
    updated_at: Number(r.updated_at),
  }));
  const { evictIds, fits } = selectStagedDatasetsToEvict({
    candidates,
    ownerEmail: options.ownerEmail,
    projectedBytes: options.projectedBytes,
    projectedRows: options.projectedRows,
    staleBefore: options.now - STAGED_DATASET_MAX_AGE_MS,
  });
  const updatedAtById = new Map(candidates.map((c) => [c.id, c.updated_at]));
  return {
    fits,
    evict: fits
      ? evictIds.map((id) => ({ id, updatedAt: updatedAtById.get(id) ?? 0 }))
      : [],
  };
}

export async function upsertStagedDataset(
  options: UpsertDatasetOptions,
): Promise<StagedDatasetMeta> {
  await ensureTables();
  const db = getDbExec();
  const now = Date.now();
  const id = options.id || generateId();

  // Ids come from sanitized owner emails, so two owners can share one. The
  // owner-scoped reads below would count the other owner's dataset as absent
  // and the id-keyed write would then replace its rows in place.
  const { rows: idOwner } = await db.execute({
    sql: `SELECT app_id, owner_email FROM staged_datasets WHERE id = ?`,
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

  const serialized = allRows.map((row) => JSON.stringify(row));
  const byteSize = serialized.reduce((sum, s) => sum + s.length, 0);

  const currentAppRows = await getAppRowCount(options.appId);
  const currentDatasetRows = options.append
    ? existingRows.length
    : await (async () => {
        const { rows } = await db.execute({
          sql: `SELECT row_count FROM staged_datasets WHERE id = ? AND app_id = ? AND owner_email = ?`,
          args: [id, options.appId, options.ownerEmail],
        });
        return Number(rows[0]?.row_count ?? 0);
      })();
  const currentAppBytes = await getAppByteSize(options.appId);
  const { rows: existingMeta } = await db.execute({
    sql: `SELECT byte_size FROM staged_datasets WHERE id = ? AND app_id = ? AND owner_email = ?`,
    args: [id, options.appId, options.ownerEmail],
  });
  const existingDatasetBytes = Number(existingMeta[0]?.byte_size ?? 0);
  const projectedRows = currentAppRows + allRows.length - currentDatasetRows;
  const projectedBytes = currentAppBytes + byteSize - existingDatasetBytes;

  let evict: { id: string; updatedAt: number }[] = [];
  if (projectedRows > MAX_ROWS_PER_APP || projectedBytes > MAX_BYTES_PER_APP) {
    const plan = await planStagedDatasetEviction({
      db,
      appId: options.appId,
      ownerEmail: options.ownerEmail,
      excludeId: id,
      projectedBytes,
      projectedRows,
      now,
    });
    if (!plan.fits) {
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
    evict = plan.evict;
  }

  const columns = options.columns.length
    ? options.columns
    : deriveColumns(allRows);
  const columnsJson = JSON.stringify(columns);

  await withDbTransaction(db, async (tx) => {
    // Eviction commits or rolls back with the write it makes room for. Each
    // delete is guarded by the updated_at it was planned against, so a dataset
    // refreshed since the plan was read is left alone.
    for (const victim of evict) {
      await tx.execute({
        sql: `DELETE FROM staged_dataset_rows WHERE dataset_id = ? AND EXISTS (SELECT 1 FROM staged_datasets WHERE id = ? AND app_id = ? AND updated_at = ?)`,
        args: [victim.id, victim.id, options.appId, victim.updatedAt],
      });
      await tx.execute({
        sql: `DELETE FROM staged_datasets WHERE id = ? AND app_id = ? AND updated_at = ?`,
        args: [victim.id, options.appId, victim.updatedAt],
      });
    }
    // The plan was read outside this transaction, so a guarded delete may have
    // skipped a dataset refreshed since, and a concurrent writer may have used
    // the room. Re-check the caps here; throwing rolls the evictions back too.
    if (evict.length > 0) {
      const { rows: totals } = await tx.execute({
        sql: `SELECT COALESCE(SUM(row_count), 0) AS total_rows, COALESCE(SUM(byte_size), 0) AS total_bytes FROM staged_datasets WHERE app_id = ? AND id <> ?`,
        args: [options.appId, id],
      });
      if (
        Number(totals[0]?.total_rows ?? 0) + allRows.length >
          MAX_ROWS_PER_APP ||
        Number(totals[0]?.total_bytes ?? 0) + byteSize > MAX_BYTES_PER_APP
      ) {
        throw new Error(
          "Staged dataset cap exceeded: another write filled this app while older datasets were being evicted. Try again.",
        );
      }
    }
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
      sql: `INSERT INTO staged_datasets (id, app_id, owner_email, name, columns, row_count, byte_size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, columns=EXCLUDED.columns, row_count=EXCLUDED.row_count, byte_size=EXCLUDED.byte_size, updated_at=EXCLUDED.updated_at`,
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
