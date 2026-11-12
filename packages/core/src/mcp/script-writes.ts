import { actionChangeResource } from "../action-call-classification.js";
/**
 * Script writes: the ledger steps around each write a script makes.
 *
 * Before a write runs, its row bound is reserved against the script's budget
 * and its ledger row is written, naming the receipt the write commits with
 * its change. A write whose row cannot be written does not run. After it
 * runs, the row is settled from what the run did; when that is unclear, the
 * write's own `reconcile` decides, now or from the recovery sweep. Audit rows
 * and change markers go through the ledger's outbox, never the best-effort
 * audit log, and only for writes known to have committed.
 */
import {
  actionCallIntent,
  preparedCallArguments,
  type ActionRunContext,
  type McpScriptReceiptLocator,
  type McpScriptWriteContract,
} from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import { auditAttribution } from "../audit/attribution.js";
import {
  buildActionAuditEvent,
  type RecordActionAuditInput,
} from "../audit/record.js";
import { insertAuditEventOnce } from "../audit/store.js";
import type { AuditEvent } from "../audit/types.js";
import {
  recordMcpScriptBudgetRefusal,
  recordMcpScriptWriteEffect,
} from "../observability/metrics.js";
import {
  writeActionChangeMarker,
  type NotifyActionChangeOptions,
} from "../server/action-change-marker-write.js";
import { currentRequestUserIsOrgAdmin } from "../server/org-admin.js";
import { runWithRequestContext } from "../server/request-context.js";
import { describeThrownForLog } from "./embed-redaction.js";
import type { McpActionCallOutcome } from "./execute-action-call.js";
import {
  insertPendingScriptWrite,
  listDueScriptOutbox,
  listScriptRunCalls,
  listUnsettledScriptWrites,
  markScriptOutboxDelivered,
  markScriptOutboxFailed,
  noteScriptReconcileAttempt,
  pruneScriptLedger,
  recordScriptDenialRow,
  settleScriptWriteRow,
  type ScriptCallResponse,
  type ScriptOutboxItem,
  type ScriptRunOwner,
  type ScriptWriteEffect,
  type UnsettledScriptWrite,
} from "./script-ledger.js";

/** The write contract of an entry a script may call as a write. */
export function scriptWriteContract(
  entry: ActionEntry | undefined,
): McpScriptWriteContract | undefined {
  return entry?.mcpScript === "write" ? entry.mcpScriptWrite : undefined;
}

export interface ScriptWriteCall {
  /** The call's place in the run, which with the run id is its identity. */
  seq: number;
  functionName: string;
  action: string;
  entry: ActionEntry;
  args: unknown;
}

/** A write the gate let through, carried from `begin` to `settle`. */
export interface ScriptWriteTicket {
  readonly call: ScriptWriteCall;
  readonly args: unknown;
  readonly locator: McpScriptReceiptLocator;
  readonly reservedRows: number;
  /** What the run attaches to its context, so its audit comes here. */
  readonly runContext: Partial<ActionRunContext>;
}

export type ScriptWriteBegin =
  | { status: "go"; ticket: ScriptWriteTicket }
  | { status: "refused"; code: string; message: string };

export interface ScriptWriteGate {
  readonly owner: ScriptRunOwner;
  begin(call: ScriptWriteCall): Promise<ScriptWriteBegin>;
  /** Settles the ledger row and delivers what a commit owes. Never throws. */
  settle(
    ticket: ScriptWriteTicket,
    outcome: McpActionCallOutcome,
    response: { status: ScriptCallResponse; code?: string },
  ): Promise<void>;
  /** Settles a write that passed the gate and was never run. Never throws. */
  abandon(ticket: ScriptWriteTicket): Promise<void>;
  /** Records a policy denial in the run's ledger. Throws when it cannot. */
  recordDenial(denial: {
    seq: number;
    functionName: string;
    action: string | undefined;
    reason: string;
    args: unknown;
  }): Promise<void>;
}

export interface ScriptWriteGateOptions {
  owner: ScriptRunOwner;
  /** Rows the run's writes may reserve in all. */
  rowBudget: number;
  /** See `mcp.scriptWriteRecoveryMs`. */
  recoveryMs: number;
  /** Read before each write, so turning writes off stops the next one. */
  writesEnabled: () => boolean;
  now?: () => number;
}

interface Reservation {
  rows: number;
  /** Writes of the run sharing it that have not settled `not-applied`. */
  holders: number;
  /** One of them committed or may have, so the rows stay charged. */
  kept: boolean;
}

function identityKey(action: string, locator: McpScriptReceiptLocator) {
  return JSON.stringify([
    action,
    locator.scope,
    locator.idempotencyKey,
    locator.payloadDigest,
  ]);
}

function isLocator(value: unknown): value is McpScriptReceiptLocator {
  if (typeof value !== "object" || value === null) return false;
  const locator = value as Record<string, unknown>;
  return ["scope", "idempotencyKey", "payloadDigest"].every(
    (key) => typeof locator[key] === "string" && locator[key] !== "",
  );
}

/**
 * The gate one script run's writes pass through. A run lives in one process,
 * so its reservations are kept here and taken one at a time: concurrent
 * writes in a `Promise.all` cannot each pass the budget separately.
 */
export function createScriptWriteGate(
  options: ScriptWriteGateOptions,
): ScriptWriteGate {
  const now = options.now ?? Date.now;
  const { owner } = options;
  let reserved = 0;
  const reservations = new Map<string, Reservation>();
  const audits = new WeakMap<ScriptWriteTicket, RecordActionAuditInput[]>();
  let queue: Promise<unknown> = Promise.resolve();
  const serially = <T>(step: () => Promise<T>): Promise<T> => {
    const run = queue.then(step, step);
    queue = run.catch(() => undefined);
    return run;
  };
  const refused = (code: string, message: string): ScriptWriteBegin => ({
    status: "refused",
    code,
    message,
  });

  const release = (key: string) => {
    const reservation = reservations.get(key);
    if (!reservation) return;
    reservation.holders -= 1;
    if (reservation.holders > 0 || reservation.kept) return;
    reservations.delete(key);
    reserved -= reservation.rows;
  };
  const keep = (key: string) => {
    const reservation = reservations.get(key);
    if (reservation) reservation.kept = true;
  };

  return {
    owner,
    begin: (call) =>
      serially(async (): Promise<ScriptWriteBegin> => {
        if (!options.writesEnabled()) {
          return refused(
            "writes_off",
            `api.${call.functionName} changes data, and script writes are turned off on this server.`,
          );
        }
        const contract = scriptWriteContract(call.entry);
        if (!contract) {
          return refused(
            "not-opted-in",
            `api.${call.functionName} is not available to scripts.`,
          );
        }
        const prepared = await actionCallIntent(call.entry, call.args);
        if (!prepared.valid) {
          return refused(
            "invalid_arguments",
            `api.${call.functionName} was called with invalid arguments: ${describeThrownForLog(prepared.error)}`,
          );
        }
        const args = preparedCallArguments(prepared);
        let rowBound: unknown;
        let locator: unknown;
        try {
          rowBound = contract.rowBound(args);
          locator = contract.receiptLocator(args);
        } catch (error) {
          return refused(
            "write_contract",
            `api.${call.functionName} could not name the rows or receipt of this call: ${describeThrownForLog(error)}`,
          );
        }
        if (
          typeof rowBound !== "number" ||
          !Number.isSafeInteger(rowBound) ||
          rowBound < 0 ||
          !isLocator(locator)
        ) {
          return refused(
            "write_contract",
            `api.${call.functionName} did not give a row bound and a receipt for this call.`,
          );
        }
        const key = identityKey(call.action, locator);
        const shared = reservations.get(key);
        // The same call again, as a retry or a second copy in flight, is
        // one write: it shares the reservation and never charges twice.
        const reservedRows = shared ? 0 : rowBound;
        if (!shared && reserved + rowBound > options.rowBudget) {
          recordMcpScriptBudgetRefusal();
          return refused(
            "write_budget",
            `api.${call.functionName} could change up to ${rowBound} rows, and this script has ${options.rowBudget - reserved} of its ${options.rowBudget} left. Nothing was changed by this call.`,
          );
        }
        const startedAt = now();
        try {
          await insertPendingScriptWrite(
            owner,
            {
              seq: call.seq,
              functionName: call.functionName,
              action: call.action,
              args,
              locator,
              rowBound,
              reservedRows,
              recoverAfter: startedAt + options.recoveryMs,
            },
            startedAt,
          );
        } catch (error) {
          console.error(
            `[mcp] Could not record a script write before running it: ${describeThrownForLog(error)}`,
          );
          return refused(
            "ledger_unavailable",
            `api.${call.functionName} was not run: the server could not record it first. Nothing was changed by this call.`,
          );
        }
        if (shared) shared.holders += 1;
        else {
          reservations.set(key, { rows: rowBound, holders: 1, kept: false });
          reserved += rowBound;
        }
        recordMcpScriptWriteEffect("pending", "run");
        const collected: RecordActionAuditInput[] = [];
        const ticket: ScriptWriteTicket = {
          call,
          args,
          locator,
          reservedRows,
          runContext: { deferAudit: (audit) => collected.push(audit) },
        };
        audits.set(ticket, collected);
        return { status: "go", ticket };
      }),

    async settle(ticket, outcome, response) {
      const { call } = ticket;
      const key = identityKey(call.action, ticket.locator);
      let effect = effectOfOutcome(outcome);
      if (effect === "unknown") {
        effect = await reconcileNow(owner, ticket);
      }
      // Only a write proven not to have run gives its rows back; one that may
      // still commit keeps them for the rest of the run.
      if (effect === "not-applied") release(key);
      else keep(key);
      const outbox =
        effect === "committed"
          ? committedOutbox(owner, call, {
              audits: audits.get(ticket) ?? [],
              args: ticket.args,
              result:
                outcome.status === "completed" ? outcome.value : undefined,
            })
          : [];
      try {
        const moved = await settleScriptWriteRow(
          owner,
          call.seq,
          { effect, response, outbox },
          now(),
        );
        if (moved) recordMcpScriptWriteEffect(effect, "run");
      } catch (error) {
        // The row stays unsettled, and recovery settles it from the receipt.
        console.error(
          `[mcp] Could not settle a script write's ledger row: ${describeThrownForLog(error)}`,
        );
        return;
      }
      if (outbox.length > 0) {
        await deliverScriptOutbox(owner.appId, {
          only: { runId: owner.runId, seq: call.seq },
          now: now(),
        });
      }
    },

    async abandon(ticket) {
      release(identityKey(ticket.call.action, ticket.locator));
      try {
        const moved = await settleScriptWriteRow(
          owner,
          ticket.call.seq,
          {
            effect: "not-applied",
            response: { status: "refused", code: "script_stopped" },
          },
          now(),
        );
        if (moved) recordMcpScriptWriteEffect("not-applied", "run");
      } catch (error) {
        // Unsettled, the row is settled by recovery, from no receipt.
        console.error(
          `[mcp] Could not settle a script write that never ran: ${describeThrownForLog(error)}`,
        );
      }
    },

    recordDenial: (denial) => recordScriptDenialRow(owner, denial, now()),
  };
}

/** The effect a settled call proves, or `unknown` when it proves neither. */
export function effectOfOutcome(
  outcome: McpActionCallOutcome,
): Exclude<ScriptWriteEffect, "pending"> {
  switch (outcome.status) {
    case "completed":
    case "failed":
      return outcome.effect === "none"
        ? "not-applied"
        : outcome.effect === "committed" && !isReportedFailure(outcome)
          ? "committed"
          : "unknown";
    case "unknown-tool":
    case "forbidden-scope":
    case "approval-required":
    case "approval-pending":
    case "approval-denied":
      // Refused before the action was invoked.
      return "not-applied";
  }
}

// A value that reports failure may still have committed part of the call, so
// only the receipt can say.
function isReportedFailure(outcome: McpActionCallOutcome): boolean {
  return (
    (outcome.status === "completed" && outcome.reportedError) ||
    (outcome.status === "failed" && outcome.stage !== "result")
  );
}

/**
 * Asks the write's receipt right after the run. A receipt proves the commit;
 * none proves nothing yet, since a commit the database had not acknowledged
 * may still land, so the row stays `unknown` for recovery.
 */
async function reconcileNow(
  owner: ScriptRunOwner,
  ticket: ScriptWriteTicket,
): Promise<"committed" | "unknown"> {
  const contract = scriptWriteContract(ticket.call.entry);
  if (!contract) return "unknown";
  try {
    const found = await contract.reconcile(ticket.locator);
    return found.status === "committed" ? "committed" : "unknown";
  } catch (error) {
    console.warn(
      `[mcp] Could not reconcile a script write for run ${owner.runId}: ${describeThrownForLog(error)}`,
    );
    return "unknown";
  }
}

/** The audit row's id, so a retried delivery writes it once. */
export function scriptAuditEventId(
  owner: Pick<ScriptRunOwner, "runId">,
  seq: number,
  item: number,
): string {
  return `mcp-script:${owner.runId}:${seq}:${item}`;
}

function committedOutbox(
  owner: ScriptRunOwner,
  call: Pick<ScriptWriteCall, "seq" | "action" | "entry">,
  facts: {
    audits: readonly RecordActionAuditInput[];
    args: unknown;
    result: unknown;
  },
): ScriptOutboxItem[] {
  const items: ScriptOutboxItem[] = [];
  const events: AuditEvent[] = [];
  for (const audit of facts.audits) {
    try {
      const event = buildActionAuditEvent(audit);
      if (event) events.push(event);
    } catch (error) {
      console.error(
        `[mcp] Could not build a script write's audit row: ${describeThrownForLog(error)}`,
      );
    }
  }
  if (events.length === 0) {
    const fallback = minimalAuditEvent(owner, call.action, facts.args);
    if (fallback) events.push(fallback);
  }
  for (const event of events) {
    items.push({
      kind: "audit",
      payload: {
        ...event,
        id: scriptAuditEventId(owner, call.seq, items.length),
        runId: event.runId ?? owner.runId,
      },
    });
  }
  if (call.entry.changeEvents !== false) {
    const change: NotifyActionChangeOptions = {
      actionName: call.action,
      ...actionChangeResource(call.entry, facts.args, facts.result),
      ...(owner.ownerEmail ? { owner: owner.ownerEmail } : {}),
      ...(owner.orgId ? { orgId: owner.orgId } : {}),
    };
    items.push({ kind: "change", payload: change });
  }
  return items;
}

/**
 * The audit row for a write recovery found committed, whose run is gone and
 * with it everything but the ledger: who, what, and the stored arguments.
 */
function minimalAuditEvent(
  owner: ScriptRunOwner,
  action: string,
  args: unknown,
): AuditEvent | undefined {
  try {
    return buildActionAuditEvent({
      config: undefined,
      args,
      ctx: {
        actionName: action,
        ...(owner.ownerEmail ? { userEmail: owner.ownerEmail } : {}),
        orgId: owner.orgId,
      },
      attribution: auditAttribution({ caller: "mcp", runId: owner.runId }),
      status: "success",
    });
  } catch (error) {
    console.error(
      `[mcp] Could not build a recovered script write's audit row: ${describeThrownForLog(error)}`,
    );
    return undefined;
  }
}

const OUTBOX_BATCH = 50;

/**
 * Delivers due outbox items: one write's, right after it commits, or every
 * due item from the sweep. A failure is recorded on the item, which is tried
 * again later; it never reaches the caller.
 */
export async function deliverScriptOutbox(
  appId: string,
  options: {
    only?: { runId: string; seq: number };
    now?: number;
    deadlineAt?: number;
  } = {},
): Promise<{ delivered: number; failed: number }> {
  const now = options.now ?? Date.now();
  let delivered = 0;
  let failed = 0;
  let due;
  try {
    due = await listDueScriptOutbox(appId, now, OUTBOX_BATCH, options.only);
  } catch (error) {
    console.error(
      `[mcp] Could not read the script outbox: ${describeThrownForLog(error)}`,
    );
    return { delivered, failed };
  }
  for (const item of due) {
    if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) {
      break;
    }
    try {
      const payload: unknown = JSON.parse(item.payload);
      if (item.kind === "audit") {
        await insertAuditEventOnce(payload as AuditEvent);
      } else {
        await writeActionChangeMarker(payload as NotifyActionChangeOptions);
      }
      await markScriptOutboxDelivered(item, now);
      delivered += 1;
    } catch (error) {
      failed += 1;
      try {
        await markScriptOutboxFailed(item, describeThrownForLog(error), now);
      } catch (markError) {
        console.error(
          `[mcp] Could not record a script outbox failure: ${describeThrownForLog(markError)}`,
        );
      }
    }
  }
  return { delivered, failed };
}

/** A write started this recently may still be running where it started. */
const RECOVERY_GRACE_MS = 2 * 60_000;
const RECOVERY_BATCH = 50;

export interface RecoverScriptWritesOptions {
  appId: string;
  /** The app's actions by name, for each write's `reconcile`. */
  actions: Readonly<Record<string, ActionEntry>>;
  now?: number;
  deadlineAt?: number;
}

/**
 * The recovery sweep: settles `pending` and `unknown` writes from their
 * receipts, delivers the outbox, and prunes the ledger. A receipt means
 * `committed`. No receipt keeps the write `unknown` until it could no longer
 * commit, and then means `not-applied`. A write whose action is gone, or has
 * no `reconcile` now, stays `unknown`: nothing can prove it either way.
 */
export async function recoverScriptWrites(
  options: RecoverScriptWritesOptions,
): Promise<{ settled: number; unsettled: number }> {
  const now = options.now ?? Date.now();
  const rows = await listUnsettledScriptWrites(
    options.appId,
    now - RECOVERY_GRACE_MS,
    RECOVERY_BATCH,
  );
  let settled = 0;
  let unsettled = 0;
  for (const row of rows) {
    if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) {
      unsettled += 1;
      continue;
    }
    const effect = await recoveredEffect(row, options.actions, now);
    if (effect === undefined) {
      unsettled += 1;
      await noteScriptReconcileAttempt(row, row.seq);
      continue;
    }
    const entry = Object.hasOwn(options.actions, row.action)
      ? options.actions[row.action]
      : undefined;
    const args = parsedArguments(row.argumentsJson);
    const outbox =
      effect === "committed" && entry
        ? committedOutbox(
            row,
            { seq: row.seq, action: row.action, entry },
            {
              audits: [],
              args,
              result: undefined,
            },
          )
        : effect === "committed"
          ? auditOnlyOutbox(row, args)
          : [];
    if (await settleScriptWriteRow(row, row.seq, { effect, outbox }, now)) {
      recordMcpScriptWriteEffect(effect, "recovery");
      settled += 1;
    }
  }
  await deliverScriptOutbox(options.appId, {
    now,
    ...(options.deadlineAt === undefined
      ? {}
      : { deadlineAt: options.deadlineAt }),
  });
  await pruneScriptLedger(now);
  return { settled, unsettled };
}

function auditOnlyOutbox(
  row: UnsettledScriptWrite,
  args: unknown,
): ScriptOutboxItem[] {
  const event = minimalAuditEvent(row, row.action, args);
  return event
    ? [
        {
          kind: "audit",
          payload: { ...event, id: scriptAuditEventId(row, row.seq, 0) },
        },
      ]
    : [];
}

async function recoveredEffect(
  row: UnsettledScriptWrite,
  actions: Readonly<Record<string, ActionEntry>>,
  now: number,
): Promise<"committed" | "not-applied" | undefined> {
  const entry = Object.hasOwn(actions, row.action)
    ? actions[row.action]
    : undefined;
  const contract = scriptWriteContract(entry);
  if (!contract) return undefined;
  let found;
  try {
    // As the person who made the call, so the receipt is read with their
    // access and no one else's.
    found = await runWithRequestContext(
      {
        ...(row.ownerEmail ? { userEmail: row.ownerEmail } : {}),
        ...(row.orgId ? { orgId: row.orgId } : {}),
      },
      () => contract.reconcile(row.locator),
    );
  } catch (error) {
    console.warn(
      `[mcp] Recovery could not reconcile a script write for run ${row.runId}: ${describeThrownForLog(error)}`,
    );
    return undefined;
  }
  if (found.status === "committed") return "committed";
  return now >= row.recoverAfter ? "not-applied" : undefined;
}

/**
 * `get-script-run`: one run's ledger, for the person who ran it or an admin
 * of the org it ran in. Lists writes and refused calls in call order; a read
 * that completed is in the run's own result, not here. `reader` is matched
 * as the gate records a run's owner.
 */
export async function mcpScriptRunStatusResult(
  appId: string,
  args: unknown,
  reader: { email: string | null; orgId: string | null },
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: true }> {
  const text = (value: string) => [{ type: "text" as const, text: value }];
  const runId =
    typeof args === "object" &&
    args !== null &&
    typeof (args as { runId?: unknown }).runId === "string"
      ? (args as { runId: string }).runId.trim()
      : "";
  if (!runId) {
    return {
      content: text("Pass the `runId` a run-script result returned."),
      isError: true,
    };
  }
  const { email, orgId } = reader;
  if (!email) {
    return {
      content: text("Sign in to read a script run."),
      isError: true,
    };
  }
  try {
    const isOrgAdmin =
      orgId !== null && (await currentRequestUserIsOrgAdmin(orgId));
    const calls = await listScriptRunCalls(appId, runId, {
      email,
      orgId,
      isOrgAdmin,
    });
    if (calls.length === 0) {
      return {
        content: text(
          `No run ${runId} with writes or refused calls is visible to you.`,
        ),
        isError: true,
      };
    }
    return { content: text(JSON.stringify({ runId, calls }, null, 2)) };
  } catch (error) {
    console.error(
      `[mcp] Could not read a script run's ledger: ${describeThrownForLog(error)}`,
    );
    return {
      content: text("The script ledger could not be read. Try again shortly."),
      isError: true,
    };
  }
}

/** A write's stored arguments, or undefined when none are kept or readable. */
function parsedArguments(json: string | null): unknown {
  if (json === null) return undefined;
  try {
    return JSON.parse(json);
  } catch {
    // coercion-ok: unreadable stored arguments are recorded as not kept, as cleared ones are.
    return undefined;
  }
}
