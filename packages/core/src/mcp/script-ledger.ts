/**
 * The script ledger: one row for every write a script starts and every call
 * the script policy refuses, kept apart from what the script itself saw.
 *
 * A write's row is written before the write runs and names the receipt the
 * write commits with its change, so recovery can settle a write whose process
 * died. Its audit row and change marker are delivered from the outbox once the
 * write is known to have committed, and retried until they are.
 */
import type { McpScriptReceiptLocator } from "../action.js";
import { redactArgsToJson } from "../audit/redact.js";
import { getDbExec } from "../db/client.js";
import { ensureTableExists } from "../db/ddl-guard.js";
import { defineStore } from "../db/store-registry.js";

export const mcpScriptLedgerStore = defineStore({
  id: "mcp_script_ledger",
  migrations: [
    {
      name: "baseline",
      run: async () => {
        await ensureTableExists(
          "mcp_script_calls",
          `CREATE TABLE IF NOT EXISTS mcp_script_calls (
            run_id TEXT NOT NULL,
            seq INTEGER NOT NULL,
            app_id TEXT NOT NULL,
            owner_email TEXT,
            org_id TEXT,
            function_name TEXT NOT NULL,
            action_name TEXT,
            kind TEXT NOT NULL,
            denial_reason TEXT,
            call_arguments TEXT,
            receipt_scope TEXT,
            idempotency_key TEXT,
            payload_digest TEXT,
            row_bound INTEGER,
            reserved_rows INTEGER NOT NULL DEFAULT 0,
            effect_status TEXT,
            response_status TEXT,
            response_code TEXT,
            recover_after BIGINT,
            reconcile_attempts INTEGER NOT NULL DEFAULT 0,
            created_at BIGINT NOT NULL,
            settled_at BIGINT,
            retain_until BIGINT NOT NULL,
            PRIMARY KEY (run_id, seq)
          )`,
        );
        await ensureTableExists(
          "mcp_script_outbox",
          `CREATE TABLE IF NOT EXISTS mcp_script_outbox (
            run_id TEXT NOT NULL,
            seq INTEGER NOT NULL,
            item INTEGER NOT NULL,
            app_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            payload TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            next_attempt_at BIGINT NOT NULL,
            delivered_at BIGINT,
            last_error TEXT,
            created_at BIGINT NOT NULL,
            PRIMARY KEY (run_id, seq, item)
          )`,
        );
      },
    },
    {
      name: "sweep-indexes",
      sql: [
        "CREATE INDEX IF NOT EXISTS idx_mcp_script_calls_unsettled ON mcp_script_calls (app_id, effect_status, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_mcp_script_calls_retain ON mcp_script_calls (retain_until)",
        "CREATE INDEX IF NOT EXISTS idx_mcp_script_outbox_due ON mcp_script_outbox (app_id, delivered_at, next_attempt_at)",
      ],
    },
  ],
});

export function ensureScriptLedgerTables(): Promise<void> {
  return mcpScriptLedgerStore.ready();
}

/**
 * `pending` from before the write runs until something settles it.
 * `committed`: its receipt exists, or the run said it finished. `not-applied`:
 * it never ran, or recovery found no receipt after it could have committed.
 * `unknown`: it may have run, and nothing yet says either way.
 */
export type ScriptWriteEffect =
  | "pending"
  | "committed"
  | "not-applied"
  | "unknown";

/** What the script saw for the call, as its result lists it. */
export type ScriptCallResponse =
  | "completed"
  | "failed"
  | "denied"
  | "refused"
  | "unfinished";

/** How long a run's rows are kept, and how long their arguments are. */
export const SCRIPT_LEDGER_RETENTION_MS = 30 * 24 * 60 * 60_000;
const ARGUMENT_RETENTION_MS = 7 * 24 * 60 * 60_000;
const STORED_ARGUMENT_LIMITS = { maxJson: 16_000, maxString: 2_000 };

/** Who made a run's calls, which every read of the run is matched against. */
export interface ScriptRunOwner {
  appId: string;
  runId: string;
  ownerEmail: string | null;
  orgId: string | null;
}

/** The arguments as the ledger keeps them: redacted, and capped. */
export function storedScriptArguments(args: unknown): string | null {
  return redactArgsToJson(args ?? {}, STORED_ARGUMENT_LIMITS);
}

function normalizedEmail(email: string | null): string | null {
  return email ? email.trim().toLowerCase() : null;
}

export async function recordScriptDenialRow(
  owner: ScriptRunOwner,
  call: {
    seq: number;
    functionName: string;
    action: string | undefined;
    reason: string;
    args: unknown;
  },
  now = Date.now(),
): Promise<void> {
  await ensureScriptLedgerTables();
  await getDbExec().execute({
    sql: `INSERT INTO mcp_script_calls (run_id, seq, app_id, owner_email, org_id, function_name, action_name, kind, denial_reason, call_arguments, response_status, response_code, created_at, settled_at, retain_until)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'denied', ?, ?, 'denied', ?, ?, ?, ?)
      ON CONFLICT (run_id, seq) DO NOTHING`,
    args: [
      owner.runId,
      call.seq,
      owner.appId,
      normalizedEmail(owner.ownerEmail),
      owner.orgId,
      call.functionName,
      call.action ?? null,
      call.reason,
      storedScriptArguments(call.args),
      call.reason,
      now,
      now,
      now + SCRIPT_LEDGER_RETENTION_MS,
    ],
  });
}

/** A write's row as it is written, before the write runs. */
export interface PendingScriptWrite {
  seq: number;
  functionName: string;
  action: string;
  args: unknown;
  locator: McpScriptReceiptLocator;
  rowBound: number;
  /** Rows this call reserved; 0 when it reuses a reservation of the run's. */
  reservedRows: number;
  /** After this, a missing receipt proves the write did not commit. */
  recoverAfter: number;
}

/** Throws when the row cannot be written, and then the write must not run. */
export async function insertPendingScriptWrite(
  owner: ScriptRunOwner,
  write: PendingScriptWrite,
  now = Date.now(),
): Promise<void> {
  await ensureScriptLedgerTables();
  await getDbExec().execute({
    sql: `INSERT INTO mcp_script_calls (run_id, seq, app_id, owner_email, org_id, function_name, action_name, kind, call_arguments, receipt_scope, idempotency_key, payload_digest, row_bound, reserved_rows, effect_status, response_status, recover_after, created_at, retain_until)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'write', ?, ?, ?, ?, ?, ?, 'pending', 'unfinished', ?, ?, ?)`,
    args: [
      owner.runId,
      write.seq,
      owner.appId,
      normalizedEmail(owner.ownerEmail),
      owner.orgId,
      write.functionName,
      write.action,
      storedScriptArguments(write.args),
      write.locator.scope,
      write.locator.idempotencyKey,
      write.locator.payloadDigest,
      write.rowBound,
      write.reservedRows,
      write.recoverAfter,
      now,
      now + SCRIPT_LEDGER_RETENTION_MS,
    ],
  });
}

/** One delivery the outbox owes for a committed write. */
export type ScriptOutboxItem =
  | { kind: "audit"; payload: unknown }
  | { kind: "change"; payload: unknown };

/**
 * Settles a write's row. `committed` writes its outbox items first, each
 * once, so a row that says committed always has them; a crash between the
 * two leaves the row unsettled, and recovery enqueues them again, which
 * keeps the first copy. Only an unsettled row moves, except that `committed`
 * may replace `unknown` or `not-applied` when a receipt turns up.
 */
export async function settleScriptWriteRow(
  owner: ScriptRunOwner,
  seq: number,
  settled: {
    effect: Exclude<ScriptWriteEffect, "pending">;
    response?: { status: ScriptCallResponse; code?: string };
    outbox?: readonly ScriptOutboxItem[];
  },
  now = Date.now(),
): Promise<boolean> {
  await ensureScriptLedgerTables();
  const client = getDbExec();
  if (settled.effect === "committed") {
    for (const [item, entry] of (settled.outbox ?? []).entries()) {
      await client.execute({
        sql: `INSERT INTO mcp_script_outbox (run_id, seq, item, app_id, kind, payload, next_attempt_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (run_id, seq, item) DO NOTHING`,
        args: [
          owner.runId,
          seq,
          item,
          owner.appId,
          entry.kind,
          JSON.stringify(entry.payload),
          now,
          now,
        ],
      });
    }
  }
  const from =
    settled.effect === "committed"
      ? "('pending', 'unknown', 'not-applied')"
      : settled.effect === "unknown"
        ? "('pending')"
        : "('pending', 'unknown')";
  const response = settled.response;
  // raw-sql-ok: the state list and response columns are literals chosen above; every value is bound.
  const result = await client.execute({
    sql: `UPDATE mcp_script_calls
      SET effect_status = ?,
        settled_at = ?${response ? ", response_status = ?, response_code = ?" : ""}
      WHERE run_id = ? AND seq = ? AND app_id = ? AND kind = 'write'
        AND effect_status IN ${from}`,
    args: [
      settled.effect,
      now,
      ...(response ? [response.status, response.code ?? null] : []),
      owner.runId,
      seq,
      owner.appId,
    ],
  });
  return result.rowsAffected === 1;
}

/** A write recovery may settle: unsettled, and old enough to ask about. */
export interface UnsettledScriptWrite extends ScriptRunOwner {
  seq: number;
  action: string;
  effect: "pending" | "unknown";
  locator: McpScriptReceiptLocator;
  argumentsJson: string | null;
  recoverAfter: number;
  createdAt: number;
}

function stringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/**
 * Unsettled writes of `appId` started before `startedBefore`, oldest first.
 * A newer one may still be running in the process that started it.
 */
export async function listUnsettledScriptWrites(
  appId: string,
  startedBefore: number,
  limit: number,
): Promise<UnsettledScriptWrite[]> {
  await ensureScriptLedgerTables();
  const { rows } = await getDbExec().execute({
    sql: `SELECT run_id, seq, app_id, owner_email, org_id, action_name, effect_status, receipt_scope, idempotency_key, payload_digest, call_arguments, recover_after, created_at
      FROM mcp_script_calls
      WHERE app_id = ? AND kind = 'write' AND effect_status IN ('pending', 'unknown') AND created_at < ?
      ORDER BY created_at, run_id, seq
      LIMIT ?`,
    args: [appId, startedBefore, limit],
  });
  return rows.map((row: Record<string, unknown>) => ({
    runId: String(row.run_id),
    seq: Number(row.seq),
    appId: String(row.app_id),
    ownerEmail: stringOrNull(row.owner_email),
    orgId: stringOrNull(row.org_id),
    action: String(row.action_name),
    effect: row.effect_status === "unknown" ? "unknown" : "pending",
    locator: {
      scope: String(row.receipt_scope),
      idempotencyKey: String(row.idempotency_key),
      payloadDigest: String(row.payload_digest),
    },
    argumentsJson: stringOrNull(row.call_arguments),
    recoverAfter: Number(row.recover_after),
    createdAt: Number(row.created_at),
  }));
}

/** Counts one more reconcile attempt on a row recovery could not settle. */
export async function noteScriptReconcileAttempt(
  owner: ScriptRunOwner,
  seq: number,
): Promise<void> {
  await getDbExec().execute({
    sql: `UPDATE mcp_script_calls
      SET reconcile_attempts = reconcile_attempts + 1,
        effect_status = CASE WHEN effect_status = 'pending' THEN 'unknown' ELSE effect_status END
      WHERE run_id = ? AND seq = ? AND app_id = ? AND kind = 'write'`,
    args: [owner.runId, seq, owner.appId],
  });
}

export interface DueScriptOutboxItem {
  runId: string;
  seq: number;
  item: number;
  kind: "audit" | "change";
  payload: string;
  attempts: number;
}

/** Undelivered items of `appId` due by `now`, or of one write only. */
export async function listDueScriptOutbox(
  appId: string,
  now: number,
  limit: number,
  only?: { runId: string; seq: number },
): Promise<DueScriptOutboxItem[]> {
  await ensureScriptLedgerTables();
  // raw-sql-ok: the one-write filter is a literal clause; its values are bound.
  const { rows } = await getDbExec().execute({
    sql: `SELECT run_id, seq, item, kind, payload, attempts
      FROM mcp_script_outbox
      WHERE app_id = ? AND delivered_at IS NULL AND next_attempt_at <= ?${only ? " AND run_id = ? AND seq = ?" : ""}
      ORDER BY next_attempt_at, run_id, seq, item
      LIMIT ?`,
    args: [appId, now, ...(only ? [only.runId, only.seq] : []), limit],
  });
  return rows.map((row: Record<string, unknown>) => ({
    runId: String(row.run_id),
    seq: Number(row.seq),
    item: Number(row.item),
    kind: row.kind === "change" ? "change" : "audit",
    payload: String(row.payload),
    attempts: Number(row.attempts),
  }));
}

// Doubles from 30 s, to at most an hour between tries.
function outboxRetryDelayMs(attempts: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.min(attempts, 7));
}

export async function markScriptOutboxDelivered(
  item: Pick<DueScriptOutboxItem, "runId" | "seq" | "item">,
  now = Date.now(),
): Promise<void> {
  await getDbExec().execute({
    sql: `UPDATE mcp_script_outbox SET delivered_at = ?, last_error = NULL
      WHERE run_id = ? AND seq = ? AND item = ? AND delivered_at IS NULL`,
    args: [now, item.runId, item.seq, item.item],
  });
}

export async function markScriptOutboxFailed(
  item: Pick<DueScriptOutboxItem, "runId" | "seq" | "item" | "attempts">,
  error: string,
  now = Date.now(),
): Promise<void> {
  await getDbExec().execute({
    sql: `UPDATE mcp_script_outbox
      SET attempts = attempts + 1, next_attempt_at = ?, last_error = ?
      WHERE run_id = ? AND seq = ? AND item = ? AND delivered_at IS NULL`,
    args: [
      now + outboxRetryDelayMs(item.attempts),
      error.slice(0, 500),
      item.runId,
      item.seq,
      item.item,
    ],
  });
}

/** One call of a run, as run status shows it. */
export interface ScriptRunCallRecord {
  seq: number;
  function: string;
  action: string | null;
  kind: "write" | "denied";
  /** As stored: redacted and capped, and `null` once the week is up. */
  arguments: unknown;
  denialReason: string | null;
  effect: ScriptWriteEffect | null;
  response: ScriptCallResponse | null;
  responseCode: string | null;
  rowBound: number | null;
  reservedRows: number;
  createdAt: number;
  settledAt: number | null;
}

function storedArgumentsValue(value: unknown): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    // coercion-ok: null is how run status shows arguments that aren't kept.
    return null;
  }
}

/**
 * A run's ledger in call order, for its owner, or for an admin of the org it
 * ran in. Empty when the run is not theirs or has none.
 */
export async function listScriptRunCalls(
  appId: string,
  runId: string,
  reader: { email: string; orgId: string | null; isOrgAdmin: boolean },
): Promise<ScriptRunCallRecord[]> {
  await ensureScriptLedgerTables();
  const email = normalizedEmail(reader.email);
  const asAdmin = reader.isOrgAdmin && reader.orgId !== null;
  // raw-sql-ok: the admin clause is a literal; the org id is bound.
  const { rows } = await getDbExec().execute({
    sql: `SELECT seq, function_name, action_name, kind, call_arguments, denial_reason, effect_status, response_status, response_code, row_bound, reserved_rows, created_at, settled_at
      FROM mcp_script_calls
      WHERE run_id = ? AND app_id = ?
        AND (owner_email = ?${asAdmin ? " OR org_id = ?" : ""})
      ORDER BY seq`,
    args: [runId, appId, email, ...(asAdmin ? [reader.orgId] : [])],
  });
  return rows.map((row: Record<string, unknown>) => ({
    seq: Number(row.seq),
    function: String(row.function_name),
    action: stringOrNull(row.action_name),
    kind: row.kind === "denied" ? "denied" : "write",
    arguments: storedArgumentsValue(row.call_arguments),
    denialReason: stringOrNull(row.denial_reason),
    effect: stringOrNull(row.effect_status) as ScriptWriteEffect | null,
    response: stringOrNull(row.response_status) as ScriptCallResponse | null,
    responseCode: stringOrNull(row.response_code),
    rowBound: row.row_bound === null ? null : Number(row.row_bound),
    reservedRows: Number(row.reserved_rows ?? 0),
    createdAt: Number(row.created_at),
    settledAt: row.settled_at === null ? null : Number(row.settled_at),
  }));
}

/**
 * Clears arguments a week on, and deletes settled rows and delivered outbox
 * items past retention. An unsettled write is kept until recovery settles it.
 */
export async function pruneScriptLedger(now = Date.now()): Promise<void> {
  await ensureScriptLedgerTables();
  const client = getDbExec();
  await client.execute({
    sql: `UPDATE mcp_script_calls SET call_arguments = NULL
      WHERE call_arguments IS NOT NULL AND created_at < ?
        AND (kind = 'denied' OR effect_status IN ('committed', 'not-applied'))`,
    args: [now - ARGUMENT_RETENTION_MS],
  });
  await client.execute({
    sql: `DELETE FROM mcp_script_outbox
      WHERE delivered_at IS NOT NULL AND delivered_at < ?`,
    args: [now - SCRIPT_LEDGER_RETENTION_MS],
  });
  await client.execute({
    sql: `DELETE FROM mcp_script_calls
      WHERE retain_until < ?
        AND (kind = 'denied' OR effect_status IN ('committed', 'not-applied'))
        AND NOT EXISTS (
          SELECT 1 FROM mcp_script_outbox o
          WHERE o.run_id = mcp_script_calls.run_id
            AND o.seq = mcp_script_calls.seq
            AND o.delivered_at IS NULL
        )`,
    args: [now],
  });
}
