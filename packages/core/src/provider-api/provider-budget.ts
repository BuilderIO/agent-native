import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

import { withoutWriteObservation } from "../action-frame.js";
import { ActionContractError } from "../action.js";
import { getDbExec } from "../db/client.js";
import { defineStore } from "../db/store-registry.js";
import { countOutcome } from "../tracking/failure-counters.js";

interface ProviderBudgetReservation {
  key: string;
  capacity: number;
  windowMs: number;
  windowStartedAt: number;
  cost: number;
  ceiling: number;
  consumed: boolean;
  charge: {
    released: boolean;
    dispatched: boolean;
    releasePromise?: Promise<void>;
  };
}

const prepaid = new AsyncLocalStorage<ProviderBudgetReservation>();

const reservations = new WeakMap<object, ProviderBudgetReservation>();

export {
  runWithProviderDispatchTracking,
  noteProviderWriteDispatch,
} from "./provider-dispatch.js";

export function runWithProviderBudgetCredit<T>(
  scope: ProviderConnectionScope,
  policy: ProviderBudgetPolicy,
  cost: number,
  admission: Extract<ProviderAdmission, { status: "ready" }>,
  work: () => Promise<T>,
): Promise<T> {
  const reservation = reservations.get(admission);
  if (
    !reservation ||
    reservation.key !== providerConnectionKey(scope) ||
    reservation.capacity !== policy.capacity ||
    reservation.windowMs !== policy.windowMs ||
    reservation.cost !== cost ||
    reservation.charge.released
  )
    throw new TypeError(
      "Provider credit requires its original budget reservation.",
    );
  return prepaid.run(reservation, work);
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
    {
      name: "write-claim-phase",
      sql: [
        "ALTER TABLE provider_write_queue ADD COLUMN IF NOT EXISTS claim_phase TEXT",
      ],
    },
    {
      name: "write-completion-notification",
      sql: [
        "ALTER TABLE provider_write_queue ADD COLUMN IF NOT EXISTS completion_notified_at BIGINT",
        `CREATE INDEX IF NOT EXISTS provider_write_queue_notification_idx
          ON provider_write_queue (app_id, scope_key, caller_key, position)
          WHERE status = 'completed' AND completion_notified_at IS NULL`,
      ],
    },
    {
      name: "write-server-context",
      sql: [
        "ALTER TABLE provider_write_queue ADD COLUMN IF NOT EXISTS metadata_json TEXT",
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

export class ProviderBudgetCreditConfigurationError extends TypeError {
  readonly actionContractError = true;
  readonly errorCode = "provider_budget_credit_mismatch";
  readonly code = this.errorCode;
  readonly statusCode = 503;
  constructor() {
    super(
      "Provider transport cost or policy does not match its prepaid reservation.",
    );
    this.name = "ProviderBudgetCreditConfigurationError";
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
  if (
    (resume === null && reason !== "operator") ||
    (resume !== null && !Number.isSafeInteger(resume))
  )
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
  const now = Date.now();
  try {
    await providerWorkStore.ready();
    if (
      credit &&
      !credit.consumed &&
      !credit.charge.released &&
      !credit.charge.dispatched &&
      credit.key === key &&
      (credit.capacity !== policy.capacity ||
        credit.windowMs !== policy.windowMs ||
        credit.cost !== cost ||
        credit.ceiling !== ceiling)
    )
      throw new ProviderBudgetCreditConfigurationError();
    if (
      credit &&
      !credit.consumed &&
      !credit.charge.released &&
      !credit.charge.dispatched &&
      credit.key === key &&
      credit.capacity === policy.capacity &&
      credit.windowMs === policy.windowMs &&
      credit.cost === cost &&
      credit.ceiling === ceiling
    ) {
      credit.consumed = true;
      const admission = { status: "ready" } as const;
      reservations.set(admission, credit);
      const checked = await recheckProviderBudgetReservation(
        scope,
        policy,
        cost,
        admission,
        { ceiling },
      );
      if (checked.status === "paused") return checked;
      const checkedReservation = reservations.get(checked);
      if (!checkedReservation)
        throw new TypeError("Provider credit lost its original reservation.");

      const transferred = { status: "ready" } as const;
      reservations.set(transferred, { ...checkedReservation, consumed: false });
      return transferred;
    }
    const grant = await withoutWriteObservation(() =>
      getDbExec().execute({
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
        RETURNING window_started_at`,
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
      }),
    );
    if (grant.rows.length === 1) {
      const windowStartedAt = Number(grant.rows[0].window_started_at);
      if (!Number.isSafeInteger(windowStartedAt))
        throw new TypeError("Unreadable provider budget window.");
      const admission = { status: "ready" } as const;
      reservations.set(admission, {
        key,
        capacity: policy.capacity,
        windowMs: policy.windowMs,
        windowStartedAt,
        cost,
        ceiling,
        consumed: false,
        charge: { released: false, dispatched: false },
      });
      return admission;
    }
    const result = await withoutWriteObservation(() =>
      getDbExec().execute({
        sql: "SELECT capacity, window_ms, window_started_at, pause_reason, resume_at FROM provider_connection_budgets WHERE scope_key = ?",
        args: [key],
      }),
    );
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

export async function recheckProviderBudgetReservation(
  scope: ProviderConnectionScope,
  policy: ProviderBudgetPolicy,
  cost: number,
  admission: Extract<ProviderAdmission, { status: "ready" }>,
  options: { ceiling?: number } = {},
): Promise<ProviderAdmission> {
  policyValues(policy, cost);
  const ceiling = options.ceiling ?? policy.capacity;
  const reservation = reservations.get(admission);
  const key = providerConnectionKey(scope);
  if (
    !reservation ||
    reservation.key !== key ||
    reservation.capacity !== policy.capacity ||
    reservation.windowMs !== policy.windowMs ||
    reservation.cost !== cost ||
    reservation.ceiling !== ceiling ||
    reservation.charge.released ||
    reservation.charge.dispatched
  )
    throw new TypeError(
      "Provider recheck requires its original budget reservation.",
    );
  try {
    await providerWorkStore.ready();
    const current = await withoutWriteObservation(() =>
      getDbExec().execute({
        sql: "SELECT capacity, window_ms, window_started_at, pause_reason, resume_at FROM provider_connection_budgets WHERE scope_key = ?",
        args: [key],
      }),
    );
    const row = current.rows[0];
    if (!row) throw new ProviderBudgetUnavailableError();
    if (
      Number(row.capacity) !== policy.capacity ||
      Number(row.window_ms) !== policy.windowMs
    )
      throw new TypeError("Conflicting policies for one provider connection.");
    const windowStartedAt = Number(row.window_started_at);
    if (!Number.isSafeInteger(windowStartedAt))
      throw new TypeError("Unreadable provider budget window.");
    const now = Date.now();
    if (
      row.pause_reason !== null &&
      (row.resume_at === null || Number(row.resume_at) > now)
    )
      return parsePause(row.pause_reason, row.resume_at);
    if (
      windowStartedAt === reservation.windowStartedAt &&
      now < windowStartedAt + policy.windowMs
    )
      return admission;

    return await reserveProviderBudget(scope, policy, cost, { ceiling });
  } catch (error) {
    if (
      error instanceof TypeError ||
      error instanceof ProviderBudgetUnavailableError
    )
      throw error;
    throw new ProviderBudgetUnavailableError({ cause: error });
  }
}

export function commitProviderBudgetReservation(
  admission: Extract<ProviderAdmission, { status: "ready" }>,
): void {
  const reservation = reservations.get(admission);
  if (
    !reservation ||
    reservation.charge.released ||
    reservation.charge.dispatched
  )
    throw new TypeError(
      "Provider reservation is no longer available for dispatch.",
    );
  reservation.charge.dispatched = true;
}

export function releaseProviderBudgetReservation(
  admission: Extract<ProviderAdmission, { status: "ready" }>,
): Promise<void> {
  const reservation = reservations.get(admission);
  if (!reservation)
    throw new TypeError(
      "Provider refund requires its original budget reservation.",
    );
  const charge = reservation.charge;
  if (charge.releasePromise) return charge.releasePromise;
  if (charge.dispatched) return Promise.resolve();

  charge.released = true;
  charge.releasePromise = (async () => {
    try {
      await providerWorkStore.ready();
      await withoutWriteObservation(() =>
        getDbExec().execute({
          sql: `UPDATE provider_connection_budgets SET used = used - ?
          WHERE scope_key = ? AND capacity = ? AND window_ms = ? AND window_started_at = ? AND used >= ?`,
          args: [
            reservation.cost,
            reservation.key,
            reservation.capacity,
            reservation.windowMs,
            reservation.windowStartedAt,
            reservation.cost,
          ],
        }),
      );
    } catch (error) {
      countOutcome("provider_budget_counts", { outcome: "refund_failed" });
      throw new ProviderBudgetUnavailableError({ cause: error });
    }
  })();
  return charge.releasePromise;
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
  await withoutWriteObservation(() =>
    getDbExec().execute({
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
    }),
  );
}

export class ProviderDeferredError extends ActionContractError {
  constructor(readonly pause: ProviderPause) {
    const validated = parsePause(pause.reason, pause.resumeAt);
    super("Provider request deferred.", {
      errorCode: "provider_deferred",
      statusCode:
        validated.reason === "operator" ||
        validated.reason === "admission_unavailable"
          ? 503
          : 429,
      details: {
        pause: validated,
        reason: validated.reason,
        resumeAt: validated.resumeAt,
        retryAfterMs:
          validated.resumeAt === null
            ? null
            : Math.max(0, validated.resumeAt - Date.now()),
      },
    });
    this.pause = validated;
    this.name = "ProviderDeferredError";
  }
}

const PROVIDER_READ_CACHE_RETENTION_MS = 30 * 24 * 60 * 60_000;
const PROVIDER_READ_CACHE_MAX_KEYS = 128;

interface ProviderBudgetReadOptions<T> {
  scope: ProviderConnectionScope;
  policy: ProviderBudgetPolicy;
  /** Unmanaged reads reserve this cost once; their first nested gate must agree. */
  cost?: number;
  /** All requests use framework transports with configured budget gates; charge each actual request there. */
  dispatchTracking?: "provider-api";
  /** Include the caller's authorization scope and all response-shaping arguments. */
  cacheKey: string;
  principalId: string;
  authorize: () => Promise<void>;
  execute: () => Promise<T>;
  /** Validate cached JSON against the same contract as a live response. */
  parse: (value: unknown) => T;
}

export async function readWithProviderBudget<T>(
  options: ProviderBudgetReadOptions<T>,
): Promise<ProviderReadResult<T>> {
  if (!options.principalId.trim())
    throw new TypeError("Provider cache reader is missing.");
  const cost = options.cost ?? 1;
  policyValues(options.policy, cost);
  await options.authorize();
  const cacheKey = createHash("sha256")
    .update(JSON.stringify([options.principalId, options.cacheKey]))
    .digest("hex");
  let pause: ProviderPause;
  await providerWorkStore.ready();
  const admission: ProviderAdmission =
    options.dispatchTracking === "provider-api"
      ? { status: "ready" }
      : await reserveProviderBudget(options.scope, options.policy, cost);
  if (admission.status === "ready") {
    try {
      const data = options.parse(
        options.dispatchTracking === "provider-api"
          ? await options.execute()
          : await runWithProviderBudgetCredit(
              options.scope,
              options.policy,
              cost,
              admission,
              options.execute,
            ),
      );
      const fetchedAt = Date.now();
      const dataJson: unknown = JSON.stringify(data);
      if (typeof dataJson !== "string")
        throw new TypeError("Provider cache value is not JSON.");
      if (Buffer.byteLength(dataJson) > 64 * 1024)
        return { status: "fresh", data, fetchedAt, cache: "payload_too_large" };
      await withoutWriteObservation(() =>
        getDbExec().execute({
          sql: `INSERT INTO provider_read_cache (scope_key, cache_key, data_json, fetched_at) VALUES (?, ?, ?, ?)
          ON CONFLICT (scope_key, cache_key) DO UPDATE SET data_json = EXCLUDED.data_json, fetched_at = EXCLUDED.fetched_at`,
          args: [
            providerConnectionKey(options.scope),
            cacheKey,
            dataJson,
            fetchedAt,
          ],
        }),
      );

      await withoutWriteObservation(() =>
        getDbExec().execute({
          sql: `DELETE FROM provider_read_cache WHERE scope_key = ? AND cache_key IN (
            SELECT cache_key FROM provider_read_cache
            WHERE scope_key = ? AND cache_key <> ? AND (
              fetched_at <= ? OR cache_key IN (
                SELECT cache_key FROM provider_read_cache
                WHERE scope_key = ? AND cache_key <> ?
                ORDER BY fetched_at DESC, cache_key DESC
                LIMIT ? OFFSET ?
              )
            )
            ORDER BY fetched_at ASC, cache_key ASC LIMIT ?
          )`,
          args: [
            providerConnectionKey(options.scope),
            providerConnectionKey(options.scope),
            cacheKey,
            fetchedAt - PROVIDER_READ_CACHE_RETENTION_MS,
            providerConnectionKey(options.scope),
            cacheKey,
            PROVIDER_READ_CACHE_MAX_KEYS,
            PROVIDER_READ_CACHE_MAX_KEYS - 1,
            PROVIDER_READ_CACHE_MAX_KEYS,
          ],
        }),
      );
      return { status: "fresh", data, fetchedAt, cache: "stored" };
    } catch (error) {
      if (!(error instanceof ProviderDeferredError)) throw error;
      pause = parsePause(error.pause.reason, error.pause.resumeAt);

      if (pause.reason === "provider_throttle")
        await pauseProviderBudget(options.scope, pause, options.policy);
    }
  } else pause = admission;
  const cached = await withoutWriteObservation(() =>
    getDbExec().execute({
      sql: "SELECT data_json, fetched_at FROM provider_read_cache WHERE scope_key = ? AND cache_key = ? AND fetched_at > ?",
      args: [
        providerConnectionKey(options.scope),
        cacheKey,
        Date.now() - PROVIDER_READ_CACHE_RETENTION_MS,
      ],
    }),
  );
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
    const result = await withoutWriteObservation(() =>
      getDbExec().execute({
        sql: "SELECT capacity, window_ms, window_started_at, used, pause_reason, resume_at FROM provider_connection_budgets WHERE scope_key = ?",
        args: [providerConnectionKey(scope)],
      }),
    );
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
