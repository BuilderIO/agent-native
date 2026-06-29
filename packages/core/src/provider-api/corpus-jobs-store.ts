/**
 * Durable state for provider corpus jobs.
 *
 * Jobs are scoped by (app_id, owner_email), matching staged datasets. The
 * runner stores only request configuration, checkpoints, and compact search
 * hits so large provider corpora never enter chat context or filesystem
 * scratch files.
 */

import { getDbExec, intType, isPostgres, type DbExec } from "../db/client.js";
import { ensureTableExists, ensureIndexExists } from "../db/ddl-guard.js";

export type ProviderCorpusJobStatus =
  | "running"
  | "paused"
  | "quota_wait"
  | "completed"
  | "failed";

export interface ProviderCorpusJobRecord {
  id: string;
  appId: string;
  ownerEmail: string;
  name: string;
  mode: string;
  status: ProviderCorpusJobStatus;
  provider: string;
  request: Record<string, unknown>;
  pagination: Record<string, unknown> | null;
  batch: Record<string, unknown> | null;
  search: Record<string, unknown>;
  limits: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
  pagesProcessed: number;
  batchesProcessed: number;
  itemsProcessed: number;
  matchedItems: number;
  totalHits: number;
  storedHits: number;
  error: string | null;
  nextResumeAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateProviderCorpusJobOptions {
  id: string;
  appId: string;
  ownerEmail: string;
  name: string;
  mode: string;
  status: ProviderCorpusJobStatus;
  provider: string;
  request: Record<string, unknown>;
  pagination?: Record<string, unknown> | null;
  batch?: Record<string, unknown> | null;
  search: Record<string, unknown>;
  limits: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
}

export interface UpdateProviderCorpusJobOptions {
  id: string;
  appId: string;
  ownerEmail: string;
  status?: ProviderCorpusJobStatus;
  checkpoint?: Record<string, unknown>;
  pagesProcessed?: number;
  batchesProcessed?: number;
  itemsProcessed?: number;
  matchedItems?: number;
  totalHits?: number;
  storedHits?: number;
  error?: string | null;
  nextResumeAt?: number | null;
}

let initPromise: Promise<void> | undefined;

async function ensureTables(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const db = getDbExec();
      const integerType = intType();
      const createJobsSql = `
        CREATE TABLE IF NOT EXISTS provider_corpus_jobs (
          id TEXT NOT NULL,
          app_id TEXT NOT NULL,
          owner_email TEXT NOT NULL,
          name TEXT NOT NULL,
          mode TEXT NOT NULL,
          status TEXT NOT NULL,
          provider TEXT NOT NULL,
          request_json TEXT NOT NULL,
          pagination_json TEXT,
          batch_json TEXT,
          search_json TEXT NOT NULL,
          limits_json TEXT NOT NULL,
          checkpoint_json TEXT NOT NULL,
          pages_processed ${integerType} NOT NULL DEFAULT 0,
          batches_processed ${integerType} NOT NULL DEFAULT 0,
          items_processed ${integerType} NOT NULL DEFAULT 0,
          matched_items ${integerType} NOT NULL DEFAULT 0,
          total_hits ${integerType} NOT NULL DEFAULT 0,
          stored_hits ${integerType} NOT NULL DEFAULT 0,
          error TEXT,
          next_resume_at ${integerType},
          created_at ${integerType} NOT NULL,
          updated_at ${integerType} NOT NULL,
          PRIMARY KEY (id)
        )
      `;
      const createHitsSql = `
        CREATE TABLE IF NOT EXISTS provider_corpus_job_hits (
          job_id TEXT NOT NULL,
          hit_index ${integerType} NOT NULL,
          hit_data TEXT NOT NULL,
          PRIMARY KEY (job_id, hit_index)
        )
      `;
      if (isPostgres()) {
        // PG guard: probe via information_schema, only issue DDL if missing, bounded lock_timeout
        await ensureTableExists("provider_corpus_jobs", createJobsSql);
        await ensureTableExists("provider_corpus_job_hits", createHitsSql);
        await widenPostgresIntegerColumns(db); // best-effort type widening — unchanged
        await ensureIndexExists(
          "provider_corpus_jobs_scope_idx",
          `CREATE INDEX IF NOT EXISTS provider_corpus_jobs_scope_idx ON provider_corpus_jobs (app_id, owner_email, updated_at)`,
        );
        await ensureIndexExists(
          "provider_corpus_jobs_status_idx",
          `CREATE INDEX IF NOT EXISTS provider_corpus_jobs_status_idx ON provider_corpus_jobs (app_id, owner_email, status)`,
        );
        await ensureIndexExists(
          "provider_corpus_job_hits_job_idx",
          `CREATE INDEX IF NOT EXISTS provider_corpus_job_hits_job_idx ON provider_corpus_job_hits (job_id)`,
        );
        return;
      }
      // SQLite (local dev): keep existing behavior
      await db.execute(createJobsSql);
      await db.execute(createHitsSql);
      for (const ddl of [
        `CREATE INDEX IF NOT EXISTS provider_corpus_jobs_scope_idx ON provider_corpus_jobs (app_id, owner_email, updated_at)`,
        `CREATE INDEX IF NOT EXISTS provider_corpus_jobs_status_idx ON provider_corpus_jobs (app_id, owner_email, status)`,
        `CREATE INDEX IF NOT EXISTS provider_corpus_job_hits_job_idx ON provider_corpus_job_hits (job_id)`,
      ]) {
        try {
          await db.execute(ddl);
        } catch {
          // Index already exists or the backend rejected best-effort indexing.
        }
      }
    })().catch((err) => {
      initPromise = undefined;
      throw err;
    });
  }
  return initPromise;
}

async function widenPostgresIntegerColumns(db: DbExec): Promise<void> {
  const statements = [
    `ALTER TABLE provider_corpus_jobs ALTER COLUMN pages_processed TYPE BIGINT USING pages_processed::bigint`,
    `ALTER TABLE provider_corpus_jobs ALTER COLUMN batches_processed TYPE BIGINT USING batches_processed::bigint`,
    `ALTER TABLE provider_corpus_jobs ALTER COLUMN items_processed TYPE BIGINT USING items_processed::bigint`,
    `ALTER TABLE provider_corpus_jobs ALTER COLUMN matched_items TYPE BIGINT USING matched_items::bigint`,
    `ALTER TABLE provider_corpus_jobs ALTER COLUMN total_hits TYPE BIGINT USING total_hits::bigint`,
    `ALTER TABLE provider_corpus_jobs ALTER COLUMN stored_hits TYPE BIGINT USING stored_hits::bigint`,
    `ALTER TABLE provider_corpus_jobs ALTER COLUMN next_resume_at TYPE BIGINT USING next_resume_at::bigint`,
    `ALTER TABLE provider_corpus_jobs ALTER COLUMN created_at TYPE BIGINT USING created_at::bigint`,
    `ALTER TABLE provider_corpus_jobs ALTER COLUMN updated_at TYPE BIGINT USING updated_at::bigint`,
    `ALTER TABLE provider_corpus_job_hits ALTER COLUMN hit_index TYPE BIGINT USING hit_index::bigint`,
  ];
  for (const sql of statements) {
    try {
      await db.execute(sql);
    } catch {
      // Best-effort compatibility for older deployments.
    }
  }
}

export async function createProviderCorpusJob(
  options: CreateProviderCorpusJobOptions,
): Promise<ProviderCorpusJobRecord> {
  await ensureTables();
  const db = getDbExec();
  const now = Date.now();
  await db.execute({
    sql: isPostgres()
      ? `
        INSERT INTO provider_corpus_jobs
          (id, app_id, owner_email, name, mode, status, provider, request_json, pagination_json, batch_json, search_json, limits_json, checkpoint_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          app_id = EXCLUDED.app_id,
          owner_email = EXCLUDED.owner_email,
          name = EXCLUDED.name,
          mode = EXCLUDED.mode,
          status = EXCLUDED.status,
          provider = EXCLUDED.provider,
          request_json = EXCLUDED.request_json,
          pagination_json = EXCLUDED.pagination_json,
          batch_json = EXCLUDED.batch_json,
          search_json = EXCLUDED.search_json,
          limits_json = EXCLUDED.limits_json,
          checkpoint_json = EXCLUDED.checkpoint_json,
          pages_processed = 0,
          batches_processed = 0,
          items_processed = 0,
          matched_items = 0,
          total_hits = 0,
          stored_hits = 0,
          error = NULL,
          next_resume_at = NULL,
          updated_at = EXCLUDED.updated_at
        WHERE provider_corpus_jobs.app_id = EXCLUDED.app_id
          AND provider_corpus_jobs.owner_email = EXCLUDED.owner_email
      `
      : `
        INSERT INTO provider_corpus_jobs
          (id, app_id, owner_email, name, mode, status, provider, request_json, pagination_json, batch_json, search_json, limits_json, checkpoint_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          app_id = excluded.app_id,
          owner_email = excluded.owner_email,
          name = excluded.name,
          mode = excluded.mode,
          status = excluded.status,
          provider = excluded.provider,
          request_json = excluded.request_json,
          pagination_json = excluded.pagination_json,
          batch_json = excluded.batch_json,
          search_json = excluded.search_json,
          limits_json = excluded.limits_json,
          checkpoint_json = excluded.checkpoint_json,
          pages_processed = 0,
          batches_processed = 0,
          items_processed = 0,
          matched_items = 0,
          total_hits = 0,
          stored_hits = 0,
          error = NULL,
          next_resume_at = NULL,
          updated_at = excluded.updated_at
        WHERE provider_corpus_jobs.app_id = excluded.app_id
          AND provider_corpus_jobs.owner_email = excluded.owner_email
      `,
    args: [
      options.id,
      options.appId,
      options.ownerEmail,
      options.name,
      options.mode,
      options.status,
      options.provider,
      JSON.stringify(options.request),
      jsonOrNull(options.pagination),
      jsonOrNull(options.batch),
      JSON.stringify(options.search),
      JSON.stringify(options.limits),
      JSON.stringify(options.checkpoint),
      now,
      now,
    ],
  });
  await db.execute({
    sql: `DELETE FROM provider_corpus_job_hits WHERE job_id = ?`,
    args: [options.id],
  });
  const job = await getProviderCorpusJob({
    id: options.id,
    appId: options.appId,
    ownerEmail: options.ownerEmail,
  });
  if (!job) {
    // The scoped upsert above only updates a row that already belongs to this
    // (app_id, owner_email). A null read here means a job with this id exists
    // under a different owner, so the conflicting insert was skipped rather
    // than clobbering the other tenant's job.
    throw new Error(
      `Failed to create provider corpus job ${options.id}: a job with this id ` +
        `already exists for a different owner. Use a different jobId.`,
    );
  }
  return job;
}

export async function getProviderCorpusJob(options: {
  id: string;
  appId: string;
  ownerEmail: string;
}): Promise<ProviderCorpusJobRecord | null> {
  await ensureTables();
  const db = getDbExec();
  const { rows } = await db.execute({
    sql: `SELECT * FROM provider_corpus_jobs WHERE id = ? AND app_id = ? AND owner_email = ?`,
    args: [options.id, options.appId, options.ownerEmail],
  });
  return rows[0] ? rowToJob(rows[0]) : null;
}

export async function listProviderCorpusJobs(options: {
  appId: string;
  ownerEmail: string;
  limit?: number;
}): Promise<ProviderCorpusJobRecord[]> {
  await ensureTables();
  const db = getDbExec();
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const { rows } = await db.execute({
    sql: `SELECT * FROM provider_corpus_jobs WHERE app_id = ? AND owner_email = ? ORDER BY updated_at DESC LIMIT ?`,
    args: [options.appId, options.ownerEmail, limit],
  });
  return rows.map(rowToJob);
}

export async function updateProviderCorpusJob(
  options: UpdateProviderCorpusJobOptions,
): Promise<ProviderCorpusJobRecord | null> {
  await ensureTables();
  const existing = await getProviderCorpusJob({
    id: options.id,
    appId: options.appId,
    ownerEmail: options.ownerEmail,
  });
  if (!existing) return null;
  const next = {
    status: options.status ?? existing.status,
    checkpoint: options.checkpoint ?? existing.checkpoint,
    pagesProcessed: options.pagesProcessed ?? existing.pagesProcessed,
    batchesProcessed: options.batchesProcessed ?? existing.batchesProcessed,
    itemsProcessed: options.itemsProcessed ?? existing.itemsProcessed,
    matchedItems: options.matchedItems ?? existing.matchedItems,
    totalHits: options.totalHits ?? existing.totalHits,
    storedHits: options.storedHits ?? existing.storedHits,
    error: options.error === undefined ? existing.error : options.error,
    nextResumeAt:
      options.nextResumeAt === undefined
        ? existing.nextResumeAt
        : options.nextResumeAt,
  };
  const db = getDbExec();
  await db.execute({
    sql: `
      UPDATE provider_corpus_jobs SET
        status = ?,
        checkpoint_json = ?,
        pages_processed = ?,
        batches_processed = ?,
        items_processed = ?,
        matched_items = ?,
        total_hits = ?,
        stored_hits = ?,
        error = ?,
        next_resume_at = ?,
        updated_at = ?
      WHERE id = ? AND app_id = ? AND owner_email = ?
    `,
    args: [
      next.status,
      JSON.stringify(next.checkpoint),
      next.pagesProcessed,
      next.batchesProcessed,
      next.itemsProcessed,
      next.matchedItems,
      next.totalHits,
      next.storedHits,
      next.error,
      next.nextResumeAt,
      Date.now(),
      options.id,
      options.appId,
      options.ownerEmail,
    ],
  });
  return getProviderCorpusJob({
    id: options.id,
    appId: options.appId,
    ownerEmail: options.ownerEmail,
  });
}

export async function appendProviderCorpusJobHits(options: {
  jobId: string;
  startIndex: number;
  hits: Record<string, unknown>[];
}): Promise<void> {
  if (options.hits.length === 0) return;
  await ensureTables();
  const db = getDbExec();
  // Insert in chunked multi-row statements rather than one round-trip per hit,
  // and ignore conflicts on (job_id, hit_index). The runner writes hits before
  // it advances the stored-hits counter and checkpoint, so a crash between the
  // two means resume re-fetches the same page and re-appends the same indices;
  // DO NOTHING makes that retry idempotent instead of a primary-key violation.
  const CHUNK = 100;
  for (let start = 0; start < options.hits.length; start += CHUNK) {
    const chunk = options.hits.slice(start, start + CHUNK);
    const placeholders = chunk.map(() => "(?, ?, ?)").join(", ");
    const args: unknown[] = [];
    for (let j = 0; j < chunk.length; j++) {
      args.push(
        options.jobId,
        options.startIndex + start + j,
        JSON.stringify(chunk[j]),
      );
    }
    await db.execute({
      sql: `INSERT INTO provider_corpus_job_hits (job_id, hit_index, hit_data) VALUES ${placeholders} ON CONFLICT (job_id, hit_index) DO NOTHING`,
      args,
    });
  }
}

export async function getProviderCorpusJobHits(options: {
  jobId: string;
  appId: string;
  ownerEmail: string;
  offset?: number;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  await ensureTables();
  const job = await getProviderCorpusJob({
    id: options.jobId,
    appId: options.appId,
    ownerEmail: options.ownerEmail,
  });
  if (!job) return [];
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, Math.min(options.limit ?? 100, 1000));
  const db = getDbExec();
  const { rows } = await db.execute({
    sql: `SELECT hit_data FROM provider_corpus_job_hits WHERE job_id = ? ORDER BY hit_index ASC LIMIT ? OFFSET ?`,
    args: [options.jobId, limit, offset],
  });
  return rows.map((row) => parseJsonRecord(row.hit_data));
}

export async function deleteProviderCorpusJob(options: {
  id: string;
  appId: string;
  ownerEmail: string;
}): Promise<boolean> {
  await ensureTables();
  const existing = await getProviderCorpusJob(options);
  if (!existing) return false;
  const db = getDbExec();
  await db.execute({
    sql: `DELETE FROM provider_corpus_job_hits WHERE job_id = ?`,
    args: [options.id],
  });
  const result = await db.execute({
    sql: `DELETE FROM provider_corpus_jobs WHERE id = ? AND app_id = ? AND owner_email = ?`,
    args: [options.id, options.appId, options.ownerEmail],
  });
  return result.rowsAffected > 0;
}

function jsonOrNull(
  value: Record<string, unknown> | null | undefined,
): string | null {
  return value ? JSON.stringify(value) : null;
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseNullableJsonRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (typeof value !== "string" || !value) return null;
  return parseJsonRecord(value);
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rowToJob(row: Record<string, unknown>): ProviderCorpusJobRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    ownerEmail: String(row.owner_email),
    name: String(row.name),
    mode: String(row.mode),
    status: String(row.status) as ProviderCorpusJobStatus,
    provider: String(row.provider),
    request: parseJsonRecord(row.request_json),
    pagination: parseNullableJsonRecord(row.pagination_json),
    batch: parseNullableJsonRecord(row.batch_json),
    search: parseJsonRecord(row.search_json),
    limits: parseJsonRecord(row.limits_json),
    checkpoint: parseJsonRecord(row.checkpoint_json),
    pagesProcessed: Number(row.pages_processed ?? 0),
    batchesProcessed: Number(row.batches_processed ?? 0),
    itemsProcessed: Number(row.items_processed ?? 0),
    matchedItems: Number(row.matched_items ?? 0),
    totalHits: Number(row.total_hits ?? 0),
    storedHits: Number(row.stored_hits ?? 0),
    error: row.error == null ? null : String(row.error),
    nextResumeAt: nullableNumber(row.next_resume_at),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

export function _resetProviderCorpusJobsStoreForTests(): void {
  initPromise = undefined;
}
