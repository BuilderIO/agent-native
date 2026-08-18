import { createHash } from "crypto";

import { getDbExec } from "@agent-native/core/db";

import type { AnalyticsQueryResult } from "./first-party-analytics.js";

/**
 * First-party dashboard panel query cache.
 *
 * `analytics_events` grows unbounded and several panels (rolling-window and
 * cohort self-joins) are inherently expensive, so a page with many panels or
 * a daily report screenshot capturing many panels at once repeatedly
 * recomputes the same rows under concurrent load — that contention, not any
 * single query alone, is what was pushing panels past their timeout budget.
 * This mirrors bigquery.ts's L1 (in-process) + L2 (SQL-backed, shared across
 * serverless invocations) cache, but keyed per scoped+interpolated SQL text
 * (which already embeds org_id/owner_email via query args) and with a much
 * shorter TTL since this is the app's own live data, not an immutable
 * warehouse result.
 */

interface L1Entry {
  result: AnalyticsQueryResult;
  createdAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_L1_ENTRIES = 500;
const CACHE_IO_TIMEOUT_MS = 1_000;

const l1Cache = new Map<string, L1Entry>();
// De-dupes identical concurrent cache misses (e.g. the same panel query fired
// by several viewers, or by the report capture's 4-panel concurrent window)
// so only one of them actually hits the database.
const inFlight = new Map<string, Promise<AnalyticsQueryResult>>();

function inFlightKey(key: string, timeoutMs?: number): string {
  return `${key}:${timeoutMs ?? "unbounded"}`;
}

export interface FirstPartyCacheOptions {
  timeoutMs?: number;
}

export function firstPartyCacheKey(
  scopedSql: string,
  args: Array<string | null>,
): string {
  return createHash("sha256")
    .update(`${scopedSql}\n${JSON.stringify(args)}`)
    .digest("hex");
}

function getL1(key: string): AnalyticsQueryResult | null {
  const entry = l1Cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    l1Cache.delete(key);
    return null;
  }
  return entry.result;
}

function setL1(key: string, result: AnalyticsQueryResult): void {
  if (l1Cache.size >= MAX_L1_ENTRIES) {
    const oldest = l1Cache.keys().next().value;
    if (oldest) l1Cache.delete(oldest);
  }
  l1Cache.set(key, { result, createdAt: Date.now() });
}

async function getL2(
  key: string,
  deadlineAt: number,
): Promise<AnalyticsQueryResult | null> {
  try {
    const db = getDbExec();
    const nowIso = new Date().toISOString();
    const { rows } = await db.execute({
      sql: "SELECT result FROM first_party_analytics_cache WHERE key = ? AND expires_at > ?",
      args: [key, nowIso],
      timeoutMs: cacheIoTimeoutMs(deadlineAt),
      maxAttempts: 1,
    });
    if (!rows.length) return null;
    const raw = (rows[0] as { result: string }).result;
    return JSON.parse(raw) as AnalyticsQueryResult;
  } catch (err) {
    console.warn("[first-party-analytics] L2 cache read failed:", err);
    return null;
  }
}

async function setL2(
  key: string,
  sql: string,
  result: AnalyticsQueryResult,
  deadlineAt: number,
): Promise<void> {
  try {
    const db = getDbExec();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);
    const serialized = JSON.stringify(result);
    await db.execute({
      sql: `INSERT INTO first_party_analytics_cache (key, sql, result, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          sql = excluded.sql,
          result = excluded.result,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at`,
      args: [key, sql, serialized, now.toISOString(), expiresAt.toISOString()],
      timeoutMs: cacheIoTimeoutMs(deadlineAt),
      maxAttempts: 1,
    });
    // Opportunistically prune expired rows so the table doesn't grow
    // unbounded — the keyspace is effectively every distinct panel/filter
    // combination. Run ~1% of the time to avoid thrashing on every write.
    if (Math.random() < 0.01) {
      await db.execute({
        sql: "DELETE FROM first_party_analytics_cache WHERE expires_at <= ?",
        args: [now.toISOString()],
        timeoutMs: cacheIoTimeoutMs(deadlineAt),
        maxAttempts: 1,
      });
    }
  } catch (err) {
    console.warn("[first-party-analytics] L2 cache write failed:", err);
  }
}

function remainingTimeoutMs(deadlineAt: number): number {
  return Math.max(0, deadlineAt - Date.now());
}

function cacheIoTimeoutMs(deadlineAt: number): number {
  return Math.max(
    1,
    Math.min(CACHE_IO_TIMEOUT_MS, remainingTimeoutMs(deadlineAt)),
  );
}

/**
 * Returns a cached result for (key, sql) if fresh, otherwise runs `compute`
 * exactly once — even under concurrent callers with the same key — and
 * caches the result.
 */
export async function withFirstPartyCache(
  key: string,
  sql: string,
  compute: (timeoutMs: number) => Promise<AnalyticsQueryResult>,
  options: FirstPartyCacheOptions = {},
): Promise<AnalyticsQueryResult> {
  const l1Hit = getL1(key);
  if (l1Hit) return l1Hit;

  const timeoutMs = Math.max(1, options.timeoutMs ?? CACHE_IO_TIMEOUT_MS);
  const deadlineAt = Date.now() + timeoutMs;

  // A report prewarm may have a shorter deadline than a normal panel request;
  // never let those callers inherit one another's database timeout.
  const requestKey = inFlightKey(key, options.timeoutMs);
  const existing = inFlight.get(requestKey);
  if (existing) return existing;

  // Register the in-flight promise synchronously (before any `await`) so two
  // callers racing on the same key can't both slip past the check above and
  // both hit L2/compute.
  const promise = (async () => {
    const l2Hit = await getL2(key, deadlineAt);
    if (l2Hit) {
      setL1(key, l2Hit);
      return l2Hit;
    }
    const queryTimeoutMs = remainingTimeoutMs(deadlineAt);
    if (queryTimeoutMs <= 0) {
      throw new Error(
        `First-party analytics query timed out after ${timeoutMs}ms`,
      );
    }
    const result = await compute(queryTimeoutMs);
    setL1(key, result);
    // Cache persistence is best-effort. A successful panel query must not miss
    // its delivery deadline because the cache table is slow or unavailable.
    void setL2(key, sql, result, deadlineAt);
    return result;
  })().finally(() => {
    inFlight.delete(requestKey);
  });
  inFlight.set(requestKey, promise);
  return promise;
}
