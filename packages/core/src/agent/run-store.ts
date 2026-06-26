/**
 * SQL persistence for agent runs and events.
 * Enables cross-isolate access on Cloudflare Workers and
 * reliable reconnection after page refreshes.
 */
import { getDbExec, intType, isPostgres } from "../db/client.js";
import { ensureColumnExists, ensureTableExists } from "../db/ddl-guard.js";
import { widenIntColumnsToBigInt } from "../db/widen-columns.js";
import { captureError } from "../server/capture-error.js";
import type { AgentChatEvent } from "./types.js";

let _initPromise: Promise<void> | undefined;

/**
 * Max time without a heartbeat before a "running" run is considered dead.
 * The run-manager heartbeats every 1.5s, so 15s tolerates ~9 missed writes.
 * Widened from 6s to absorb real-world DB latency spikes and GC pauses that
 * caused false-positive reaps: a live run whose heartbeat lagged 6s+ would be
 * reaped and a zombie would keep running, eventually clobbering the new row.
 */
export const RUN_STALE_MS = 15_000;

/**
 * Stale window for runs dispatched into a Netlify background function
 * (`dispatch_mode = 'background'`). The design doc flags the 15s reaper vs a
 * background cold-start as the #1 false-failure risk: the foreground POST
 * inserts the `running` row, then `fireInternalDispatch` returns 202 and the
 * background function may take >15s to cold-start and emit its first heartbeat.
 * With the normal 15s window the reaper would falsely kill that freshly-
 * inserted-but-not-yet-heartbeaten row. 90s tolerates a slow background
 * cold-start while still reaping a genuinely dead background worker promptly.
 *
 * Only applied to rows explicitly marked background-dispatched; ordinary
 * foreground runs keep the tight 15s window unchanged.
 */
export const BACKGROUND_RUN_STALE_MS = 90_000;

export const STALE_RUN_ERROR_EVENT = {
  type: "error",
  error:
    "The agent stopped before it could finish. It may have hit a server timeout or the worker may have been interrupted.",
  errorCode: "stale_run",
  recoverable: true,
  details:
    "The run heartbeat stopped while the run was still marked running. Partial output and tool calls were preserved when available.",
} as const;

/**
 * Terminal error for a background-dispatched run whose worker NEVER claimed it
 * (the foreground fired the self-dispatch, Netlify acked it async with a 202,
 * but the `_process-run` worker never ran far enough to flip
 * `dispatch_mode background → background-processing`). Distinct errorCode so the
 * client (and prod triage) can tell "the worker died silently" apart from "a
 * claimed worker's heartbeat went stale". Recoverable so the client surfaces a
 * retry affordance and re-drives the turn. See `reapUnclaimedBackgroundRun`.
 */
export const UNCLAIMED_BACKGROUND_RUN_ERROR_EVENT = {
  type: "error",
  error:
    "The agent run was handed off to a background worker that never started. It was recovered so you can try again.",
  errorCode: "background_worker_never_started",
  recoverable: true,
  details:
    "A background-dispatched run was acknowledged (HTTP 202) but its worker never claimed the run, so no progress was produced. The run was reaped early (it had no live worker to protect) so the turn can be retried.",
} as const;

/**
 * Grace period before a never-claimed background run (dispatch_mode still
 * 'background', no worker claim) is treated as a dead handoff and reaped.
 *
 * This is intentionally MUCH tighter than `BACKGROUND_RUN_STALE_MS` (90s). The
 * wide 90s window exists ONLY to protect a CLAIMED worker whose heartbeat lags
 * during a slow cold start. A run that is still `dispatch_mode = 'background'`
 * has, by definition, NO worker — nothing to protect — so once a Netlify
 * background function has had a reasonable cold-start window to claim it and
 * hasn't, the handoff is dead and should surface promptly instead of leaving
 * the user staring at a spinner for 90s. 25s comfortably exceeds a normal
 * Netlify Lambda cold start while still failing fast on a silent worker death.
 */
export const UNCLAIMED_BACKGROUND_RUN_GRACE_MS = 25_000;

async function ensureRunTables(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();

      // Shared CREATE SQL strings — referenced by both the Postgres and SQLite
      // branches so the column definitions stay in one place.
      const agentRunsCreateSql = `
        CREATE TABLE IF NOT EXISTS agent_runs (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          abort_reason TEXT,
          started_at ${intType()} NOT NULL,
          completed_at ${intType()},
          heartbeat_at ${intType()},
          last_progress_at ${intType()},
          turn_id TEXT,
          error_code TEXT,
          error_detail TEXT,
          dispatch_mode TEXT,
          diag_stage TEXT
        )
      `;
      const agentRunEventsCreateSql = `
        CREATE TABLE IF NOT EXISTS agent_run_events (
          run_id TEXT NOT NULL,
          seq ${intType()} NOT NULL,
          event_data TEXT NOT NULL,
          PRIMARY KEY (run_id, seq)
        )
      `;
      // Tool-call result ledger: persists the outcome of write tool calls that
      // completed AFTER their chunk was abandoned (zombie completions). A
      // resumed continuation can recover the real result by matching
      // thread_id + tool_key (name:stableInputHash) instead of re-executing
      // the side effect. Entries are scoped to the thread and expire with it.
      const agentToolLedgerCreateSql = `
        CREATE TABLE IF NOT EXISTS agent_tool_ledger (
          thread_id TEXT NOT NULL,
          tool_key TEXT NOT NULL,
          result_summary TEXT NOT NULL,
          completed_at ${intType()} NOT NULL,
          PRIMARY KEY (thread_id, tool_key)
        )
      `;

      if (isPostgres()) {
        // Hot path: in production the tables and all additive columns are
        // virtually always already present. Issuing `CREATE TABLE`/`ALTER TABLE
        // ADD COLUMN` still takes an ACCESS EXCLUSIVE lock — which, in a fresh
        // background-worker process behind a concurrent connection on the shared
        // Neon DB, can block ~indefinitely. So check `information_schema` first
        // (plain reads, no lock) and run DDL ONLY for what is actually missing.
        // The `ensureTableExists` / `ensureColumnExists` wrappers probe →
        // guarded-DDL (bounded `lock_timeout`) → re-probe, and THROW if the
        // schema is still missing after a swallowed lock-timeout so a poisoned
        // init never memoizes success against absent schema (the `_initPromise`
        // rejects and the next call retries).
        await ensureTableExists("agent_runs", agentRunsCreateSql);
        // Additive columns — all listed in the CREATE TABLE above, so on a
        // fresh DB they already exist after the CREATE and these checks are
        // instant short-circuits. On an older deployment that predates a
        // column, the wrapper issues one bounded ALTER.
        //
        // Backfill heartbeat_at on older deployments.
        // heartbeat_at = "the producer process is alive" (bumped on a timer).
        // last_progress_at = "the agent is actually emitting events" (bumped on
        // each emit). The gap between them is the stuck-detector signal.
        for (const [col, colType] of [
          ["heartbeat_at", intType()],
          ["abort_reason", "TEXT"],
          ["last_progress_at", intType()],
          // Backfill turn_id / error_code / error_detail.
          //   turn_id    = stable identity for one logical assistant turn that may
          //                span several continuation runs, so the durable record
          //                can be folded across runs instead of dropped per-run.
          //   error_code / error_detail = terminal failure classification captured
          //                at completion so errored/cut-off runs are queryable for
          //                pattern analysis (see listErroredRuns).
          // dispatch_mode marks how a run was started: NULL/"foreground" for the
          // normal synchronous path, "background" for a run dispatched into a
          // Netlify background function. The reaper/claim widen the stale window
          // for background rows so a slow cold-start isn't falsely reaped.
          // diag_stage records the last reached pipeline stage (+ any error) for a
          // background-dispatched run so a silent worker death is DIAGNOSABLE from
          // the client (/runs/active surfaces it) without reading the unreadable
          // Netlify background-function logs. See recordRunDiagnostic.
          ["turn_id", "TEXT"],
          ["error_code", "TEXT"],
          ["error_detail", "TEXT"],
          ["dispatch_mode", "TEXT"],
          ["diag_stage", "TEXT"],
          ["worker_stage", "TEXT"],
        ] as const) {
          await ensureColumnExists(
            "agent_runs",
            col,
            `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS ${col} ${colType}`,
          );
        }
        await ensureTableExists("agent_run_events", agentRunEventsCreateSql);
        await ensureTableExists("agent_tool_ledger", agentToolLedgerCreateSql);
        // Widen millisecond-timestamp columns that older deployments created as
        // 32-bit `INTEGER`. `insertRun()` writes `Date.now()` into `started_at`
        // on every turn, so an int4 column makes every agent prompt fail on
        // Postgres with "value … is out of range for type integer". No-op once
        // widened (and on fresh DBs that already use BIGINT). See
        // widenIntColumnsToBigInt.
        await widenIntColumnsToBigInt("agent_runs", [
          "started_at",
          "completed_at",
          "heartbeat_at",
          "last_progress_at",
        ]);
        await widenIntColumnsToBigInt("agent_tool_ledger", ["completed_at"]);
        return;
      }

      // SQLite (local dev): no ACCESS EXCLUSIVE lock problem — keep the
      // original create-then-additive-alter behaviour. SQLite has no
      // `ADD COLUMN IF NOT EXISTS`, so the ALTERs stay wrapped in try/catch.
      await client.execute(agentRunsCreateSql);
      // Backfill heartbeat_at on older deployments.
      try {
        await client.execute(
          `ALTER TABLE agent_runs ADD COLUMN heartbeat_at ${intType()}`,
        );
      } catch {
        // Column already exists — ignore
      }
      try {
        await client.execute(
          `ALTER TABLE agent_runs ADD COLUMN abort_reason TEXT`,
        );
      } catch {
        // Column already exists — ignore
      }
      // Backfill last_progress_at — this is distinct from heartbeat_at.
      // heartbeat_at = "the producer process is alive" (bumped on a timer).
      // last_progress_at = "the agent is actually emitting events" (bumped on
      // each emit). The gap between them is the stuck-detector signal.
      try {
        await client.execute(
          `ALTER TABLE agent_runs ADD COLUMN last_progress_at ${intType()}`,
        );
      } catch {
        // Column already exists — ignore
      }
      // Backfill turn_id / error_code / error_detail.
      //   turn_id    = stable identity for one logical assistant turn that may
      //                span several continuation runs, so the durable record
      //                can be folded across runs instead of dropped per-run.
      //   error_code / error_detail = terminal failure classification captured
      //                at completion so errored/cut-off runs are queryable for
      //                pattern analysis (see listErroredRuns).
      // dispatch_mode marks how a run was started: NULL/"foreground" for the
      // normal synchronous path, "background" for a run dispatched into a
      // Netlify background function. The reaper/claim widen the stale window
      // for background rows so a slow cold-start isn't falsely reaped.
      // diag_stage records the last reached pipeline stage (+ any error) for a
      // background-dispatched run so a silent worker death is DIAGNOSABLE from
      // the client (/runs/active surfaces it) without reading the unreadable
      // Netlify background-function logs. See recordRunDiagnostic.
      for (const col of [
        "turn_id",
        "error_code",
        "error_detail",
        "dispatch_mode",
        "diag_stage",
        "worker_stage",
      ] as const) {
        try {
          await client.execute(`ALTER TABLE agent_runs ADD COLUMN ${col} TEXT`);
        } catch {
          // Column already exists — ignore
        }
      }
      await client.execute(agentRunEventsCreateSql);
      await client.execute(agentToolLedgerCreateSql);
      // Widen millisecond-timestamp columns that older deployments created as
      // 32-bit `INTEGER`. `insertRun()` writes `Date.now()` into `started_at`
      // on every turn, so an int4 column makes every agent prompt fail on
      // Postgres with "value … is out of range for type integer". No-op once
      // widened (and on fresh DBs that already use BIGINT). See
      // widenIntColumnsToBigInt.
      await widenIntColumnsToBigInt("agent_runs", [
        "started_at",
        "completed_at",
        "heartbeat_at",
        "last_progress_at",
      ]);
      await widenIntColumnsToBigInt("agent_tool_ledger", ["completed_at"]);
    })().catch((err) => {
      // Retry init on the next call after a failed startup.
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

// ─── Tool-call result ledger ─────────────────────────────────────────────────
//
// When the run-level abort signal fires (soft timeout / user cancel) while a
// write tool is in-flight, `Promise.race` abandons the call — but the action's
// Promise continues running in the background (a "zombie"). If the zombie
// resolves before the continuation's next tool dispatch, we record the result
// here so the continuation can recover it without re-executing the side effect.
//
// Keyed by (thread_id, tool_key) where tool_key = "<toolName>:<stableJsonHash>".
// The write is fire-and-forget from the hot path; reads are synchronous look-
// ups at the start of each write-tool dispatch in the continuation.

/** Max length for a persisted result summary (8 KB). */
const LEDGER_RESULT_MAX_CHARS = 8_000;

/**
 * Persist a zombie tool-call completion to the ledger. Called by the detached
 * promise continuation after `Promise.race` abandons it. Best-effort — never
 * throws so a ledger write failure doesn't break any caller.
 */
export async function writeLedgerEntry(
  threadId: string,
  toolKey: string,
  resultSummary: string,
): Promise<void> {
  try {
    await ensureRunTables();
    const client = getDbExec();
    const capped =
      resultSummary.length > LEDGER_RESULT_MAX_CHARS
        ? resultSummary.slice(0, LEDGER_RESULT_MAX_CHARS) +
          `\n...[ledger truncated at ${LEDGER_RESULT_MAX_CHARS} chars]`
        : resultSummary;
    await client.execute({
      sql: `INSERT INTO agent_tool_ledger (thread_id, tool_key, result_summary, completed_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (thread_id, tool_key) DO UPDATE SET
              result_summary = excluded.result_summary,
              completed_at = excluded.completed_at`,
      args: [threadId, toolKey, capped, Date.now()],
    });
  } catch {
    // Ledger is best-effort; never surface failures to the caller.
  }
}

/**
 * Look up a prior zombie completion for this thread + tool key. Returns the
 * persisted result summary, or `null` when no entry exists.
 */
export async function readLedgerEntry(
  threadId: string,
  toolKey: string,
): Promise<string | null> {
  try {
    await ensureRunTables();
    const client = getDbExec();
    const { rows } = await client.execute({
      sql: `SELECT result_summary FROM agent_tool_ledger WHERE thread_id = ? AND tool_key = ?`,
      args: [threadId, toolKey],
    });
    if (rows.length === 0) return null;
    const row = rows[0] as { result_summary: string };
    return row.result_summary;
  } catch {
    return null;
  }
}

/**
 * Delete ledger entries for a thread. Called after a turn fully completes so
 * old entries don't bleed into the next turn's disambiguation.
 * Best-effort — never throws.
 */
export async function clearLedgerForThread(threadId: string): Promise<void> {
  try {
    await ensureRunTables();
    const client = getDbExec();
    await client.execute({
      sql: `DELETE FROM agent_tool_ledger WHERE thread_id = ?`,
      args: [threadId],
    });
  } catch {
    // Best-effort.
  }
}

export async function insertRun(
  id: string,
  threadId: string,
  turnId?: string,
  options?: { dispatchMode?: "foreground" | "background" },
): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  const now = Date.now();
  await client.execute({
    sql: `INSERT INTO agent_runs (id, thread_id, status, started_at, heartbeat_at, last_progress_at, turn_id, dispatch_mode) VALUES (?, ?, 'running', ?, ?, ?, ?, ?)`,
    args: [
      id,
      threadId,
      now,
      now,
      now,
      turnId ?? id,
      options?.dispatchMode ?? null,
    ],
  });
}

/**
 * SQL fragment that resolves the per-row stale cutoff. Background-dispatched
 * runs (`dispatch_mode` starting with `background`) tolerate a much longer gap
 * without a heartbeat (slow Netlify background-function cold-start) before being
 * reaped; every other run keeps the tight 15s window. The bound `now` is
 * subtracted by the resolved window so the comparison is
 * `COALESCE(heartbeat_at, started_at) < (now - window)`.
 *
 * `dispatch_mode` is one of NULL/"foreground" (normal sync path), "background"
 * (foreground inserted the row for a background dispatch), or
 * "background-processing" (the background worker claimed it). Both background
 * states get the wider window via a LIKE-prefix match.
 */
function backgroundAwareStaleCutoffSql(): string {
  // `CAST(? AS BIGINT)` is required: without it Postgres infers the param as
  // int4 from the int4 window literals, so the bound `Date.now()` ms epoch
  // overflows int4. The cast keeps the subtraction 64-bit; a no-op on SQLite.
  return `(CAST(? AS BIGINT) - CASE WHEN dispatch_mode LIKE 'background%' THEN ${BACKGROUND_RUN_STALE_MS} ELSE ${RUN_STALE_MS} END)`;
}

/**
 * Atomically claim a background-dispatched run for processing. The foreground
 * POST inserts the run row with `dispatch_mode = 'background'`; the FIRST
 * delivery of the background dispatch flips it to `background-processing` and
 * wins the claim. A duplicate Netlify delivery (background functions can be
 * retried) sees `background-processing` and loses, so it no-ops — mirroring
 * `claimAgentTeamRun` returning null. Returns true when this caller won.
 *
 * Idempotent and conditional: the WHERE clause only matches the unclaimed
 * `background` state AND a still-running row, so a reaped/terminal row can't be
 * re-claimed.
 */
export async function claimBackgroundRun(runId: string): Promise<boolean> {
  await ensureRunTables();
  const client = getDbExec();
  const { rowsAffected } = await client.execute({
    sql: `UPDATE agent_runs
          SET dispatch_mode = 'background-processing'
          WHERE id = ?
            AND status = 'running'
            AND dispatch_mode = 'background'`,
    args: [runId],
  });
  return (rowsAffected ?? 0) > 0;
}

/**
 * Read the claim/lifecycle state of a single run by id — for the foreground
 * circuit-breaker that confirms a background worker actually CLAIMED a run that
 * was dispatched with a Netlify async 202. A 202 only means the invocation was
 * ENQUEUED; if the generated background-function wrapper fails to import/hand off
 * to the route it never reaches `claimBackgroundRun`, leaving the row stuck at
 * `dispatch_mode = 'background'`. `'background-processing'` means a worker won
 * the claim; a terminal `status` means the run already resolved. Returns null if
 * the row is missing.
 */
export async function readBackgroundRunClaim(runId: string): Promise<{
  dispatchMode: string | null;
  status: string | null;
  diagStage: string | null;
  workerStage: string | null;
  lastLivenessAt: number | null;
} | null> {
  await ensureRunTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT dispatch_mode, status, diag_stage, worker_stage, started_at, heartbeat_at FROM agent_runs WHERE id = ? LIMIT 1`,
    args: [runId],
  });
  const row = rows?.[0] as
    | {
        dispatch_mode?: string | null;
        status?: string | null;
        diag_stage?: string | null;
        worker_stage?: string | null;
        started_at?: number | null;
        heartbeat_at?: number | null;
      }
    | undefined;
  if (!row) return null;
  return {
    dispatchMode: row.dispatch_mode ?? null,
    status: row.status ?? null,
    diagStage: row.diag_stage ?? null,
    workerStage: row.worker_stage ?? null,
    // Same liveness basis the unclaimed-reaper uses (COALESCE(heartbeat_at,
    // started_at)), so the foreground can decide to recover BEFORE the reaper.
    lastLivenessAt: row.heartbeat_at ?? row.started_at ?? null,
  };
}

/**
 * Resolve the authenticated owner email for a run by joining it to its chat
 * thread. The durable background worker's self-dispatch is cookieless
 * (HMAC-only — see `AGENT_CHAT_PROCESS_RUN_PATH`), so it has no session for the
 * normal owner resolution and would otherwise be treated as unauthenticated.
 * The thread's `owner_email` was written by the authenticated foreground when it
 * created the thread, so it is a trusted, non-forgeable owner source: only the
 * HMAC-signed `runId` selects the row, and the caller cannot influence which
 * owner that row maps to. Returns null when the run (or its thread) is missing.
 */
export async function getRunOwnerEmail(runId: string): Promise<string | null> {
  await ensureRunTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT t.owner_email AS owner_email FROM agent_runs r JOIN chat_threads t ON r.thread_id = t.id WHERE r.id = ? LIMIT 1`,
    args: [runId],
  });
  const row = rows?.[0] as { owner_email?: string | null } | undefined;
  return row?.owner_email ?? null;
}

/**
 * Atomically acquire a run lease for a thread. Succeeds (returns true) only
 * when no other run for the same thread is currently status='running' with a
 * fresh heartbeat. Works for both Postgres and SQLite: the stale-cutoff
 * comparison lets a dead producer's run be replaced without waiting for the
 * reaper, mirroring the logic in `reapIfStale`.
 *
 * Callers that win the claim then insert the run row normally; callers that
 * lose skip the run and return the existing active runId to the caller.
 */
export async function tryClaimRunSlot(
  threadId: string,
  maxStaleMs?: number,
): Promise<{ claimed: boolean; activeRunId: string | null }> {
  await ensureRunTables();
  const client = getDbExec();
  const now = Date.now();
  // Default: per-row background-aware window so a live background run (which can
  // legitimately go >15s between heartbeats during a cold-start) isn't seen as
  // "free" and double-claimed by a racing foreground POST. An explicit
  // `maxStaleMs` override keeps a flat window for callers that want one.
  if (typeof maxStaleMs === "number") {
    const heartbeatCutoff = now - maxStaleMs;
    const { rows } = await client.execute({
      sql: `SELECT id FROM agent_runs
            WHERE thread_id = ?
              AND status = 'running'
              AND COALESCE(heartbeat_at, started_at) >= ?
            ORDER BY started_at DESC LIMIT 1`,
      args: [threadId, heartbeatCutoff],
    });
    if (rows.length > 0) {
      return { claimed: false, activeRunId: (rows[0] as { id: string }).id };
    }
    return { claimed: true, activeRunId: null };
  }
  const { rows } = await client.execute({
    sql: `SELECT id FROM agent_runs
          WHERE thread_id = ?
            AND status = 'running'
            AND COALESCE(heartbeat_at, started_at) >= ${backgroundAwareStaleCutoffSql()}
          ORDER BY started_at DESC LIMIT 1`,
    args: [threadId, now],
  });
  if (rows.length > 0) {
    const row = rows[0] as { id: string };
    return { claimed: false, activeRunId: row.id };
  }
  return { claimed: true, activeRunId: null };
}

/**
 * Record terminal failure classification for a run so cut-off / errored runs
 * can be surfaced for pattern analysis (see listErroredRuns). Best-effort —
 * never throws, since it runs on the completion path that must not fail the run.
 */
export async function setRunError(
  runId: string,
  errorCode: string | undefined,
  errorDetail: string | undefined,
): Promise<void> {
  if (!errorCode && !errorDetail) return;
  try {
    await ensureRunTables();
    const client = getDbExec();
    await client.execute({
      sql: `UPDATE agent_runs SET error_code = ?, error_detail = ? WHERE id = ?`,
      args: [
        errorCode ?? null,
        errorDetail ? errorDetail.slice(0, 2000) : null,
        runId,
      ],
    });
  } catch {
    // Diagnostics are best-effort; never let them break completion.
  }
}

/**
 * Diagnostic stage names recorded onto a background run as it moves through the
 * `_process-run` worker pipeline. Each value is the LAST stage successfully
 * reached, so a stuck run's `diag_stage` reveals exactly where it died. Ordered
 * roughly by execution; the literal strings are the client-readable contract.
 */
export const RUN_DIAG_STAGE = {
  /** The `_process-run` route handler was entered (the request reached Nitro). */
  routeEntered: "route_entered",
  /** HMAC auth + body validation in prepareProcessRunRequest FAILED. */
  authFailed: "auth_failed",
  /** HMAC auth + body validation PASSED; about to invoke the worker handler. */
  authPassed: "auth_passed",
  /** The re-entered agent-chat handler recognized itself as the bg worker. */
  workerEntered: "worker_entered",
  /** The worker won the atomic claim (it owns the run). */
  workerClaimed: "worker_claimed",
  /** The worker LOST the claim (a duplicate delivery already owns the run). */
  workerClaimLost: "worker_claim_lost",
  /** The agent loop started (startRun fired). */
  workerStarted: "worker_started",
  /** Last worker setup stage reached before startRun (progressive hang localizer). */
  workerSetupStep: "worker_setup_step",
  /** Pre-claim setup timing breakdown (diagnostic). */
  setupTimings: "setup_timings",
  /** The worker threw before/while running the loop (message carried in detail). */
  workerThrew: "worker_threw",
  /** The route handler caught an error from the worker invocation. */
  routeThrew: "route_threw",
  /**
   * The foreground circuit-breaker fired: a Netlify async 202 was returned but
   * no background worker CLAIMED the run within the foreground grace window
   * (the generated function wrapper never reached the route), so the foreground
   * recovered by running the turn inline. The run still completes for the user.
   */
  foregroundInlineRecovery: "foreground_inline_recovery",
} as const;

export type RunDiagStage = (typeof RUN_DIAG_STAGE)[keyof typeof RUN_DIAG_STAGE];

/**
 * Record the last reached pipeline stage (+ optional short detail) for a run.
 *
 * PURPOSE: a Netlify background function's logs are not readable from the build
 * tooling, so when its worker dies silently the run just times out with no clue
 * WHY. This writes the failure stage straight onto the `agent_runs` row, which
 * `/runs/active` and `listRunsForThread` surface to the client — so the next
 * prod run's death cause is readable WITHOUT bg-fn logs. Cheap, additive, and
 * best-effort: it must never throw or perturb the run (it is called on the auth
 * path BEFORE a 401 is returned, and around the worker body).
 *
 * The stored value is a compact JSON `{ stage, detail?, at }` capped to 2 KB so
 * a long stack can't bloat the row.
 */
export async function recordRunDiagnostic(
  runId: string,
  stage: RunDiagStage,
  detail?: string,
): Promise<void> {
  if (!runId) return;
  try {
    await ensureRunTables();
    const client = getDbExec();
    const payload = JSON.stringify({
      stage,
      ...(detail ? { detail: detail.slice(0, 1500) } : {}),
      at: Date.now(),
    }).slice(0, 2000);
    // Worker-setup stages ALSO land in `worker_stage`, a column the foreground's
    // inline-recovery `setup_timings` write never touches. `/runs/active` only
    // surfaces a run after it is claimed, and the foreground then overwrites
    // `diag_stage` — so without this the durable worker's pre-claim progression
    // (where it stalled before claiming) is unrecoverable. `worker_stage`
    // preserves the last worker stage reached for post-hoc diagnosis.
    const isWorkerStage =
      stage === RUN_DIAG_STAGE.workerSetupStep ||
      stage === RUN_DIAG_STAGE.workerStarted;
    if (isWorkerStage) {
      await client.execute({
        sql: `UPDATE agent_runs SET diag_stage = ?, worker_stage = ? WHERE id = ?`,
        args: [payload, payload, runId],
      });
    } else {
      await client.execute({
        sql: `UPDATE agent_runs SET diag_stage = ? WHERE id = ?`,
        args: [payload, runId],
      });
    }
  } catch {
    // Diagnostics are best-effort; never let them break the run or the route.
  }
}

/** Update the run's liveness heartbeat. Called periodically by run-manager. */
export async function updateRunHeartbeat(runId: string): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  await client.execute({
    sql: `UPDATE agent_runs SET heartbeat_at = ? WHERE id = ?`,
    args: [Date.now(), runId],
  });
}

/**
 * Bump `last_progress_at` — call this whenever the agent actually emits an
 * event (token, tool call, message). Distinct from `heartbeat_at` so the
 * stuck-detector can tell "process alive but nothing happening" from
 * "process dead." Callers should throttle (run-manager debounces to ~1/s).
 */
export async function bumpRunProgress(runId: string): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  await client.execute({
    sql: `UPDATE agent_runs SET last_progress_at = ? WHERE id = ?`,
    args: [Date.now(), runId],
  });
}

/**
 * If the given run is marked "running" in SQL but its heartbeat is stale
 * (producer likely crashed), flip it to "errored" so watchers stop waiting.
 * Returns true if the row was reaped.
 */
export async function reapIfStale(
  runId: string,
  maxStaleMs?: number,
): Promise<boolean> {
  await ensureRunTables();
  const client = getDbExec();
  const completedAt = Date.now();
  // Background-dispatched runs get the wider stale window so a slow cold-start
  // isn't reaped; foreground runs keep the tight 15s window. An explicit
  // override forces a flat window for callers that want one.
  const staleClause =
    typeof maxStaleMs === "number"
      ? `COALESCE(heartbeat_at, started_at) < ?`
      : `COALESCE(heartbeat_at, started_at) < ${backgroundAwareStaleCutoffSql()}`;
  const staleArgs =
    typeof maxStaleMs === "number" ? [completedAt - maxStaleMs] : [completedAt];
  const { rowsAffected } = await client.execute({
    sql: `UPDATE agent_runs
          SET status = 'errored',
              completed_at = ?,
              error_code = ?,
              error_detail = ?
          WHERE id = ?
            AND status = 'running'
            AND ${staleClause}`,
    args: [
      completedAt,
      STALE_RUN_ERROR_EVENT.errorCode,
      STALE_RUN_ERROR_EVENT.details,
      runId,
      ...staleArgs,
    ],
  });
  const reaped = (rowsAffected ?? 0) > 0;
  if (reaped) {
    await safeAppendTerminalRunEvent(
      runId,
      STALE_RUN_ERROR_EVENT,
      "reap-if-stale",
    );
  }
  return reaped;
}

/**
 * FALLBACK HARDENING for the "dispatched with 202 but the worker never started"
 * case. A background-dispatched run sits in `dispatch_mode = 'background'` until
 * the worker wins `claimBackgroundRun` (which flips it to
 * `background-processing`). If the worker silently dies (e.g. the bg-fn 401s
 * before it can claim), the row stays `background`, never heartbeats again, and
 * — because dispatch returned 202 — the foreground already returned the SSE
 * stream, so the existing fast-fail inline fallback never engaged. The run would
 * otherwise hang for the full 90s background window and then error opaquely.
 *
 * This reaps such a run EARLY and DISTINCTLY: a row that is still unclaimed
 * (`dispatch_mode = 'background'`) past the tight `UNCLAIMED_BACKGROUND_RUN_GRACE_MS`
 * grace is a dead handoff — there is no live worker to protect with the wide
 * window — so we flip it to `errored` with the recoverable
 * `background_worker_never_started` code. The client's existing recoverable-error
 * path then lets the user (or auto-recovery) re-drive the turn. Idempotent and
 * conditional: only an unclaimed, still-running, grace-exceeded row matches, so a
 * claimed worker, a fresh dispatch, or a terminal row is never touched.
 *
 * Returns true when this call reaped the run.
 */
export async function reapUnclaimedBackgroundRun(
  runId: string,
): Promise<boolean> {
  await ensureRunTables();
  const client = getDbExec();
  const completedAt = Date.now();
  const cutoff = completedAt - UNCLAIMED_BACKGROUND_RUN_GRACE_MS;
  const { rowsAffected } = await client.execute({
    sql: `UPDATE agent_runs
          SET status = 'errored',
              completed_at = ?,
              error_code = ?,
              error_detail = ?
          WHERE id = ?
            AND status = 'running'
            AND dispatch_mode = 'background'
            AND COALESCE(heartbeat_at, started_at) < ?`,
    args: [
      completedAt,
      UNCLAIMED_BACKGROUND_RUN_ERROR_EVENT.errorCode,
      UNCLAIMED_BACKGROUND_RUN_ERROR_EVENT.details,
      runId,
      cutoff,
    ],
  });
  const reaped = (rowsAffected ?? 0) > 0;
  if (reaped) {
    await recordRunDiagnostic(
      runId,
      RUN_DIAG_STAGE.workerThrew,
      "unclaimed background dispatch reaped (worker never claimed the run)",
    );
    await safeAppendTerminalRunEvent(
      runId,
      UNCLAIMED_BACKGROUND_RUN_ERROR_EVENT,
      "reap-unclaimed-background",
    );
  }
  return reaped;
}

export async function updateRunStatus(
  runId: string,
  status: "completed" | "errored" | "aborted",
): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  await client.execute({
    sql: `UPDATE agent_runs SET status = ?, completed_at = ? WHERE id = ?`,
    args: [status, Date.now(), runId],
  });
}

/**
 * Conditional terminal status write: only updates if the row still belongs to
 * this run AND is still status='running'. Returns true when the update landed.
 *
 * This is the safe variant used by the producer's finally block so a zombie run
 * (reaped while executing) can never clobber the status written by the reaper
 * or a replacement run.
 */
export async function updateRunStatusIfRunning(
  runId: string,
  status: "completed" | "errored" | "aborted",
): Promise<boolean> {
  await ensureRunTables();
  const client = getDbExec();
  const { rowsAffected } = await client.execute({
    sql: `UPDATE agent_runs SET status = ?, completed_at = ? WHERE id = ? AND status = 'running'`,
    args: [status, Date.now(), runId],
  });
  return (rowsAffected ?? 0) > 0;
}

/** Read the current status of a run row. Returns null when the row is missing. */
export async function getRunStatus(runId: string): Promise<string | null> {
  await ensureRunTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT status FROM agent_runs WHERE id = ?`,
    args: [runId],
  });
  if (rows.length === 0) return null;
  return String((rows[0] as { status: string }).status);
}

export async function markRunAborted(
  runId: string,
  reason?: string,
): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  await client.execute({
    sql: `UPDATE agent_runs SET status = 'aborted', abort_reason = ?, completed_at = ? WHERE id = ?`,
    args: [reason ?? "user", Date.now(), runId],
  });
  await safeAppendTerminalRunEvent(runId, { type: "done" }, "mark-aborted");
}

export async function isRunAborted(runId: string): Promise<boolean> {
  return (await getRunAbortState(runId)).aborted;
}

export async function getRunAbortState(
  runId: string,
): Promise<{ aborted: boolean; reason?: string }> {
  await ensureRunTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT status, abort_reason FROM agent_runs WHERE id = ?`,
    args: [runId],
  });
  if (rows.length === 0) return { aborted: false };
  const row = rows[0] as { status: string; abort_reason?: string | null };
  if (row.status !== "aborted") return { aborted: false };
  return {
    aborted: true,
    ...(row.abort_reason ? { reason: row.abort_reason } : {}),
  };
}

export async function insertRunEvent(
  runId: string,
  seq: number,
  eventData: string,
): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  // ON CONFLICT DO NOTHING: a (runId, seq) collision can happen on the
  // soft-timeout / terminal-event path where `pendingTerminalEvent` was
  // assigned a seq that later gets reused by an event pushed after it.
  // It can also race with `appendTerminalRunEvent` (max-seq + 1) when a
  // run aborts at the same time the producer emits its final event.
  // Treat the second write as a no-op so the run completes cleanly.
  await client.execute({
    sql: `INSERT INTO agent_run_events (run_id, seq, event_data) VALUES (?, ?, ?) ON CONFLICT (run_id, seq) DO NOTHING`,
    args: [runId, seq, eventData],
  });
}

export async function getRunEventsSince(
  runId: string,
  fromSeq: number,
): Promise<Array<{ seq: number; eventData: string }>> {
  await ensureRunTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT seq, event_data FROM agent_run_events WHERE run_id = ? AND seq >= ? ORDER BY seq ASC`,
    args: [runId, fromSeq],
  });
  return rows.map((r) => {
    const row = r as { seq: number | string; event_data: string };
    return { seq: Number(row.seq), eventData: row.event_data };
  });
}

export async function getRunById(runId: string): Promise<{
  id: string;
  threadId: string;
  status: string;
  startedAt: number;
} | null> {
  await ensureRunTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id, thread_id, status, started_at FROM agent_runs WHERE id = ?`,
    args: [runId],
  });
  if (rows.length === 0) return null;
  const r = rows[0] as {
    id: string;
    thread_id: string;
    status: string;
    started_at: number | string;
  };
  return {
    id: r.id,
    threadId: r.thread_id,
    status: r.status,
    startedAt: Number(r.started_at),
  };
}

export async function getRunByThread(
  threadId: string,
  options?: { includeTerminal?: boolean },
): Promise<{
  id: string;
  threadId: string;
  turnId?: string | null;
  status: string;
  startedAt: number;
  heartbeatAt: number | null;
  completedAt: number | null;
  lastProgressAt: number | null;
  dispatchMode: string | null;
  diagStage: string | null;
} | null> {
  await ensureRunTables();
  const client = getDbExec();
  const sql = options?.includeTerminal
    ? `SELECT id, thread_id, turn_id, status, started_at, heartbeat_at, completed_at, last_progress_at, dispatch_mode, diag_stage FROM agent_runs WHERE thread_id = ? ORDER BY started_at DESC LIMIT 1`
    : `SELECT id, thread_id, turn_id, status, started_at, heartbeat_at, completed_at, last_progress_at, dispatch_mode, diag_stage FROM agent_runs WHERE thread_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1`;
  const { rows } = await client.execute({ sql, args: [threadId] });
  if (rows.length === 0) return null;
  const r = rows[0] as {
    id: string;
    thread_id: string;
    turn_id?: string | null;
    status: string;
    started_at: number | string;
    heartbeat_at: number | string | null;
    completed_at: number | string | null;
    last_progress_at: number | string | null;
    dispatch_mode?: string | null;
    diag_stage?: string | null;
  };
  return {
    id: r.id,
    threadId: r.thread_id,
    turnId: r.turn_id ?? null,
    status: r.status,
    startedAt: Number(r.started_at),
    heartbeatAt: r.heartbeat_at == null ? null : Number(r.heartbeat_at),
    completedAt: r.completed_at == null ? null : Number(r.completed_at),
    lastProgressAt:
      r.last_progress_at == null ? null : Number(r.last_progress_at),
    dispatchMode: r.dispatch_mode ?? null,
    diagStage: r.diag_stage ?? null,
  };
}

export interface AgentRunSummary {
  id: string;
  threadId: string;
  turnId: string | null;
  status: string;
  startedAt: number;
  heartbeatAt: number | null;
  completedAt: number | null;
  lastProgressAt: number | null;
  errorCode: string | null;
  abortReason: string | null;
  dispatchMode: string | null;
  /** Last reached `_process-run` worker stage (JSON `{stage,detail?,at}`). */
  diagStage: string | null;
}

export async function listRunsForThread(
  threadId: string,
  options: { limit?: number } = {},
): Promise<AgentRunSummary[]> {
  await ensureRunTables();
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id, thread_id, turn_id, status, started_at, heartbeat_at, completed_at, last_progress_at, error_code, abort_reason, dispatch_mode, diag_stage
          FROM agent_runs
          WHERE thread_id = ?
          ORDER BY started_at DESC
          LIMIT ?`,
    args: [threadId, limit],
  });
  return rows.map((r) => {
    const row = r as {
      id: string;
      thread_id: string;
      turn_id?: string | null;
      status: string;
      started_at: number | string;
      heartbeat_at?: number | string | null;
      completed_at?: number | string | null;
      last_progress_at?: number | string | null;
      error_code?: string | null;
      abort_reason?: string | null;
      dispatch_mode?: string | null;
      diag_stage?: string | null;
    };
    return {
      id: row.id,
      threadId: row.thread_id,
      turnId: row.turn_id ?? null,
      status: row.status,
      startedAt: Number(row.started_at),
      heartbeatAt: row.heartbeat_at == null ? null : Number(row.heartbeat_at),
      completedAt: row.completed_at == null ? null : Number(row.completed_at),
      lastProgressAt:
        row.last_progress_at == null ? null : Number(row.last_progress_at),
      errorCode: row.error_code ?? null,
      abortReason: row.abort_reason ?? null,
      dispatchMode: row.dispatch_mode ?? null,
      diagStage: row.diag_stage ?? null,
    };
  });
}

/**
 * Read the current logical turn's recorded events for a thread, parsed into
 * `AgentChatEvent`s in seq order, for per-turn tool-call journal classification
 * (see `tool-call-journal.ts`). Read-only and additive — reuses the existing
 * `agent_runs` / `agent_run_events` ledger with no schema change.
 *
 * A logical turn may span several continuation runs (each chunk is its own run
 * sharing one `turn_id`), so we union the events of every run that belongs to
 * the latest turn for this thread. Events are ordered by (started_at, seq) so
 * earlier chunks come before later ones and the positional `tool_start` →
 * `tool_done` matching in the classifier stays correct across chunk boundaries.
 *
 * Returns an empty array when the thread has no run yet or no parseable events.
 * Best-effort on parse: malformed ledger rows are skipped rather than thrown.
 */
export async function getCurrentTurnEventsForThread(
  threadId: string,
): Promise<AgentChatEvent[]> {
  await ensureRunTables();
  const client = getDbExec();
  // Find the latest run for this thread (terminal or running) to learn the
  // logical turn id. The journal is consulted on the resume path, where the
  // just-interrupted run is typically already terminal.
  const latest = await client.execute({
    sql: `SELECT id, turn_id FROM agent_runs WHERE thread_id = ? ORDER BY started_at DESC LIMIT 1`,
    args: [threadId],
  });
  if (latest.rows.length === 0) return [];
  const latestRow = latest.rows[0] as { id: string; turn_id: string | null };
  const turnId = latestRow.turn_id ?? latestRow.id;
  // Gather every run that belongs to this logical turn, oldest chunk first, and
  // read their events in seq order. COALESCE(turn_id, id) folds older rows that
  // predate the turn_id backfill into a turn keyed by their own run id.
  const { rows } = await client.execute({
    sql: `SELECT e.event_data AS event_data
          FROM agent_run_events e
          JOIN agent_runs r ON r.id = e.run_id
          WHERE r.thread_id = ?
            AND COALESCE(r.turn_id, r.id) = ?
          ORDER BY r.started_at ASC, e.seq ASC`,
    args: [threadId, turnId],
  });
  const events: AgentChatEvent[] = [];
  for (const r of rows) {
    const raw = (r as { event_data?: string }).event_data;
    if (!raw) continue;
    try {
      events.push(JSON.parse(raw) as AgentChatEvent);
    } catch {
      // Skip malformed ledger rows — the journal is best-effort.
    }
  }
  return events;
}

/**
 * Expire any "running" rows whose heartbeat is stale — producer died.
 * Safe to call at server startup on multi-isolate deployments: only rows
 * without a fresh heartbeat get reaped, so runs owned by OTHER live
 * isolates (which keep heartbeating) are left alone.
 */
export async function reapAllStaleRuns(): Promise<number> {
  await ensureRunTables();
  const client = getDbExec();
  const now = Date.now();
  // Background-dispatched runs use the wider window; everything else 15s.
  const stale = await client.execute({
    sql: `SELECT id FROM agent_runs
          WHERE status = 'running'
            AND COALESCE(heartbeat_at, started_at) < ${backgroundAwareStaleCutoffSql()}`,
    args: [now],
  });
  const completedAt = Date.now();
  const { rowsAffected } = await client.execute({
    sql: `UPDATE agent_runs
          SET status = 'errored',
              completed_at = ?,
              error_code = ?,
              error_detail = ?
          WHERE status = 'running'
            AND COALESCE(heartbeat_at, started_at) < ${backgroundAwareStaleCutoffSql()}`,
    args: [
      completedAt,
      STALE_RUN_ERROR_EVENT.errorCode,
      STALE_RUN_ERROR_EVENT.details,
      completedAt,
    ],
  });
  for (const row of stale.rows) {
    const id = (row as { id?: unknown }).id;
    if (typeof id === "string") {
      await safeAppendTerminalRunEvent(
        id,
        STALE_RUN_ERROR_EVENT,
        "reap-all-stale",
      );
    }
  }
  return rowsAffected ?? 0;
}

/** Delete old runs and expire stale "running" rows that haven't had activity
 *  (e.g. worker crashed before updating status). Completed runs are pruned at
 *  `olderThanMs`; errored/aborted runs are kept until `erroredOlderThanMs` (a
 *  longer window, falling back to `olderThanMs`) so their event log survives
 *  for cut-off pattern analysis via listErroredRuns. */
export async function cleanupOldRuns(
  olderThanMs: number,
  erroredOlderThanMs?: number,
): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  const cutoff = Date.now() - olderThanMs;
  const erroredCutoff =
    Date.now() - Math.max(erroredOlderThanMs ?? 0, olderThanMs);
  // Expire stale running rows on the absolute-age threshold — safety net
  // for runs that never received a heartbeat (very old deployments). The
  // SELECT covers BOTH UPDATE conditions so the terminal-event-append loop
  // below catches every row we're about to flip — a 24h-old row with a
  // somehow-fresh heartbeat would slip past a heartbeat-only SELECT.
  const now = Date.now();
  const stale = await client.execute({
    sql: `SELECT id FROM agent_runs
          WHERE status = 'running'
            AND (
              COALESCE(heartbeat_at, started_at) < ${backgroundAwareStaleCutoffSql()}
              OR started_at < ?
    )`,
    args: [now, cutoff],
  });
  const completedAt = Date.now();
  await client.execute({
    sql: `UPDATE agent_runs
          SET status = 'errored',
              completed_at = ?,
              error_code = ?,
              error_detail = ?
          WHERE status = 'running' AND started_at < ?`,
    args: [
      completedAt,
      STALE_RUN_ERROR_EVENT.errorCode,
      STALE_RUN_ERROR_EVENT.details,
      cutoff,
    ],
  });
  // Also expire runs whose heartbeat is stale — producer has died. Uses the
  // background-aware window so a slow background cold-start isn't reaped early.
  await client.execute({
    sql: `UPDATE agent_runs
          SET status = 'errored',
              completed_at = ?,
              error_code = ?,
              error_detail = ?
          WHERE status = 'running'
            AND COALESCE(heartbeat_at, started_at) < ${backgroundAwareStaleCutoffSql()}`,
    args: [
      completedAt,
      STALE_RUN_ERROR_EVENT.errorCode,
      STALE_RUN_ERROR_EVENT.details,
      completedAt,
    ],
  });
  for (const row of stale.rows) {
    const id = (row as { id?: unknown }).id;
    if (typeof id === "string") {
      await safeAppendTerminalRunEvent(
        id,
        STALE_RUN_ERROR_EVENT,
        "cleanup-old-runs",
      );
    }
  }
  // Delete events for old terminal runs. Completed runs prune at `cutoff`;
  // errored/aborted runs are retained until the (longer) `erroredCutoff`.
  await client.execute({
    sql: `DELETE FROM agent_run_events WHERE run_id IN (
      SELECT id FROM agent_runs
      WHERE (status = 'completed' AND completed_at < ?)
         OR (status IN ('errored', 'aborted') AND completed_at < ?)
    )`,
    args: [cutoff, erroredCutoff],
  });
  await client.execute({
    sql: `DELETE FROM agent_runs
          WHERE (status = 'completed' AND completed_at < ?)
             OR (status IN ('errored', 'aborted') AND completed_at < ?)`,
    args: [cutoff, erroredCutoff],
  });
}

/**
 * List recent errored/aborted runs for cut-off pattern analysis. Read-only,
 * bounded, and ordered newest-first. Surfaced via the list-errored-runs action
 * so the team can see why chats are failing (terminal error code, duration,
 * turn linkage) instead of discovering it ad hoc.
 */
export async function listErroredRuns(options?: {
  limit?: number;
  sinceMs?: number;
}): Promise<
  Array<{
    id: string;
    threadId: string;
    turnId: string | null;
    status: string;
    errorCode: string | null;
    errorDetail: string | null;
    startedAt: number;
    completedAt: number | null;
    durationMs: number | null;
  }>
> {
  await ensureRunTables();
  const client = getDbExec();
  const limit = Math.min(Math.max(Math.floor(options?.limit ?? 100), 1), 1000);
  const since =
    options?.sinceMs && options.sinceMs > 0 ? Date.now() - options.sinceMs : 0;
  const { rows } = await client.execute({
    sql: `SELECT id, thread_id, turn_id, status, error_code, error_detail, started_at, completed_at
          FROM agent_runs
          WHERE status IN ('errored', 'aborted')
            AND COALESCE(completed_at, started_at) >= ?
          ORDER BY COALESCE(completed_at, started_at) DESC
          LIMIT ${limit}`,
    args: [since],
  });
  return rows.map((r) => {
    const row = r as {
      id: string;
      thread_id: string;
      turn_id: string | null;
      status: string;
      error_code: string | null;
      error_detail: string | null;
      started_at: number | string;
      completed_at: number | string | null;
    };
    const startedAt = Number(row.started_at);
    const completedAt =
      row.completed_at == null ? null : Number(row.completed_at);
    return {
      id: row.id,
      threadId: row.thread_id,
      turnId: row.turn_id ?? null,
      status: row.status,
      errorCode: row.error_code ?? null,
      errorDetail: row.error_detail ?? null,
      startedAt,
      completedAt,
      durationMs: completedAt == null ? null : completedAt - startedAt,
    };
  });
}

/**
 * Idempotently append a terminal event to a run's event stream. No-op if the
 * stream already ends in a terminal event. Used by reapers AND by SSE
 * reconnect paths that discover an `errored` run row with no terminal event
 * (e.g. an earlier reaper's silent `.catch(() => {})` swallowed the append).
 *
 * Persisting from the reconnect path is what keeps the system self-healing:
 * subsequent reconnects replay the proper terminal event from SQL instead of
 * synthesizing a fresh one each time.
 */
export async function ensureTerminalRunEvent(
  runId: string,
  event: Record<string, unknown>,
): Promise<void> {
  return appendTerminalRunEvent(runId, event);
}

/**
 * Append a terminal run event, retrying once on failure and reporting to
 * Sentry if both attempts fail. Background reaper paths can't surface errors
 * to a user, but they MUST eventually persist a terminal event — losing it
 * leaves reconnecting clients staring at a bare `status='errored'` row with
 * no payload to render. The previous `.catch(() => {})` callsites silently
 * dropped transient SQL blips and produced exactly that bug. Never throws.
 */
async function safeAppendTerminalRunEvent(
  runId: string,
  event: Record<string, unknown>,
  source: string,
): Promise<void> {
  let firstError: unknown;
  try {
    await appendTerminalRunEvent(runId, event);
    return;
  } catch (err) {
    firstError = err;
  }
  // Brief backoff — most "transient" SQL failures (connection blip, lock
  // contention) clear within a couple hundred ms.
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
  try {
    await appendTerminalRunEvent(runId, event);
  } catch (retryErr) {
    captureError(retryErr, {
      tags: {
        component: "agent-run-store",
        operation: "append-terminal-event",
        source,
      },
      extra: {
        runId,
        eventType: typeof event.type === "string" ? event.type : "(unknown)",
        firstError:
          firstError instanceof Error ? firstError.message : String(firstError),
      },
    });
  }
}

async function appendTerminalRunEvent(
  runId: string,
  event: Record<string, unknown>,
): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT seq, event_data FROM agent_run_events WHERE run_id = ? ORDER BY seq DESC LIMIT 1`,
    args: [runId],
  });
  const last = rows[0] as
    | { seq?: number | string; event_data?: string }
    | undefined;
  if (last?.event_data) {
    try {
      const parsed = JSON.parse(last.event_data);
      if (
        parsed?.type === "done" ||
        parsed?.type === "error" ||
        parsed?.type === "missing_api_key" ||
        parsed?.type === "loop_limit" ||
        parsed?.type === "auto_continue"
      ) {
        return;
      }
    } catch {
      // Ignore malformed rows and append the terminal event.
    }
  }
  const nextSeq = last ? Number(last.seq ?? -1) + 1 : 0;
  await client.execute({
    sql: `INSERT INTO agent_run_events (run_id, seq, event_data) VALUES (?, ?, ?) ON CONFLICT (run_id, seq) DO NOTHING`,
    args: [runId, nextSeq, JSON.stringify(event)],
  });
}
