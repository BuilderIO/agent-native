import {
  credentialStateProperties,
  type CredentialState,
} from "../agent/engine/credential-state.js";
import { trackingIdentityProperties } from "../observability/tracking-identity.js";
import { track } from "./registry.js";

/**
 * Failure rates as events instead of anecdotes. A failure class that repeats
 * (a rejected key, a missing provider, an action returning 5xx) would otherwise
 * mean one analytics event per occurrence, so each (event, dimensions) pair is
 * counted in a window and shipped as `count`: the first occurrence immediately,
 * then one event per window carrying the rest. `SUM(count)` is the exact total
 * whichever way the events were flushed.
 *
 * Dimensions are bounded tokens (action names, error codes, state kinds) and
 * never ids or addresses; state is bounded and folds into one overflow key.
 */
export const FAILURE_COUNT_EVENTS = {
  actionErrors: "action_error_counts",
  credentialState: "credential_state_counts",
  attachmentOutcomes: "attachment_outcome_counts",
} as const;

/** A counted event is named for what it counts: `<thing>_counts`, snake_case. */
const COUNT_EVENT_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*_counts$/;
let warnedAboutEventName = false;

const WINDOW_MS = 60_000;
const MAX_KEYS = 200;
const MAX_DIMENSION_CHARS = 80;
const OVERFLOW_DIMENSIONS = { overflow: "true" } as const;

interface Bucket {
  event: string;
  dimensions: Record<string, string>;
  windowStartedAt: number;
  lastTouchedAt: number;
  pending: number;
  timer?: ReturnType<typeof setTimeout>;
}

const buckets = new Map<string, Bucket>();

export function resetFailureCountersForTests(): void {
  for (const bucket of buckets.values()) clearTimeout(bucket.timer);
  buckets.clear();
  warnedAboutEventName = false;
}

function dimension(value: unknown): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  return text.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, MAX_DIMENSION_CHARS);
}

function emit(bucket: Bucket, count: number, aggregated: boolean): void {
  try {
    track(bucket.event, {
      ...trackingIdentityProperties(),
      ...bucket.dimensions,
      count,
      window_ms: WINDOW_MS,
      aggregated,
    });
    // coercion-ok: telemetry emission is best-effort and has no caller-visible value
  } catch {
    // Counting a failure must never become one.
  }
}

function flush(bucket: Bucket, now: number): void {
  clearTimeout(bucket.timer);
  bucket.timer = undefined;
  const pending = bucket.pending;
  bucket.pending = 0;
  bucket.windowStartedAt = now;
  bucket.lastTouchedAt = now;
  if (pending > 0) emit(bucket, pending, true);
}

function evictIdle(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.pending === 0 && now - bucket.lastTouchedAt > 2 * WINDOW_MS) {
      clearTimeout(bucket.timer);
      buckets.delete(key);
    }
  }
}

function count(event: string, raw: Record<string, unknown>): void {
  const now = Date.now();
  let dimensions: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value !== undefined && value !== "")
      dimensions[name] = dimension(value);
  }
  let key = `${event}|${JSON.stringify(dimensions)}`;
  let bucket = buckets.get(key);
  if (!bucket && buckets.size >= MAX_KEYS) {
    evictIdle(now);
    if (buckets.size >= MAX_KEYS) {
      dimensions = { ...OVERFLOW_DIMENSIONS };
      key = `${event}|${JSON.stringify(dimensions)}`;
      bucket = buckets.get(key);
    }
  }
  if (!bucket) {
    bucket = {
      event,
      dimensions,
      windowStartedAt: now,
      lastTouchedAt: now,
      pending: 0,
    };
    buckets.set(key, bucket);
    emit(bucket, 1, false);
    return;
  }
  bucket.lastTouchedAt = now;
  if (now - bucket.windowStartedAt >= WINDOW_MS) {
    // No timer ran (a frozen serverless instance): the next hit carries it.
    const carried = bucket.pending + 1;
    clearTimeout(bucket.timer);
    bucket.timer = undefined;
    bucket.pending = 0;
    bucket.windowStartedAt = now;
    emit(bucket, carried, carried > 1);
    return;
  }
  bucket.pending += 1;
  if (bucket.timer === undefined && typeof setTimeout === "function") {
    const target = bucket;
    target.timer = setTimeout(
      () => flush(target, Date.now()),
      Math.max(0, target.windowStartedAt + WINDOW_MS - now),
    );
    (target.timer as { unref?: () => void }).unref?.();
  }
}

/**
 * Count one occurrence of a bounded outcome class under a `<thing>_counts`
 * event, for code outside core that has its own classes to chart (a template's
 * cooldowns, a provider's quota). Dimensions are tokens, never ids or
 * addresses. A name that breaks the convention is reported once and dropped,
 * so a typo cannot throw into the code path being measured.
 */
export function countOutcome(
  event: string,
  dimensions: Record<string, unknown>,
): void {
  if (!COUNT_EVENT_NAME.test(event)) {
    if (!warnedAboutEventName) {
      warnedAboutEventName = true;
      console.error(
        `[failure-counters] "${event}" is not a <thing>_counts event name; counts for it are dropped.`,
      );
    }
    return;
  }
  count(event, dimensions);
}

/**
 * One attachment mint, resolve or delete, with how it ended. Successes are
 * counted too, so a failure is a rate and not just a number.
 */
export function countAttachmentOutcome(input: {
  operation: "mint" | "resolve" | "delete";
  status: string;
  reason?: string;
  whoCanFix?: string;
}): void {
  count(FAILURE_COUNT_EVENTS.attachmentOutcomes, {
    operation: input.operation,
    status: input.status,
    reason: input.reason,
    who_can_fix: input.whoCanFix,
  });
}

/**
 * One action request that ended in a failure. `errorCode` is the typed code the
 * action raised (`validation` and `untyped` stand in when there is none), so the
 * chart separates expected typed states from bare 500s.
 */
export function countActionFailure(input: {
  action: string;
  status: number;
  errorCode?: string;
  caller?: string;
}): void {
  count(FAILURE_COUNT_EVENTS.actionErrors, {
    action_name: input.action,
    error_code: input.errorCode ?? "untyped",
    status_class: `${Math.floor(input.status / 100)}xx`,
    action_source: input.caller,
  });
}

/** A credential state other than `usable` was shown to a user or an owner. */
export function countCredentialState(
  state: CredentialState,
  source: "credit_notice" | "action_route" | "automation",
): void {
  if (state.kind === "usable") return;
  count(FAILURE_COUNT_EVENTS.credentialState, {
    ...credentialStateProperties(state),
    source,
  });
}
