/**
 * Durable storage for queued `run-code` sandbox executions.
 *
 * A row in `sandbox_executions` is one background code-execution request: the
 * raw user code plus enough identity (owner email, org, thread) to rebuild the
 * action bridge context in a fresh process, and the full result once an
 * executor finishes. This is what lets a long compute job survive the hosted
 * serverless wall: the enqueueing request returns immediately, and any later
 * invocation (self-dispatch processor, status poll, warm-instance sweep) can
 * claim and run the row under its own budget.
 *
 * Concurrency model (single-writer via claim token + lease):
 *  - `claimSandboxExecution` atomically flips `queued → running` (or reclaims
 *    a `running` row whose lease expired) with `UPDATE … WHERE status = …`
 *    guards, so exactly one executor wins even when several invocations race.
 *  - The winning executor holds a random `claim_token` and heartbeats
 *    `lease_expires_at`; `finalizeSandboxExecution` only writes results when
 *    the token still matches, so a displaced executor can never clobber the
 *    reclaimer's result.
 *  - A row whose lease expired with attempts remaining is re-claimable; once
 *    attempts are exhausted `failExpiredSandboxExecution` marks it `failed`
 *    instead of leaving it "running" forever.
 *
 * Schema notes: additive-only, portable across Postgres (Neon) and SQLite —
 * same `ensureTableExists`/dialect-branched DDL pattern as
 * `resources/store.ts`. Timestamps are epoch-ms in `BIGINT`/`INTEGER` columns.
 * Reads for user-facing surfaces are always owner-scoped
 * (`getSandboxExecutionForOwner`); the unscoped internal reader exists only
 * for the trusted executor/sweep paths.
 */

import crypto from "node:crypto";

import {
  getDbExec,
  intType,
  isPostgres,
  retryOnDdlRace,
} from "../../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../../db/ddl-guard.js";

export type SandboxExecutionStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out";

export interface SandboxExecutionRow {
  id: string;
  owner: string;
  orgId: string | null;
  threadId: string | null;
  runtime: string;
  code: string;
  status: SandboxExecutionStatus;
  timeoutMs: number;
  maxOutputChars: number;
  attemptCount: number;
  maxAttempts: number;
  claimToken: string | null;
  leaseExpiresAt: number | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  exitCode: number | null;
  timedOut: boolean;
  error: string | null;
  bridgeToolsUsed: string[];
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  updatedAt: number;
}

export interface CreateSandboxExecutionInput {
  owner: string;
  orgId?: string | null;
  threadId?: string | null;
  code: string;
  timeoutMs: number;
  maxOutputChars: number;
  maxAttempts?: number;
  runtime?: string;
}

export interface FinalizeSandboxExecutionInput {
  status: Extract<SandboxExecutionStatus, "succeeded" | "failed" | "timed_out">;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  error?: string | null;
  bridgeToolsUsed?: string[];
}

/** Default retry budget: the initial attempt plus one lease-expiry retry. */
export const SANDBOX_EXECUTION_DEFAULT_MAX_ATTEMPTS = 2;
/**
 * Hard per-stream storage cap. The per-row `max_output_chars` (derived from
 * the caller's `maxOutputChars`) is applied first; this bounds even that.
 */
export const SANDBOX_EXECUTION_MAX_STORED_OUTPUT_CHARS = 200_000;

const TABLE = "sandbox_executions";

let _initPromise: Promise<void> | undefined;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = _doEnsureTable().catch((err) => {
      // Don't cache the rejection — let the next caller retry a fresh init.
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

/** Test-only: forget the memoized init so a fresh in-memory DB re-creates. */
export function resetSandboxExecutionsStoreForTests(): void {
  _initPromise = undefined;
}

async function _doEnsureTable(): Promise<void> {
  const client = getDbExec();
  const createSql = `
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      org_id TEXT,
      thread_id TEXT,
      runtime TEXT NOT NULL DEFAULT 'node',
      code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      timeout_ms ${intType()} NOT NULL,
      max_output_chars ${intType()} NOT NULL,
      attempt_count ${intType()} NOT NULL DEFAULT 0,
      max_attempts ${intType()} NOT NULL DEFAULT ${SANDBOX_EXECUTION_DEFAULT_MAX_ATTEMPTS},
      claim_token TEXT,
      lease_expires_at ${intType()},
      stdout TEXT NOT NULL DEFAULT '',
      stderr TEXT NOT NULL DEFAULT '',
      stdout_truncated ${intType()} NOT NULL DEFAULT 0,
      stderr_truncated ${intType()} NOT NULL DEFAULT 0,
      exit_code ${intType()},
      timed_out ${intType()} NOT NULL DEFAULT 0,
      error TEXT,
      bridge_tools_used TEXT,
      created_at ${intType()} NOT NULL,
      started_at ${intType()},
      finished_at ${intType()},
      updated_at ${intType()} NOT NULL
    )
  `;
  const ownerIdxSql = `CREATE INDEX IF NOT EXISTS sandbox_executions_owner_created_idx ON ${TABLE} (owner, created_at)`;
  const dueIdxSql = `CREATE INDEX IF NOT EXISTS sandbox_executions_due_idx ON ${TABLE} (status, lease_expires_at)`;

  if (isPostgres()) {
    // Probe information_schema first (no lock) and DDL only what's missing —
    // same guarded pattern as resources/store.ts so a fresh background worker
    // never blocks on an ACCESS EXCLUSIVE lock for schema that already exists.
    await ensureTableExists(TABLE, createSql);
    // Additive-column guard: keeps older deployments (created before a column
    // was added) self-healing without destructive migrations.
    const pgColumns: Array<[string, string]> = [["bridge_tools_used", "TEXT"]];
    for (const [col, def] of pgColumns) {
      await ensureColumnExists(
        TABLE,
        col,
        `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS ${col} ${def}`,
      );
    }
    await ensureIndexExists(
      "sandbox_executions_owner_created_idx",
      ownerIdxSql,
    );
    await ensureIndexExists("sandbox_executions_due_idx", dueIdxSql);
  } else {
    await retryOnDdlRace(() => client.execute(createSql));
    await retryOnDdlRace(() => client.execute(ownerIdxSql));
    await retryOnDdlRace(() => client.execute(dueIdxSql));
  }
}

function capOutput(
  value: string | undefined,
  maxChars: number,
): { text: string; truncated: boolean } {
  const raw = typeof value === "string" ? value : "";
  const cap = Math.max(
    1,
    Math.min(maxChars, SANDBOX_EXECUTION_MAX_STORED_OUTPUT_CHARS),
  );
  if (raw.length <= cap) return { text: raw, truncated: false };
  return { text: raw.slice(0, cap), truncated: true };
}

function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowFromDb(raw: Record<string, unknown>): SandboxExecutionRow {
  let bridgeToolsUsed: string[] = [];
  if (typeof raw.bridge_tools_used === "string" && raw.bridge_tools_used) {
    try {
      const parsed = JSON.parse(raw.bridge_tools_used);
      if (Array.isArray(parsed)) {
        bridgeToolsUsed = parsed.filter(
          (item): item is string => typeof item === "string",
        );
      }
    } catch {
      bridgeToolsUsed = [];
    }
  }
  return {
    id: String(raw.id),
    owner: String(raw.owner),
    orgId:
      raw.org_id === null || raw.org_id === undefined
        ? null
        : String(raw.org_id),
    threadId:
      raw.thread_id === null || raw.thread_id === undefined
        ? null
        : String(raw.thread_id),
    runtime: String(raw.runtime ?? "node"),
    code: String(raw.code ?? ""),
    status: String(raw.status ?? "queued") as SandboxExecutionStatus,
    timeoutMs: toNumberOrNull(raw.timeout_ms) ?? 0,
    maxOutputChars: toNumberOrNull(raw.max_output_chars) ?? 0,
    attemptCount: toNumberOrNull(raw.attempt_count) ?? 0,
    maxAttempts:
      toNumberOrNull(raw.max_attempts) ??
      SANDBOX_EXECUTION_DEFAULT_MAX_ATTEMPTS,
    claimToken:
      raw.claim_token === null || raw.claim_token === undefined
        ? null
        : String(raw.claim_token),
    leaseExpiresAt: toNumberOrNull(raw.lease_expires_at),
    stdout: String(raw.stdout ?? ""),
    stderr: String(raw.stderr ?? ""),
    stdoutTruncated: toBool(raw.stdout_truncated),
    stderrTruncated: toBool(raw.stderr_truncated),
    exitCode: toNumberOrNull(raw.exit_code),
    timedOut: toBool(raw.timed_out),
    error:
      raw.error === null || raw.error === undefined ? null : String(raw.error),
    bridgeToolsUsed,
    createdAt: toNumberOrNull(raw.created_at) ?? 0,
    startedAt: toNumberOrNull(raw.started_at),
    finishedAt: toNumberOrNull(raw.finished_at),
    updatedAt: toNumberOrNull(raw.updated_at) ?? 0,
  };
}

/** Enqueue a new execution row in `queued` state. */
export async function createSandboxExecution(
  input: CreateSandboxExecutionInput,
): Promise<SandboxExecutionRow> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const id = `sbx_${crypto.randomUUID()}`;
  const maxAttempts = Math.max(
    1,
    Math.min(input.maxAttempts ?? SANDBOX_EXECUTION_DEFAULT_MAX_ATTEMPTS, 5),
  );
  await client.execute({
    sql: `INSERT INTO ${TABLE}
      (id, owner, org_id, thread_id, runtime, code, status, timeout_ms, max_output_chars, attempt_count, max_attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, 0, ?, ?, ?)`,
    args: [
      id,
      input.owner,
      input.orgId ?? null,
      input.threadId ?? null,
      input.runtime ?? "node",
      input.code,
      input.timeoutMs,
      input.maxOutputChars,
      maxAttempts,
      now,
      now,
    ],
  });
  const row = await getSandboxExecutionInternal(id);
  if (!row) throw new Error(`sandbox execution ${id} vanished after insert`);
  return row;
}

/** Owner-scoped read for user-facing status/result surfaces. */
export async function getSandboxExecutionForOwner(
  id: string,
  owner: string,
): Promise<SandboxExecutionRow | null> {
  if (!id || !owner) return null;
  await ensureTable();
  const client = getDbExec();
  const result = await client.execute({
    sql: `SELECT * FROM ${TABLE} WHERE id = ? AND owner = ? LIMIT 1`,
    args: [id, owner],
  });
  const raw = result.rows?.[0] as Record<string, unknown> | undefined;
  return raw ? rowFromDb(raw) : null;
}

/**
 * Unscoped read for the trusted executor/sweep paths ONLY. Never expose this
 * through a user-facing action — use `getSandboxExecutionForOwner`.
 */
export async function getSandboxExecutionInternal(
  id: string,
): Promise<SandboxExecutionRow | null> {
  if (!id) return null;
  await ensureTable();
  const client = getDbExec();
  const result = await client.execute({
    sql: `SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const raw = result.rows?.[0] as Record<string, unknown> | undefined;
  return raw ? rowFromDb(raw) : null;
}

/**
 * Atomically claim an execution for a single executor. Claims a `queued` row,
 * or reclaims a `running` row whose lease expired, as long as the attempt
 * budget is not exhausted. Returns the claimed row (with the new claim token)
 * or null when another executor holds it / it is terminal / attempts ran out.
 */
export async function claimSandboxExecution(
  id: string,
  claimToken: string,
  leaseMs: number,
  now = Date.now(),
): Promise<SandboxExecutionRow | null> {
  await ensureTable();
  const client = getDbExec();
  const result = await client.execute({
    sql: `UPDATE ${TABLE}
      SET status = 'running',
          claim_token = ?,
          lease_expires_at = ?,
          attempt_count = attempt_count + 1,
          started_at = COALESCE(started_at, ?),
          updated_at = ?
      WHERE id = ?
        AND attempt_count < max_attempts
        AND (
          status = 'queued'
          OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?)
        )`,
    args: [claimToken, now + leaseMs, now, now, id, now],
  });
  if ((result.rowsAffected ?? 0) !== 1) return null;
  const row = await getSandboxExecutionInternal(id);
  // Verify the claim token survived (paranoia against a same-ms racing UPDATE
  // on drivers that report affected rows loosely).
  if (!row || row.claimToken !== claimToken) return null;
  return row;
}

/** Heartbeat: extend the lease while the claimed execution is still running. */
export async function renewSandboxExecutionLease(
  id: string,
  claimToken: string,
  leaseMs: number,
  now = Date.now(),
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const result = await client.execute({
    sql: `UPDATE ${TABLE}
      SET lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND claim_token = ? AND status = 'running'`,
    args: [now + leaseMs, now, id, claimToken],
  });
  return (result.rowsAffected ?? 0) === 1;
}

/**
 * Write the terminal result. Single-writer safe: only the executor whose
 * claim token still matches the row (i.e. it was not reclaimed after a lease
 * expiry) can finalize. Returns false when the row was already finalized or
 * reclaimed — the caller must discard its result.
 */
export async function finalizeSandboxExecution(
  id: string,
  claimToken: string,
  input: FinalizeSandboxExecutionInput,
  now = Date.now(),
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const row = await getSandboxExecutionInternal(id);
  if (!row) return false;
  const stdout = capOutput(input.stdout, row.maxOutputChars);
  const stderr = capOutput(input.stderr, row.maxOutputChars);
  const result = await client.execute({
    sql: `UPDATE ${TABLE}
      SET status = ?,
          stdout = ?,
          stderr = ?,
          stdout_truncated = ?,
          stderr_truncated = ?,
          exit_code = ?,
          timed_out = ?,
          error = ?,
          bridge_tools_used = ?,
          finished_at = ?,
          updated_at = ?,
          lease_expires_at = NULL
      WHERE id = ? AND claim_token = ? AND status = 'running'`,
    args: [
      input.status,
      stdout.text,
      stderr.text,
      stdout.truncated ? 1 : 0,
      stderr.truncated ? 1 : 0,
      input.exitCode ?? null,
      input.timedOut ? 1 : 0,
      input.error ?? null,
      JSON.stringify(input.bridgeToolsUsed ?? []),
      now,
      now,
      id,
      claimToken,
    ],
  });
  return (result.rowsAffected ?? 0) === 1;
}

/**
 * Reap a `running` row whose lease expired after its attempt budget was
 * exhausted, so it never sits "running" forever. Atomic: guarded on the same
 * expiry + budget conditions, so a live executor (fresh lease) is untouched.
 */
export async function failExpiredSandboxExecution(
  id: string,
  error: string,
  now = Date.now(),
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const result = await client.execute({
    sql: `UPDATE ${TABLE}
      SET status = 'failed',
          error = ?,
          finished_at = ?,
          updated_at = ?,
          lease_expires_at = NULL
      WHERE id = ?
        AND status = 'running'
        AND lease_expires_at IS NOT NULL AND lease_expires_at < ?
        AND attempt_count >= max_attempts`,
    args: [error, now, now, id, now],
  });
  return (result.rowsAffected ?? 0) === 1;
}

export interface DueSandboxExecution {
  id: string;
  status: SandboxExecutionStatus;
  attemptCount: number;
  maxAttempts: number;
  leaseExpiresAt: number | null;
}

/**
 * List rows that need driving: `queued` rows that have sat unclaimed longer
 * than `queuedOlderThanMs` (their enqueue-time dispatch was likely lost), and
 * `running` rows whose lease expired (executor died). Used by the sweep and
 * the poll-time drain. Deliberately does NOT call `ensureTable()` — the sweep
 * must stay a zero-footprint no-op on deployments that never enqueue; callers
 * treat a missing-table error as "nothing due".
 */
export async function listDueSandboxExecutions(options: {
  limit?: number;
  queuedOlderThanMs?: number;
  now?: number;
}): Promise<DueSandboxExecution[]> {
  const client = getDbExec();
  const now = options.now ?? Date.now();
  const limit = Math.max(1, Math.min(options.limit ?? 5, 25));
  const queuedCutoff = now - Math.max(0, options.queuedOlderThanMs ?? 30_000);
  const result = await client.execute({
    sql: `SELECT id, status, attempt_count, max_attempts, lease_expires_at
      FROM ${TABLE}
      WHERE (status = 'queued' AND updated_at < ?)
         OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?)
      ORDER BY created_at ASC
      LIMIT ?`,
    args: [queuedCutoff, now, limit],
  });
  return (result.rows ?? []).map((raw: Record<string, unknown>) => ({
    id: String(raw.id),
    status: String(raw.status) as SandboxExecutionStatus,
    attemptCount: toNumberOrNull(raw.attempt_count) ?? 0,
    maxAttempts:
      toNumberOrNull(raw.max_attempts) ??
      SANDBOX_EXECUTION_DEFAULT_MAX_ATTEMPTS,
    leaseExpiresAt: toNumberOrNull(raw.lease_expires_at),
  }));
}
