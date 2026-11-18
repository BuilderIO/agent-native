import { actionChangeResource } from "../action-call-classification.js";
import {
  actionCallIntent,
  preparedCallArguments,
  type ActionRunContext,
  type PreparedActionCall,
  type McpScriptReceiptLocator,
  type McpScriptWriteContract,
} from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import { auditAttribution } from "../audit/attribution.js";
import {
  isAuditDisabled,
  normalizeAuditConfig,
  resolveAuditAttach,
  shouldRecordAudit,
} from "../audit/config.js";
import {
  buildActionAuditEvent,
  type RecordActionAuditInput,
} from "../audit/record.js";
import { insertAuditEventOnce } from "../audit/store.js";
import type { ActionAuditConfig, AuditEvent } from "../audit/types.js";
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
import {
  type McpActionCallOutcome,
  redactEmbedCredentials,
} from "./execute-action-call.js";
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
  /**
   * The call as the gate prepared it, which is the one that runs: its row
   * bound and receipt were read from these arguments, so preparing them
   * again (a generated default, a transform) can't run something else.
   */
  readonly prepared: PreparedActionCall;
  /** A copy of the prepared arguments, as the ledger records them. */
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
  holders: number;
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
              args: actionRecordsInputs(call.action, call.entry)
                ? args
                : undefined,
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
          prepared,
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
      if (effect === "not-applied") await serially(async () => release(key));
      else keep(key);
      const outbox =
        effect === "committed"
          ? committedOutbox(owner, call, {
              audits: audits.get(ticket) ?? [],
              args: ticket.args,
              result:
                outcome.status === "completed" ? outcome.value : undefined,
            })
          : effect === "not-applied"
            ? auditItems(
                owner,
                call.seq,
                actionAuditEvents(audits.get(ticket) ?? []),
              )
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
      const key = identityKey(ticket.call.action, ticket.locator);
      await serially(async () => release(key));
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
      if (outcome.reportedError) return "unknown";
      return outcome.effect === "none"
        ? "not-applied"
        : outcome.effect === "committed"
          ? "committed"
          : "unknown";
    case "failed":
      if (outcome.stage === "result") {
        return outcome.effect === "committed" ? "committed" : "unknown";
      }
      return outcome.effect === "none" ? "not-applied" : "unknown";
    case "unknown-tool":
    case "forbidden-scope":
    case "approval-required":
    case "approval-pending":
    case "approval-denied":
      return "not-applied";
  }
}

function callerContext(owner: {
  ownerEmail: string | null;
  orgId: string | null;
}): { userEmail?: string; orgId?: string } {
  return {
    ...(owner.ownerEmail ? { userEmail: owner.ownerEmail } : {}),
    ...(owner.orgId ? { orgId: owner.orgId } : {}),
  };
}

async function reconcileNow(
  owner: ScriptRunOwner,
  ticket: ScriptWriteTicket,
): Promise<"committed" | "unknown"> {
  const contract = scriptWriteContract(ticket.call.entry);
  if (!contract) return "unknown";
  try {
    const found = await withinRecoveryTimeout(
      Promise.resolve(
        runWithRequestContext(callerContext(owner), () =>
          contract.reconcile(ticket.locator),
        ),
      ),
      undefined,
    );
    if (found === TIMED_OUT) {
      console.warn(
        `[mcp] Gave up waiting on a script write's receipt for run ${owner.runId}; recovery settles it.`,
      );
      return "unknown";
    }
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
  const events = actionAuditEvents(facts.audits);
  if (events.length === 0) {
    const fallback = minimalAuditEvent(owner, call, facts.args);
    if (fallback) events.push(fallback);
  }
  const items = auditItems(owner, call.seq, events);
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

function actionAuditEvents(
  audits: readonly RecordActionAuditInput[],
): AuditEvent[] {
  const events: AuditEvent[] = [];
  for (const audit of audits) {
    try {
      const event = buildActionAuditEvent({
        ...audit,
        args: auditedArguments(audit.args),
      });
      if (event) events.push(event);
    } catch (error) {
      console.error(
        `[mcp] Could not build a script write's audit row: ${describeThrownForLog(error)}`,
      );
    }
  }
  return events;
}

function auditItems(
  owner: ScriptRunOwner,
  seq: number,
  events: readonly AuditEvent[],
): ScriptOutboxItem[] {
  return events.map((event, item) => ({
    kind: "audit",
    payload: {
      ...event,
      id: scriptAuditEventId(owner, seq, item),
      runId: event.runId ?? owner.runId,
    },
  }));
}

function auditedArguments(args: unknown): unknown {
  if (args === undefined) return undefined;
  try {
    return redactEmbedCredentials(args);
  } catch {
    // coercion-ok: an audit row records no arguments it can't read.
    return undefined;
  }
}

/**
 * Whether an action's calls may be recorded with their arguments: not when
 * it keeps them out of chat history, keeps them out of its audit rows, or
 * has no audit rows, by its settings, by the audit log's default
 * exclusions, or because the audit log is off. Its ledger rows then keep
 * none either, so run status shows none, to the run's owner included.
 */
export function actionRecordsInputs(name: string, entry: ActionEntry): boolean {
  const audit = normalizeAuditConfig(entry.audit);
  return (
    !isAuditDisabled() &&
    entry.persistInChatHistory !== false &&
    audit?.enabled !== false &&
    audit?.recordInputs !== false &&
    shouldRecordAudit(audit, name)
  );
}

function actionAuditPolicy(
  entry: ActionEntry,
): { config: ActionAuditConfig | undefined } | undefined {
  const config = normalizeAuditConfig(entry.audit);
  let effective = config;
  if (entry.persistInChatHistory === false) {
    const { target: _target, summary: _summary, ...shared } = config ?? {};
    effective = { ...shared, recordInputs: false };
  }
  if (!resolveAuditAttach(effective, entry.readOnly)) return undefined;
  return { config: effective };
}

function minimalAuditEvent(
  owner: ScriptRunOwner,
  call: Pick<ScriptWriteCall, "action" | "entry">,
  args: unknown,
): AuditEvent | undefined {
  const policy = actionAuditPolicy(call.entry);
  if (!policy) return undefined;
  try {
    return buildActionAuditEvent({
      config: policy.config,
      args: auditedArguments(args),
      ctx: {
        actionName: call.action,
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

const RECOVERY_GRACE_MS = 2 * 60_000;
const RECOVERY_BATCH = 50;
/** How long the sweep waits on one write's `reconcile` or `fence`, or less
 *  when its deadline comes sooner, and how long a run waits on the
 *  `reconcile` of a write whose outcome is unclear. One that takes longer
 *  leaves the write `unknown`. Later sweeps start nothing for a write until
 *  their own call for it ends. */
export const RECOVERY_CALL_TIMEOUT_MS = 20_000;

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
 * `committed`. Before the write's `recoverAfter`, no receipt keeps it
 * `unknown`. From then, the sweep fences the write's key: a receipt found
 * there means `committed`, and a refusal stored there means `not-applied`,
 * since the write can no longer commit. A write whose action is gone, or has
 * no contract now, or whose check fails or takes too long, stays `unknown`:
 * nothing proves it either way.
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
    const effect = await recoveredEffect(
      row,
      options.actions,
      now,
      options.deadlineAt,
    );
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

async function recoveredEffect(
  row: UnsettledScriptWrite,
  actions: Readonly<Record<string, ActionEntry>>,
  now: number,
  deadlineAt: number | undefined,
): Promise<"committed" | "not-applied" | undefined> {
  const entry = Object.hasOwn(actions, row.action)
    ? actions[row.action]
    : undefined;
  const contract = scriptWriteContract(entry);
  if (!contract) return undefined;
  const closing = now >= row.recoverAfter;
  const check = closing ? "fence" : "reconcile";
  const answer = startRecoveryCall(contract, row, closing);
  if (answer === "running") {
    console.warn(
      `[mcp] Recovery's last ${check} of a script write for run ${row.runId} is still running; it stays unknown.`,
    );
    return undefined;
  }
  if (answer === "full") {
    console.warn(
      `[mcp] Recovery is already running ${RECOVERY_CALLS_MAX} checks; a script write for run ${row.runId} stays unknown until a later sweep.`,
    );
    return undefined;
  }
  let found: { status?: unknown } | typeof TIMED_OUT | undefined;
  try {
    found = await withinRecoveryTimeout(answer, deadlineAt);
  } catch (error) {
    console.warn(
      `[mcp] Recovery could not ${check} a script write for run ${row.runId}: ${describeThrownForLog(error)}`,
    );
    return undefined;
  }
  if (found === TIMED_OUT) {
    console.warn(
      `[mcp] Recovery's ${check} of a script write for run ${row.runId} took too long; it stays unknown.`,
    );
    return undefined;
  }
  if (found?.status === "committed") return "committed";
  if (closing && found?.status === "fenced") return "not-applied";
  return undefined;
}

const RECOVERY_CALLS_MAX = 8;

const runningRecoveryCalls = new WeakMap<McpScriptWriteContract, Set<string>>();
let runningRecoveryCallCount = 0;

function startRecoveryCall(
  contract: McpScriptWriteContract,
  row: UnsettledScriptWrite,
  closing: boolean,
): Promise<{ status?: unknown } | undefined> | "running" | "full" {
  const running = runningRecoveryCalls.get(contract) ?? new Set<string>();
  runningRecoveryCalls.set(contract, running);
  const key = `${row.appId}\0${row.runId}\0${row.seq}`;
  if (running.has(key)) return "running";
  if (runningRecoveryCallCount >= RECOVERY_CALLS_MAX) return "full";
  const answer = Promise.resolve(
    runWithRequestContext(
      callerContext(row),
      async (): Promise<{ status?: unknown } | undefined> =>
        closing ? contract.fence(row.locator) : contract.reconcile(row.locator),
    ),
  );
  running.add(key);
  runningRecoveryCallCount += 1;
  const done = () => {
    runningRecoveryCallCount -= 1;
    running.delete(key);
  };
  void answer.then(done, done);
  return answer;
}

const TIMED_OUT = Symbol("timed out");

function withinRecoveryTimeout<T>(
  work: Promise<T>,
  deadlineAt: number | undefined,
): Promise<T | typeof TIMED_OUT> {
  const waitMs =
    deadlineAt === undefined
      ? RECOVERY_CALL_TIMEOUT_MS
      : Math.max(
          0,
          Math.min(RECOVERY_CALL_TIMEOUT_MS, deadlineAt - Date.now()),
        );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), waitMs);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * `get-script-run`: one run's ledger, for the person who ran it or, without
 * its arguments, an admin of the org it ran in. Lists writes and refused
 * calls in call order; a read
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

function parsedArguments(json: string | null): unknown {
  if (json === null) return undefined;
  try {
    return JSON.parse(json);
  } catch {
    // coercion-ok: unreadable stored arguments are recorded as not kept, as cleared ones are.
    return undefined;
  }
}
