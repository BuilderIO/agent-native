import {
  MAX_BACKGROUND_RUN_CONTINUATIONS,
  TURN_RUN_LEDGER_SLACK,
} from "../app-config/run-lifecycle-invariants.js";
import {
  isArtifactReceipt,
  type ArtifactReceipt,
} from "../artifacts/detect.js";
import type { DbExec } from "../db/client.js";
import { getDbExec } from "../db/client.js";
import { ensureColumnExists, ensureTableExists } from "../db/ddl-guard.js";
import { widenIntColumnsToBigInt } from "../db/widen-columns.js";
import { captureError } from "../server/capture-error.js";
import {
  LLM_MISSING_CREDENTIALS_ERROR_CODE,
  LLM_MISSING_CREDENTIALS_MESSAGE,
} from "./engine/credential-errors.js";
import { isContinuationTerminalReason } from "./types.js";
import type { AgentChatEvent, ContinuationReason } from "./types.js";

let _initPromise: Promise<void> | undefined;

export const RUN_STALE_MS = 15_000;

export const BACKGROUND_RUN_STALE_MS = 90_000;

export const BACKGROUND_PROCESSING_RUN_STALE_MS = 45_000;

export const STALE_RUN_ERROR_EVENT = {
  type: "error",
  error:
    "The agent stopped before it could finish. It may have hit a server timeout or the worker may have been interrupted.",
  errorCode: "stale_run",
  recoverable: true,
  details:
    "The run heartbeat stopped while the run was still marked running. Partial output and tool calls were preserved when available.",
} as const;

export const STALE_RUN_TERMINAL_REASON = `error:${STALE_RUN_ERROR_EVENT.errorCode}`;

export const UNCLAIMED_BACKGROUND_RUN_ERROR_EVENT = {
  type: "error",
  error:
    "The agent run was handed off to a background worker that never started. It was recovered so you can try again.",
  errorCode: "background_worker_never_started",
  recoverable: true,
  details:
    "A background-dispatched run was acknowledged (HTTP 202) but its worker never claimed the run, so no progress was produced. The run was reaped early (it had no live worker to protect) so the turn can be retried.",
} as const;

export const CLAIMED_BACKGROUND_WORKER_FAILED_ERROR_EVENT = {
  type: "error",
  error:
    "The background agent worker stopped before it could start the turn. You can retry from the preserved chat context.",
  errorCode: "background_worker_failed",
  recoverable: true,
  details:
    "The durable background worker claimed the run but threw during setup before it could emit agent events.",
} as const;

export const RUN_RECORD_MISSING_ERROR_EVENT = {
  type: "error",
  error:
    "The agent run record is no longer available, so this turn could not be confirmed as finished. Retry if the result is missing.",
  errorCode: "run_record_missing",
  recoverable: true,
  details:
    "No agent_runs row existed for this run when the live connection last checked, and no terminal event was persisted for it. The run may have completed before its record was pruned.",
} as const;

export const UNKNOWN_RUN_STATUS_ERROR_EVENT = {
  type: "error",
  error:
    "The agent run ended in a state this app does not recognize, so the result could not be confirmed. Retry if the result is missing.",
  errorCode: "unknown_run_status",
  recoverable: true,
  details:
    "The run row left 'running' with a status the live connection has no terminal event for. Partial output and tool calls were preserved when available.",
} as const;

export const RUN_TERMINAL_LOOKUP_FAILED_ERROR_EVENT = {
  type: "error",
  error:
    "The agent run's final state could not be read, so this turn could not be confirmed as finished. Retry if the result is missing.",
  errorCode: "run_terminal_lookup_failed",
  recoverable: true,
  details:
    "Reading the run's last persisted terminal event failed. The run may have completed; its outcome is unknown to this connection rather than known to be absent.",
} as const;

export const RUN_RECORD_MISSING_GRACE_MS = 15_000;

export const UNCLAIMED_BACKGROUND_RUN_GRACE_MS = 25_000;

export const UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS = 5 * 60_000;

/**
 * Tick interval for the DEDICATED fast redispatch sweep in
 * agent-chat-plugin.ts (distinct from that file's general-purpose 2-minute
 * orphan/reap sweep). Only attempts redispatch for rows still inside
 * `UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS` — it never reaps, so it
 * cannot race the loud-failure fallback onto an earlier trigger.
 *
 * This constant exists because the general sweep's 2-minute cadence puts the
 * FIRST redispatch attempt uncomfortably close to (and on a slow tick, past)
 * `BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS` (150s, agent-chat-adapter.ts) — the
 * client following a deferred successor would give up and report a fatal
 * error for a turn the server was silently about to recover. The whole
 * budget is a derived chain, each bound following from the one before it:
 *
 *   UNCLAIMED_BACKGROUND_RUN_GRACE_MS        (25s)  row must look abandoned
 * + UNCLAIMED_BACKGROUND_RUN_FAST_SWEEP_MS   (20s)  worst-case tick latency
 * = ~45s worst-case time-to-first-redispatch-attempt, ~65s to a second
 *   attempt if the first fails — both comfortably under the client's 150s
 *   idle timeout, which additionally no longer counts a known-deferred row
 *   against its idle window at all (see `awaitingRedispatch` surfaced by
 *   `/runs/active` and consumed by the client follow loop).
 * < BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS       (150s) client's own backstop
 * < UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS (300s) hard, unresettable
 *   ceiling — untouched by this constant — past which the slow sweep's
 *   existing loud reap (`background_worker_never_started`) still fires.
 */
export const UNCLAIMED_BACKGROUND_RUN_FAST_SWEEP_MS = 20_000;

const NO_RUNNING_RUNS_CACHE_MS = 5_000;

let _noRunningRunsUntil = 0;

export function __resetNoRunningRunsProbeForTests(): void {
  _noRunningRunsUntil = 0;
}

async function hasRunningRuns(): Promise<boolean> {
  if (Date.now() < _noRunningRunsUntil) return false;
  const { rows } = await getDbExec().execute({
    sql: `SELECT id FROM agent_runs WHERE status = 'running' LIMIT 1`,
    args: [],
  });
  if ((rows?.length ?? 0) > 0) {
    _noRunningRunsUntil = 0;
    return true;
  }
  _noRunningRunsUntil = Date.now() + NO_RUNNING_RUNS_CACHE_MS;
  return false;
}

export function resolveTurnRunLedgerBudget(): number {
  return MAX_BACKGROUND_RUN_CONTINUATIONS + TURN_RUN_LEDGER_SLACK;
}

export function turnRunLedgerExhausted(turnRunCount: number): boolean {
  return turnRunCount >= resolveTurnRunLedgerBudget();
}

/**
 * Circuit breaker for a DETERMINISTIC dead-on-arrival loop: some request
 * shapes make the worker hang almost immediately every single time (e.g. an
 * un-timed-out provider fetch that blocks the event loop) rather than merely
 * hitting a transient blip. Because `attemptStaleRunRecovery` replays the
 * SAME captured `dispatch_payload` on every successor (never a fresh
 * request), such a turn was retrying an unwinnable request up to
 * `resolveTurnRunLedgerBudget()` (25) times — ~25 * 53s ≈ 22 minutes,
 * each cycle re-billing the full input context — before finally giving up.
 * Confirmed live in prod (assets: one turn cycled 24x, each attempt an
 * identical ~32K-token request that made a token of real progress around
 * ~8s in then went completely silent for the rest of its life until the 45s
 * reap). Stop recovering after this many CONSECUTIVE stale_run reaps that
 * each made near-zero real progress — a single blip never trips it (needs
 * 3 in a row), and a run that's genuinely grinding through long work right
 * up to its heartbeat window is untouched (see `hasNoForwardProgress`).
 */
const STALE_RUN_RECOVERY_CONSECUTIVE_NO_PROGRESS_LIMIT = 3;

const STALE_RUN_RECOVERY_NO_PROGRESS_WINDOW_MS = 20_000;

export const STALE_RUN_RECOVERY_MAX_SUCCESSORS_PER_TURN = 3;

export const IN_FLIGHT_RUN_STALE_GRACE_MS = 14.5 * 60_000;

export const IN_FLIGHT_GRACE_MAX_LIVENESS_GAP_MS = 120_000;

export async function ensureRunTables(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const agentRunsCreateSql = `
        CREATE TABLE IF NOT EXISTS agent_runs (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          abort_reason TEXT,
          started_at BIGINT NOT NULL,
          completed_at BIGINT,
          heartbeat_at BIGINT,
          last_progress_at BIGINT,
          turn_id TEXT,
          error_code TEXT,
          error_detail TEXT,
          terminal_reason TEXT,
          dispatch_mode TEXT,
          diag_stage TEXT,
          dispatch_payload TEXT,
          peak_rss_mb BIGINT,
          continuation_order BIGINT
        )
      `;
      const agentRunEventsCreateSql = `
        CREATE TABLE IF NOT EXISTS agent_run_events (
          run_id TEXT NOT NULL,
          seq BIGINT NOT NULL,
          event_at BIGINT,
          event_data TEXT NOT NULL,
          PRIMARY KEY (run_id, seq)
        )
      `;
      const agentRunOutcomeDailyCreateSql = `
        CREATE TABLE IF NOT EXISTS agent_run_outcome_daily (
          day TEXT NOT NULL,
          status TEXT NOT NULL,
          terminal_reason TEXT NOT NULL DEFAULT '',
          run_count BIGINT NOT NULL DEFAULT 0,
          PRIMARY KEY (day, status, terminal_reason)
        )
      `;
      const agentToolLedgerCreateSql = `
        CREATE TABLE IF NOT EXISTS agent_tool_ledger (
          thread_id TEXT NOT NULL,
          tool_key TEXT NOT NULL,
          result_summary TEXT NOT NULL,
          artifacts_json TEXT,
          completed_at BIGINT NOT NULL,
          PRIMARY KEY (thread_id, tool_key)
        )
      `;

      await ensureTableExists("agent_runs", agentRunsCreateSql);
      for (const [col, colType] of [
        ["heartbeat_at", "BIGINT"],
        ["abort_reason", "TEXT"],
        ["last_progress_at", "BIGINT"],
        ["turn_id", "TEXT"],
        ["error_code", "TEXT"],
        ["error_detail", "TEXT"],
        ["terminal_reason", "TEXT"],
        ["dispatch_mode", "TEXT"],
        ["diag_stage", "TEXT"],
        ["worker_stage", "TEXT"],
        ["peak_rss_mb", "BIGINT"],
        ["dispatch_payload", "TEXT"],
        ["in_flight_since", "BIGINT"],
        ["continuation_order", "BIGINT"],
      ] as const) {
        await ensureColumnExists(
          "agent_runs",
          col,
          `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS ${col} ${colType}`,
        );
      }
      await ensureTableExists("agent_run_events", agentRunEventsCreateSql);
      await ensureColumnExists(
        "agent_run_events",
        "event_at",
        `ALTER TABLE agent_run_events ADD COLUMN IF NOT EXISTS event_at BIGINT`,
      );
      await ensureTableExists("agent_tool_ledger", agentToolLedgerCreateSql);
      await ensureColumnExists(
        "agent_tool_ledger",
        "artifacts_json",
        `ALTER TABLE agent_tool_ledger ADD COLUMN IF NOT EXISTS artifacts_json TEXT`,
      );
      await ensureTableExists(
        "agent_run_outcome_daily",
        agentRunOutcomeDailyCreateSql,
      );
      await widenIntColumnsToBigInt("agent_runs", [
        "started_at",
        "completed_at",
        "heartbeat_at",
        "last_progress_at",
        "in_flight_since",
        "continuation_order",
      ]);
      await widenIntColumnsToBigInt("agent_run_events", ["event_at"]);
      await widenIntColumnsToBigInt("agent_tool_ledger", ["completed_at"]);
      return;
    })().catch((err) => {
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

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
  artifacts: ArtifactReceipt[] = [],
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
      sql: `INSERT INTO agent_tool_ledger (thread_id, tool_key, result_summary, artifacts_json, completed_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (thread_id, tool_key) DO UPDATE SET
              result_summary = excluded.result_summary,
              artifacts_json = excluded.artifacts_json,
              completed_at = excluded.completed_at`,
      args: [threadId, toolKey, capped, JSON.stringify(artifacts), Date.now()],
    });
  } catch {
    // Ledger is best-effort; never surface failures to the caller.
  }
}

export async function readLedgerEntry(
  threadId: string,
  toolKey: string,
): Promise<{ result: string; artifacts: ArtifactReceipt[] } | null> {
  try {
    await ensureRunTables();
    const client = getDbExec();
    const { rows } = await client.execute({
      sql: `SELECT result_summary, artifacts_json FROM agent_tool_ledger WHERE thread_id = ? AND tool_key = ?`,
      args: [threadId, toolKey],
    });
    if (rows.length === 0) return null;
    const row = rows[0] as {
      result_summary: string;
      artifacts_json?: string | null;
    };
    return {
      result: row.result_summary,
      artifacts: parseLedgerArtifacts(row.artifacts_json, threadId, toolKey),
    };
  } catch {
    return null;
  }
}

function parseLedgerArtifacts(
  artifactsJson: string | null | undefined,
  threadId: string,
  toolKey: string,
): ArtifactReceipt[] {
  if (artifactsJson === null || artifactsJson === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(artifactsJson);
    if (!Array.isArray(parsed)) {
      throw new Error("agent_tool_ledger.artifacts_json is not an array");
    }
    const artifacts = parsed.filter(isArtifactReceipt);
    if (artifacts.length !== parsed.length) {
      captureError(
        new Error("agent_tool_ledger.artifacts_json contains invalid receipts"),
        {
          tags: {
            component: "agent-run-store",
            operation: "parse-tool-ledger-artifacts",
          },
          extra: { threadId, toolKey },
        },
      );
    }
    return artifacts;
  } catch (error) {
    captureError(error, {
      tags: {
        component: "agent-run-store",
        operation: "parse-tool-ledger-artifacts",
      },
      extra: { threadId, toolKey },
    });
    return [];
  }
}

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
  options?: {
    dispatchMode?: "foreground" | "foreground-self-chain" | "background";
    dispatchPayload?: string;
    continuationOrder?: number;
  },
): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  const now = Date.now();
  const logicalTurnId = turnId ?? id;
  const explicitContinuationOrder = normalizeContinuationOrder(
    options?.continuationOrder,
  );
  const insert = async (db: DbExec, continuationOrder: number) => {
    await db.execute({
      sql: `INSERT INTO agent_runs (id, thread_id, status, started_at, heartbeat_at, last_progress_at, turn_id, dispatch_mode, dispatch_payload, continuation_order) VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      args: [
        id,
        threadId,
        now,
        now,
        now,
        logicalTurnId,
        options?.dispatchMode ?? null,
        options?.dispatchPayload ?? null,
        continuationOrder,
      ],
    });
  };
  if (!client.transaction) {
    await lockContinuationOrder(client, threadId, logicalTurnId);
    await insert(
      client,
      explicitContinuationOrder ??
        (await nextContinuationOrder(client, threadId, logicalTurnId)),
    );
    return;
  }
  await client.transaction(async (tx) => {
    await lockContinuationOrder(tx, threadId, logicalTurnId);
    await insert(
      tx,
      explicitContinuationOrder ??
        (await nextContinuationOrder(tx, threadId, logicalTurnId)),
    );
  });
}

function normalizeContinuationOrder(
  value: number | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid continuation order: ${String(value)}`);
  }
  return value;
}

function continuationOrderLockKey(threadId: string, turnId: string): string {
  return `agent-native:run-order:${threadId}:${turnId}`;
}

async function lockContinuationOrder(
  db: DbExec,
  threadId: string,
  turnId: string,
): Promise<void> {
  await db.execute({
    sql: "SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))",
    args: [continuationOrderLockKey(threadId, turnId)],
  });
}

async function nextContinuationOrder(
  db: DbExec,
  threadId: string,
  turnId: string,
): Promise<number> {
  await lockContinuationOrder(db, threadId, turnId);
  const { rows } = await db.execute({
    sql: `SELECT MAX(continuation_order) AS max_order
          FROM agent_runs
          WHERE thread_id = ? AND COALESCE(turn_id, id) = ?`,
    args: [threadId, turnId],
  });
  const rawMax = (rows?.[0] as { max_order?: unknown } | undefined)?.max_order;
  if (rawMax === null || rawMax === undefined) return 0;
  const maxOrder = Number(rawMax);
  if (!Number.isSafeInteger(maxOrder) || maxOrder < 0) {
    throw new Error(`Invalid stored continuation order: ${String(rawMax)}`);
  }
  if (maxOrder === Number.MAX_SAFE_INTEGER) {
    throw new Error("Continuation order exhausted");
  }
  return maxOrder + 1;
}

function backgroundAwareStaleCutoffSql(): string {
  return `(CAST(? AS BIGINT) - CASE WHEN dispatch_mode = 'background-processing' AND dispatch_payload IS NOT NULL THEN ${BACKGROUND_PROCESSING_RUN_STALE_MS} WHEN dispatch_mode LIKE 'background%' THEN ${BACKGROUND_RUN_STALE_MS} ELSE ${RUN_STALE_MS} END)`;
}

export function staleWindowMsForRow(row: {
  dispatchMode?: string | null;
  hasDispatchPayload?: boolean;
  maxStaleMs?: number;
}): number {
  if (typeof row.maxStaleMs === "number") return row.maxStaleMs;
  const mode = row.dispatchMode ?? "";
  if (mode === "background-processing" && row.hasDispatchPayload)
    return BACKGROUND_PROCESSING_RUN_STALE_MS;
  if (mode.startsWith("background")) return BACKGROUND_RUN_STALE_MS;
  return RUN_STALE_MS;
}

export function describeStaleReap(row: {
  startedAt?: number | null;
  heartbeatAt?: number | null;
  lastProgressAt?: number | null;
  inFlightSince?: number | null;
  dispatchMode?: string | null;
  hasDispatchPayload?: boolean;
  maxStaleMs?: number;
  now: number;
}): string {
  const { now } = row;
  const started = row.startedAt ?? null;
  const heartbeat = row.heartbeatAt ?? null;
  const progress = row.lastProgressAt ?? null;
  const liveness = Math.max(
    progress ?? started ?? 0,
    heartbeat ?? started ?? 0,
  );
  const parts: string[] = [
    `window=${staleWindowMsForRow(row)}`,
    `dispatch=${row.dispatchMode ?? "none"}`,
    `redispatchable=${row.hasDispatchPayload ? "1" : "0"}`,
  ];
  if (heartbeat != null) parts.push(`sinceHeartbeat=${now - heartbeat}`);
  if (progress != null) parts.push(`sinceProgress=${now - progress}`);
  if (heartbeat != null && progress != null)
    parts.push(`hbAheadOfProgress=${heartbeat - progress}`);
  if (started != null && liveness >= started)
    parts.push(`runAge=${liveness - started}`);
  parts.push(`inFlight=${row.inFlightSince != null ? "1" : "0"}`);
  if (row.inFlightSince != null)
    parts.push(`inFlightFor=${now - row.inFlightSince}`);
  return parts.join(" ");
}

function terminalRunEventExclusionSql(runIdColumn = "id"): string {
  return `NOT EXISTS (
    SELECT 1 FROM agent_run_events terminal_events
    WHERE terminal_events.run_id = agent_runs.${runIdColumn}
      AND (
        terminal_events.event_data LIKE '{"type":"done"%'
        OR terminal_events.event_data LIKE '{"type":"error"%'
        OR terminal_events.event_data LIKE '{"type":"missing_api_key"%'
        OR terminal_events.event_data LIKE '{"type":"loop_limit"%'
        OR terminal_events.event_data LIKE '{"type":"auto_continue"%'
      )
  )`;
}

function livenessBasisSql(): string {
  return `(CASE WHEN COALESCE(last_progress_at, started_at) > COALESCE(heartbeat_at, started_at) THEN COALESCE(last_progress_at, started_at) ELSE COALESCE(heartbeat_at, started_at) END)`;
}

/**
 * Additive grace clause for the default (no explicit `maxStaleMs` override)
 * heartbeat/liveness-based stale reap conditions — TRUE (row remains eligible
 * for the surrounding staleness check) unless `in_flight_since` is set AND
 * still inside `IN_FLIGHT_RUN_STALE_GRACE_MS`. A row with no marker set
 * (`in_flight_since IS NULL`, the common case and every pre-existing row
 * before this migration) always evaluates TRUE here, so this can only make
 * reaping MORE conservative — the no-in-flight `BACKGROUND_RUN_STALE_MS` /
 * `RUN_STALE_MS` behavior is unchanged. See `IN_FLIGHT_RUN_STALE_GRACE_MS`'s
 * doc comment for why this is sound and bounded.
 *
 * The grace additionally requires the producer to still be demonstrably
 * heartbeating: a marker on a row whose liveness basis is itself dead by more
 * than `IN_FLIGHT_GRACE_MAX_LIVENESS_GAP_MS` is a latched corpse, not a slow
 * tool, and gets no extension.
 *
 * Binds two params, both the same `now` the surrounding cutoff clause binds.
 */
function inFlightGraceSql(): string {
  return `(in_flight_since IS NULL
    OR in_flight_since <= (CAST(? AS BIGINT) - ${IN_FLIGHT_RUN_STALE_GRACE_MS})
    OR ${livenessBasisSql()} < (CAST(? AS BIGINT) - ${IN_FLIGHT_GRACE_MAX_LIVENESS_GAP_MS}))`;
}

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
    lastLivenessAt: row.heartbeat_at ?? row.started_at ?? null,
  };
}

export async function readRunDispatchPayload(
  runId: string,
): Promise<string | null> {
  await ensureRunTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT dispatch_payload FROM agent_runs WHERE id = ? LIMIT 1`,
    args: [runId],
  });
  const row = rows?.[0] as { dispatch_payload?: string | null } | undefined;
  if (!row) return null;
  const payload = row.dispatch_payload;
  return typeof payload === "string" && payload.length > 0 ? payload : null;
}

export async function clearRunDispatchPayload(runId: string): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  await client.execute({
    sql: `UPDATE agent_runs SET dispatch_payload = NULL WHERE id = ?`,
    args: [runId],
  });
}

export async function listUnclaimedBackgroundRunIds(): Promise<string[]> {
  await ensureRunTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id FROM agent_runs
          WHERE status = 'running'
            AND dispatch_mode = 'background'
            AND COALESCE(heartbeat_at, started_at) < (CAST(? AS BIGINT) - ${UNCLAIMED_BACKGROUND_RUN_GRACE_MS})`,
    args: [Date.now()],
  });
  const ids: string[] = [];
  for (const row of rows ?? []) {
    const id = (row as { id?: unknown }).id;
    if (typeof id === "string" && id) ids.push(id);
  }
  return ids;
}

export interface UnclaimedBackgroundRunRow {
  id: string;
  startedAt: number;
  /**
   * Whether the row still carries the `dispatch_payload` a redispatched worker
   * would rehydrate its request body from. Eligibility for this sweep does NOT
   * imply it: a background row can reach the grace window having never had a
   * payload at all. Redispatching one of those asserts `payloadRef: true` to a
   * worker that then cannot rehydrate, so it kills the run as
   * `dispatch_payload_missing` — a reason that reads like data loss for what is
   * really an un-redispatchable handoff.
   */
  hasDispatchPayload: boolean;
}

export const UNCLAIMED_BACKGROUND_RUN_SWEEP_BATCH_LIMIT = 4;

export async function listUnclaimedBackgroundRunRows(options?: {
  limit?: number;
}): Promise<UnclaimedBackgroundRunRow[]> {
  await ensureRunTables();
  if (!(await hasRunningRuns())) return [];
  const client = getDbExec();
  const requestedLimit =
    options?.limit ?? UNCLAIMED_BACKGROUND_RUN_SWEEP_BATCH_LIMIT;
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.floor(requestedLimit))
    : UNCLAIMED_BACKGROUND_RUN_SWEEP_BATCH_LIMIT;
  const { rows } = await client.execute({
    sql: `SELECT id, started_at, (dispatch_payload IS NOT NULL) AS has_dispatch_payload FROM agent_runs
          WHERE status = 'running'
            AND dispatch_mode = 'background'
            AND COALESCE(heartbeat_at, started_at) < (CAST(? AS BIGINT) - ${UNCLAIMED_BACKGROUND_RUN_GRACE_MS})
          ORDER BY COALESCE(heartbeat_at, started_at) ASC, started_at ASC
          LIMIT ${limit}`,
    args: [Date.now()],
  });
  const result: UnclaimedBackgroundRunRow[] = [];
  for (const row of rows ?? []) {
    const id = (row as { id?: unknown }).id;
    const startedAt = (row as { started_at?: unknown }).started_at;
    const hasPayload = (row as { has_dispatch_payload?: unknown })
      .has_dispatch_payload;
    if (typeof id === "string" && id) {
      result.push({
        id,
        startedAt:
          typeof startedAt === "number" ? startedAt : Number(startedAt) || 0,
        hasDispatchPayload: hasPayload === true,
      });
    }
  }
  return result;
}

export function shouldRedispatchUnclaimedBackgroundRun(
  row: { startedAt: number },
  now: number = Date.now(),
): boolean {
  return now - row.startedAt < UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS;
}

export async function countRunsForTurn(
  threadId: string,
  turnId: string,
): Promise<number> {
  await ensureRunTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT COUNT(*) AS run_count FROM agent_runs WHERE thread_id = ? AND turn_id = ?`,
    args: [threadId, turnId],
  });
  const raw = (rows?.[0] as { run_count?: unknown } | undefined)?.run_count;
  const count = Number(raw);
  return Number.isFinite(count) ? count : 0;
}

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

export async function tryClaimRunSlot(
  threadId: string,
  runId: string,
  maxStaleMs?: number,
  options?: {
    turnId?: string;
    replayCompletedTurn?: boolean;
    dispatchMode?: "foreground" | "foreground-self-chain" | "background";
    dispatchPayload?: string;
    continuationOrder?: number;
  },
): Promise<{
  claimed: boolean;
  activeRunId: string | null;
  completedRunId?: string;
  turnAborted?: boolean;
}> {
  await ensureRunTables();
  const client = getDbExec();
  const now = Date.now();
  const turnId = options?.turnId ?? runId;
  const replayCompletedTurn =
    options?.replayCompletedTurn === true && Boolean(options.turnId);
  if (!client.transaction) {
    throw new Error("Atomic run-slot claims require transaction support");
  }
  return client.transaction(async (tx) => {
    await tx.execute({
      sql: "SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))",
      args: [`agent-native:run-slot:${threadId}`],
    });
    await lockContinuationOrder(tx, threadId, turnId);
    const abortMarker = await tx.execute({
      sql: `SELECT id FROM agent_runs WHERE thread_id = ? AND turn_id = ? AND dispatch_mode = 'turn-abort' AND status = 'aborted' LIMIT 1`,
      args: [threadId, turnId],
    });
    if (abortMarker.rows.length > 0) {
      return { claimed: false, activeRunId: null, turnAborted: true };
    }
    const explicitCutoff = typeof maxStaleMs === "number";
    const active = await tx.execute({
      sql: `SELECT id FROM agent_runs
            WHERE thread_id = ?
              AND status = 'running'
              AND ${terminalRunEventExclusionSql()}
              AND ${livenessBasisSql()} >= ${explicitCutoff ? "?" : backgroundAwareStaleCutoffSql()}
            ORDER BY started_at DESC LIMIT 1`,
      args: [threadId, explicitCutoff ? now - maxStaleMs : now],
    });
    const activeRunId = (active.rows[0] as { id?: string } | undefined)?.id;
    if (activeRunId) return { claimed: false, activeRunId };

    if (replayCompletedTurn) {
      const latest = await tx.execute({
        sql: `SELECT id,
                     EXISTS (
                       SELECT 1 FROM agent_run_events terminal_events
                       WHERE terminal_events.run_id = agent_runs.id
                         AND (
                           terminal_events.event_data LIKE ?
                           OR terminal_events.event_data LIKE ?
                           OR terminal_events.event_data LIKE ?
                           OR terminal_events.event_data LIKE ?
                         )
                     ) AS has_terminal_event
              FROM agent_runs
              WHERE thread_id = ? AND turn_id = ?
              ORDER BY started_at DESC LIMIT 1`,
        args: [
          '{"type":"done"%',
          '{"type":"error"%',
          '{"type":"missing_api_key"%',
          '{"type":"loop_limit"%',
          threadId,
          turnId,
        ],
      });
      const latestRun = latest.rows[0] as
        | { id?: string; has_terminal_event?: boolean }
        | undefined;
      if (latestRun?.id && latestRun.has_terminal_event === true) {
        return {
          claimed: false,
          activeRunId: null,
          completedRunId: latestRun.id,
        };
      }
    }

    const continuationOrder =
      normalizeContinuationOrder(options?.continuationOrder) ??
      (await nextContinuationOrder(tx, threadId, turnId));
    const inserted = await tx.execute({
      sql: `INSERT INTO agent_runs (id, thread_id, status, started_at, heartbeat_at, last_progress_at, turn_id, dispatch_mode, dispatch_payload, continuation_order) VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      args: [
        runId,
        threadId,
        now,
        now,
        now,
        turnId,
        options?.dispatchMode ?? null,
        options?.dispatchPayload ?? null,
        continuationOrder,
      ],
    });
    if ((inserted.rowsAffected ?? 0) !== 1) {
      throw new Error(`Failed to insert claimed run ${runId}`);
    }
    return { claimed: true, activeRunId: null };
  });
}

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

export async function setRunTerminalReason(
  runId: string,
  terminalReason: string | undefined,
): Promise<void> {
  if (!terminalReason) return;
  try {
    await ensureRunTables();
    const client = getDbExec();
    const reason = terminalReason.slice(0, 200);
    // Write-once for a row that is already terminal. Three writers in three
    // isolates race on this column — the mid-run checkpoint, the run-manager's
    // finalization, and the background worker's failure path — with no ordering
    // between them, and last-writer-wins let a late checkpoint relabel a row
    // another isolate had already finalized. That produced impossible rows
    // (status='errored' carrying a continuation reason, no error_code, no
    // terminal event) and misattributed 130 production runs to a failure mode
    // they never hit. A row still `running` has no honest reason yet, so it
    // stays writable; once one is recorded on a terminal row, it stands.
    const guard = `AND (status = 'running' OR terminal_reason IS NULL OR terminal_reason = '')`;
    await client.execute({
      sql: isContinuationTerminalReason(reason)
        ? `UPDATE agent_runs SET terminal_reason = ?, status = CASE WHEN status = 'completed' THEN 'truncated' ELSE status END WHERE id = ? ${guard}`
        : `UPDATE agent_runs SET terminal_reason = ? WHERE id = ? ${guard}`,
      args: [reason, runId],
    });
  } catch {
    // Diagnostics are best-effort; never let them break completion.
  }
}

/**
 * INVARIANT: a terminal event yields `completed` if and only if its reason is
 * `done`. Everything else either failed (`errored`) or stopped short
 * (`truncated`). Keep this in lockstep with `terminalReasonForEvent` below.
 */
function terminalStatusForEvent(
  event: AgentChatEvent,
): "completed" | "truncated" | "errored" | null {
  if (event.type === "error") return "errored";
  if (event.type === "missing_api_key") return "errored";
  if (event.type === "done") return "completed";
  if (event.type === "loop_limit" || event.type === "auto_continue") {
    return "truncated";
  }
  return null;
}

function terminalReasonForEvent(event: AgentChatEvent): string | null {
  if (event.type === "auto_continue") return event.reason || "auto_continue";
  if (event.type === "loop_limit") return "loop_limit";
  if (event.type === "missing_api_key") return "missing_api_key";
  if (event.type === "error") return `error:${event.errorCode || "unknown"}`;
  if (event.type === "done") return "done";
  return null;
}

function isRealFailureTerminalEvent(event: AgentChatEvent): boolean {
  if (event.type === "missing_api_key") return true;
  if (event.type !== "error") return false;
  return event.errorCode !== STALE_RUN_ERROR_EVENT.errorCode;
}

const RUN_RECONCILIATION_TERMINAL_EVENT_LIMIT = 100;

async function getRunEventForReconciliation(runId: string): Promise<{
  event: AgentChatEvent;
  eventAt: number | null;
} | null> {
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT seq, event_data, event_at
          FROM agent_run_events
          WHERE run_id = ?
            AND (
              event_data LIKE '{"type":"done"%'
              OR event_data LIKE '{"type":"error"%'
              OR event_data LIKE '{"type":"missing_api_key"%'
              OR event_data LIKE '{"type":"loop_limit"%'
              OR event_data LIKE '{"type":"auto_continue"%'
            )
          ORDER BY seq DESC
          LIMIT ?`,
    args: [runId, RUN_RECONCILIATION_TERMINAL_EVENT_LIMIT],
  });
  let latestTerminal: {
    event: AgentChatEvent;
    eventAt: number | null;
  } | null = null;
  for (const row of rows as Array<{
    event_at?: number | string | null;
    event_data?: string;
  }>) {
    const raw = row.event_data;
    if (!raw) continue;
    try {
      const event = JSON.parse(raw) as AgentChatEvent;
      if (!terminalStatusForEvent(event) || !terminalReasonForEvent(event)) {
        continue;
      }
      const rawEventAt = row.event_at == null ? NaN : Number(row.event_at);
      const parsed = {
        event,
        eventAt:
          Number.isFinite(rawEventAt) && rawEventAt > 0 ? rawEventAt : null,
      };
      if (!latestTerminal) latestTerminal = parsed;
      if (isRealFailureTerminalEvent(event)) return parsed;
    } catch {
      continue;
    }
  }
  return latestTerminal;
}

function errorCodeForTerminalEvent(event: AgentChatEvent): string | null {
  if (event.type === "missing_api_key")
    return LLM_MISSING_CREDENTIALS_ERROR_CODE;
  if (event.type === "error") return event.errorCode ?? null;
  return null;
}

function errorDetailForTerminalEvent(event: AgentChatEvent): string | null {
  if (event.type === "missing_api_key") return LLM_MISSING_CREDENTIALS_MESSAGE;
  if (event.type !== "error") return null;
  return (event.details || event.error || "").slice(0, 2000) || null;
}

/**
 * Repair a run whose terminal event was durably appended but whose final
 * `agent_runs.status` write lost a race with reconnect/reaper code.
 *
 * The event ledger is the durable transcript users see. If its latest event is
 * terminal, the run is no longer alive and must not be converted into a stale
 * error later. This keeps `agent_runs` and `agent_run_events` from telling two
 * different stories after delayed DB writes or background function teardown.
 */
export async function reconcileTerminalRunFromEvents(
  runId: string,
): Promise<boolean> {
  await ensureRunTables();
  const latest = await getRunEventForReconciliation(runId);
  if (!latest) return false;
  const status = terminalStatusForEvent(latest.event);
  const terminalReason = terminalReasonForEvent(latest.event);
  if (!status || !terminalReason) return false;

  const client = getDbExec();
  const errorCode = errorCodeForTerminalEvent(latest.event);
  const errorDetail = errorDetailForTerminalEvent(latest.event);
  const { rows: currentRows } = await client.execute({
    sql: `SELECT status, error_code, terminal_reason, completed_at FROM agent_runs WHERE id = ?`,
    args: [runId],
  });
  const current = currentRows[0] as
    | {
        status?: string | null;
        error_code?: string | null;
        terminal_reason?: string | null;
        completed_at?: number | string | null;
      }
    | undefined;
  if (
    current &&
    current.status === status &&
    (current.error_code ?? null) === (errorCode ?? null) &&
    (current.terminal_reason ?? null) === terminalReason &&
    current.completed_at != null
  ) {
    return false;
  }
  const { rowsAffected } = await client.execute({
    sql: `UPDATE agent_runs
          SET status = ?,
              completed_at = COALESCE(completed_at, ?, ${livenessBasisSql()}),
              error_code = ?,
              error_detail = ?,
              terminal_reason = ?
          WHERE id = ?
            AND (
              status = 'running'
              OR (status = 'errored' AND error_code = ?)
            )`,
    args: [
      status,
      latest.eventAt,
      errorCode,
      errorDetail,
      terminalReason,
      runId,
      STALE_RUN_ERROR_EVENT.errorCode,
    ],
  });
  return (rowsAffected ?? 0) > 0;
}

export const RUN_DIAG_STAGE = {
  routeEntered: "route_entered",
  authFailed: "auth_failed",
  authPassed: "auth_passed",
  workerEntered: "worker_entered",
  workerClaimed: "worker_claimed",
  workerClaimLost: "worker_claim_lost",
  workerStarted: "worker_started",
  workerSetupStep: "worker_setup_step",
  setupTimings: "setup_timings",
  workerThrew: "worker_threw",
  routeThrew: "route_threw",
  foregroundInlineRecovery: "foreground_inline_recovery",
  staleRunRecoveryAttempted: "stale_run_recovery_attempted",
  runBoundaryReached: "run_boundary_reached",
  staleRunReaped: "stale_run_reaped",
} as const;

export type RunDiagStage = (typeof RUN_DIAG_STAGE)[keyof typeof RUN_DIAG_STAGE];

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

const HEARTBEAT_WRITE_TIMEOUT_MS = Math.floor(RUN_STALE_MS / 3);

export async function updateRunHeartbeat(runId: string): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  await client.execute({
    sql: `UPDATE agent_runs
          SET heartbeat_at = ?,
              peak_rss_mb = CASE
                WHEN peak_rss_mb IS NULL OR peak_rss_mb < ? THEN ?
                ELSE peak_rss_mb
              END
          WHERE id = ? AND status = 'running'`,
    args: [Date.now(), currentRssMb(), currentRssMb(), runId],
    timeoutMs: HEARTBEAT_WRITE_TIMEOUT_MS,
    maxAttempts: 1,
  });
}

function currentRssMb(): number {
  try {
    const rss = process.memoryUsage?.().rss;
    return typeof rss === "number" ? Math.round(rss / 1024 / 1024) : 0;
  } catch {
    return 0;
  }
}

export async function bumpRunProgress(runId: string): Promise<boolean> {
  await ensureRunTables();
  const client = getDbExec();
  const now = Date.now();
  const { rowsAffected } = await client.execute({
    sql: `UPDATE agent_runs SET last_progress_at = CASE WHEN last_progress_at IS NULL OR last_progress_at < ? THEN ? ELSE last_progress_at END WHERE id = ? AND status = 'running'`,
    args: [now, now, runId],
  });
  return (rowsAffected ?? 0) > 0;
}

/**
 * Mirror run-manager's in-memory `inFlightWorkCount` 0<->N transitions into
 * SQL so a stale reaper running in a DIFFERENT isolate can tell a
 * demonstrably-alive run (holding a tool call or A2A `agent_call` delegation)
 * apart from a genuinely dead one — see `IN_FLIGHT_RUN_STALE_GRACE_MS`'s doc
 * comment for the full reasoning.
 *
 * `inFlight: true` only writes when the row is still `NULL` — a defense-in-
 * depth belt-and-suspenders against a nested 1->2 transition clobbering the
 * ORIGINAL start time with a later one (the caller's own counter already
 * dedupes 0->1 transitions; this WHERE just makes the write itself
 * idempotent/order-independent too). When `markerSince` is supplied for a
 * clear, the UPDATE is conditional on the marker still having that value. The
 * run manager serializes marker writes and supplies this token so a delayed
 * clear from one tool cannot erase a newer tool's marker.
 *
 * Best-effort: callers fire-and-forget so a write failure here never blocks
 * event emission or aborts the run. The run manager logs marker-write failures
 * while preserving transition order. If this write itself fails (the same DB
 * pressure that could be starving the heartbeat), the row simply gets no grace
 * - never worse than today's behavior.
 */
export async function setRunInFlightMarker(
  runId: string,
  inFlight: boolean,
  markerSince?: number,
): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  if (inFlight) {
    await client.execute({
      sql: `UPDATE agent_runs SET in_flight_since = ? WHERE id = ? AND status = 'running' AND in_flight_since IS NULL`,
      args: [markerSince ?? Date.now(), runId],
    });
  } else {
    await client.execute({
      sql:
        markerSince == null
          ? `UPDATE agent_runs SET in_flight_since = NULL WHERE id = ?`
          : `UPDATE agent_runs SET in_flight_since = NULL WHERE id = ? AND in_flight_since = ?`,
      args: markerSince == null ? [runId] : [runId, markerSince],
    });
  }
}

interface StaleRunRecoverySuccessor {
  successorRunId: string;
  threadId: string;
  turnId: string;
}

type StaleRunRecoveryOutcome =
  | ({ outcome: "recovered" } & StaleRunRecoverySuccessor)
  | { outcome: "not_background" }
  | { outcome: "not_redispatchable" }
  | { outcome: "newer_run_exists" }
  | { outcome: "budget_exhausted" }
  | { outcome: "repeated_no_progress" };

function generateRecoveryRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function staleRecoveryDispatchPayload(payload: string): string {
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return payload;
    }
    return JSON.stringify({
      ...(parsed as Record<string, unknown>),
      internalContinuation: true,
    });
  } catch {
    return payload;
  }
}

async function attemptStaleRunRecovery(
  db: DbExec,
  runId: string,
): Promise<StaleRunRecoveryOutcome> {
  const { rows } = await db.execute({
    sql: `SELECT thread_id, turn_id, dispatch_mode, dispatch_payload, started_at FROM agent_runs WHERE id = ? LIMIT 1`,
    args: [runId],
  });
  const row = rows?.[0] as
    | {
        thread_id?: string | null;
        turn_id?: string | null;
        dispatch_mode?: string | null;
        dispatch_payload?: string | null;
        started_at?: number | string | null;
      }
    | undefined;
  const dispatchMode = row?.dispatch_mode ?? "";
  if (!row?.thread_id || !dispatchMode.startsWith("background")) {
    return { outcome: "not_background" };
  }
  const payload = row.dispatch_payload;
  if (typeof payload !== "string" || payload.length === 0) {
    return { outcome: "not_redispatchable" };
  }
  const threadId = row.thread_id;
  const turnId = row.turn_id ?? runId;
  const startedAt = Number(row.started_at) || 0;

  await lockContinuationOrder(db, threadId, turnId);

  const { rows: newerRows } = await db.execute({
    sql: `SELECT id FROM agent_runs WHERE turn_id = ? AND id != ? AND started_at > ? LIMIT 1`,
    args: [turnId, runId, startedAt],
  });
  if ((newerRows?.length ?? 0) > 0) {
    return { outcome: "newer_run_exists" };
  }

  const { rows: countRows } = await db.execute({
    sql: `SELECT COUNT(*) AS run_count FROM agent_runs WHERE thread_id = ? AND turn_id = ?`,
    args: [threadId, turnId],
  });
  const turnRunCount = Number(
    (countRows?.[0] as { run_count?: unknown } | undefined)?.run_count,
  );
  if (Number.isFinite(turnRunCount) && turnRunLedgerExhausted(turnRunCount)) {
    return { outcome: "budget_exhausted" };
  }

  const { rows: staleCountRows } = await db.execute({
    sql: `SELECT COUNT(*) AS stale_count FROM agent_runs WHERE turn_id = ? AND error_code = ? AND id <> ?`,
    args: [turnId, STALE_RUN_ERROR_EVENT.errorCode, runId],
  });
  const staleSuccessorCount = Number(
    (staleCountRows?.[0] as { stale_count?: unknown } | undefined)?.stale_count,
  );
  if (
    Number.isFinite(staleSuccessorCount) &&
    staleSuccessorCount >= STALE_RUN_RECOVERY_MAX_SUCCESSORS_PER_TURN
  ) {
    return { outcome: "repeated_no_progress" };
  }

  const { rows: recentRows } = await db.execute({
    sql: `SELECT error_code, started_at, last_progress_at FROM agent_runs WHERE turn_id = ? ORDER BY started_at DESC LIMIT ?`,
    args: [turnId, STALE_RUN_RECOVERY_CONSECUTIVE_NO_PROGRESS_LIMIT],
  });
  const recent = (recentRows ?? []) as Array<{
    error_code?: string | null;
    started_at: number | string;
    last_progress_at: number | string | null;
  }>;
  const allDeadOnArrival =
    recent.length === STALE_RUN_RECOVERY_CONSECUTIVE_NO_PROGRESS_LIMIT &&
    recent.every((r) => {
      if (r.error_code !== STALE_RUN_ERROR_EVENT.errorCode) return false;
      const started = Number(r.started_at) || 0;
      const progress =
        r.last_progress_at == null ? null : Number(r.last_progress_at);
      return (
        progress === null ||
        progress - started < STALE_RUN_RECOVERY_NO_PROGRESS_WINDOW_MS
      );
    });
  if (allDeadOnArrival) {
    return { outcome: "repeated_no_progress" };
  }

  const successorRunId = generateRecoveryRunId();
  const now = Date.now();
  const continuationOrder = await nextContinuationOrder(db, threadId, turnId);
  await db.execute({
    sql: `INSERT INTO agent_runs (id, thread_id, status, started_at, heartbeat_at, last_progress_at, turn_id, dispatch_mode, dispatch_payload, continuation_order) VALUES (?, ?, 'running', ?, ?, ?, ?, 'background', ?, ?) ON CONFLICT (id) DO NOTHING`,
    args: [
      successorRunId,
      threadId,
      now,
      now,
      now,
      turnId,
      staleRecoveryDispatchPayload(payload),
      continuationOrder,
    ],
  });
  return { outcome: "recovered", successorRunId, threadId, turnId };
}

function attemptStaleRunRecoveryDispatch(successorRunId: string): void {
  void (async () => {
    try {
      const [
        {
          AGENT_CHAT_BACKGROUND_RUN_FIELD,
          resolveAgentChatProcessRunDispatchPath,
        },
        { fireInternalDispatch },
      ] = await Promise.all([
        import("./durable-background.js"),
        import("../server/self-dispatch.js"),
      ]);
      await fireInternalDispatch({
        path: resolveAgentChatProcessRunDispatchPath(),
        taskId: successorRunId,
        body: {
          internalContinuation: true,
          [AGENT_CHAT_BACKGROUND_RUN_FIELD]: {
            runId: successorRunId,
            payloadRef: true,
          },
        },
      });
    } catch (err) {
      console.error(
        "[run-store] stale-run recovery redispatch attempt failed (leaving successor claimable for the sweep):",
        successorRunId,
        err instanceof Error ? err.message : err,
      );
    }
  })();
}

function priorDiagStageLabel(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { stage?: unknown }).stage === "string"
    ) {
      return (parsed as { stage: string }).stage;
    }
  } catch {
    // coercion-ok: not the `{stage,...}` JSON shape — the raw text is returned
    // below, so the caller still sees the original value, not a blank.
  }
  return raw.slice(0, 120);
}

async function reapSingleStaleRun(
  runId: string,
  maxStaleMs?: number,
): Promise<boolean> {
  const completedAt = Date.now();
  const staleClause =
    typeof maxStaleMs === "number"
      ? `${livenessBasisSql()} < ?`
      : `${livenessBasisSql()} < ${backgroundAwareStaleCutoffSql()} AND ${inFlightGraceSql()}`;
  const staleArgs =
    typeof maxStaleMs === "number"
      ? [completedAt - maxStaleMs]
      : [completedAt, completedAt, completedAt];
  const updateSql = `UPDATE agent_runs
          SET status = 'errored',
              completed_at = COALESCE(completed_at, ${livenessBasisSql()}),
              error_code = ?,
              error_detail = ?,
              terminal_reason = ?
          WHERE id = ?
            AND status = 'running'
            AND ${terminalRunEventExclusionSql()}
            AND ${staleClause}`;
  const updateArgs = [
    STALE_RUN_ERROR_EVENT.errorCode,
    STALE_RUN_ERROR_EVENT.details,
    STALE_RUN_TERMINAL_REASON,
    runId,
    ...staleArgs,
  ];

  const client = getDbExec();
  let reaped = false;
  let outcome: StaleRunRecoveryOutcome | null = null;
  if (client.transaction) {
    await client.transaction(async (tx) => {
      const { rowsAffected } = await tx.execute({
        sql: updateSql,
        args: updateArgs,
      });
      reaped = (rowsAffected ?? 0) > 0;
      if (reaped) {
        outcome = await attemptStaleRunRecovery(tx, runId).catch(() => null);
      }
    });
  } else {
    outcome = await attemptStaleRunRecovery(client, runId).catch(() => null);
    const { rowsAffected } = await client.execute({
      sql: updateSql,
      args: updateArgs,
    });
    reaped = (rowsAffected ?? 0) > 0;
  }

  let forensics = "";
  let priorStageInfo = "";
  if (reaped) {
    const read = await client
      .execute({
        sql: `SELECT started_at, heartbeat_at, last_progress_at, in_flight_since,
                     dispatch_mode, dispatch_payload, diag_stage, worker_stage
                FROM agent_runs WHERE id = ?`,
        args: [runId],
      })
      .then((res) => {
        const row = (res.rows as unknown as Array<Record<string, unknown>>)[0];
        if (!row)
          return { forensics: "forensics=row_missing", priorStageInfo: "" };
        const num = (v: unknown) => (v == null ? null : Number(v));
        const priorParts: string[] = [];
        const priorDiag = priorDiagStageLabel(row.diag_stage);
        const priorWorker = priorDiagStageLabel(row.worker_stage);
        if (priorDiag) priorParts.push(`priorDiag=${priorDiag}`);
        if (priorWorker) priorParts.push(`priorWorker=${priorWorker}`);
        return {
          forensics: describeStaleReap({
            startedAt: num(row.started_at),
            heartbeatAt: num(row.heartbeat_at),
            lastProgressAt: num(row.last_progress_at),
            inFlightSince: num(row.in_flight_since),
            dispatchMode: (row.dispatch_mode as string | null) ?? null,
            hasDispatchPayload: row.dispatch_payload != null,
            ...(typeof maxStaleMs === "number" ? { maxStaleMs } : {}),
            now: completedAt,
          }),
          priorStageInfo: priorParts.join(" "),
        };
      })
      // Best-effort throughout: a diagnostic that could fail a reap would be
      // strictly worse than no diagnostic. But an empty string reads as "reaped
      // with nothing worth saying" — the exact ambiguity these forensics exist
      // to remove — so an unreadable row says so instead of going quiet.
      .catch((err) => ({
        forensics: `forensics=unreadable ${(err instanceof Error ? err.message : String(err)).slice(0, 120)}`,
        priorStageInfo: "",
      }));
    forensics = read.forensics;
    priorStageInfo = read.priorStageInfo;
  }

  if (reaped && outcome && outcome.outcome !== "not_background") {
    const outcomeDetail =
      outcome.outcome === "recovered"
        ? `recovered successorRunId=${outcome.successorRunId}`
        : `declined reason=${outcome.outcome}`;
    const detail = priorStageInfo
      ? `${outcomeDetail} ${priorStageInfo}`
      : outcomeDetail;
    await recordRunDiagnostic(
      runId,
      RUN_DIAG_STAGE.staleRunRecoveryAttempted,
      forensics ? `${detail} ${forensics}` : detail,
    ).catch(() => {});
    if (outcome.outcome === "recovered") {
      attemptStaleRunRecoveryDispatch(outcome.successorRunId);
    }
  } else if (reaped && forensics) {
    await recordRunDiagnostic(
      runId,
      RUN_DIAG_STAGE.staleRunReaped,
      forensics,
    ).catch(() => {});
  }

  return reaped;
}

export async function reapIfStale(
  runId: string,
  maxStaleMs?: number,
): Promise<boolean> {
  await ensureRunTables();
  if (await reconcileTerminalRunFromEvents(runId)) return false;
  const reaped = await reapSingleStaleRun(runId, maxStaleMs);
  if (!reaped && (await reconcileTerminalRunFromEvents(runId))) return false;
  if (reaped) {
    await safeAppendTerminalRunEvent(
      runId,
      STALE_RUN_ERROR_EVENT,
      "reap-if-stale",
    );
  }
  return reaped;
}

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
              error_detail = ?,
              terminal_reason = ?
          WHERE id = ?
            AND status = 'running'
            AND dispatch_mode = 'background'
            AND COALESCE(heartbeat_at, started_at) < ?`,
    args: [
      completedAt,
      UNCLAIMED_BACKGROUND_RUN_ERROR_EVENT.errorCode,
      UNCLAIMED_BACKGROUND_RUN_ERROR_EVENT.details,
      UNCLAIMED_BACKGROUND_RUN_ERROR_EVENT.errorCode,
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
  status: "completed" | "truncated" | "errored" | "aborted",
): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  await client.execute({
    sql: `UPDATE agent_runs SET status = ?, completed_at = ?, dispatch_payload = NULL WHERE id = ?`,
    args: [status, Date.now(), runId],
  });
}

export async function updateRunStatusIfRunning(
  runId: string,
  status: "completed" | "truncated" | "errored" | "aborted",
): Promise<boolean> {
  await ensureRunTables();
  const client = getDbExec();
  const { rowsAffected } = await client.execute({
    sql: `UPDATE agent_runs SET status = ?, completed_at = ?, dispatch_payload = NULL WHERE id = ? AND status = 'running'`,
    args: [status, Date.now(), runId],
  });
  return (rowsAffected ?? 0) > 0;
}

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

const TURN_ENDING_ABORT_REASONS = new Set(["user", "displaced"]);
const USER_INITIATED_ABORT_REASONS = new Set(["user", "abort"]);

const RECOVERABLE_ABORT_REASONS = new Set(["background_worker_died"]);

export function terminalEventForAbortReason(
  reason: string | undefined,
): AgentChatEvent {
  const normalized = (reason ?? "").trim() || "user";
  if (isContinuationTerminalReason(normalized)) {
    return {
      type: "auto_continue",
      reason: normalized as ContinuationReason,
    };
  }
  if (
    TURN_ENDING_ABORT_REASONS.has(normalized) ||
    USER_INITIATED_ABORT_REASONS.has(normalized) ||
    normalized.startsWith("user_")
  ) {
    return {
      type: "done",
      ...(normalized !== "displaced" ? { reason: "user" } : {}),
    };
  }
  return {
    type: "error",
    error: "The agent run was stopped before it finished.",
    errorCode: `aborted_${normalized}`,
    recoverable: RECOVERABLE_ABORT_REASONS.has(normalized),
  };
}

export async function markRunAborted(
  runId: string,
  reason?: string,
): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  const { rowsAffected } = await client.execute({
    sql: `UPDATE agent_runs SET status = 'aborted', abort_reason = ?, completed_at = ?, terminal_reason = ? WHERE id = ? AND status = 'running'`,
    args: [reason ?? "user", Date.now(), `aborted:${reason ?? "user"}`, runId],
  });
  if ((rowsAffected ?? 0) > 0) {
    await safeAppendTerminalRunEvent(
      runId,
      terminalEventForAbortReason(reason) as unknown as Record<string, unknown>,
      "mark-aborted",
    );
  }
}

function turnAbortMarkerRunId(threadId: string, turnId: string): string {
  return `turn-abort:${encodeURIComponent(threadId)}:${encodeURIComponent(turnId)}`;
}

export async function markTurnAborted(
  threadId: string,
  turnId: string,
  reason: string = "user",
): Promise<"aborted" | "already_terminal"> {
  await ensureRunTables();
  const now = Date.now();
  const client = getDbExec();
  if (!client.transaction) {
    throw new Error("Atomic turn cancellation requires transaction support");
  }
  const runIds: string[] = [];
  const outcome = await client.transaction(async (tx) => {
    await tx.execute({
      sql: "SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))",
      args: [`agent-native:run-slot:${threadId}`],
    });
    const running = await tx.execute({
      sql: `SELECT id FROM agent_runs WHERE thread_id = ? AND turn_id = ? AND status = 'running' AND dispatch_mode IS DISTINCT FROM 'turn-abort' FOR UPDATE`,
      args: [threadId, turnId],
    });
    runIds.push(
      ...running.rows
        .map((row) => String((row as { id?: unknown }).id ?? ""))
        .filter(Boolean),
    );
    if (runIds.length === 0) {
      const existing = await tx.execute({
        sql: `SELECT id, terminal_reason,
                     EXISTS (
                       SELECT 1 FROM agent_run_events
                       WHERE agent_run_events.run_id = agent_runs.id
                         AND (
                           event_data LIKE ?
                           OR event_data LIKE ?
                         )
                     ) AS continuation_pending
              FROM agent_runs
              WHERE thread_id = ? AND turn_id = ?
                AND dispatch_mode IS DISTINCT FROM 'turn-abort'
              ORDER BY started_at DESC LIMIT 1 FOR UPDATE`,
        args: [
          '{"type":"loop_limit"%',
          '{"type":"auto_continue"%',
          threadId,
          turnId,
        ],
      });
      const latest = existing.rows[0] as
        | { terminal_reason?: string | null; continuation_pending?: boolean }
        | undefined;
      if (
        latest &&
        latest.continuation_pending !== true &&
        !isContinuationTerminalReason(latest.terminal_reason ?? "")
      ) {
        return "already_terminal" as const;
      }
    } else {
      await tx.execute({
        sql: `UPDATE agent_runs SET status = 'aborted', abort_reason = ?, completed_at = ?, terminal_reason = ? WHERE thread_id = ? AND turn_id = ? AND status = 'running'`,
        args: [reason, now, `aborted:${reason}`, threadId, turnId],
      });
    }
    await tx.execute({
      sql: `INSERT INTO agent_runs (id, thread_id, status, abort_reason, started_at, completed_at, heartbeat_at, last_progress_at, turn_id, terminal_reason, dispatch_mode) VALUES (?, ?, 'aborted', ?, ?, ?, ?, ?, ?, ?, 'turn-abort'), (?, ?, 'aborted', ?, ?, ?, ?, ?, ?, ?, 'turn-abort') ON CONFLICT (id) DO NOTHING`,
      args: [
        turnAbortMarkerRunId(threadId, turnId),
        threadId,
        reason,
        now,
        now,
        now,
        now,
        turnId,
        `aborted:${reason}`,
        `turn-abort-${turnId}`,
        threadId,
        reason,
        now,
        now,
        now,
        now,
        turnId,
        `aborted:${reason}`,
      ],
    });
    return "aborted" as const;
  });
  if (outcome === "already_terminal") return outcome;
  await Promise.all(
    runIds.map((runId) =>
      safeAppendTerminalRunEvent(
        runId,
        terminalEventForAbortReason(reason) as unknown as Record<
          string,
          unknown
        >,
        "mark-turn-aborted",
      ),
    ),
  );
  return outcome;
}

export async function getRunTurnRef(
  runId: string,
): Promise<{ threadId: string; turnId: string } | null> {
  await ensureRunTables();
  const { rows } = await getDbExec().execute({
    sql: `SELECT thread_id, turn_id FROM agent_runs WHERE id = ?`,
    args: [runId],
  });
  const row = rows[0] as { thread_id?: unknown; turn_id?: unknown } | undefined;
  const threadId = row?.thread_id ? String(row.thread_id) : "";
  if (!threadId) return null;
  return { threadId, turnId: row?.turn_id ? String(row.turn_id) : runId };
}

export async function isTurnAborted(
  threadId: string,
  turnId: string,
): Promise<boolean> {
  await ensureRunTables();
  const { rows } = await getDbExec().execute({
    sql: `SELECT id FROM agent_runs WHERE id IN (?, ?) AND thread_id = ? AND status = 'aborted' LIMIT 1`,
    args: [
      turnAbortMarkerRunId(threadId, turnId),
      `turn-abort-${turnId}`,
      threadId,
    ],
  });
  return rows.length > 0;
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
  await client.execute({
    sql: `INSERT INTO agent_run_events (run_id, seq, event_at, event_data)
      SELECT ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM agent_runs
        WHERE id = ? AND status <> 'running'
      )
      ON CONFLICT (run_id, seq) DO NOTHING`,
    args: [runId, seq, Date.now(), eventData, runId],
  });
}

export const CHECKPOINT_TERMINAL_EVENT_SEQ = 1_000_000_000;

export async function persistRunCheckpointEvent(
  runId: string,
  event: AgentChatEvent,
  terminalReason: string,
): Promise<void> {
  await insertRunEvent(
    runId,
    CHECKPOINT_TERMINAL_EVENT_SEQ,
    JSON.stringify(event),
  );
  await setRunTerminalReason(runId, terminalReason);
}

export async function getRunEventsSince(
  runId: string,
  fromSeq: number,
): Promise<Array<{ seq: number; eventData: string }>> {
  await ensureRunTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT seq, event_data FROM agent_run_events WHERE run_id = ? AND seq >= ? AND seq < ? ORDER BY seq ASC`,
    args: [runId, fromSeq, CHECKPOINT_TERMINAL_EVENT_SEQ],
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
  errorCode: string | null;
  errorDetail: string | null;
  terminalReason: string | null;
} | null> {
  await ensureRunTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id, thread_id, status, started_at, error_code, error_detail, terminal_reason FROM agent_runs WHERE id = ?`,
    args: [runId],
  });
  if (rows.length === 0) return null;
  const r = rows[0] as {
    id: string;
    thread_id: string;
    status: string;
    started_at: number | string;
    error_code?: string | null;
    error_detail?: string | null;
    terminal_reason?: string | null;
  };
  return {
    id: r.id,
    threadId: r.thread_id,
    status: r.status,
    startedAt: Number(r.started_at),
    errorCode: r.error_code ?? null,
    errorDetail: r.error_detail ?? null,
    terminalReason: r.terminal_reason ?? null,
  };
}

export async function getLastTerminalRunEvent(
  runId: string,
): Promise<{ seq: number; event: Record<string, unknown> } | null> {
  await ensureRunTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT seq, event_data FROM agent_run_events WHERE run_id = ? ORDER BY seq DESC LIMIT 1`,
    args: [runId],
  });
  const last = rows[0] as
    | { seq?: number | string; event_data?: string }
    | undefined;
  if (!last?.event_data) return null;
  try {
    const parsed = JSON.parse(last.event_data) as Record<string, unknown>;
    if (
      parsed?.type === "done" ||
      parsed?.type === "error" ||
      parsed?.type === "missing_api_key" ||
      parsed?.type === "loop_limit" ||
      parsed?.type === "auto_continue"
    ) {
      return { seq: Number(last.seq ?? 0), event: parsed };
    }
  } catch {
    return null;
  }
  return null;
}

export function resolveErroredRunTerminalEvent(run: {
  errorCode?: string | null;
  errorDetail?: string | null;
}): {
  event: Record<string, unknown>;
  shouldPersist: boolean;
} {
  const code = typeof run.errorCode === "string" ? run.errorCode.trim() : "";
  const detail =
    typeof run.errorDetail === "string" ? run.errorDetail.trim() : "";
  if (code === STALE_RUN_ERROR_EVENT.errorCode) {
    return { event: { ...STALE_RUN_ERROR_EVENT }, shouldPersist: true };
  }
  if (detail || (code && code !== "unknown")) {
    return {
      event: {
        type: "error",
        error: detail || "The agent run failed.",
        ...(code && code !== "unknown" ? { errorCode: code } : {}),
      },
      shouldPersist: true,
    };
  }
  return { event: { ...STALE_RUN_ERROR_EVENT }, shouldPersist: true };
}

export async function getRunByThread(
  threadId: string,
  options?: { includeTerminal?: boolean; turnId?: string },
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
  terminalReason: string | null;
  diagStage: string | null;
  inFlightSince: number | null;
} | null> {
  await ensureRunTables();
  const client = getDbExec();
  const turnClause = options?.turnId ? ` AND COALESCE(turn_id, id) = ?` : "";
  const statusClause = options?.includeTerminal
    ? ""
    : ` AND status = 'running'`;
  const markerPriority = options?.turnId
    ? `CASE WHEN dispatch_mode = 'turn-abort' THEN 0 ELSE 1 END`
    : `CASE WHEN dispatch_mode = 'turn-abort' THEN 1 ELSE 0 END`;
  const sql = `SELECT id, thread_id, turn_id, status, started_at, heartbeat_at, completed_at, last_progress_at, dispatch_mode, terminal_reason, diag_stage, error_code, in_flight_since FROM agent_runs WHERE thread_id = ?${turnClause}${statusClause} ORDER BY ${markerPriority}, started_at DESC LIMIT 1`;
  const args = options?.turnId ? [threadId, options.turnId] : [threadId];
  const { rows } = await client.execute({ sql, args });
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
    terminal_reason?: string | null;
    diag_stage?: string | null;
    error_code?: string | null;
    in_flight_since?: number | string | null;
  };
  const canReconcileFromEvents =
    r.status === "running" ||
    (r.status === "errored" &&
      r.error_code === STALE_RUN_ERROR_EVENT.errorCode);
  if (canReconcileFromEvents && (await reconcileTerminalRunFromEvents(r.id))) {
    return getRunByThread(threadId, options);
  }
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
    terminalReason: r.terminal_reason ?? null,
    diagStage: r.diag_stage ?? null,
    inFlightSince: r.in_flight_since == null ? null : Number(r.in_flight_since),
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
  terminalReason: string | null;
  diagStage: string | null;
}

export async function listRunsForThread(
  threadId: string,
  options: { limit?: number } = {},
): Promise<AgentRunSummary[]> {
  await ensureRunTables();
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const client = getDbExec();
  let { rows } = await client.execute({
    sql: `SELECT id, thread_id, turn_id, status, started_at, heartbeat_at, completed_at, last_progress_at, error_code, abort_reason, dispatch_mode, terminal_reason, diag_stage
          FROM agent_runs
          WHERE thread_id = ?
          ORDER BY started_at DESC
          LIMIT ?`,
    args: [threadId, limit],
  });
  const reconcileCandidateIds: string[] = [];
  for (const r of rows) {
    const row = r as {
      id?: string;
      status?: string;
      error_code?: string | null;
    };
    const runId = row.id;
    if (!runId) continue;
    const canReconcileFromEvents =
      row.status === "running" ||
      (row.status === "errored" &&
        row.error_code === STALE_RUN_ERROR_EVENT.errorCode);
    if (!canReconcileFromEvents) continue;
    reconcileCandidateIds.push(runId);
  }
  const reconcileResults = await Promise.all(
    reconcileCandidateIds.map((runId) =>
      reconcileTerminalRunFromEvents(runId).catch(() => false),
    ),
  );
  const repairedTerminalRow = reconcileResults.some(Boolean);
  if (repairedTerminalRow) {
    const refreshed = await client.execute({
      sql: `SELECT id, thread_id, turn_id, status, started_at, heartbeat_at, completed_at, last_progress_at, error_code, abort_reason, dispatch_mode, terminal_reason, diag_stage
            FROM agent_runs
            WHERE thread_id = ?
            ORDER BY started_at DESC
            LIMIT ?`,
      args: [threadId, limit],
    });
    rows = refreshed.rows;
  }
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
      terminal_reason?: string | null;
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
      terminalReason: row.terminal_reason ?? null,
      diagStage: row.diag_stage ?? null,
    };
  });
}

export interface CurrentTurnRunEvent {
  runId: string;
  seq: number;
  event: AgentChatEvent;
}

async function getCurrentTurnRunEvents(
  threadId: string,
  knownTurnId?: string,
): Promise<CurrentTurnRunEvent[]> {
  await ensureRunTables();
  const client = getDbExec();
  let turnId = knownTurnId;
  if (!turnId) {
    const latest = await client.execute({
      sql: `SELECT id, turn_id FROM agent_runs WHERE thread_id = ? ORDER BY started_at DESC LIMIT 1`,
      args: [threadId],
    });
    if (latest.rows.length === 0) return [];
    const latestRow = latest.rows[0] as { id: string; turn_id: string | null };
    turnId = latestRow.turn_id ?? latestRow.id;
  }
  const { rows } = await client.execute({
    sql: `SELECT e.run_id AS run_id, e.seq AS seq, e.event_data AS event_data
          FROM agent_run_events e
          JOIN agent_runs r ON r.id = e.run_id
          WHERE r.thread_id = ?
            AND COALESCE(r.turn_id, r.id) = ?
          ORDER BY COALESCE(r.continuation_order, 0) ASC,
                   r.started_at ASC,
                   e.event_at ASC NULLS LAST,
                   e.seq ASC,
                   r.id ASC`,
    args: [threadId, turnId],
  });
  const events: CurrentTurnRunEvent[] = [];
  for (const r of rows) {
    const row = r as {
      run_id?: string;
      seq?: number | string;
      event_data?: string;
    };
    const raw = row.event_data;
    const seq = Number(row.seq);
    if (!row.run_id || !Number.isFinite(seq) || !raw) continue;
    try {
      events.push({
        runId: row.run_id,
        seq,
        event: JSON.parse(raw) as AgentChatEvent,
      });
    } catch {
      // Skip malformed ledger rows — the journal is best-effort.
    }
  }
  return events;
}

export async function getCurrentTurnRunEventsForThread(
  threadId: string,
  knownTurnId?: string,
): Promise<CurrentTurnRunEvent[]> {
  return getCurrentTurnRunEvents(threadId, knownTurnId);
}

export async function getCurrentTurnEventsForThread(
  threadId: string,
  knownTurnId?: string,
): Promise<AgentChatEvent[]> {
  const persisted = await getCurrentTurnRunEvents(threadId, knownTurnId);
  return persisted.map(({ event }) => event);
}

const REAP_ALL_STALE_BATCH_LIMIT = 200;

export interface StaleRunReapResult {
  reaped: number;
  failed: number;
  truncated: boolean;
}

export async function reapAllStaleRuns(): Promise<StaleRunReapResult> {
  const nothingStale: StaleRunReapResult = {
    reaped: 0,
    failed: 0,
    truncated: false,
  };
  await ensureRunTables();
  if (!(await hasRunningRuns())) return nothingStale;
  const client = getDbExec();
  const now = Date.now();
  const scanned = await client.execute({
    sql: `SELECT id FROM agent_runs
          WHERE status = 'running'
            AND ${livenessBasisSql()} < ${backgroundAwareStaleCutoffSql()}
            AND ${inFlightGraceSql()}
          ORDER BY started_at ASC
          LIMIT ${REAP_ALL_STALE_BATCH_LIMIT + 1}`,
    args: [now, now, now],
  });
  const truncated = scanned.rows.length > REAP_ALL_STALE_BATCH_LIMIT;
  const stale = {
    rows: truncated
      ? scanned.rows.slice(0, REAP_ALL_STALE_BATCH_LIMIT)
      : scanned.rows,
  };
  for (const row of stale.rows) {
    const id = (row as { id?: unknown }).id;
    if (typeof id === "string") {
      await reconcileTerminalRunFromEvents(id);
    }
  }
  let reapedCount = 0;
  let failedCount = 0;
  for (const row of stale.rows) {
    const id = (row as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    try {
      if (await reapSingleStaleRun(id)) reapedCount += 1;
    } catch (error) {
      failedCount += 1;
      console.error(`[run-store] stale reap failed for run ${id}:`, error);
    }
  }
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
  return { reaped: reapedCount, failed: failedCount, truncated };
}

const RUN_OUTCOME_DAY_MS = 86_400_000;

const UNSUCCESSFUL_STATUS_SQL_LIST = `('errored', 'aborted', 'truncated')`;
const RUN_OUTCOME_PRUNE_BATCH_LIMIT = 200;
const RUN_OUTCOME_PRUNE_LOCK_KEY = "agent-native:run-outcome-prune";

async function pruneAndRollUpPrunedRunOutcomes(
  client: ReturnType<typeof getDbExec>,
  cutoff: number,
  erroredCutoff: number,
): Promise<void> {
  const prune = async (tx: ReturnType<typeof getDbExec>): Promise<void> => {
    {
      const lockResult = await tx.execute({
        sql: "SELECT pg_try_advisory_xact_lock(hashtextextended(?, 0::bigint)) AS acquired",
        args: [RUN_OUTCOME_PRUNE_LOCK_KEY],
      });
      const acquired = lockResult.rows[0]?.acquired;
      if (acquired !== true && acquired !== "t") return;
    }

    const { rows } = await tx.execute({
      sql: `DELETE FROM agent_runs
            WHERE id IN (
              SELECT id FROM agent_runs
              WHERE (status = 'completed' AND completed_at < ?)
                 OR (status IN ${UNSUCCESSFUL_STATUS_SQL_LIST} AND completed_at < ?)
              ORDER BY completed_at ASC, id ASC
              LIMIT ${RUN_OUTCOME_PRUNE_BATCH_LIMIT}
            )
            RETURNING id, status, completed_at, terminal_reason`,
      args: [cutoff, erroredCutoff],
    });

    const runIds = rows
      .map((row) => (row as { id?: unknown }).id)
      .filter((id): id is string => typeof id === "string");
    if (runIds.length > 0) {
      const placeholders = runIds.map(() => "?").join(", ");
      await tx.execute({
        sql: `DELETE FROM agent_run_events WHERE run_id IN (${placeholders})`,
        args: runIds,
      });
    }

    const groups = new Map<
      string,
      { day: string; status: string; terminalReason: string; count: number }
    >();
    for (const row of rows) {
      const outcome = row as {
        completed_at?: number | string | null;
        status?: string;
        terminal_reason?: string | null;
      };
      const dayIndex = Number(outcome.completed_at) / RUN_OUTCOME_DAY_MS;
      if (!Number.isFinite(dayIndex) || !outcome.status) continue;
      const day = new Date(Math.floor(dayIndex) * RUN_OUTCOME_DAY_MS)
        .toISOString()
        .slice(0, 10);
      const terminalReason = outcome.terminal_reason ?? "";
      const key = `${day}\u0000${outcome.status}\u0000${terminalReason}`;
      const existing = groups.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        groups.set(key, {
          day,
          status: outcome.status,
          terminalReason,
          count: 1,
        });
      }
    }

    for (const group of groups.values()) {
      await tx.execute({
        sql: `INSERT INTO agent_run_outcome_daily (day, status, terminal_reason, run_count)
              VALUES (?, ?, ?, ?)
              ON CONFLICT (day, status, terminal_reason)
              DO UPDATE SET run_count = agent_run_outcome_daily.run_count + excluded.run_count`,
        args: [group.day, group.status, group.terminalReason, group.count],
      });
    }
  };

  try {
    if (client.transaction) {
      await client.transaction(prune);
      return;
    }

    await client.execute("BEGIN");
    try {
      await prune(client);
      await client.execute("COMMIT");
    } catch (error) {
      await client.execute("ROLLBACK").catch(() => {});
      throw error;
    }
  } catch {
    // A transactional failure leaves the rows available for the next sweep.
  }
}

export async function getRunOutcomeCounters(options?: {
  sinceDay?: string;
}): Promise<
  Array<{
    day: string;
    status: string;
    terminalReason: string;
    count: number;
  }>
> {
  await ensureRunTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT day, status, terminal_reason, run_count
          FROM agent_run_outcome_daily
          WHERE day >= ?
          ORDER BY day DESC`,
    args: [options?.sinceDay ?? ""],
  });
  return rows.map((r) => {
    const row = r as {
      day: string;
      status: string;
      terminal_reason: string | null;
      run_count: number | string | null;
    };
    return {
      day: row.day,
      status: row.status,
      terminalReason: row.terminal_reason ?? "",
      count: Number(row.run_count ?? 0),
    };
  });
}

let cleanupOldRunsInFlight: Promise<void> | undefined;

async function cleanupOldRunsInternal(
  olderThanMs: number,
  erroredOlderThanMs?: number,
): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  const cutoff = Date.now() - olderThanMs;
  const erroredCutoff =
    Date.now() - Math.max(erroredOlderThanMs ?? 0, olderThanMs);
  const now = Date.now();
  const stale = await client.execute({
    sql: `SELECT id FROM agent_runs
          WHERE status = 'running'
            AND (
              (${livenessBasisSql()} < ${backgroundAwareStaleCutoffSql()} AND ${inFlightGraceSql()})
              OR started_at < ?
    )`,
    args: [now, now, now, cutoff],
  });
  for (const row of stale.rows) {
    const id = (row as { id?: unknown }).id;
    if (typeof id === "string") {
      await reconcileTerminalRunFromEvents(id);
    }
  }
  const completedAt = Date.now();
  await client.execute({
    sql: `UPDATE agent_runs
          SET status = 'errored',
              completed_at = COALESCE(completed_at, ${livenessBasisSql()}),
              error_code = ?,
              error_detail = ?,
              terminal_reason = ?
          WHERE status = 'running'
            AND ${terminalRunEventExclusionSql()}
            AND started_at < ?`,
    args: [
      STALE_RUN_ERROR_EVENT.errorCode,
      STALE_RUN_ERROR_EVENT.details,
      STALE_RUN_TERMINAL_REASON,
      cutoff,
    ],
  });
  await client.execute({
    sql: `UPDATE agent_runs
          SET status = 'errored',
              completed_at = COALESCE(completed_at, ${livenessBasisSql()}),
              error_code = ?,
              error_detail = ?,
              terminal_reason = ?
          WHERE status = 'running'
            AND ${terminalRunEventExclusionSql()}
            AND ${livenessBasisSql()} < ${backgroundAwareStaleCutoffSql()}
            AND ${inFlightGraceSql()}`,
    args: [
      STALE_RUN_ERROR_EVENT.errorCode,
      STALE_RUN_ERROR_EVENT.details,
      STALE_RUN_TERMINAL_REASON,
      completedAt,
      completedAt,
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
  await pruneAndRollUpPrunedRunOutcomes(client, cutoff, erroredCutoff);
}

export function cleanupOldRuns(
  olderThanMs: number,
  erroredOlderThanMs?: number,
): Promise<void> {
  if (cleanupOldRunsInFlight) return cleanupOldRunsInFlight;

  const current = cleanupOldRunsInternal(olderThanMs, erroredOlderThanMs);
  let settled: Promise<void>;
  settled = current.finally(() => {
    if (cleanupOldRunsInFlight === settled) cleanupOldRunsInFlight = undefined;
  });
  cleanupOldRunsInFlight = settled;
  return settled;
}

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
    terminalReason: string | null;
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
    sql: `SELECT id, thread_id, turn_id, status, error_code, error_detail, terminal_reason, started_at, completed_at
          FROM agent_runs
          WHERE status IN ${UNSUCCESSFUL_STATUS_SQL_LIST}
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
      terminal_reason: string | null;
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
      terminalReason: row.terminal_reason ?? null,
      startedAt,
      completedAt,
      durationMs: completedAt == null ? null : completedAt - startedAt,
    };
  });
}

export async function ensureTerminalRunEvent(
  runId: string,
  event: Record<string, unknown>,
): Promise<void> {
  return appendTerminalRunEvent(runId, event);
}

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
    sql: `INSERT INTO agent_run_events (run_id, seq, event_at, event_data) VALUES (?, ?, ?, ?) ON CONFLICT (run_id, seq) DO NOTHING`,
    args: [runId, nextSeq, Date.now(), JSON.stringify(event)],
  });
}
