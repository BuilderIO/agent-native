import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { ActionContractError, isActionContractError } from "../action.js";
import { getDbExec } from "../db/client.js";
import { defineStore } from "../db/store-registry.js";
import { writeActionChangeMarker } from "../server/action-change-marker-write.js";
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
    cancel: { from: ["queued"], to: "failed" },
  },
});

export interface ProviderWriteProgress {
  id: string;
  status: (typeof providerWriteLifecycle.states)[number];
  attempts: number;
  reason: string | null;
  resumeAt: number | null;
}

export interface ProviderWriteReceipt {
  progress: ProviderWriteProgress;
  result?: unknown;
  /** Completion is durable even while the scoped UI change marker awaits delivery. */
  notification?: "pending" | "published";
}

export interface ProviderWriteExecutionContext {
  scope: ProviderWriteScope;
  idempotencyKey: string;
  /** Non-secret, server-owned context saved when the intent was first accepted. */
  metadata?: unknown;
}

export interface ProviderWriteHandler<I, O> {
  policy: ProviderBudgetPolicy;
  /**
   * Every provider effect uses budget-admitted framework HTTP transports, and
   * local bookkeeping is safe to repeat. Raw/non-HTTP providers cannot opt in.
   */
  dispatchTracking?: "provider-api";
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
    context: ProviderWriteExecutionContext,
  ) => Promise<
    | { status: "completed"; result: O }
    | { status: "not_applied" }
    | { status: "uncertain" }
  >;
  /** Receives a stable idempotency key. Never persist a token in input or result. */
  execute(input: I, context: ProviderWriteExecutionContext): Promise<O>;
}

interface RegisteredHandler {
  dispatchTracking?: "provider-api";
  replaySafe?: boolean;
  policy: ProviderBudgetPolicy;
  parseInput(value: unknown): unknown;
  parseResult(value: unknown): unknown;
  authorize(scope: ProviderWriteScope): Promise<void>;
  reconcile?: ProviderWriteHandler<unknown, unknown>["reconcile"];
  execute(
    input: unknown,
    context: ProviderWriteExecutionContext,
  ): Promise<unknown>;
}

const handlers = new Map<string, RegisteredHandler>();
const authorizers = new Map<
  string,
  { authorize(scope: ProviderWriteScope): Promise<void> }
>();
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
          reconcile: (input: unknown, context: ProviderWriteExecutionContext) =>
            reconcile(
              readAcceptedInput(
                (value) => handler.parseInput(value),
                boundedJson(input),
              ),
              context,
            ),
        }
      : {}),
    execute: (input, context) =>
      handler.execute(
        readAcceptedInput(
          (value) => handler.parseInput(value),
          boundedJson(input),
        ),
        context,
      ),
  };
  handlers.set(key, registered);
  return () => {
    if (handlers.get(key) === registered) handlers.delete(key);
  };
}

function handlerFor(appId: string, operation: string): RegisteredHandler {
  const handler = handlers.get(JSON.stringify([appId, operation]));
  if (!handler) throw unavailableWriteHandler();
  return handler;
}

/**
 * Current app authorization for reading/stopping retained intents whose operation
 * was retired. This never authorizes enqueue, execution, reconciliation or result parsing.
 */
export function registerProviderWriteAuthorizer(
  appId: string,
  authorizeScope: (scope: ProviderWriteScope) => Promise<void>,
): () => void {
  if (!appId.trim()) throw new TypeError("Provider write app is missing.");
  if (authorizers.has(appId))
    throw new Error("Provider write authorizer is already registered.");
  const registered = { authorize: authorizeScope };
  authorizers.set(appId, registered);
  return () => {
    if (authorizers.get(appId) === registered) authorizers.delete(appId);
  };
}

function unavailableWriteHandler(): ActionContractError {
  return new ActionContractError("Provider write handler is unavailable.", {
    errorCode: "provider_write_handler_unavailable",
    statusCode: 503,
  });
}

async function authorizeStoredWriteAccess(
  scope: ProviderWriteScope,
  operation: string,
): Promise<RegisteredHandler | undefined> {
  const handler = handlers.get(JSON.stringify([scope.appId, operation]));
  if (handler) {
    await handler.authorize(scope);
    return handler;
  }
  const authorizer = authorizers.get(scope.appId);
  if (!authorizer) throw unavailableWriteHandler();
  await authorizer.authorize(scope);
  return undefined;
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
  const json: unknown = JSON.stringify(value);
  if (typeof json !== "string" || Buffer.byteLength(json) > MAX_JSON_BYTES)
    throw new TypeError(
      "Provider queue values must be bounded structured JSON; use blob references for files.",
    );
  return json;
}

function readAcceptedInput<T>(
  parse: (value: unknown) => T,
  inputJson: string,
): T {
  const parsed = parse(JSON.parse(inputJson));

  if (
    !isDeepStrictEqual(JSON.parse(inputJson), JSON.parse(boundedJson(parsed)))
  )
    throw new TypeError("Worker schema changes the accepted provider intent.");
  return parsed;
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

export interface EnqueueProviderWriteOptions {
  scope: ProviderWriteScope;
  operation: string;
  /** One key for the user's intent, reused by retries, never a request timestamp. */
  idempotencyKey: string;
  input: unknown;
  /** Non-secret server context, retained independently of the intent's idempotency. */
  metadata?: unknown;
}

export async function enqueueProviderWrite(
  options: EnqueueProviderWriteOptions,
): Promise<ProviderWriteReceipt> {
  const { scope } = options;
  if (!options.idempotencyKey.trim())
    throw new TypeError("An idempotency key is required.");
  const handler = handlerFor(scope.appId, options.operation);

  await handler.authorize(scope);
  const input = boundedJson(handler.parseInput(options.input));
  const inputHash = createHash("sha256").update(input).digest("hex");
  const metadata = writeMetadataJson(options.metadata);
  const caller = callerKey(scope);
  const id = createHash("sha256")
    .update(JSON.stringify([caller, options.idempotencyKey]))
    .digest("hex");
  await providerWorkStore.ready();
  await providerWriteEnqueueStore.ready();
  const result = await getDbExec().execute({
    sql: `WITH caller_lock AS (
        INSERT INTO provider_write_enqueue_lock (caller_key) VALUES (?)
        ON CONFLICT (caller_key) DO UPDATE SET caller_key = EXCLUDED.caller_key
        RETURNING caller_key
      )
      INSERT INTO provider_write_queue
      (id, scope_key, caller_key, scope_json, app_id, operation, input_json, input_hash, metadata_json, created_at, ready_at)
      SELECT ?, ?, caller_lock.caller_key, ?, ?, ?, ?, ?, ?, ?, ? FROM caller_lock
      ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
      WHERE provider_write_queue.operation = EXCLUDED.operation
        AND (provider_write_queue.input_hash = EXCLUDED.input_hash OR provider_write_queue.input_json::jsonb = EXCLUDED.input_json::jsonb)
      RETURNING id, status, attempts, reason, resume_at, result_json, completion_notified_at`,
    args: [
      caller,
      id,
      providerConnectionKey(scope),
      boundedJson(scope),
      scope.appId,
      options.operation,
      input,
      inputHash,
      metadata,
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
  if (result.rows[0].status === "completed") await handler.authorize(scope);
  return receipt(result.rows[0], handler);
}

function receipt(
  row: Record<string, unknown>,
  handler: RegisteredHandler,
): ProviderWriteReceipt {
  const current = progress(row);
  if (current.status !== "completed") return { progress: current };
  if (typeof row.result_json !== "string")
    throw new TypeError("Completed provider write has no result.");
  return {
    progress: current,
    result: handler.parseResult(JSON.parse(row.result_json)),
    notification: completionNotificationState(row.completion_notified_at),
  };
}

export async function getProviderWrite(
  scope: ProviderWriteScope,
  id: string,
): Promise<ProviderWriteReceipt | null> {
  await providerWorkStore.ready();
  const rows = await getDbExec().execute({
    sql: "SELECT id, operation, status, attempts, reason, resume_at, result_json, completion_notified_at FROM provider_write_queue WHERE id = ? AND caller_key = ? AND scope_key = ?",
    args: [id, callerKey(scope), providerConnectionKey(scope)],
  });
  const row = rows.rows[0];
  if (!row) return null;
  const handler = await authorizeStoredWriteAccess(scope, row.operation);
  if (!handler) {
    const current = progress(row);
    if (current.status === "completed") throw unavailableWriteHandler();
    return { progress: current };
  }
  return receipt(row, handler);
}

function writeMetadataJson(value: unknown): string | null {
  if (value === undefined) return null;
  const serialized = boundedJson(value);
  if (!isDeepStrictEqual(value, JSON.parse(serialized)))
    throw new TypeError(
      "Provider write context must contain only JSON values.",
    );
  return serialized;
}

function readWriteMetadata(value: unknown): unknown {
  if (value === null) return undefined;
  if (typeof value !== "string")
    throw new TypeError("Unreadable provider write context.");
  return JSON.parse(value);
}

function completionNotificationState(value: unknown): "pending" | "published" {
  if (value === null) return "pending";
  if (
    (typeof value === "number" ||
      (typeof value === "string" && /^\d+$/.test(value)) ||
      typeof value === "bigint") &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) >= 0
  )
    return "published";
  throw new TypeError("Unreadable provider write notification state.");
}

/** A committed provider effect remains complete while its UI notification retries. */
export class ProviderWriteCompletionNotificationError extends ActionContractError {
  constructor() {
    super(
      "Provider write completed; its change notification is awaiting delivery.",
      { errorCode: "provider_write_notification_unavailable", statusCode: 503 },
    );
    this.name = "ProviderWriteCompletionNotificationError";
  }
}

async function publishCompletedWrites(
  scope: ProviderWriteScope,
): Promise<boolean> {
  try {
    const db = getDbExec();
    const selected = await db.execute({
      sql: `SELECT id FROM provider_write_queue WHERE scope_key = ? AND caller_key = ?
        AND status = 'completed' AND completion_notified_at IS NULL ORDER BY position LIMIT 20`,
      args: [providerConnectionKey(scope), callerKey(scope)],
    });
    if (!selected.rows.length) return true;
    await writeActionChangeMarker({
      actionName: `${scope.appId}:provider-write-completed`,
      owner: scope.principalId,
      requestSource: "provider-write-worker",
    });

    for (const row of selected.rows) {
      await db.execute({
        sql: `UPDATE provider_write_queue SET completion_notified_at = ?
          WHERE id = ? AND scope_key = ? AND caller_key = ? AND status = 'completed' AND completion_notified_at IS NULL`,
        args: [
          Date.now(),
          row.id,
          providerConnectionKey(scope),
          callerKey(scope),
        ],
      });
    }
    return true;
  } catch {
    const error = new ProviderWriteCompletionNotificationError();
    countOutcome("provider_write_notification_error_counts", {
      outcome: error.errorCode,
    });
    try {
      console.error(error);
    } catch {
      // coercion-ok: diagnostic sink failure cannot alter the committed provider outcome.
    }
    return false;
  }
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
  options.signal?.throwIfAborted();
  let notificationsAvailable = await publishCompletedWrites(scope);
  const db = getDbExec();
  const completed: ProviderWriteProgress[] = [];
  for (let index = 0; index < maxItems; index++) {
    options.signal?.throwIfAborted();

    await db.execute({
      sql: `UPDATE provider_write_queue SET
        status = CASE WHEN claim_phase = 'preparing' THEN 'queued' ELSE 'uncertain' END,
        reason = CASE WHEN claim_phase = 'preparing' THEN 'lease_expired_before_dispatch' ELSE 'lease_expired' END,
        ready_at = CASE WHEN claim_phase = 'preparing' THEN ? ELSE ready_at END,
        resume_at = NULL, claim_id = NULL, claim_phase = NULL, lease_until = NULL
        WHERE scope_key = ? AND status = 'running' AND lease_until <= ?`,
      args: [Date.now(), providerConnectionKey(scope), Date.now()],
    });
    const head = await db.execute({
      sql: "SELECT id, status, operation, attempts, reason, resume_at FROM provider_write_queue WHERE scope_key = ? AND caller_key = ? AND status IN ('queued', 'running', 'uncertain') ORDER BY position LIMIT 1",
      args: [providerConnectionKey(scope), callerKey(scope)],
    });
    const pendingHead = head.rows.at(0);
    if (!pendingHead || pendingHead.status === "running") break;
    if (pendingHead.status === "uncertain") {
      const current = progress(pendingHead);
      if (current.resumeAt !== null && current.resumeAt > Date.now()) {
        completed.push(current);
        break;
      }
    }
    if (
      (pendingHead.status === "queued" || pendingHead.status === "uncertain") &&
      !handlers.has(JSON.stringify([scope.appId, pendingHead.operation]))
    ) {
      const deferred = await db.execute({
        sql: `UPDATE provider_write_queue SET reason = CASE
            WHEN status = 'uncertain' AND reason = 'result_unavailable' THEN reason
            ELSE 'handler_unavailable' END,
          resume_at = CASE WHEN ready_at > ? THEN ready_at ELSE ? END,
          ready_at = CASE WHEN ready_at > ? THEN ready_at ELSE ? END
          WHERE id = ? AND caller_key = ? AND status = ?
          RETURNING id, status, attempts, reason, resume_at`,
        args: [
          Date.now(),
          Date.now() + 60_000,
          Date.now(),
          Date.now() + 60_000,
          pendingHead.id,
          callerKey(scope),
          pendingHead.status,
        ],
      });
      if (deferred.rows.length === 1)
        completed.push(progress(deferred.rows[0]));
      break;
    }
    if (pendingHead.status === "uncertain") {
      let reconciled: ProviderWriteProgress | null;
      try {
        reconciled = await reconcileProviderWrite(scope, pendingHead.id);
      } catch (error) {
        options.signal?.throwIfAborted();

        const deferred = await deferUncertainRecovery(
          scope,
          pendingHead.id,
          pendingHead.reason === "result_unavailable"
            ? "result_unavailable"
            : error instanceof ProviderDeferredError
              ? error.pause.reason
              : isPermanentAuthorizationError(error) ||
                  error instanceof ProviderWriteRejectedError
                ? "authorization_rejected"
                : "reconciliation_unavailable",
          error instanceof ProviderDeferredError
            ? error.pause.resumeAt
            : Date.now() + 60_000,
        );
        if (deferred) completed.push(deferred);
        break;
      }
      if (!reconciled || reconciled.status === "uncertain") break;
      if (reconciled.status === "completed") {
        completed.push(reconciled);
        continue;
      }
    }
    const handler = handlerFor(scope.appId, pendingHead.operation);
    const claimId = randomUUID();
    const claimed = await db.execute({
      sql: `UPDATE provider_write_queue SET status = 'running', claim_id = ?, claim_phase = 'preparing', lease_until = ?, attempts = attempts + 1, reason = NULL, resume_at = NULL
        WHERE id = (SELECT id FROM provider_write_queue WHERE scope_key = ? AND caller_key = ?
          AND status IN ('queued', 'running', 'uncertain') ORDER BY position LIMIT 1)
          AND id = ? AND caller_key = ? AND status = 'queued' AND ready_at <= ?
        RETURNING id, operation, input_json, metadata_json, status, attempts, reason, resume_at`,
      args: [
        claimId,
        Date.now() + LEASE_MS,
        providerConnectionKey(scope),
        callerKey(scope),
        pendingHead.id,
        callerKey(scope),
        Date.now(),
      ],
    });
    const row = claimed.rows[0];
    if (!row) break;
    let resultJson: string | null = null;
    const execution: {
      phase: "input" | "authorization" | "admission" | "dispatch" | "result";
      dispatched: boolean;
    } = { phase: "input", dispatched: false };
    let pause: ProviderPause | undefined;
    let deferredReason: string | undefined;
    let rejection: string | undefined;
    let uncertain = false;
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
    const runtimeHeartbeat: unknown = heartbeat;
    if (
      runtimeHeartbeat !== null &&
      typeof runtimeHeartbeat === "object" &&
      "unref" in runtimeHeartbeat &&
      typeof runtimeHeartbeat.unref === "function"
    )
      runtimeHeartbeat.unref();
    try {
      const input = readAcceptedInput(handler.parseInput, row.input_json);
      const metadata = readWriteMetadata(row.metadata_json);
      execution.phase = "authorization";
      await handler.authorize(scope);
      const execute = async () => {
        const advanced = await db.execute({
          sql: `UPDATE provider_write_queue SET claim_phase = 'dispatching'
            WHERE id = ? AND claim_id = ? AND status = 'running' AND claim_phase = 'preparing' AND lease_until > ?
            RETURNING id`,
          args: [row.id, claimId, Date.now()],
        });
        if (advanced.rows.length !== 1)
          throw new Error("Provider write claim was lost before dispatch.");
        execution.dispatched = true;
        execution.phase = "dispatch";
        return handler.execute(input, {
          scope,
          idempotencyKey: row.id,
          metadata,
        });
      };
      let executed: unknown;
      if (handler.dispatchTracking === "provider-api") {
        executed = await runWithProviderDispatchTracking(
          dispatchState,
          execute,
          { requireAdmission: true },
        );
      } else {
        execution.phase = "admission";
        const admission = await reserveProviderBudget(scope, handler.policy);
        if (admission.status === "paused") pause = admission;
        else {
          executed = await runWithProviderBudgetCredit(
            scope,
            handler.policy,
            1,
            admission,
            execute,
          );
        }
      }
      if (!pause) {
        execution.phase = "result";
        resultJson = boundedJson(handler.parseResult(executed));
      }
    } catch (error) {
      if (execution.phase === "result") {
        uncertain = true;
        resultUnavailable = true;
      } else if (execution.phase === "input") {
        pause = {
          status: "paused",
          reason: "admission_unavailable",
          resumeAt: Date.now() + 60_000,
        };
        deferredReason = "input_incompatible";
      } else if (execution.phase === "admission") {
        pause = {
          status: "paused",
          reason: "admission_unavailable",
          resumeAt: Date.now() + 60_000,
        };
      } else if (error instanceof ProviderDeferredError) {
        if (
          !execution.dispatched ||
          error instanceof ProviderWriteNotDispatchedError ||
          handler.replaySafe === true ||
          (handler.dispatchTracking === "provider-api" &&
            dispatchState.writes === 0)
        )
          pause = error.pause;
        else uncertain = true;
      } else if (
        handler.dispatchTracking === "provider-api" &&
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
      else if (
        execution.phase === "authorization" &&
        isPermanentAuthorizationError(error)
      )
        rejection = "authorization_rejected";
      else if (
        !execution.dispatched ||
        (handler.dispatchTracking === "provider-api" &&
          dispatchState.writes === 0)
      )
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
      sql: `UPDATE provider_write_queue SET status = ?, ready_at = ?, reason = ?, resume_at = ?, result_json = ?, claim_id = NULL, claim_phase = NULL, lease_until = NULL
        WHERE id = ? AND status = 'running' AND claim_id = ?
        RETURNING id, status, attempts, reason, resume_at`,
      args: [
        status,
        pause?.resumeAt ?? Date.now() + 60_000,
        deferredReason ??
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
    if (status === "completed" && notificationsAvailable)
      notificationsAvailable = await publishCompletedWrites(scope);
    completed.push(progress(updated.rows[0]));
    countOutcome("provider_write_counts", {
      provider: scope.providerId,
      outcome: status,
    });
    if (status !== "completed" && status !== "failed") break;
  }
  return completed;
}

async function deferUncertainRecovery(
  scope: ProviderWriteScope,
  id: string,
  reason: string,
  resumeAt: number | null,
): Promise<ProviderWriteProgress | null> {
  const updated = await getDbExec().execute({
    sql: `UPDATE provider_write_queue SET reason = ?, resume_at = ?, ready_at = ?
      WHERE id = ? AND caller_key = ? AND scope_key = ? AND status = 'uncertain'
      RETURNING id, status, attempts, reason, resume_at`,
    args: [
      reason,
      resumeAt,
      resumeAt ?? Date.now() + 60_000,
      id,
      callerKey(scope),
      providerConnectionKey(scope),
    ],
  });
  return updated.rows.length === 1 ? progress(updated.rows[0]) : null;
}

/** Release an uncertain head only after the adapter verifies its upstream effect. */
export async function reconcileProviderWrite(
  scope: ProviderWriteScope,
  id: string,
): Promise<ProviderWriteProgress | null> {
  await providerWorkStore.ready();
  const found = await getDbExec().execute({
    sql: "SELECT id, operation, input_json, metadata_json, status, attempts, reason, resume_at FROM provider_write_queue WHERE id = ? AND caller_key = ? AND scope_key = ?",
    args: [id, callerKey(scope), providerConnectionKey(scope)],
  });
  const row = found.rows[0];
  if (!row) return null;
  const handler = handlerFor(scope.appId, row.operation);
  await handler.authorize(scope);
  const current = progress(row);
  if (
    current.status !== "uncertain" ||
    !handler.reconcile ||
    (current.resumeAt !== null && current.resumeAt > Date.now())
  )
    return current;
  let input: unknown;
  let metadata: unknown;
  try {
    input = readAcceptedInput(handler.parseInput, row.input_json);
    metadata = readWriteMetadata(row.metadata_json);
  } catch {
    return deferUncertainRecovery(
      scope,
      id,
      "input_incompatible",
      Date.now() + 60_000,
    );
  }
  const result: unknown = await handler.reconcile(input, {
    scope,
    idempotencyKey: id,
    metadata,
  });
  if (
    !result ||
    typeof result !== "object" ||
    !("status" in result) ||
    (result.status !== "completed" &&
      result.status !== "not_applied" &&
      result.status !== "uncertain") ||
    (result.status === "completed" &&
      (!("result" in result) || result.result === undefined))
  )
    return deferUncertainRecovery(
      scope,
      id,
      "invalid_reconciliation",
      Date.now() + 60_000,
    );
  if (
    result.status === "uncertain" ||
    (result.status === "not_applied" && !handler.replaySafe)
  )
    return deferUncertainRecovery(
      scope,
      id,
      row.reason === "result_unavailable"
        ? "result_unavailable"
        : "reconciliation_inconclusive",
      Date.now() + 60_000,
    );
  let resultJson: string | null = null;
  let resultUnavailable = false;
  if (result.status === "completed") {
    try {
      resultJson = boundedJson(
        handler.parseResult("result" in result ? result.result : undefined),
      );
    } catch {
      resultUnavailable = true;
    }
  }
  const updated = await getDbExec().execute({
    sql: `UPDATE provider_write_queue SET status = ?, result_json = ?, ready_at = ?, reason = ?, resume_at = ?, claim_phase = NULL
      WHERE id = ? AND caller_key = ? AND status = 'uncertain'
      RETURNING id, status, attempts, reason, resume_at`,
    args: [
      resultUnavailable
        ? "uncertain"
        : result.status === "completed"
          ? "completed"
          : "queued",
      resultJson,
      resultUnavailable ? Date.now() + 60_000 : Date.now(),
      resultUnavailable ? "result_unavailable" : null,
      resultUnavailable ? Date.now() + 60_000 : null,
      id,
      callerKey(scope),
    ],
  });
  if (updated.rows.length !== 1)
    throw new Error("Provider reconciliation lost its state transition.");
  if (updated.rows[0].status === "completed")
    await publishCompletedWrites(scope);
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
  return stopProviderWrite(scope, id, "uncertain");
}

/**
 * Stop an accepted queued intent explicitly; this never undoes prior effects.
 * A replay-safe earlier attempt may already have applied part of the intent.
 */
export async function cancelQueuedProviderWrite(
  scope: ProviderWriteScope,
  id: string,
): Promise<ProviderWriteProgress | null> {
  return stopProviderWrite(scope, id, "queued");
}

async function stopProviderWrite(
  scope: ProviderWriteScope,
  id: string,
  expected: "queued" | "uncertain",
): Promise<ProviderWriteProgress | null> {
  await providerWorkStore.ready();
  const db = getDbExec();
  const found = await db.execute({
    sql: "SELECT id, operation, status, attempts, reason, resume_at FROM provider_write_queue WHERE id = ? AND caller_key = ? AND scope_key = ?",
    args: [id, callerKey(scope), providerConnectionKey(scope)],
  });
  const row = found.rows[0];
  if (!row) return null;
  await authorizeStoredWriteAccess(scope, row.operation);
  const current = progress(row);
  if (current.status === "failed" && current.reason === "outcome_abandoned")
    return current;
  if (current.status !== expected)
    throw new ActionContractError(
      expected === "queued"
        ? "Only a queued provider write can be cancelled."
        : "Only an uncertain provider write can be abandoned.",
      {
        errorCode:
          expected === "queued"
            ? "provider_write_not_queued"
            : "provider_write_not_uncertain",
        statusCode: 409,
      },
    );
  const updated = await db.execute({
    sql: `UPDATE provider_write_queue SET status = 'failed', reason = 'outcome_abandoned',
        resume_at = NULL, claim_id = NULL, claim_phase = NULL, lease_until = NULL
      WHERE id = ? AND caller_key = ? AND scope_key = ? AND status = ?
      RETURNING id, status, attempts, reason, resume_at`,
    args: [id, callerKey(scope), providerConnectionKey(scope), expected],
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

/** A corrupt persisted scope is reported without exposing its stored contents. */
export class ProviderWriteSchedulerScopeError extends ActionContractError {
  constructor(appId: string, position: number) {
    super("Stored provider scheduler scope is invalid.", {
      errorCode: "provider_write_scope_invalid",
      statusCode: 503,
      details: {
        appId: appId.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80),
        position,
      },
    });
    this.name = "ProviderWriteSchedulerScopeError";
  }
}

function logSchedulerScopeError(error: ProviderWriteSchedulerScopeError): void {
  try {
    console.error(error);
  } catch {
    // coercion-ok: a broken diagnostic sink cannot stop healthy scheduled work.
  }
}

/** Trusted scheduler input; the persisted cursor rotates parked scopes across bounded sweeps. */
export async function listPendingProviderWriteScopes(
  appId: string,
  limit = 20,
  options: {
    onInvalidScope?: (
      error: ProviderWriteSchedulerScopeError,
    ) => void | Promise<void>;
  } = {},
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
        FROM provider_write_queue WHERE app_id = ? AND (status IN ('queued', 'running', 'uncertain')
          OR (status = 'completed' AND completion_notified_at IS NULL))
        GROUP BY scope_json, caller_key, scope_key
        ORDER BY CASE WHEN MIN(position) > ? THEN 0 ELSE 1 END, MIN(position) LIMIT ?`,
      args: [appId, current, limit],
    });
    if (!selected.rows.length) return [];
    const next = Number(selected.rows[selected.rows.length - 1].first_position);
    if (!Number.isSafeInteger(next) || next < 1)
      throw new TypeError("Unreadable provider scheduler position.");
    const advanced = await db.execute({
      sql: "UPDATE provider_write_scheduler_cursor SET last_position = ? WHERE app_id = ? AND last_position = ? RETURNING app_id",
      args: [next, appId, current],
    });
    if (advanced.rows.length === 1) {
      const scopes: ProviderWriteScope[] = [];
      for (const row of selected.rows) {
        try {
          scopes.push(readStoredScope(row, appId));
        } catch {
          const error = new ProviderWriteSchedulerScopeError(
            appId,
            Number(row.first_position),
          );
          countOutcome("provider_write_scheduler_error_counts", {
            outcome: error.errorCode,
          });
          if (options.onInvalidScope) {
            try {
              void Promise.resolve(options.onInvalidScope(error)).catch(() =>
                logSchedulerScopeError(error),
              );
            } catch {
              logSchedulerScopeError(error);
            }
          } else logSchedulerScopeError(error);
        }
      }
      return scopes;
    }
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

/** Explicit queued cancellation, scoped to the authenticated caller. */
export async function cancelQueuedProviderWriteForCaller(
  caller: { appId: string; tenantId: string; principalId: string },
  id: string,
): Promise<ProviderWriteProgress | null> {
  const scope = await scopeForCaller(caller, id);
  return scope ? cancelQueuedProviderWrite(scope, id) : null;
}
