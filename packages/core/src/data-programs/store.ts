/**
 * Store for the data-programs primitive: CRUD on the `dataPrograms` ownable
 * resource (via Drizzle) plus a raw-DDL run-result cache
 * (`data_program_runs`) mirroring `../provider-api/staged-datasets-store.ts`.
 *
 * Follows the boot-DDL pattern from `../extensions/store.ts`: a memoized
 * init promise, Postgres probe-then-guarded-DDL via `ensureTableExists` /
 * `ensureIndexExists`, and a plain create-then-catch on SQLite.
 */

import { randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { getDbExec, intType, isPostgres } from "../db/client.js";
import { createGetDb } from "../db/create-get-db.js";
import {
  ensureTableExists,
  ensureIndexExists,
  ensureColumnExists,
} from "../db/ddl-guard.js";
import { accessFilter, type AccessContext } from "../sharing/access.js";
import { registerShareableResource } from "../sharing/registry.js";
import {
  dataPrograms,
  dataProgramShares,
  DATA_PROGRAMS_CREATE_SQL,
  DATA_PROGRAMS_CREATE_SQL_PG,
  DATA_PROGRAM_SHARES_CREATE_SQL,
  DATA_PROGRAM_SHARES_CREATE_SQL_PG,
  DATA_PROGRAMS_APP_OWNER_INDEX_SQL,
  DATA_PROGRAMS_APP_NAME_INDEX_SQL,
  DATA_PROGRAM_SHARES_RESOURCE_INDEX_SQL,
  dataProgramRunsCreateSql,
  DATA_PROGRAM_RUNS_TRUNCATED_COLUMN_SQL,
  DATA_PROGRAM_RUNS_LOOKUP_INDEX_SQL,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

export const MAX_PROGRAM_ROWS = 10_000;
export const MAX_PROGRAM_RESULT_BYTES = 4 * 1024 * 1024;
export const MAX_ACTIVE_PROGRAMS_PER_APP = 200;
export const MIN_REFRESH_TTL_MS = 60_000;

/** How many run rows to retain per (programId, paramsHash) after each write. */
const DEFAULT_RUN_KEEP = 5;

const getDb = createGetDb({ dataPrograms, dataProgramShares });

// ---------------------------------------------------------------------------
// Boot DDL
// ---------------------------------------------------------------------------

let _initPromise: Promise<void> | undefined;

function isDuplicateColumnError(err: unknown): boolean {
  const code = String((err as { code?: unknown })?.code ?? "");
  const message = String((err as { message?: unknown })?.message ?? err)
    .toLowerCase()
    .trim();
  return (
    code === "42701" ||
    message.includes("duplicate column") ||
    message.includes("already exists")
  );
}

async function ensureSqliteDataProgramRunsColumns(): Promise<void> {
  const client = getDbExec();
  try {
    await client.execute(
      `ALTER TABLE data_program_runs ADD COLUMN truncated INTEGER NOT NULL DEFAULT 0`,
    );
  } catch (err) {
    if (!isDuplicateColumnError(err)) throw err;
  }
}

export async function ensureDataProgramTables(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const pg = isPostgres();
      const integerType = intType();
      const runsCreateSql = dataProgramRunsCreateSql(integerType);

      if (pg) {
        // PG guard: probe via information_schema, only issue DDL if missing,
        // bounded lock_timeout — see ../db/ddl-guard.js.
        await ensureTableExists("data_programs", DATA_PROGRAMS_CREATE_SQL_PG);
        await ensureTableExists(
          "data_program_shares",
          DATA_PROGRAM_SHARES_CREATE_SQL_PG,
        );
        await ensureTableExists("data_program_runs", runsCreateSql);
        await ensureColumnExists(
          "data_program_runs",
          "truncated",
          DATA_PROGRAM_RUNS_TRUNCATED_COLUMN_SQL,
        );
        await ensureIndexExists(
          "data_programs_app_owner_idx",
          DATA_PROGRAMS_APP_OWNER_INDEX_SQL,
        );
        await ensureIndexExists(
          "data_programs_app_name_idx",
          DATA_PROGRAMS_APP_NAME_INDEX_SQL,
        );
        await ensureIndexExists(
          "data_program_shares_resource_idx",
          DATA_PROGRAM_SHARES_RESOURCE_INDEX_SQL,
        );
        await ensureIndexExists(
          "data_program_runs_lookup_idx",
          DATA_PROGRAM_RUNS_LOOKUP_INDEX_SQL,
        );
        return;
      }

      // SQLite (local dev): plain create-then-catch, matching staged-datasets-store.ts.
      await client.execute(DATA_PROGRAMS_CREATE_SQL);
      await client.execute(DATA_PROGRAM_SHARES_CREATE_SQL);
      await client.execute(runsCreateSql);
      await ensureSqliteDataProgramRunsColumns();
      for (const ddl of [
        DATA_PROGRAMS_APP_OWNER_INDEX_SQL,
        DATA_PROGRAMS_APP_NAME_INDEX_SQL,
        DATA_PROGRAM_SHARES_RESOURCE_INDEX_SQL,
        DATA_PROGRAM_RUNS_LOOKUP_INDEX_SQL,
      ]) {
        try {
          await client.execute(ddl);
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

export function registerDataProgramsShareable(): void {
  registerShareableResource({
    type: "data_program",
    resourceTable: dataPrograms,
    sharesTable: dataProgramShares,
    displayName: "Data program",
    titleColumn: "title",
    getDb: () => getDb(),
    // MANDATORY security invariant: a data program executes its author's
    // stored code with the VIEWER's credentials (providerFetch resolves the
    // caller's own auth). A public program would let any authenticated user
    // run arbitrary stored code under their own token — same threat model as
    // extensions (../extensions/store.ts registerExtensionsShareable).
    allowPublic: false,
    requireOrgMemberForUserShares: true,
  });
}

/** Test-only: reset the memoized init promise. */
export function _resetDataProgramInitPromiseForTests(): void {
  _initPromise = undefined;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DataProgramRefreshMode = "manual" | "ttl";

export interface DataProgramRow {
  id: string;
  appId: string;
  name: string;
  title: string;
  description: string;
  code: string;
  paramsSchema: string | null;
  defaultParams: string | null;
  outputColumns: string | null;
  refreshMode: DataProgramRefreshMode;
  refreshTtlMs: number;
  background: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org" | "public";
}

interface RawDataProgramRow {
  id: string;
  appId: string;
  name: string;
  title: string;
  description: string;
  code: string;
  paramsSchema: string | null;
  defaultParams: string | null;
  outputColumns: string | null;
  refreshMode: string;
  refreshTtlMs: number;
  background: number | boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  ownerEmail: string;
  orgId: string | null;
  visibility: string;
}

function normalizeRefreshMode(value: string): DataProgramRefreshMode {
  return value === "manual" ? "manual" : "ttl";
}

function rowFromRaw(row: RawDataProgramRow): DataProgramRow {
  return {
    id: row.id,
    appId: row.appId,
    name: row.name,
    title: row.title,
    description: row.description ?? "",
    code: row.code,
    paramsSchema: row.paramsSchema ?? null,
    defaultParams: row.defaultParams ?? null,
    outputColumns: row.outputColumns ?? null,
    refreshMode: normalizeRefreshMode(row.refreshMode),
    refreshTtlMs: Number(row.refreshTtlMs) || 300_000,
    background: Boolean(row.background),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt ?? null,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId ?? null,
    visibility:
      row.visibility === "org" || row.visibility === "public"
        ? row.visibility
        : "private",
  };
}

export interface UpsertDataProgramInput {
  id?: string;
  appId: string;
  name: string;
  title: string;
  description?: string;
  code: string;
  paramsSchema?: string | null;
  defaultParams?: string | null;
  outputColumns?: string | null;
  refreshMode?: DataProgramRefreshMode;
  refreshTtlMs?: number;
  background?: boolean;
  ownerEmail: string;
  orgId?: string | null;
}

function generateProgramId(): string {
  return `dp_${randomUUID().replace(/-/g, "")}`;
}

/**
 * Create or update a data program. When `id` is omitted, checks for an
 * existing program with the same (appId, ownerEmail, name) slug and updates
 * it in place (upsert-by-slug); otherwise creates a new row. Enforces
 * MAX_ACTIVE_PROGRAMS_PER_APP on create.
 */
export async function upsertDataProgram(
  input: UpsertDataProgramInput,
): Promise<DataProgramRow> {
  await ensureDataProgramTables();
  const db = getDb();
  const now = new Date().toISOString();

  const existing = input.id
    ? await getDataProgram(input.id)
    : await getDataProgramByName(input.appId, input.name, input.ownerEmail);

  const refreshTtlMs = Math.max(
    input.refreshTtlMs ?? existing?.refreshTtlMs ?? 300_000,
    MIN_REFRESH_TTL_MS,
  );
  const refreshMode = input.refreshMode ?? existing?.refreshMode ?? "ttl";

  if (existing) {
    await db
      .update(dataPrograms)
      .set({
        title: input.title,
        description: input.description ?? existing.description,
        code: input.code,
        paramsSchema: input.paramsSchema ?? null,
        defaultParams: input.defaultParams ?? null,
        outputColumns: input.outputColumns ?? existing.outputColumns,
        refreshMode,
        refreshTtlMs,
        background: input.background ? 1 : 0,
        updatedAt: now,
        archivedAt: null,
      })
      .where(eq(dataPrograms.id, existing.id));
    const row = await getDataProgram(existing.id);
    if (!row) throw new Error("data program disappeared during update");
    return row;
  }

  const activeCount = await countActiveDataPrograms(input.appId);
  if (activeCount >= MAX_ACTIVE_PROGRAMS_PER_APP) {
    throw new Error(
      `This app already has ${activeCount} active data programs (limit ${MAX_ACTIVE_PROGRAMS_PER_APP}). ` +
        `Archive unused programs before creating more.`,
    );
  }

  const id = input.id || generateProgramId();
  await db.insert(dataPrograms).values({
    id,
    appId: input.appId,
    name: input.name,
    title: input.title,
    description: input.description ?? "",
    code: input.code,
    paramsSchema: input.paramsSchema ?? null,
    defaultParams: input.defaultParams ?? null,
    outputColumns: input.outputColumns ?? null,
    refreshMode,
    refreshTtlMs,
    background: input.background ? 1 : 0,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ownerEmail: input.ownerEmail,
    orgId: input.orgId ?? null,
    visibility: "private",
  });
  const row = await getDataProgram(id);
  if (!row) throw new Error("data program failed to persist");
  return row;
}

async function countActiveDataPrograms(appId: string): Promise<number> {
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT COUNT(*) as total FROM data_programs WHERE app_id = ? AND archived_at IS NULL`,
    args: [appId],
  });
  return Number((rows[0] as any)?.total ?? 0);
}

/**
 * Look up a program by id. Pass `appId` to scope the lookup to the calling
 * app — in a shared-database multi-app deployment, a program created in one
 * app must not be readable/runnable from another app's agent chat just
 * because the caller otherwise has row-level (owner/org/share) access to it.
 * `appId` is optional only because a handful of internal call sites
 * (`upsertDataProgram`'s existing-row lookup, tests) look up a program they
 * already know is scoped correctly by construction.
 */
export async function getDataProgram(
  id: string,
  appId?: string,
): Promise<DataProgramRow | null> {
  await ensureDataProgramTables();
  const db = getDb();
  const where = appId
    ? and(eq(dataPrograms.id, id), eq(dataPrograms.appId, appId))
    : eq(dataPrograms.id, id);
  const rows = await db.select().from(dataPrograms).where(where);
  const row = rows[0] as RawDataProgramRow | undefined;
  return row ? rowFromRaw(row) : null;
}

export async function getDataProgramByName(
  appId: string,
  name: string,
  ownerEmail: string,
): Promise<DataProgramRow | null> {
  await ensureDataProgramTables();
  const db = getDb();
  const rows = await db
    .select()
    .from(dataPrograms)
    .where(
      and(
        eq(dataPrograms.appId, appId),
        eq(dataPrograms.name, name),
        eq(dataPrograms.ownerEmail, ownerEmail),
      ),
    );
  const row = rows[0] as RawDataProgramRow | undefined;
  return row ? rowFromRaw(row) : null;
}

export interface ListDataProgramsOptions {
  includeArchived?: boolean;
}

/** List programs scoped to `appId`, filtered through the sharing access rules. */
export async function listDataPrograms(
  appId: string,
  ctx: AccessContext,
  options: ListDataProgramsOptions = {},
): Promise<DataProgramRow[]> {
  await ensureDataProgramTables();
  const db = getDb();
  const base = accessFilter(dataPrograms, dataProgramShares, ctx);
  const where = options.includeArchived
    ? and(eq(dataPrograms.appId, appId), base)
    : and(eq(dataPrograms.appId, appId), base, isNull(dataPrograms.archivedAt));
  const rows = (await db
    .select()
    .from(dataPrograms)
    .where(where)) as RawDataProgramRow[];
  return rows.map(rowFromRaw);
}

/** Soft-archive: sets `archivedAt`. NEVER hard-deletes — panels/history may still reference the id. */
export async function archiveDataProgram(
  id: string,
  appId?: string,
): Promise<boolean> {
  await ensureDataProgramTables();
  const db = getDb();
  const existing = await getDataProgram(id, appId);
  if (!existing) return false;
  const where = appId
    ? and(eq(dataPrograms.id, id), eq(dataPrograms.appId, appId))
    : eq(dataPrograms.id, id);
  const now = new Date().toISOString();
  await db
    .update(dataPrograms)
    .set({
      archivedAt: now,
      updatedAt: now,
    })
    .where(where);
  return true;
}

// ---------------------------------------------------------------------------
// Run cache
// ---------------------------------------------------------------------------

export type DataProgramRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out";

export interface DataProgramRunRow {
  id: string;
  programId: string;
  paramsHash: string;
  paramsJson: string;
  status: DataProgramRunStatus;
  rowsJson: string | null;
  schemaJson: string | null;
  truncated: boolean;
  rowCount: number;
  byteSize: number;
  errorCode: string | null;
  errorMessage: string | null;
  logsTail: string | null;
  executionId: string | null;
  triggeredBy: string;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
}

export interface RecordDataProgramRunInput {
  programId: string;
  paramsHash: string;
  paramsJson: string;
  status: DataProgramRunStatus;
  rowsJson?: string | null;
  schemaJson?: string | null;
  truncated?: boolean;
  rowCount?: number;
  byteSize?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  logsTail?: string | null;
  executionId?: string | null;
  triggeredBy: string;
  startedAt?: number;
  finishedAt?: number | null;
  durationMs?: number | null;
  /** How many run rows to keep per (programId, paramsHash) after this write. */
  keep?: number;
}

function booleanFromDb(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function runRowFromDb(row: Record<string, unknown>): DataProgramRunRow {
  return {
    id: row.id as string,
    programId: row.program_id as string,
    paramsHash: row.params_hash as string,
    paramsJson: row.params_json as string,
    status: row.status as DataProgramRunStatus,
    rowsJson: (row.rows_json as string | null) ?? null,
    schemaJson: (row.schema_json as string | null) ?? null,
    truncated: booleanFromDb(row.truncated),
    rowCount: Number(row.row_count ?? 0),
    byteSize: Number(row.byte_size ?? 0),
    errorCode: (row.error_code as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    logsTail: (row.logs_tail as string | null) ?? null,
    executionId: (row.execution_id as string | null) ?? null,
    triggeredBy: row.triggered_by as string,
    startedAt: Number(row.started_at ?? 0),
    finishedAt:
      row.finished_at === null || row.finished_at === undefined
        ? null
        : Number(row.finished_at),
    durationMs:
      row.duration_ms === null || row.duration_ms === undefined
        ? null
        : Number(row.duration_ms),
  };
}

function generateRunId(): string {
  return `dpr_${randomUUID().replace(/-/g, "")}`;
}

/** Insert a new run row (typically `status: "running"` or `"queued"` first, finalized via `updateDataProgramRun`). */
export async function recordDataProgramRun(
  input: RecordDataProgramRunInput,
): Promise<DataProgramRunRow> {
  await ensureDataProgramTables();
  const client = getDbExec();
  const id = generateRunId();
  const startedAt = input.startedAt ?? Date.now();
  await client.execute({
    sql: `INSERT INTO data_program_runs (
      id, program_id, params_hash, params_json, status, rows_json, schema_json,
      truncated, row_count, byte_size, error_code, error_message, logs_tail,
      execution_id, triggered_by, started_at, finished_at, duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.programId,
      input.paramsHash,
      input.paramsJson,
      input.status,
      input.rowsJson ?? null,
      input.schemaJson ?? null,
      input.truncated ? 1 : 0,
      input.rowCount ?? 0,
      input.byteSize ?? 0,
      input.errorCode ?? null,
      input.errorMessage ?? null,
      input.logsTail ?? null,
      input.executionId ?? null,
      input.triggeredBy,
      startedAt,
      input.finishedAt ?? null,
      input.durationMs ?? null,
    ],
  });
  await pruneDataProgramRuns(
    input.programId,
    input.paramsHash,
    input.keep ?? DEFAULT_RUN_KEEP,
  );
  return {
    id,
    programId: input.programId,
    paramsHash: input.paramsHash,
    paramsJson: input.paramsJson,
    status: input.status,
    rowsJson: input.rowsJson ?? null,
    schemaJson: input.schemaJson ?? null,
    truncated: Boolean(input.truncated),
    rowCount: input.rowCount ?? 0,
    byteSize: input.byteSize ?? 0,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
    logsTail: input.logsTail ?? null,
    executionId: input.executionId ?? null,
    triggeredBy: input.triggeredBy,
    startedAt,
    finishedAt: input.finishedAt ?? null,
    durationMs: input.durationMs ?? null,
  };
}

export interface UpdateDataProgramRunInput {
  status?: DataProgramRunStatus;
  rowsJson?: string | null;
  schemaJson?: string | null;
  truncated?: boolean;
  rowCount?: number;
  byteSize?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  logsTail?: string | null;
  executionId?: string | null;
  finishedAt?: number | null;
  durationMs?: number | null;
  /** How many run rows to keep per (programId, paramsHash) after this write. */
  keep?: number;
}

/** Finalize an existing run row (e.g. a background execution completing). */
export async function updateDataProgramRun(
  runId: string,
  updates: UpdateDataProgramRunInput,
): Promise<void> {
  await ensureDataProgramTables();
  const client = getDbExec();
  const sets: string[] = [];
  const args: unknown[] = [];
  const push = (col: string, value: unknown) => {
    sets.push(`${col} = ?`);
    args.push(value);
  };
  if (updates.status !== undefined) push("status", updates.status);
  if (updates.rowsJson !== undefined) push("rows_json", updates.rowsJson);
  if (updates.schemaJson !== undefined) push("schema_json", updates.schemaJson);
  if (updates.truncated !== undefined)
    push("truncated", updates.truncated ? 1 : 0);
  if (updates.rowCount !== undefined) push("row_count", updates.rowCount);
  if (updates.byteSize !== undefined) push("byte_size", updates.byteSize);
  if (updates.errorCode !== undefined) push("error_code", updates.errorCode);
  if (updates.errorMessage !== undefined)
    push("error_message", updates.errorMessage);
  if (updates.logsTail !== undefined) push("logs_tail", updates.logsTail);
  if (updates.executionId !== undefined)
    push("execution_id", updates.executionId);
  if (updates.finishedAt !== undefined) push("finished_at", updates.finishedAt);
  if (updates.durationMs !== undefined) push("duration_ms", updates.durationMs);
  if (sets.length === 0) return;

  args.push(runId);
  await client.execute({
    sql: `UPDATE data_program_runs SET ${sets.join(", ")} WHERE id = ?`,
    args,
  });

  // Look up (programId, paramsHash) to prune — cheap point read.
  const { rows } = await client.execute({
    sql: `SELECT program_id, params_hash FROM data_program_runs WHERE id = ?`,
    args: [runId],
  });
  const row = rows[0] as
    | { program_id?: string; params_hash?: string }
    | undefined;
  if (row?.program_id && row?.params_hash) {
    await pruneDataProgramRuns(
      row.program_id,
      row.params_hash,
      updates.keep ?? DEFAULT_RUN_KEEP,
    );
  }
}

export async function getLatestSuccessfulRun(
  programId: string,
  paramsHash: string,
): Promise<DataProgramRunRow | null> {
  await ensureDataProgramTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM data_program_runs
      WHERE program_id = ? AND params_hash = ? AND status = 'succeeded'
      ORDER BY COALESCE(finished_at, started_at) DESC
      LIMIT 1`,
    args: [programId, paramsHash],
  });
  const row = rows[0] as Record<string, unknown> | undefined;
  return row ? runRowFromDb(row) : null;
}

export async function getLatestRun(
  programId: string,
  paramsHash: string,
): Promise<DataProgramRunRow | null> {
  await ensureDataProgramTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM data_program_runs
      WHERE program_id = ? AND params_hash = ?
      ORDER BY COALESCE(finished_at, started_at) DESC
      LIMIT 1`,
    args: [programId, paramsHash],
  });
  const row = rows[0] as Record<string, unknown> | undefined;
  return row ? runRowFromDb(row) : null;
}

/**
 * Return the latest queued/running run row for (programId, paramsHash), if
 * any, so callers can dedupe concurrent executions instead of racing.
 */
export async function getActiveRun(
  programId: string,
  paramsHash: string,
): Promise<DataProgramRunRow | null> {
  await ensureDataProgramTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM data_program_runs
      WHERE program_id = ? AND params_hash = ? AND status IN ('queued', 'running')
      ORDER BY started_at DESC
      LIMIT 1`,
    args: [programId, paramsHash],
  });
  const row = rows[0] as Record<string, unknown> | undefined;
  return row ? runRowFromDb(row) : null;
}

/**
 * Delete all but the `keep` most-recent run rows for (programId, paramsHash).
 * Called on every write (prune-on-write, no sweep job). Fetches all ids
 * ordered newest-first and slices in TypeScript rather than `LIMIT ... OFFSET`
 * so the query stays byte-identical across SQLite and Postgres (SQLite's
 * `LIMIT -1 OFFSET n` idiom has no direct Postgres equivalent).
 */
export async function pruneDataProgramRuns(
  programId: string,
  paramsHash: string,
  keep = DEFAULT_RUN_KEEP,
): Promise<void> {
  await ensureDataProgramTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id FROM data_program_runs
      WHERE program_id = ? AND params_hash = ?
      ORDER BY COALESCE(finished_at, started_at) DESC`,
    args: [programId, paramsHash],
  });
  const staleIds = (rows as Array<{ id: string }>).slice(keep).map((r) => r.id);
  if (staleIds.length === 0) return;

  for (const id of staleIds) {
    await client.execute({
      sql: `DELETE FROM data_program_runs WHERE id = ?`,
      args: [id],
    });
  }
}
