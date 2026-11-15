/**
 * Per-app, per-operation provider call census.
 *
 * Why: on a hosted workspace one shared Google OAuth client serves every workspace app, so
 * Cloud Monitoring can say "Events.List 152/min, 403 at 3/min" but cannot say
 * WHICH app or connection is calling. The per-call `provider.api.upstream`
 * diagnostics are only switched on for one app, so every other consumer is
 * invisible from logs. This census is always on, cheap, and attributes at
 * (app, provider, operation, connection) granularity.
 *
 * Volume: one aggregated line per key every 50 calls or 60 seconds, whichever
 * comes first — 150 calls/min becomes 2-3 lines/min, never 150.
 *
 * Safety: no URL, no query, no body, no credential and no email is ever
 * recorded; only the operation name and a short connection-id prefix are
 * emitted. The bucket map is bounded, so connection fan-out cannot grow it
 * without limit.
 */
import { randomUUID } from "node:crypto";

export interface ProviderCallCensusKey {
  /** Workspace app that issued the request (runtime appId). */
  app: string;
  /** Provider id, e.g. "google_calendar". */
  provider: string;
  /** Normalised operation, e.g. "event_read". */
  operation: string;
  /** Workspace connection id; only a short prefix is ever emitted. */
  connection?: string | null;
}

interface CensusBucket {
  key: ProviderCallCensusKey;
  count: number;
  statuses: Map<number, number>;
  failures: number;
  firstAt: number;
  lastAt: number;
}

/** Flush a bucket once it has this many calls... */
export const CALL_CENSUS_FLUSH_AT = 50;
/** ...or once it has been open this long, whichever happens first. */
export const CALL_CENSUS_WINDOW_MS = 60_000;
/** Upper bound on distinct buckets held in one process. */
export const CALL_CENSUS_MAX_BUCKETS = 64;

const CONNECTION_PREFIX_LENGTH = 8;
const OVERFLOW_KEY: ProviderCallCensusKey = {
  app: "overflow",
  provider: "overflow",
  operation: "overflow",
};

const buckets = new Map<string, CensusBucket>();
let overflowBucket: CensusBucket | undefined;
let timer: ReturnType<typeof setInterval> | undefined;

function connectionPrefix(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, CONNECTION_PREFIX_LENGTH) : null;
}

function bucketId(entry: ProviderCallCensusKey): string {
  return [
    entry.app,
    entry.provider,
    entry.operation,
    connectionPrefix(entry.connection) ?? "",
  ].join("\u0000");
}

function newBucket(key: ProviderCallCensusKey, now: number): CensusBucket {
  return {
    key,
    count: 0,
    statuses: new Map(),
    failures: 0,
    firstAt: now,
    lastAt: now,
  };
}

function emit(bucket: CensusBucket): void {
  const statuses: Record<string, number> = {};
  for (const [status, count] of bucket.statuses)
    statuses[String(status)] = count;
  const windowMs = bucket.lastAt - bucket.firstAt;
  console.info(
    JSON.stringify({
      event: "provider.api.calls",
      censusId: randomUUID(),
      app: bucket.key.app,
      provider: bucket.key.provider,
      operation: bucket.key.operation,
      connection: connectionPrefix(bucket.key.connection),
      count: bucket.count,
      failures: bucket.failures,
      statuses,
      windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 0,
    }),
  );
}

function ensureTimer(): void {
  if (timer) return;
  timer = setInterval(() => flushProviderCallCensus(), CALL_CENSUS_WINDOW_MS);
  timer.unref?.();
}

/**
 * Record one provider call. `status` is the upstream HTTP status, or 0 when the
 * request never produced a response (network error, abort, timeout).
 */
export function recordProviderCall(
  entry: ProviderCallCensusKey,
  status: number | null,
  now: number = Date.now(),
): void {
  const id = bucketId(entry);
  let bucket = buckets.get(id);
  if (!bucket) {
    if (buckets.size >= CALL_CENSUS_MAX_BUCKETS) {
      overflowBucket ??= newBucket(OVERFLOW_KEY, now);
      bucket = overflowBucket;
    } else {
      bucket = newBucket(entry, now);
      buckets.set(id, bucket);
    }
  }
  const code = status === null ? 0 : status;
  bucket.count++;
  bucket.lastAt = now;
  bucket.statuses.set(code, (bucket.statuses.get(code) ?? 0) + 1);
  if (code === 0 || code >= 400) bucket.failures++;
  ensureTimer();
  if (
    bucket.count >= CALL_CENSUS_FLUSH_AT ||
    bucket.lastAt - bucket.firstAt >= CALL_CENSUS_WINDOW_MS
  ) {
    emit(bucket);
    if (bucket === overflowBucket) overflowBucket = undefined;
    else buckets.delete(id);
  }
}

/** Emit every open bucket now. Returns the number of lines written. */
export function flushProviderCallCensus(): number {
  let written = 0;
  for (const bucket of buckets.values()) {
    if (bucket.count === 0) continue;
    emit(bucket);
    written++;
  }
  buckets.clear();
  if (overflowBucket && overflowBucket.count > 0) {
    emit(overflowBucket);
    written++;
  }
  overflowBucket = undefined;
  return written;
}

/** Test-only: drop all state and the flush timer. */
export function resetProviderCallCensusForTests(): void {
  buckets.clear();
  overflowBucket = undefined;
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
