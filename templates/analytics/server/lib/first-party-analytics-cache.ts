import { createHash } from "crypto";

import { getDbExec } from "@agent-native/core/db";

import type {
  AnalyticsQueryResult,
  AnalyticsScope,
} from "./first-party-analytics.js";

interface L1Entry {
  result: AnalyticsQueryResult;
  createdAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_L1_ENTRIES = 500;
const CACHE_IO_TIMEOUT_MS = 1_000;

const l1Cache = new Map<string, L1Entry>();
interface InFlightEntry {
  promise: Promise<AnalyticsQueryResult>;
  controller: AbortController;
  waiters: number;
  settled: boolean;
  sharedDeadlineAt: number;
  maxSharedDeadlineAt: number;
  extendSharedDeadline: (deadlineAt: number) => void;
}

const inFlight = new Map<string, InFlightEntry[]>();

function inFlightKey(key: string, timeoutMs?: number): string {
  return `${key}:${timeoutMs ?? "unbounded"}`;
}

export interface FirstPartyCacheOptions {
  timeoutMs?: number;
  deadlineAt?: number;
  signal?: AbortSignal;
}

/**
 * The key names the actor and tenant explicitly, so a cached result is never
 * served to another caller even when two scopes compile to the same SQL.
 */
export function firstPartyCacheKey(
  scopedSql: string,
  args: Array<string | null>,
  scope: AnalyticsScope,
): string {
  const caller = {
    actor: scope.userEmail.trim().toLowerCase(),
    orgId: scope.orgId ?? null,
    credentialScope: scope.credentialScope ?? null,
  };
  return createHash("sha256")
    .update(
      `sql-policy-v2\n${JSON.stringify(caller)}\n${scopedSql}\n${JSON.stringify(args)}`,
    )
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
      sql: "SELECT result FROM first_party_analytics_cache WHERE key = $1 AND expires_at > $2",
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
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT(key) DO UPDATE SET
          sql = excluded.sql,
          result = excluded.result,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at`,
      args: [key, sql, serialized, now.toISOString(), expiresAt.toISOString()],
      timeoutMs: cacheIoTimeoutMs(deadlineAt),
      maxAttempts: 1,
    });
    if (Math.random() < 0.01) {
      await db.execute({
        sql: "DELETE FROM first_party_analytics_cache WHERE expires_at <= $1",
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

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  return (
    error.name === "FirstPartyAnalyticsQueryTimeoutError" ||
    error.name === "DbTimeoutError" ||
    code === "CONNECT_TIMEOUT" ||
    /^First-party analytics query timed out after \d+ms$/.test(error.message)
  );
}

function cacheIoTimeoutMs(deadlineAt: number): number {
  return Math.max(
    1,
    Math.min(CACHE_IO_TIMEOUT_MS, remainingTimeoutMs(deadlineAt)),
  );
}

// A caller can join a read that started after it did, so its own deadline,
// not the read's, bounds the wait.
function waitUntilDeadline(
  entry: InFlightEntry,
  deadlineAt: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<AnalyticsQueryResult> {
  if (signal?.aborted) {
    return Promise.reject(abortError(signal));
  }

  entry.waiters += 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiterError: Error | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      waiterError = new Error(
        `First-party analytics query timed out after ${timeoutMs}ms`,
      );
      reject(waiterError);
    }, remainingTimeoutMs(deadlineAt));
  });
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    if (!signal) return;
    onAbort = () => {
      waiterError = abortError(signal);
      reject(waiterError);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });

  return Promise.race([entry.promise, expired, aborted]).finally(() => {
    clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    entry.waiters -= 1;
    // Shared work belongs to its remaining callers, not the first one in.
    if (
      entry.waiters === 0 &&
      !entry.settled &&
      !entry.controller.signal.aborted
    ) {
      entry.controller.abort(
        waiterError && isTimeoutError(waiterError) ? waiterError : undefined,
      );
    }
  });
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

export async function withFirstPartyCache(
  key: string,
  sql: string,
  compute: (
    timeoutMs: number,
    signal: AbortSignal,
  ) => Promise<AnalyticsQueryResult>,
  options: FirstPartyCacheOptions = {},
): Promise<AnalyticsQueryResult> {
  if (options.signal?.aborted) throw abortError(options.signal);
  const l1Hit = getL1(key);
  if (l1Hit) return l1Hit;

  const timeoutMs = Math.max(1, options.timeoutMs ?? CACHE_IO_TIMEOUT_MS);
  const deadlineAt = options.deadlineAt ?? Date.now() + timeoutMs;
  const maxSharedDeadlineAt = deadlineAt + timeoutMs;

  const requestKey = inFlightKey(key, options.timeoutMs);
  const existing = inFlight
    .get(requestKey)
    ?.find(
      (entry) =>
        !entry.settled &&
        !entry.controller.signal.aborted &&
        deadlineAt <= entry.maxSharedDeadlineAt,
    );
  if (existing) {
    existing.extendSharedDeadline(deadlineAt);
    return waitUntilDeadline(existing, deadlineAt, timeoutMs, options.signal);
  }

  const controller = new AbortController();
  let entry!: InFlightEntry;
  let sharedDeadlineAt = deadlineAt;
  let sharedTimeout: ReturnType<typeof setTimeout> | undefined;
  const armSharedTimeout = () => {
    if (sharedTimeout) clearTimeout(sharedTimeout);
    const queryTimeoutMs = remainingTimeoutMs(sharedDeadlineAt);
    sharedTimeout = setTimeout(
      () =>
        controller.abort(
          new Error(
            `First-party analytics query timed out after ${queryTimeoutMs}ms`,
          ),
        ),
      queryTimeoutMs,
    );
  };
  const extendSharedDeadline = (nextDeadlineAt: number) => {
    const boundedDeadlineAt = Math.min(nextDeadlineAt, maxSharedDeadlineAt);
    if (boundedDeadlineAt <= sharedDeadlineAt) return;
    sharedDeadlineAt = boundedDeadlineAt;
    if (entry) entry.sharedDeadlineAt = sharedDeadlineAt;
    armSharedTimeout();
  };
  const promise = (async () => {
    const l2Hit = await getL2(key, deadlineAt);
    if (controller.signal.aborted) {
      throw abortError(controller.signal);
    }
    if (l2Hit) {
      setL1(key, l2Hit);
      return l2Hit;
    }
    let result: AnalyticsQueryResult;
    let timeoutRetryUsed = false;
    while (true) {
      if (controller.signal.aborted) throw abortError(controller.signal);
      const attemptDeadlineAt = entry.sharedDeadlineAt;
      // A single retry may use the full joiner-extension window. The shared
      // controller still enforces the latest active waiter's actual deadline.
      const queryDeadlineAt = timeoutRetryUsed
        ? maxSharedDeadlineAt
        : attemptDeadlineAt;
      const queryTimeoutMs = remainingTimeoutMs(queryDeadlineAt);
      if (queryTimeoutMs <= 0) {
        throw new Error(
          `First-party analytics query timed out after ${timeoutMs}ms`,
        );
      }
      try {
        result = await compute(queryTimeoutMs, controller.signal);
        break;
      } catch (error) {
        const retryDeadlineAt = entry.sharedDeadlineAt;
        if (
          controller.signal.aborted ||
          entry.waiters === 0 ||
          !isTimeoutError(error) ||
          timeoutRetryUsed ||
          retryDeadlineAt <= attemptDeadlineAt ||
          retryDeadlineAt <= Date.now()
        ) {
          throw error;
        }
        timeoutRetryUsed = true;
      }
    }
    setL1(key, result);
    void setL2(key, sql, result, entry.sharedDeadlineAt);
    return result;
  })().finally(() => {
    if (sharedTimeout) clearTimeout(sharedTimeout);
    entry.settled = true;
    const entries = inFlight.get(requestKey);
    if (entries) {
      const remaining = entries.filter((candidate) => candidate !== entry);
      if (remaining.length) inFlight.set(requestKey, remaining);
      else inFlight.delete(requestKey);
    }
  });
  entry = {
    promise,
    controller,
    waiters: 0,
    settled: false,
    sharedDeadlineAt,
    maxSharedDeadlineAt,
    extendSharedDeadline,
  };
  const entries = inFlight.get(requestKey) ?? [];
  entries.push(entry);
  inFlight.set(requestKey, entries);
  armSharedTimeout();
  return waitUntilDeadline(entry, deadlineAt, timeoutMs, options.signal);
}
