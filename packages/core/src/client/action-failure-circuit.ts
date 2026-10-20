import { LLM_PROVIDER_MISSING_ERROR_CODE } from "../shared/action-error-codes.js";

/**
 * Per-(action, args) failure circuit for action queries. A query the server
 * keeps refusing (a terminal client error, a non-retryable typed code, a named
 * Retry-After) is re-issued by timers, retries and sync-driven invalidations;
 * after a few consecutive refusals this pauses every automatic refetch for a
 * growing, jittered cooldown. 5xx and network failures never count: they are
 * transient, React Query's retry/backoff owns them, and pausing on them would
 * keep a recovered server's data off screen for minutes. A success, a
 * mutation that succeeded, the browser coming back online, a provider being
 * connected, or a fetch right after a user gesture resets it.
 */

/** Typed codes an identical retry cannot resolve. */
const NON_RETRYABLE_ACTION_ERROR_CODES: ReadonlySet<string> = new Set([
  "not_found",
  "forbidden",
  "unauthorized",
  "gmail_quota_cooldown",
  LLM_PROVIDER_MISSING_ERROR_CODE,
  "conflict",
]);

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_BASE_COOLDOWN_MS = 15_000;
const CIRCUIT_MAX_COOLDOWN_MS = 300_000;
const MAX_TRACKED_CIRCUITS = 200;

export function actionErrorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | undefined)?.status;
  return typeof status === "number" ? status : undefined;
}

export function actionErrorCode(error: unknown): string | undefined {
  const code = (error as { errorCode?: unknown } | undefined)?.errorCode;
  return typeof code === "string" ? code : undefined;
}

/** The server's Retry-After, already capped by the action client. */
export function actionErrorRetryAfterMs(error: unknown): number | undefined {
  const ms = (error as { retryAfterMs?: unknown } | undefined)?.retryAfterMs;
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0
    ? Math.min(ms, CIRCUIT_MAX_COOLDOWN_MS)
    : undefined;
}

/**
 * True when re-sending the same request cannot succeed: a client error other
 * than the timeout/rate-limit statuses, or a typed code in the non-retryable
 * set. A rate limit that names its own Retry-After is a cooldown, not terminal.
 */
export function isTerminalActionError(error: unknown): boolean {
  const status = actionErrorStatus(error);
  if (
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  ) {
    return true;
  }
  return hasNonRetryableActionErrorCode(error);
}

function hasNonRetryableActionErrorCode(error: unknown): boolean {
  const code = actionErrorCode(error);
  return code !== undefined && NON_RETRYABLE_ACTION_ERROR_CODES.has(code);
}

/** Statuses that end a poll on their own: access is gone, or the resource is. */
const POLL_ENDING_STATUSES: ReadonlySet<number> = new Set([401, 403, 410]);

/**
 * True when polling should stop. Narrower than `isTerminalActionError`: a
 * plain 404 keeps polling, because a resource still being created can read as
 * not found for a tick; only a typed `not_found` says it is gone.
 */
export function endsActionPolling(error: unknown): boolean {
  const status = actionErrorStatus(error);
  if (status !== undefined && POLL_ENDING_STATUSES.has(status)) return true;
  return hasNonRetryableActionErrorCode(error);
}

/** Thrown instead of a network call while a query's circuit is open. */
export class ActionCircuitOpenError extends Error {
  readonly circuitOpen = true;
  status?: number;
  errorCode?: string;
  actionMessage?: string;
  details?: unknown;
  retryAfterMs?: number;

  constructor(last: unknown) {
    super(
      last instanceof Error ? last.message : "Action paused after failures",
    );
    this.name = "ActionCircuitOpenError";
    const source = (last ?? {}) as Record<string, unknown>;
    this.status = actionErrorStatus(last);
    this.errorCode = actionErrorCode(last);
    if (typeof source.actionMessage === "string") {
      this.actionMessage = source.actionMessage;
    }
    this.details = source.details;
    this.retryAfterMs = actionErrorRetryAfterMs(last);
    this.cause = last;
  }
}

export function isActionCircuitOpenError(
  error: unknown,
): error is ActionCircuitOpenError {
  return (error as { circuitOpen?: unknown } | undefined)?.circuitOpen === true;
}

interface Circuit {
  failures: number;
  openUntil: number;
  last: unknown;
}

const circuits = new Map<string, Circuit>();

function cooldownMs(error: unknown, failures: number): number {
  const retryAfter = actionErrorRetryAfterMs(error);
  if (retryAfter !== undefined) return retryAfter;
  // A missing provider does not fix itself; connecting one resets the circuit.
  if (actionErrorCode(error) === LLM_PROVIDER_MISSING_ERROR_CODE) {
    return CIRCUIT_MAX_COOLDOWN_MS;
  }
  if (failures < CIRCUIT_FAILURE_THRESHOLD) return 0;
  const grown = Math.min(
    CIRCUIT_BASE_COOLDOWN_MS * 2 ** (failures - CIRCUIT_FAILURE_THRESHOLD),
    CIRCUIT_MAX_COOLDOWN_MS,
  );
  return Math.min(
    Math.round(grown * (0.8 + Math.random() * 0.4)),
    CIRCUIT_MAX_COOLDOWN_MS,
  );
}

export interface ActionCircuitTrip {
  /** The circuit went from closed to open on this failure. */
  tripped: boolean;
  failures: number;
  cooldownMs: number;
}

/**
 * Record one failed fetch cycle (retries exhausted or not retryable). Only a
 * refusal the server meant counts; a transient failure leaves the circuit as
 * it was.
 */
export function recordActionFailure(
  key: string,
  error: unknown,
  now = Date.now(),
): ActionCircuitTrip {
  const previous = circuits.get(key);
  if (
    actionErrorRetryAfterMs(error) === undefined &&
    !isTerminalActionError(error)
  ) {
    return { tripped: false, failures: previous?.failures ?? 0, cooldownMs: 0 };
  }
  const failures = (previous?.failures ?? 0) + 1;
  const cooldown = cooldownMs(error, failures);
  circuits.delete(key);
  circuits.set(key, {
    failures,
    openUntil: cooldown > 0 ? now + cooldown : 0,
    last: error,
  });
  if (circuits.size > MAX_TRACKED_CIRCUITS) {
    const oldest = circuits.keys().next().value;
    if (oldest !== undefined) circuits.delete(oldest);
  }
  return {
    tripped: cooldown > 0 && (previous?.openUntil ?? 0) <= now,
    failures,
    cooldownMs: cooldown,
  };
}

export function resetActionFailureCircuit(key: string): void {
  circuits.delete(key);
}

export function resetActionFailureCircuits(): void {
  circuits.clear();
}

/** Milliseconds until automatic refetching may resume; 0 when closed. */
export function actionCircuitRemainingMs(
  key: string | undefined,
  now = Date.now(),
): number {
  const openUntil = key === undefined ? 0 : (circuits.get(key)?.openUntil ?? 0);
  return Math.max(0, openUntil - now);
}

function userGestureIsActive(): boolean {
  return (
    typeof navigator !== "undefined" &&
    (navigator as { userActivation?: { isActive?: boolean } }).userActivation
      ?.isActive === true
  );
}

/**
 * Rejects without a request while the circuit is open. A fetch within a few
 * seconds of a click or keypress is the user retrying on purpose, so it goes
 * through; timers and sync invalidations have no gesture and stay paused.
 */
export function assertActionCircuitClosed(key: string, now = Date.now()): void {
  const circuit = circuits.get(key);
  if (!circuit || circuit.openUntil <= now || userGestureIsActive()) return;
  throw new ActionCircuitOpenError(circuit.last);
}
