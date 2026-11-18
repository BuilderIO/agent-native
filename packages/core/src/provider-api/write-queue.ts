import { createHash, randomUUID } from "node:crypto";

import { ActionContractError, isActionContractError } from "../action.js";
import { getDbExec } from "../db/client.js";
import { defineStore } from "../db/store-registry.js";
import { defineMachine } from "../state-machine/index.js";
import { countOutcome } from "../tracking/failure-counters.js";
import { isProviderCallGateRefusal } from "./call-gates.js";
import {
  ProviderDeferredError,
  providerConnectionKey,
  providerWorkStore,
  reserveProviderBudget,
  runWithProviderBudgetCredit,
  runWithProviderDispatchTracking,
  type ProviderBudgetPolicy,
  type ProviderConnectionScope,
  type ProviderPause,
} from "./provider-budget.js";

export interface ProviderWriteScope extends ProviderConnectionScope {
  appId: string;
  principalId: string;
}

export const providerWriteLifecycle = defineMachine({
  id: "provider_write",
  states: ["queued", "running", "completed", "failed", "uncertain"],
  initial: "queued",
  terminal: ["completed", "failed"],
  transitions: {
    claim: { from: ["queued"], to: "running" },
    defer: { from: ["running"], to: "queued" },
    complete: { from: ["running"], to: "completed" },
    reject: { from: ["running"], to: "failed" },
    lose: { from: ["running"], to: "uncertain" },
    confirmed: { from: ["uncertain"], to: "completed" },
    unapplied: { from: ["uncertain"], to: "queued" },
    abandon: { from: ["uncertain"], to: "failed" },
  },
});

export interface ProviderWriteProgress {
  id: string;
  status: (typeof providerWriteLifecycle.states)[number];
  attempts: number;
  reason: string | null;
  resumeAt: number | null;
}

export interface ProviderWriteHandler<I, O> {
  policy: ProviderBudgetPolicy;
  /** Guarantees every provider write in execute uses registerProviderBudgetGate. */
  dispatchTracking?: "provider-budget-gate";
  /** True only when the provider itself deduplicates every replay of this operation. */
  replaySafe?: boolean;
  parseInput(value: unknown): I;
  parseResult(value: unknown): O;
  /**
   * Re-resolve current access, including when reading persisted results.
   * Deny access with an explicit 4xx ActionContractError (except 408/429) or
   * ProviderWriteRejectedError. Other failures retain the intent for recovery.
   */
  authorize(scope: ProviderWriteScope): Promise<void>;
  /** Read-only verification of an uncertain effect; never perform a write here. */
  reconcile?: (
    input: I,
    context: { scope: ProviderWriteScope; idempotencyKey: string },
  ) => Promise<
    | { status: "completed"; result: O }
    | { status: "not_applied" }
    | { status: "uncertain" }
  >;
  /** Receives a stable idempotency key. Never persist a token in input or result. */
  execute(
    input: I,
    context: { scope: ProviderWriteScope; idempotencyKey: string },
  ): Promise<O>;
}

interface RegisteredHandler {
  dispatchTracking?: "provider-budget-gate";
  replaySafe?: boolean;
  policy: ProviderBudgetPolicy;
  parseInput(value: unknown): unknown;
  parseResult(value: unknown): unknown;
  authorize(scope: ProviderWriteScope): Promise<void>;
  reconcile?: ProviderWriteHandler<unknown, unknown>["reconcile"];
  execute(
    input: unknown,
    context: { scope: ProviderWriteScope; idempotencyKey: string },
  ): Promise<unknown>;
}

const handlers = new Map<string, RegisteredHandler>();
const LEASE_MS = 120_000;
const MAX_JSON_BYTES = 64 * 1024;

export const providerWriteSchedulerStore = defineStore({
  id: "provider_write_scheduler",
  after: ["provider_work"],
  migrations: [
    {
      name: "scope-cursor",
      sql: [
        `CREATE TABLE IF NOT EXISTS provider_write_scheduler_cursor (
          app_id TEXT PRIMARY KEY, last_position BIGINT NOT NULL DEFAULT 0
        )`,
        `CREATE INDEX IF NOT EXISTS provider_write_queue_scheduler_idx
          ON provider_write_queue (app_id, position)
          WHERE status IN ('queued', 'running', 'uncertain')`,
      ],
    },
  ],
});

export const providerWriteEnqueueStore = defineStore({
  id: "provider_write_enqueue",
  after: ["provider_work"],
  migrations: [
    {
      name: "caller-lock",
      sql: [
        `CREATE TABLE IF NOT EXISTS provider_write_enqueue_lock (
          caller_key TEXT PRIMARY KEY
        )`,
      ],
    },
  ],
});

/** The adapter guarantees this entire handler attempt made no provider write. */
export class ProviderWriteNotDispatchedError extends ProviderDeferredError {
  constructor(pause: ProviderPause) {
    super(pause);
    this.name = "ProviderWriteNotDispatchedError";
  }
}

function isPermanentAuthorizationError(error: unknown): boolean {
  return (
    isActionContractError(error) &&
    error.statusCode >= 400 &&
    error.statusCode < 500 &&
    error.statusCode !== 408 &&
    error.statusCode !== 429
  );
}

/** Known provider rejection with no effect; transport timeouts are never this error. */
export class ProviderWriteRejectedError extends Error {
  constructor(readonly reason: string) {
    super("Provider write rejected.");
    this.name = "ProviderWriteRejectedError";
  }
}

export function registerProviderWriteHandler<I, O>(
  appId: string,
  operation: string,
  handler: ProviderWriteHandler<I, O>,
): () => void {
  const key = JSON.stringify([appId, operation]);
  if (handlers.has(key))
    throw new Error("Provider write handler is already registered.");
  const reconcile = handler.reconcile;
  const registered: RegisteredHandler = {
    policy: handler.policy,
    ...(handler.dispatchTracking === undefined
      ? {}
      : { dispatchTracking: handler.dispatchTracking }),
    ...(handler.replaySafe === undefined
      ? {}
      : { replaySafe: handler.replaySafe }),
    parseInput: (value) => handler.parseInput(value),
    parseResult: (value) => handler.parseResult(value),
    authorize: (scope) => handler.authorize(scope),
    ...(reconcile
      ? {
          reconcile: (
            input: unknown,
            context: { scope: ProviderWriteScope; idempotencyKey: string },
          ) => reconcile(handler.parseInput(input), context),
        }
      : {}),
    execute: (input, context) =>
      handler.execute(handler.parseInput(input), context),
  };
  handlers.set(key, registered);
  return () => {
    if (handlers.get(key) === registered) handlers.delete(key);
  };
}

function handlerFor(appId: string, operation: string): RegisteredHandler {
  const handler = handlers.get(JSON.stringify([appId, operation]));
  if (!handler) throw new Error("Provider write handler is unavailable.");
  return handler;
}

function callerKey(scope: ProviderWriteScope): string {
  if (!scope.appId.trim() || !scope.principalId.trim())
    throw new TypeError("Provider write caller is missing.");
  return createHash("sha256")
    .update(
      JSON.stringify([
        providerConnectionKey(scope),
        scope.appId,
        scope.principalId,
      ]),
    )
    .digest("hex");
}

function boundedJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined || Buffer.byteLength(json) > MAX_JSON_BYTES)
    throw new TypeError(
      "Provider queue values must be bounded structured JSON; use blob references for files.",
    );
  return json;
}

function progress(row: Record<string, unknown>): ProviderWriteProgress {
  if (
    typeof row.id !== "string" ||
    !Number.isSafeInteger(Number(row.attempts)) ||
    (row.reason !== null && typeof row.reason !== "string") ||
    (row.resume_at !== null && !Number.isSafeInteger(Number(row.resume_at)))
  )
    throw new TypeError("Unreadable provider write progress.");
  return {
    id: row.id,
    status: providerWriteLifecycle.parseState(row.status),
    attempts: Number(row.attempts),
    reason: row.reason,
    resumeAt: row.resume_at === null ? null : Number(row.resume_at),
  };
}

export async function enqueueProviderWrite(options: {
  scope: ProviderWriteScope;
  operation: string;
  /** One key for the user's intent, reused by retries, never a request timestamp. */
  idempotencyKey: string;
  input: unknown;
}): Promise<ProviderWriteProgress> {
  const { scope } = options;
  if (!options.idempotencyKey.trim())
    throw new TypeError("An idempotency key is required.");
  const handler = handlerFor(scope.appId, options.operation);
  // Deferred quota admission belongs to execution; access is always required to enqueue.
  await handler.authorize(scope);
  const input = boundedJson(handler.parseInput(options.input));
  const inputHash = createHash("sha256").update(input).digest("hex");
  const caller = callerKey(scope);
  const id = createHash("sha256")
    .update(JSON.stringify([caller, options.idempotencyKey]))
    .digest("hex");
  await providerWorkStore.ready();
  await providerWriteEnqueueStore.ready();
  const result = await getDbExec().execute({
    // Lock before allocating the queue sequence: an uncommitted earlier insert
    // must prevent this caller's later intent from becoming dispatchable first.
    sql: `WITH caller_lock AS (
        INSERT INTO provider_write_enqueue_lock (caller_key) VALUES (?)
        ON CONFLICT (caller_key) DO UPDATE SET caller_key = EXCLUDED.caller_key
        RETURNING caller_key
      )
      INSERT INTO provider_write_queue
      (id, scope_key, caller_key, scope_json, app_id, operation, input_json, input_hash, created_at, ready_at)
      SELECT ?, ?, caller_lock.caller_key, ?, ?, ?, ?, ?, ?, ? FROM caller_lock
      ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
      WHERE provider_write_queue.operation = EXCLUDED.operation AND provider_write_queue.input_hash = EXCLUDED.input_hash
      RETURNING id, status, attempts, reason, resume_at`,
    args: [
      caller,
      id,
      providerConnectionKey(scope),
      boundedJson(scope),
      scope.appId,
      options.operation,
      input,
      inputHash,
      Date.now(),
      Date.now(),
    ],
  });
  if (result.rows.length !== 1)
    throw new TypeError(
      "Provider write idempotency key was reused with a different intent.",
    );
  countOutcome("provider_write_counts", {
    provider: scope.providerId,
    outcome: "queued",
  });
  return progress(result.rows[0]);
}

export async function getProviderWrite(
  scope: ProviderWriteScope,
  id: string,
): Promise<{ progress: ProviderWriteProgress; result?: unknown } | null> {
  await providerWorkStore.ready();
  const rows = await getDbExec().execute({
    sql: "SELECT id, operation, status, attempts, reason, resume_at, result_json FROM provider_write_queue WHERE id = ? AND caller_key = ? AND scope_key = ?",
    args: [id, callerKey(scope), providerConnectionKey(scope)],
  });
  const row = rows.rows[0];
  if (!row) return null;
  await handlerFor(scope.appId, row.operation).authorize(scope);
  const current = progress(row);
  if (current.status !== "completed") return { progress: current };
  if (typeof row.result_json !== "string")
    throw new TypeError("Completed provider write has no result.");
  return {
    progress: current,
    result: handlerFor(scope.appId, row.operation).parseResult(
      JSON.parse(row.result_json),
    ),
  };
}

/** Bounded worker sweep; an initial action may explicitly dispatch a small batch. */
export async function drainProviderWrites(
  scope: ProviderWriteScope,
  options: { maxItems?: number; signal?: AbortSignal } = {},
): Promise<ProviderWriteProgress[]> {
  const maxItems = options.maxItems ?? 20;
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 100)
    throw new TypeError("Invalid provider queue batch size.");
  await providerWorkStore.ready();
  const db = getDbExec();
  const completed: ProviderWriteProgress[] = [];
  for (let index = 0; index < maxItems; index++) {
    options.signal?.throwIfAborted();
    // An abandoned dispatched write may already have landed. Never replay it blindly.
    await db.execute({
      sql: `UPDATE provider_write_queue SET status = 'uncertain', reason = 'lease_expired', claim_id = NULL
        WHERE scope_key = ? AND status = 'running' AND lease_until <= ?`,
      args: [providerConnectionKey(scope), Date.now()],
    });
    const head = await db.execute({
      sql: "SELECT id, status, operation FROM provider_write_queue WHERE scope_key = ? AND caller_key = ? AND status IN ('queued', 'running', 'uncertain') ORDER BY position LIMIT 1",
      args: [providerConnectionKey(scope), callerKey(scope)],
    });
    const pendingHead = head.rows[0];
    if (
      pendingHead?.status === "queued" &&
      !handlers.has(JSON.stringify([scope.appId, pendingHead.operation]))
    ) {
      const deferred = await db.execute({
        sql: "UPDATE provider_write_queue SET reason = 'handler_unavailable', resume_at = ?, ready_at = ? WHERE id = ? AND caller_key = ? AND status = 'queued' RETURNING id, status, attempts, reason, resume_at",
        args: [
          Date.now() + 60_000,
          Date.now() + 60_000,
          pendingHead.id,
          callerKey(scope),
        ],
      });
      if (deferred.rows.length === 1)
        completed.push(progress(deferred.rows[0]));
      break;
    }
    if (head.rows[0]?.status === "uncertain") {
      const reconciled = await reconcileProviderWrite(scope, head.rows[0].id);
      if (!reconciled || reconciled.status === "uncertain") break;
      if (reconciled.status === "completed") {
        completed.push(reconciled);
        continue;
      }
    }
    const claimId = randomUUID();
    const claimed = await db.execute({
      sql: `UPDATE provider_write_queue SET status = 'running', claim_id = ?, lease_until = ?, attempts = attempts + 1, reason = NULL, resume_at = NULL
        WHERE id = (SELECT id FROM provider_write_queue WHERE scope_key = ? AND caller_key = ?
          AND status IN ('queued', 'running', 'uncertain') ORDER BY position LIMIT 1)
          AND caller_key = ? AND status = 'queued' AND ready_at <= ?
        RETURNING id, operation, input_json, status, attempts, reason, resume_at`,
      args: [
        claimId,
        Date.now() + LEASE_MS,
        providerConnectionKey(scope),
        callerKey(scope),
        callerKey(scope),
        Date.now(),
      ],
    });
    const row = claimed.rows[0];
    if (!row) break;
    const handler = handlerFor(scope.appId, row.operation);
    let resultJson: string | null = null;
    let phase: "input" | "authorization" | "admission" | "dispatch" | "result" =
      "input";
    let pause: ProviderPause | undefined;
    let rejection: string | undefined;
    let uncertain = false;
    let dispatched = false;
    const dispatchState = { writes: 0 };
    let resultUnavailable = false;
    let renewal = Promise.resolve();
    const heartbeat = setInterval(() => {
      renewal = renewal
        .then(async () => {
          await db.execute({
            sql: "UPDATE provider_write_queue SET lease_until = ? WHERE id = ? AND claim_id = ? AND status = 'running'",
            args: [Date.now() + LEASE_MS, row.id, claimId],
          });
        })
        .catch(() => {
          // coercion-ok: final fenced update confirms ownership; a failed renewal never confirms a write.
        });
    }, LEASE_MS / 3);
    heartbeat.unref?.();
    try {
      const input = handler.parseInput(JSON.parse(row.input_json));
      phase = "authorization";
      await handler.authorize(scope);
      phase = "admission";
      const admission = await reserveProviderBudget(scope, handler.policy);
      if (admission.status === "paused") pause = admission;
      else {
        dispatched = true;
        phase = "dispatch";
        const execute = () =>
          runWithProviderBudgetCredit(scope, handler.policy, 1, () =>
            handler.execute(input, { scope, idempotencyKey: row.id }),
          );
        const executed =
          handler.dispatchTracking === "provider-budget-gate"
            ? await runWithProviderDispatchTracking(dispatchState, execute)
            : await execute();
        phase = "result";
        resultJson = boundedJson(handler.parseResult(executed));
      }
    } catch (error) {
      if (phase === "result") {
        uncertain = true;
        resultUnavailable = true;
      } else if (phase === "admission") {
        // No provider effect has begun. Configuration and storage failures can
        // recover, so retain the original intent rather than rejecting it.
        pause = {
          status: "paused",
          reason: "admission_unavailable",
          resumeAt: Date.now() + 60_000,
        };
      } else if (error instanceof ProviderDeferredError) {
        if (
          !dispatched ||
          error instanceof ProviderWriteNotDispatchedError ||
          handler.replaySafe === true ||
          (handler.dispatchTracking === "provider-budget-gate" &&
            dispatchState.writes === 0)
        )
          pause = error.pause;
        else uncertain = true;
      } else if (
        handler.dispatchTracking === "provider-budget-gate" &&
        dispatchState.writes === 0 &&
        isProviderCallGateRefusal(error)
      ) {
        pause = {
          status: "paused",
          reason: "admission_unavailable",
          resumeAt: Date.now() + 60_000,
        };
      } else if (error instanceof ProviderWriteRejectedError)
        rejection = error.reason;
      else if (phase === "input") rejection = "invalid_input";
      else if (
        phase === "authorization" &&
        isPermanentAuthorizationError(error)
      )
        rejection = "authorization_rejected";
      else if (!dispatched)
        pause = {
          status: "paused",
          reason: "admission_unavailable",
          resumeAt: Date.now() + 60_000,
        };
      else uncertain = true;
    } finally {
      clearInterval(heartbeat);
      await renewal;
    }
    const status = pause
      ? "queued"
      : rejection
        ? "failed"
        : uncertain
          ? "uncertain"
          : "completed";
    const updated = await db.execute({
      sql: `UPDATE provider_write_queue SET status = ?, ready_at = ?, reason = ?, resume_at = ?, result_json = ?, claim_id = NULL, lease_until = NULL
        WHERE id = ? AND status = 'running' AND claim_id = ?
        RETURNING id, status, attempts, reason, resume_at`,
      args: [
        status,
        pause?.resumeAt ?? Date.now() + 60_000,
        pause?.reason ??
          rejection ??
          (resultUnavailable
            ? "result_unavailable"
            : uncertain
              ? "provider_outcome_unknown"
              : null),
        pause?.resumeAt ?? null,
        status === "completed" ? resultJson : null,
        row.id,
        claimId,
      ],
    });
    if (updated.rows.length !== 1)
      throw new Error(
        "Provider write claim was lost; completion is unconfirmed.",
      );
    completed.push(progress(updated.rows[0]));
    countOutcome("provider_write_counts", {
      provider: scope.providerId,
      outcome: status,
    });
    if (status !== "completed" && status !== "failed") break;
  }
  return completed;
}

/** Release an uncertain head only after the adapter verifies its upstream effect. */
export async function reconcileProviderWrite(
  scope: ProviderWriteScope,
  id: string,
): Promise<ProviderWriteProgress | null> {
  await providerWorkStore.ready();
  const found = await getDbExec().execute({
    sql: "SELECT id, operation, input_json, status, attempts, reason, resume_at FROM provider_write_queue WHERE id = ? AND caller_key = ? AND scope_key = ?",
    args: [id, callerKey(scope), providerConnectionKey(scope)],
  });
  const row = found.rows[0];
  if (!row) return null;
  const handler = handlerFor(scope.appId, row.operation);
  await handler.authorize(scope);
  if (progress(row).status !== "uncertain" || !handler.reconcile)
    return progress(row);
  const result = await handler.reconcile(
    handler.parseInput(JSON.parse(row.input_json)),
    { scope, idempotencyKey: id },
  );
  if (
    result.status === "uncertain" ||
    (result.status === "not_applied" && !handler.replaySafe)
  )
    return progress(row);
  let resultJson: string | null = null;
  let resultUnavailable = false;
  if (result.status === "completed") {
    try {
      resultJson = boundedJson(handler.parseResult(result.result));
    } catch {
      // Verification confirmed an effect, but its result cannot be delivered.
      // Keep it recoverable through explicit abandonment; never replay it.
      resultUnavailable = true;
    }
  }
  const updated = await getDbExec().execute({
    sql: `UPDATE provider_write_queue SET status = ?, result_json = ?, ready_at = ?, reason = ?, resume_at = NULL
      WHERE id = ? AND caller_key = ? AND status = 'uncertain'
      RETURNING id, status, attempts, reason, resume_at`,
    args: [
      resultUnavailable
        ? "uncertain"
        : result.status === "completed"
          ? "completed"
          : "queued",
      resultJson,
      Date.now(),
      resultUnavailable ? "result_unavailable" : null,
      id,
      callerKey(scope),
    ],
  });
  if (updated.rows.length !== 1)
    throw new Error("Provider reconciliation lost its state transition.");
  return progress(updated.rows[0]);
}

/**
 * Explicitly stop waiting for an uncertain outcome and unblock later intents.
 * The caller acknowledges the original effect may have happened: this does not
 * undo it, assert it failed upstream, or authorize replay of the original intent.
 */
export async function abandonProviderWrite(
  scope: ProviderWriteScope,
  id: string,
): Promise<ProviderWriteProgress | null> {
  await providerWorkStore.ready();
  const db = getDbExec();
  const found = await db.execute({
    sql: "SELECT id, operation, status, attempts, reason, resume_at FROM provider_write_queue WHERE id = ? AND caller_key = ? AND scope_key = ?",
    args: [id, callerKey(scope), providerConnectionKey(scope)],
  });
  const row = found.rows[0];
  if (!row) return null;
  await handlerFor(scope.appId, row.operation).authorize(scope);
  const current = progress(row);
  if (current.status === "failed" && current.reason === "outcome_abandoned")
    return current;
  if (current.status !== "uncertain")
    throw new ActionContractError(
      "Only an uncertain provider write can be abandoned.",
      {
        errorCode: "provider_write_not_uncertain",
        statusCode: 409,
      },
    );
  const updated = await db.execute({
    sql: `UPDATE provider_write_queue SET status = 'failed', reason = 'outcome_abandoned',
        resume_at = NULL, claim_id = NULL, lease_until = NULL
      WHERE id = ? AND caller_key = ? AND scope_key = ? AND status = 'uncertain'
      RETURNING id, status, attempts, reason, resume_at`,
    args: [id, callerKey(scope), providerConnectionKey(scope)],
  });
  if (updated.rows.length !== 1)
    throw new ActionContractError(
      "Provider write outcome changed. Reload its progress.",
      {
        errorCode: "provider_write_resolution_conflict",
        statusCode: 409,
      },
    );
  return progress(updated.rows[0]);
}

function readStoredScope(
  row: Record<string, unknown>,
  appId: string,
): ProviderWriteScope {
  if (typeof row.scope_json !== "string")
    throw new TypeError("Unreadable provider scheduler context.");
  const parsed: unknown = JSON.parse(row.scope_json);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("providerId" in parsed) ||
    !("tenantId" in parsed) ||
    !("connectionId" in parsed) ||
    !("appId" in parsed) ||
    !("principalId" in parsed) ||
    typeof parsed.providerId !== "string" ||
    typeof parsed.tenantId !== "string" ||
    typeof parsed.connectionId !== "string" ||
    parsed.appId !== appId ||
    typeof parsed.principalId !== "string"
  )
    throw new TypeError("Unreadable provider scheduler context.");
  const scope: ProviderWriteScope = {
    providerId: parsed.providerId,
    tenantId: parsed.tenantId,
    connectionId: parsed.connectionId,
    appId,
    principalId: parsed.principalId,
  };
  if (
    callerKey(scope) !== row.caller_key ||
    providerConnectionKey(scope) !== row.scope_key
  )
    throw new TypeError("Provider scheduler context does not match its scope.");
  return scope;
}

/** Trusted scheduler input; the persisted cursor rotates parked scopes across bounded sweeps. */
export async function listPendingProviderWriteScopes(
  appId: string,
  limit = 20,
): Promise<ProviderWriteScope[]> {
  if (!appId.trim() || !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new TypeError("Invalid provider scheduler scope.");
  await providerWorkStore.ready();
  await providerWriteSchedulerStore.ready();
  const db = getDbExec();
  await db.execute({
    sql: "INSERT INTO provider_write_scheduler_cursor (app_id, last_position) VALUES (?, 0) ON CONFLICT (app_id) DO NOTHING",
    args: [appId],
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const cursor = await db.execute({
      sql: "SELECT last_position FROM provider_write_scheduler_cursor WHERE app_id = ?",
      args: [appId],
    });
    const current = Number(cursor.rows[0]?.last_position);
    if (!Number.isSafeInteger(current) || current < 0)
      throw new TypeError("Unreadable provider scheduler cursor.");
    const selected = await db.execute({
      sql: `SELECT scope_json, caller_key, scope_key, MIN(position) AS first_position
        FROM provider_write_queue WHERE app_id = ? AND status IN ('queued', 'running', 'uncertain')
        GROUP BY scope_json, caller_key, scope_key
        ORDER BY CASE WHEN MIN(position) > ? THEN 0 ELSE 1 END, MIN(position) LIMIT ?`,
      args: [appId, current, limit],
    });
    if (!selected.rows.length) return [];
    const scopes = selected.rows.map((row: Record<string, unknown>) =>
      readStoredScope(row, appId),
    );
    const next = Number(selected.rows[selected.rows.length - 1].first_position);
    if (!Number.isSafeInteger(next) || next < 1)
      throw new TypeError("Unreadable provider scheduler position.");
    const advanced = await db.execute({
      sql: "UPDATE provider_write_scheduler_cursor SET last_position = ? WHERE app_id = ? AND last_position = ? RETURNING app_id",
      args: [next, appId, current],
    });
    if (advanced.rows.length === 1) return scopes;
  }
  throw new ActionContractError(
    "Provider write scheduling is busy. Retry shortly.",
    {
      errorCode: "provider_write_scheduler_busy",
      statusCode: 503,
    },
  );
}

async function scopeForCaller(
  caller: {
    appId: string;
    tenantId: string;
    principalId: string;
  },
  id: string,
): Promise<ProviderWriteScope | null> {
  await providerWorkStore.ready();
  const result = await getDbExec().execute({
    sql: "SELECT scope_json, caller_key, scope_key, operation FROM provider_write_queue WHERE id = ? AND app_id = ?",
    args: [id, caller.appId],
  });
  const row = result.rows[0];
  if (!row) return null;
  const scope = readStoredScope(row, caller.appId);
  if (
    scope.principalId !== caller.principalId ||
    scope.tenantId !== caller.tenantId
  )
    return null;
  return scope;
}

/** Authenticated action boundary: caller identity must come from server request context. */
export async function resumeProviderWriteForCaller(
  caller: { appId: string; tenantId: string; principalId: string },
  id: string,
): Promise<{ progress: ProviderWriteProgress; result?: unknown } | null> {
  const scope = await scopeForCaller(caller, id);
  return scope ? getProviderWrite(scope, id) : null;
}

/** Explicit recovery boundary; requires the authenticated caller's acknowledgement. */
export async function abandonProviderWriteForCaller(
  caller: { appId: string; tenantId: string; principalId: string },
  id: string,
): Promise<ProviderWriteProgress | null> {
  const scope = await scopeForCaller(caller, id);
  return scope ? abandonProviderWrite(scope, id) : null;
}
