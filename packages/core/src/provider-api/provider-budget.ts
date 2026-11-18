import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

import { withoutWriteObservation } from "../action-frame.js";
import { ActionContractError } from "../action.js";
import { getDbExec, type DbExecInput } from "../db/client.js";
import { defineStore } from "../db/store-registry.js";
import { countOutcome } from "../tracking/failure-counters.js";

const bookkeepingDb = {
  execute: (input: DbExecInput) =>
    withoutWriteObservation(() => getDbExec().execute(input)),
};

const prepaid = new AsyncLocalStorage<{
  key: string;
  capacity: number;
  windowMs: number;
  cost: number;
  consumed: boolean;
}>();

/** @internal One queue reservation pays for exactly one nested transport attempt. */
export function runWithProviderBudgetCredit<T>(
  scope: ProviderConnectionScope,
  policy: ProviderBudgetPolicy,
  cost: number,
  work: () => Promise<T>,
): Promise<T> {
  return prepaid.run(
    {
      key: providerConnectionKey(scope),
      capacity: policy.capacity,
      windowMs: policy.windowMs,
      cost,
      consumed: false,
    },
    work,
  );
}

export interface ProviderConnectionScope {
  providerId: string;
  tenantId: string;
  /** Canonical upstream account identity; app-specific grant ids must not split it. */
  connectionId: string;
}

export interface ProviderBudgetPolicy {
  capacity: number;
  windowMs: number;
}

export interface ProviderPause {
  status: "paused";
  reason:
    | "budget_exhausted"
    | "provider_throttle"
    | "operator"
    | "admission_unavailable";
  resumeAt: number | null;
}

export type ProviderAdmission = { status: "ready" } | ProviderPause;
export type ProviderReadResult<T> =
  | {
      status: "fresh";
      data: T;
      fetchedAt: number;
      cache: "stored" | "payload_too_large";
    }
  | { status: "stale"; data: T; fetchedAt: number; pause: ProviderPause }
  | { status: "unavailable"; pause: ProviderPause };

export const providerWorkStore = defineStore({
  id: "provider_work",
  migrations: [
    {
      name: "connection-budget-cache-queue",
      sql: [
        `CREATE TABLE IF NOT EXISTS provider_connection_budgets (
          scope_key TEXT PRIMARY KEY, window_started_at BIGINT NOT NULL,
          used BIGINT NOT NULL, capacity BIGINT NOT NULL, window_ms BIGINT NOT NULL,
          pause_reason TEXT, resume_at BIGINT
        )`,
        `CREATE TABLE IF NOT EXISTS provider_read_cache (
          scope_key TEXT NOT NULL, cache_key TEXT NOT NULL, data_json TEXT NOT NULL,
          fetched_at BIGINT NOT NULL, PRIMARY KEY (scope_key, cache_key)
        )`,
        `CREATE TABLE IF NOT EXISTS provider_write_queue (
          id TEXT PRIMARY KEY, position BIGSERIAL NOT NULL, scope_key TEXT NOT NULL, caller_key TEXT NOT NULL, scope_json TEXT NOT NULL,
          app_id TEXT NOT NULL, operation TEXT NOT NULL, input_json TEXT NOT NULL,
          input_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
          created_at BIGINT NOT NULL, ready_at BIGINT NOT NULL,
          claim_id TEXT, lease_until BIGINT, attempts BIGINT NOT NULL DEFAULT 0,
          reason TEXT, resume_at BIGINT, result_json TEXT
        )`,
        `CREATE INDEX IF NOT EXISTS provider_write_queue_due_idx
          ON provider_write_queue (scope_key, caller_key, position)
          WHERE status IN ('queued', 'running', 'uncertain')`,
        `CREATE INDEX IF NOT EXISTS provider_write_queue_caller_idx
          ON provider_write_queue (caller_key, created_at)`,
      ],
    },
  ],
});

export function providerConnectionKey(scope: ProviderConnectionScope): string {
  for (const value of [scope.providerId, scope.tenantId, scope.connectionId]) {
    if (!value.trim())
      throw new TypeError("Provider connection scope is incomplete.");
  }
  return createHash("sha256")
    .update(
      JSON.stringify([scope.providerId, scope.tenantId, scope.connectionId]),
    )
    .digest("hex");
}

export class ProviderBudgetUnavailableError extends Error {
  readonly actionContractError = true;
  readonly code = "provider_budget_unavailable";
  readonly errorCode = this.code;
  readonly statusCode = 503;
  constructor(options?: ErrorOptions) {
    super("Provider budget storage is unavailable.", options);
    this.name = "ProviderBudgetUnavailableError";
  }
}

function policyValues(policy: ProviderBudgetPolicy, cost: number): void {
  if (
    !Number.isSafeInteger(policy.capacity) ||
    policy.capacity < 1 ||
    !Number.isSafeInteger(policy.windowMs) ||
    policy.windowMs < 1 ||
    !Number.isSafeInteger(cost) ||
    cost < 1 ||
    cost > policy.capacity
  ) {
    throw new TypeError("Invalid provider budget policy or request cost.");
  }
}

function parsePause(reason: unknown, resumeAt: unknown): ProviderPause {
  if (
    reason !== "budget_exhausted" &&
    reason !== "provider_throttle" &&
    reason !== "operator" &&
    reason !== "admission_unavailable"
  )
    throw new TypeError("Unreadable provider pause reason.");
  const resume = resumeAt === null ? null : Number(resumeAt);
  if (resume !== null && !Number.isSafeInteger(resume))
    throw new TypeError("Unreadable provider resume time.");
  return { status: "paused", reason, resumeAt: resume };
}

/** One compare-and-increment statement admits at most capacity across processes. */
export async function reserveProviderBudget(
  scope: ProviderConnectionScope,
  policy: ProviderBudgetPolicy,
  cost = 1,
  options: { ceiling?: number } = {},
): Promise<ProviderAdmission> {
  policyValues(policy, cost);
  const ceiling = options.ceiling ?? policy.capacity;
  if (
    !Number.isSafeInteger(ceiling) ||
    ceiling < cost ||
    ceiling > policy.capacity
  )
    throw new TypeError("Invalid provider budget ceiling.");
  const key = providerConnectionKey(scope);
  const credit = prepaid.getStore();
  if (
    credit &&
    !credit.consumed &&
    credit.key === key &&
    credit.capacity === policy.capacity &&
    credit.windowMs === policy.windowMs &&
    credit.cost === cost
  ) {
    credit.consumed = true;
    return { status: "ready" };
  }
  const now = Date.now();
  try {
    await providerWorkStore.ready();
    const db = bookkeepingDb;
    const grant = await db.execute({
      sql: `INSERT INTO provider_connection_budgets
        (scope_key, window_started_at, used, capacity, window_ms)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (scope_key) DO UPDATE SET
          window_started_at = CASE WHEN provider_connection_budgets.window_started_at + provider_connection_budgets.window_ms <= ? THEN ? ELSE provider_connection_budgets.window_started_at END,
          used = CASE WHEN provider_connection_budgets.window_started_at + provider_connection_budgets.window_ms <= ? THEN ? ELSE provider_connection_budgets.used + ? END,
          pause_reason = NULL, resume_at = NULL
        WHERE provider_connection_budgets.capacity = ? AND provider_connection_budgets.window_ms = ?
          AND (provider_connection_budgets.pause_reason IS NULL OR provider_connection_budgets.resume_at <= ?)
          AND (provider_connection_budgets.window_started_at + provider_connection_budgets.window_ms <= ? OR provider_connection_budgets.used + ? <= ?)
        RETURNING scope_key`,
      args: [
        key,
        now,
        cost,
        policy.capacity,
        policy.windowMs,
        now,
        now,
        now,
        cost,
        cost,
        policy.capacity,
        policy.windowMs,
        now,
        now,
        cost,
        ceiling,
      ],
    });
    if (grant.rows.length === 1) return { status: "ready" };
    const result = await db.execute({
      sql: "SELECT capacity, window_ms, window_started_at, pause_reason, resume_at FROM provider_connection_budgets WHERE scope_key = ?",
      args: [key],
    });
    const row = result.rows[0];
    if (!row) throw new ProviderBudgetUnavailableError();
    if (
      Number(row.capacity) !== policy.capacity ||
      Number(row.window_ms) !== policy.windowMs
    )
      throw new TypeError("Conflicting policies for one provider connection.");
    const pause: ProviderPause =
      row.pause_reason !== null &&
      (row.resume_at === null || Number(row.resume_at) > now)
        ? parsePause(row.pause_reason, row.resume_at)
        : {
            status: "paused",
            reason: "budget_exhausted",
            resumeAt: Number(row.window_started_at) + policy.windowMs,
          };
    countOutcome("provider_budget_counts", {
      provider: scope.providerId,
      outcome: pause.reason,
    });
    return pause;
  } catch (error) {
    if (
      error instanceof TypeError ||
      error instanceof ProviderBudgetUnavailableError
    )
      throw error;
    throw new ProviderBudgetUnavailableError({ cause: error });
  }
}

/** Does not alter deployment kill switches. Indefinite operator holds cannot be shortened. */
export async function pauseProviderBudget(
  scope: ProviderConnectionScope,
  pause: Pick<ProviderPause, "reason" | "resumeAt">,
  policy: ProviderBudgetPolicy,
): Promise<void> {
  parsePause(pause.reason, pause.resumeAt);
  policyValues(policy, 1);
  await providerWorkStore.ready();
  await bookkeepingDb.execute({
    sql: `INSERT INTO provider_connection_budgets
      (scope_key, window_started_at, used, capacity, window_ms, pause_reason, resume_at)
      VALUES (?, ?, 0, ?, ?, ?, ?)
      ON CONFLICT (scope_key) DO UPDATE SET pause_reason = EXCLUDED.pause_reason, resume_at = EXCLUDED.resume_at
      WHERE provider_connection_budgets.pause_reason IS NULL
        OR (provider_connection_budgets.resume_at IS NOT NULL AND
          (EXCLUDED.resume_at IS NULL OR EXCLUDED.resume_at > provider_connection_budgets.resume_at))`,
    args: [
      providerConnectionKey(scope),
      Date.now(),
      policy.capacity,
      policy.windowMs,
      pause.reason,
      pause.resumeAt,
    ],
  });
}

export class ProviderDeferredError extends ActionContractError {
  constructor(readonly pause: ProviderPause) {
    super("Provider request deferred.", {
      errorCode: "provider_deferred",
      statusCode:
        pause.reason === "operator" || pause.reason === "admission_unavailable"
          ? 503
          : 429,
      details: {
        pause,
        reason: pause.reason,
        resumeAt: pause.resumeAt,
        retryAfterMs:
          pause.resumeAt === null
            ? null
            : Math.max(0, pause.resumeAt - Date.now()),
      },
    });
    this.name = "ProviderDeferredError";
  }
}

export async function readWithProviderBudget<T>(options: {
  scope: ProviderConnectionScope;
  policy: ProviderBudgetPolicy;
  /** Include the caller's authorization scope and all response-shaping arguments. */
  cacheKey: string;
  principalId: string;
  authorize: () => Promise<void>;
  execute: () => Promise<T>;
  /** Validate cached JSON against the same contract as a live response. */
  parse: (value: unknown) => T;
}): Promise<ProviderReadResult<T>> {
  if (!options.principalId.trim())
    throw new TypeError("Provider cache reader is missing.");
  await options.authorize();
  const cacheKey = createHash("sha256")
    .update(JSON.stringify([options.principalId, options.cacheKey]))
    .digest("hex");
  let pause: ProviderPause;
  const admission = await reserveProviderBudget(options.scope, options.policy);
  if (admission.status === "ready") {
    try {
      const data = options.parse(
        await runWithProviderBudgetCredit(
          options.scope,
          options.policy,
          1,
          options.execute,
        ),
      );
      const fetchedAt = Date.now();
      const dataJson = JSON.stringify(data);
      if (dataJson === undefined)
        throw new TypeError("Provider cache value is not JSON.");
      if (Buffer.byteLength(dataJson) > 64 * 1024)
        return { status: "fresh", data, fetchedAt, cache: "payload_too_large" };
      await bookkeepingDb.execute({
        sql: `INSERT INTO provider_read_cache (scope_key, cache_key, data_json, fetched_at) VALUES (?, ?, ?, ?)
          ON CONFLICT (scope_key, cache_key) DO UPDATE SET data_json = EXCLUDED.data_json, fetched_at = EXCLUDED.fetched_at`,
        args: [
          providerConnectionKey(options.scope),
          cacheKey,
          dataJson,
          fetchedAt,
        ],
      });
      return { status: "fresh", data, fetchedAt, cache: "stored" };
    } catch (error) {
      if (!(error instanceof ProviderDeferredError)) throw error;
      pause = error.pause;
      await pauseProviderBudget(options.scope, pause, options.policy);
    }
  } else pause = admission;
  const cached = await bookkeepingDb.execute({
    sql: "SELECT data_json, fetched_at FROM provider_read_cache WHERE scope_key = ? AND cache_key = ?",
    args: [providerConnectionKey(options.scope), cacheKey],
  });
  const row = cached.rows[0];
  if (!row) return { status: "unavailable", pause };
  return {
    status: "stale",
    data: options.parse(JSON.parse(row.data_json)),
    fetchedAt: Number(row.fetched_at),
    pause,
  };
}

/** Inspect admission without spending; the subsequent reservation is still authoritative. */
export async function inspectProviderBudget(
  scope: ProviderConnectionScope,
  policy: ProviderBudgetPolicy,
  cost = 1,
  options: { ceiling?: number } = {},
): Promise<ProviderAdmission> {
  policyValues(policy, cost);
  const ceiling = options.ceiling ?? policy.capacity;
  if (
    !Number.isSafeInteger(ceiling) ||
    ceiling < cost ||
    ceiling > policy.capacity
  )
    throw new TypeError("Invalid provider budget ceiling.");
  try {
    await providerWorkStore.ready();
    const result = await bookkeepingDb.execute({
      sql: "SELECT capacity, window_ms, window_started_at, used, pause_reason, resume_at FROM provider_connection_budgets WHERE scope_key = ?",
      args: [providerConnectionKey(scope)],
    });
    const row = result.rows[0];
    if (!row) return { status: "ready" };
    if (
      Number(row.capacity) !== policy.capacity ||
      Number(row.window_ms) !== policy.windowMs
    )
      throw new TypeError("Conflicting policies for one provider connection.");
    if (
      row.pause_reason !== null &&
      (row.resume_at === null || Number(row.resume_at) > Date.now())
    )
      return parsePause(row.pause_reason, row.resume_at);
    const end = Number(row.window_started_at) + policy.windowMs;
    if (end <= Date.now() || Number(row.used) + cost <= ceiling)
      return { status: "ready" };
    return { status: "paused", reason: "budget_exhausted", resumeAt: end };
  } catch (error) {
    if (
      error instanceof TypeError ||
      error instanceof ProviderBudgetUnavailableError
    )
      throw error;
    throw new ProviderBudgetUnavailableError({ cause: error });
  }
}
