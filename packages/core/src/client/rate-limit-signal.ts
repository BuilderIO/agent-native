/**
 * One tab-wide record of "the origin is rate limiting us right now".
 *
 * A 429 is a property of the origin, not of whichever loop happened to
 * observe it. Before this module each recurring client loop re-derived
 * backoff from its own consecutive-failure count, so a site-wide throttle was
 * learned independently by every loop — and the purely speculative traffic
 * (route warmup) kept retrying into the limit while the loops that had
 * already seen the 429 were dutifully backing off. That is how one stalled
 * chat turned into a sustained throttle that also took down plain page loads.
 *
 * Whoever sees the 429 records it here once; every loop reads the same
 * deadline and, critically, speculative work stands down for its duration.
 */

/** Used when the server sends no usable `Retry-After`. */
export const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30_000;
/** Floor, so a `Retry-After: 0` cannot be read as "no cooldown at all". */
const MIN_RATE_LIMIT_COOLDOWN_MS = 1_000;
/**
 * Ceiling. A server asking for an hour is still only advising a client-side
 * loop; past a few minutes the user has long since reloaded or left.
 */
const MAX_RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;

/**
 * Parsed `Retry-After`, in milliseconds from `nowMs`.
 *
 * `null` means the header carried no usable delay — either absent or
 * unparseable. Both leave the caller to apply its own documented default,
 * and neither is reported as a zero-length cooldown, which a caller could not
 * tell apart from "the server said go ahead".
 */
export function parseRetryAfterMs(
  headerValue: string | null | undefined,
  nowMs: number,
): number | null {
  if (typeof headerValue !== "string") return null;
  const raw = headerValue.trim();
  if (raw === "") return null;

  // RFC 9110 delta-seconds: a non-negative integer.
  if (/^\d+$/.test(raw)) {
    return Number(raw) * 1_000;
  }

  // RFC 9110 HTTP-date. All three accepted forms (IMF-fixdate, rfc850,
  // asctime) spell the month out, so requiring a letter is what keeps
  // `Date.parse` from turning a malformed delta like "-5" into a year.
  if (!/[a-z]/i.test(raw)) return null;
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - nowMs);
}

function clampCooldown(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  return Math.min(
    MAX_RATE_LIMIT_COOLDOWN_MS,
    Math.max(MIN_RATE_LIMIT_COOLDOWN_MS, ms),
  );
}

type Listener = () => void;

/**
 * Survives a reload. The reported failure was a user reloading a throttled
 * page over and over, and module state resets on every load — so without
 * this, each reload re-fires the same speculative warmup burst into the
 * limit it is still inside of.
 */
const STORAGE_KEY = "agent-native:rate-limit-until";

let cooldownUntil = 0;
let hydrated = false;
const listeners = new Set<Listener>();

function sessionStore(): Storage | null {
  if (typeof window === "undefined") return null;
  // Merely touching `sessionStorage` throws in partitioned/embedded contexts.
  try {
    return window.sessionStorage;
  } catch {
    // coercion-ok: unavailable storage and storage holding no deadline both
    // mean "no cooldown known" - the honest initial state either way, and the
    // in-memory deadline still applies for this page load.
    return null;
  }
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  const store = sessionStore();
  if (!store) return;
  // coercion-ok: a missing/garbage key is simply no recorded cooldown.
  const raw = store.getItem(STORAGE_KEY);
  const until = raw === null ? Number.NaN : Number(raw);
  if (Number.isFinite(until) && until > Date.now()) cooldownUntil = until;
}

function persist(): void {
  const store = sessionStore();
  if (!store) return;
  // coercion-ok: a full/blocked quota only costs cross-reload memory of an
  // advisory cooldown; the in-memory deadline still applies for this load.
  try {
    store.setItem(STORAGE_KEY, String(cooldownUntil));
  } catch {
    return;
  }
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Record a rate-limit cooldown of `ms`, for callers that only know the status
 * code. Extends an existing cooldown but never shortens one — two loops
 * reporting the same throttle must not let the more optimistic one win.
 */
export function noteRateLimitCooldownMs(ms: number): number {
  hydrate();
  const until = Date.now() + clampCooldown(ms);
  if (until <= cooldownUntil) return cooldownUntil;
  cooldownUntil = until;
  persist();
  notify();
  return cooldownUntil;
}

/**
 * Record a rate-limit cooldown from a 429 response, honoring `Retry-After`
 * when the server sent a usable one. Safe to call with any response; only a
 * 429 registers, so call sites do not need to branch first.
 */
export function noteRateLimitedResponse(response: {
  status: number;
  headers?: { get(name: string): string | null };
}): number {
  if (response.status !== 429) return cooldownUntil;
  const advised = parseRetryAfterMs(
    response.headers?.get("Retry-After"),
    Date.now(),
  );
  return noteRateLimitCooldownMs(advised ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS);
}

/** Milliseconds left in the current cooldown, or 0 when not rate limited. */
export function rateLimitCooldownRemainingMs(): number {
  hydrate();
  return Math.max(0, cooldownUntil - Date.now());
}

/** True while the origin is known to be rate limiting this client. */
export function isRateLimited(): boolean {
  return rateLimitCooldownRemainingMs() > 0;
}

/**
 * Subscribe to cooldown changes. Only fires when a cooldown is recorded or
 * extended; expiry is time-based, so readers poll `isRateLimited()` rather
 * than waiting for an event that would need a timer per subscriber.
 */
export function subscribeRateLimitSignal(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetRateLimitSignalForTests(): void {
  cooldownUntil = 0;
  hydrated = false;
  listeners.clear();
  sessionStore()?.removeItem(STORAGE_KEY);
}
