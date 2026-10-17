export const GMAIL_QUOTA_COOLDOWN_ERROR_CODE = "gmail_quota_cooldown";

/**
 * How current a Gmail-backed read is.
 * - `live`: fetched from Gmail for this request.
 * - `cached`: served from the synced local store while Gmail is cooling down;
 *   `staleSince` is when that data was last synced.
 * - `stale`: served from the local store and old enough that new mail may be
 *   missing.
 */
export type GmailFreshness = "live" | "cached" | "stale";

/** The cooldown a read observed, as a value rather than a thrown error. */
export type GmailReadState = {
  freshness: GmailFreshness;
  staleSince?: number;
  cooldownUntil?: number;
  retryAfterMs?: number;
};

/** Typed body of a cooldown refusal, shared by actions and REST handlers. */
export type GmailCooldownBody = {
  errorCode: typeof GMAIL_QUOTA_COOLDOWN_ERROR_CODE;
  retryAfterMs: number;
  cooldownUntil: number;
};

/** Cached data older than this is reported as `stale`, not `cached`. */
export const GMAIL_CACHED_READ_STALE_AFTER_MS = 10 * 60_000;

export function gmailReadFreshness(
  syncedAt: number | null | undefined,
  now: number,
): GmailFreshness {
  if (syncedAt == null) return "stale";
  return now - syncedAt > GMAIL_CACHED_READ_STALE_AFTER_MS ? "stale" : "cached";
}

/** The state of rows read from the local store, given any active cooldown. */
export function gmailReadState(
  cooldown: { cooldownUntil: number; retryAfterMs: number } | null,
  syncedAt: number | null | undefined,
  now: number,
): GmailReadState {
  if (!cooldown) return { freshness: "live" };
  return {
    freshness: gmailReadFreshness(syncedAt, now),
    ...(syncedAt != null ? { staleSince: syncedAt } : {}),
    cooldownUntil: cooldown.cooldownUntil,
    retryAfterMs: cooldown.retryAfterMs,
  };
}

export function parseGmailReadState(
  value: unknown,
): GmailReadState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const state = value as Record<string, unknown>;
  const freshness = state.freshness;
  if (freshness !== "live" && freshness !== "cached" && freshness !== "stale") {
    return undefined;
  }
  const num = (field: unknown): number | undefined =>
    typeof field === "number" && Number.isFinite(field) && field > 0
      ? field
      : undefined;
  return {
    freshness,
    ...(num(state.staleSince) !== undefined
      ? { staleSince: num(state.staleSince) }
      : {}),
    ...(num(state.cooldownUntil) !== undefined
      ? { cooldownUntil: num(state.cooldownUntil) }
      : {}),
    ...(num(state.retryAfterMs) !== undefined
      ? { retryAfterMs: num(state.retryAfterMs) }
      : {}),
  };
}

/**
 * The cooldown a failed read carries, from either transport: the typed action
 * error (`errorCode` + `details`) or the REST body/`Retry-After` the list
 * handler returns. Undefined when the error is not a Gmail cooldown.
 */
export function gmailCooldownFromError(
  error: unknown,
  now: number,
): { retryAfterMs: number; cooldownUntil: number } | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as {
    errorCode?: unknown;
    status?: unknown;
    retryAfterMs?: unknown;
    cooldownUntil?: unknown;
    details?: { retryAfterMs?: unknown; cooldownUntil?: unknown };
  };
  if (
    value.errorCode !== GMAIL_QUOTA_COOLDOWN_ERROR_CODE &&
    !(value.status === 429 && value.errorCode === undefined)
  ) {
    return undefined;
  }
  const positive = (field: unknown): number | undefined =>
    typeof field === "number" && Number.isFinite(field) && field > 0
      ? field
      : undefined;
  const until =
    positive(value.cooldownUntil) ?? positive(value.details?.cooldownUntil);
  const retryAfterMs =
    positive(value.retryAfterMs) ??
    positive(value.details?.retryAfterMs) ??
    (until !== undefined ? Math.max(1, until - now) : undefined);
  if (retryAfterMs === undefined) return undefined;
  return { retryAfterMs, cooldownUntil: until ?? now + retryAfterMs };
}
