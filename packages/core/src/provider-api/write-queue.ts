import { createHash, randomUUID } from "node:crypto";

import { getDbExec } from "../db/client.js";
import { defineMachine } from "../state-machine/index.js";
import { countOutcome } from "../tracking/failure-counters.js";
import {
  ProviderDeferredError,
  providerConnectionKey,
  providerWorkStore,
  reserveProviderBudget,
  runWithProviderBudgetCredit,
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
  /** True only when the provider itself deduplicates every replay of this operation. */
  replaySafe?: boolean;
  parseInput(value: unknown): I;
  parseResult(value: unknown): O;
  /** Re-resolve current access, including when reading persisted results. */
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
    replaySafe: handler.replaySafe,
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
  const result = await getDbExec().execute({
    sql: `INSERT INTO provider_write_queue
      (id, scope_key, caller_key, scope_json, app_id, operation, input_json, input_hash, created_at, ready_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
      WHERE provider_write_queue.operation = EXCLUDED.operation AND provider_write_queue.input_hash = EXCLUDED.input_hash
      RETURNING id, status, attempts, reason, resume_at`,
    args: [
      id,
      providerConnectionKey(scope),
      caller,
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

/** Bounded sweep; callers invoke it from the existing scheduler and progress polling. */
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
      sql: "SELECT id, status FROM provider_write_queue WHERE scope_key = ? AND caller_key = ? AND status IN ('queued', 'running', 'uncertain') ORDER BY position LIMIT 1",
      args: [providerConnectionKey(scope), callerKey(scope)],
    });
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
      sql: `UPDATE provider_write_queue SET status = 'running', claim_id = ?, lease_until = ?, attempts = attempts + 1
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
    let result: unknown;
    let pause: ProviderPause | undefined;
    let rejection: string | undefined;
    let uncertain = false;
    let dispatched = false;
    try {
      await handler.authorize(scope);
      const admission = await reserveProviderBudget(scope, handler.policy);
      if (admission.status === "paused") pause = admission;
      else {
        const input = handler.parseInput(JSON.parse(row.input_json));
        dispatched = true;
        result = handler.parseResult(
          await runWithProviderBudgetCredit(scope, handler.policy, 1, () =>
            handler.execute(input, { scope, idempotencyKey: row.id }),
          ),
        );
      }
    } catch (error) {
      if (error instanceof ProviderDeferredError) pause = error.pause;
      else if (error instanceof ProviderWriteRejectedError)
        rejection = error.reason;
      else if (!dispatched)
        pause = {
          status: "paused",
          reason: "admission_unavailable",
          resumeAt: Date.now() + 60_000,
        };
      else uncertain = true;
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
          (uncertain ? "provider_outcome_unknown" : null),
        pause?.resumeAt ?? null,
        status === "completed" ? boundedJson(result) : null,
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
  const updated = await getDbExec().execute({
    sql: `UPDATE provider_write_queue SET status = ?, result_json = ?, ready_at = ?, reason = NULL, resume_at = NULL
      WHERE id = ? AND caller_key = ? AND status = 'uncertain'
      RETURNING id, status, attempts, reason, resume_at`,
    args: [
      result.status === "completed" ? "completed" : "queued",
      result.status === "completed"
        ? boundedJson(handler.parseResult(result.result))
        : null,
      Date.now(),
      id,
      callerKey(scope),
    ],
  });
  if (updated.rows.length !== 1)
    throw new Error("Provider reconciliation lost its state transition.");
  return progress(updated.rows[0]);
}

/** Trusted app scheduler input; adapters restore context and re-authorize each scope. */
export async function listPendingProviderWriteScopes(
  appId: string,
  limit = 20,
): Promise<ProviderWriteScope[]> {
  if (!appId.trim() || !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new TypeError("Invalid provider scheduler scope.");
  await providerWorkStore.ready();
  const rows = await getDbExec().execute({
    sql: `SELECT scope_json, caller_key, scope_key FROM provider_write_queue
      WHERE app_id = ? AND status IN ('queued', 'running', 'uncertain')
      GROUP BY scope_json, caller_key, scope_key ORDER BY MIN(position) LIMIT ?`,
    args: [appId, limit],
  });
  return rows.rows.map((row: Record<string, unknown>) => {
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
      throw new TypeError(
        "Provider scheduler context does not match its scope.",
      );
    return scope;
  });
}

/** Authenticated action boundary: caller identity must come from server request context. */
export async function resumeProviderWriteForCaller(
  caller: {
    appId: string;
    tenantId: string;
    principalId: string;
  },
  id: string,
): Promise<{ progress: ProviderWriteProgress; result?: unknown } | null> {
  await providerWorkStore.ready();
  const result = await getDbExec().execute({
    sql: "SELECT scope_json, caller_key, scope_key, operation FROM provider_write_queue WHERE id = ? AND app_id = ?",
    args: [id, caller.appId],
  });
  const row = result.rows[0];
  if (!row) return null;
  const value: unknown = JSON.parse(row.scope_json);
  if (
    !value ||
    typeof value !== "object" ||
    !("principalId" in value) ||
    !("tenantId" in value) ||
    !("connectionId" in value) ||
    !("providerId" in value) ||
    !("appId" in value)
  )
    throw new TypeError("Unreadable provider write scope.");
  if (
    value.principalId !== caller.principalId ||
    value.tenantId !== caller.tenantId ||
    value.appId !== caller.appId
  )
    return null;
  if (
    typeof value.connectionId !== "string" ||
    typeof value.providerId !== "string"
  )
    throw new TypeError("Unreadable provider write scope.");
  const scope = {
    ...caller,
    connectionId: value.connectionId,
    providerId: value.providerId,
  };
  await handlerFor(
    scope.appId,
    (
      await getDbExec().execute({
        sql: "SELECT operation FROM provider_write_queue WHERE id = ? AND caller_key = ?",
        args: [id, callerKey(scope)],
      })
    ).rows[0]?.operation,
  ).authorize(scope);
  await reconcileProviderWrite(scope, id);
  await drainProviderWrites(scope);
  return getProviderWrite(scope, id);
}
