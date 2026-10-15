import { getDbExec, type DbExec } from "../db/client.js";
import { ensureTableExists, ensureIndexExists } from "../db/ddl-guard.js";
import { retainRequestDbPoolScope } from "../db/request-pool-context.js";

export const MAX_ROWS_PER_APP = 200_000;
export const MAX_BYTES_PER_APP = 50 * 1024 * 1024;

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

async function getAppRowCount(
  db: DbExec,
  appId: string,
  ownerEmail: string,
  excludingDatasetId: string,
): Promise<number> {
  const { rows } = await db.execute({
    sql: `SELECT COALESCE(SUM(row_count), 0) as total FROM staged_datasets WHERE app_id = ? AND owner_email = ? AND id <> ?`,
    args: [appId, ownerEmail, excludingDatasetId],
  });
  return Number(rows[0]?.total ?? 0);
}

async function getAppByteSize(
  db: DbExec,
  appId: string,
  ownerEmail: string,
  excludingDatasetId: string,
): Promise<number> {
  // Existing byte_size values may predate UTF-8 accounting, so count persisted bytes.
  const { rows } = await db.execute({
    sql: `SELECT COALESCE(SUM(OCTET_LENGTH(r.row_data)), 0) as total FROM staged_dataset_rows r INNER JOIN staged_datasets d ON d.id = r.dataset_id WHERE d.app_id = ? AND d.owner_email = ? AND d.id <> ?`,
    args: [appId, ownerEmail, excludingDatasetId],
  });
  return Number(rows[0]?.total ?? 0);
}

export async function upsertStagedDataset(
  options: UpsertDatasetOptions,
): Promise<StagedDatasetMeta> {
  await ensureTables();
  const db = getDbExec();
  const now = Date.now();
  const id = options.id || generateId();
  const { allRows, columns, byteSize } = await withDbTransaction(
    db,
    async (tx) => {
      await tx.execute({
        sql: `SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))`,
        args: [
          JSON.stringify([
            "agent-native:staged-dataset-quota",
            options.appId,
            options.ownerEmail,
          ]),
        ],
      });

      const { rows: existingDataset } = await tx.execute({
        sql: `SELECT app_id, owner_email FROM staged_datasets WHERE id = ?`,
        args: [id],
      });
      const previous = existingDataset[0];
      if (
        previous &&
        (previous.app_id !== options.appId ||
          previous.owner_email !== options.ownerEmail)
      ) {
        throw new Error("A staged dataset with this ID already exists.");
      }

      const existingRows =
        options.append && previous ? await readStagedDatasetRows(tx, id) : [];
      const allRows = options.append
        ? [...existingRows, ...options.rows]
        : options.rows;
      const serialized = allRows.map((row) => JSON.stringify(row));
      const byteSize = serialized.reduce(
        (sum, value) => sum + Buffer.byteLength(value, "utf8"),
        0,
      );

      const currentAppRows = await getAppRowCount(
        tx,
        options.appId,
        options.ownerEmail,
        id,
      );
      const totalAppRows = currentAppRows + allRows.length;
      if (totalAppRows > MAX_ROWS_PER_APP) {
        throw new Error(
          `Staged dataset cap exceeded: this app would have ${totalAppRows} rows stored ` +
            `(limit ${MAX_ROWS_PER_APP}). Delete older datasets before staging more data.`,
        );
      }

      const currentAppBytes = await getAppByteSize(
        tx,
        options.appId,
        options.ownerEmail,
        id,
      );
      const totalAppBytes = currentAppBytes + byteSize;
      if (totalAppBytes > MAX_BYTES_PER_APP) {
        throw new Error(
          `Staged dataset byte cap exceeded: this app would store ` +
            `${(totalAppBytes / 1024 / 1024).toFixed(1)} MB (limit 50 MB). ` +
            `Delete older datasets before staging more data.`,
        );
      }

      const columns = options.columns.length
        ? options.columns
        : deriveColumns(allRows);
      const columnsJson = JSON.stringify(columns);

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

      const result = await tx.execute({
        sql: `INSERT INTO staged_datasets (id, app_id, owner_email, name, columns, row_count, byte_size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, columns=EXCLUDED.columns, row_count=EXCLUDED.row_count, byte_size=EXCLUDED.byte_size, updated_at=EXCLUDED.updated_at WHERE staged_datasets.app_id = EXCLUDED.app_id AND staged_datasets.owner_email = EXCLUDED.owner_email`,
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
      if (result.rowsAffected === 0) {
        throw new Error("A staged dataset with this ID already exists.");
      }
      return { allRows, columns, byteSize };
    },
  );

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

  return readStagedDatasetRows(db, options.id);
}

async function readStagedDatasetRows(
  db: DbExec,
  datasetId: string,
): Promise<Record<string, unknown>[]> {
  const { rows } = await db.execute({
    sql: `SELECT row_data FROM staged_dataset_rows WHERE dataset_id = ? ORDER BY row_index ASC`,
    args: [datasetId],
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
