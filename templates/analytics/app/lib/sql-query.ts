import { callAction, useSession } from "@agent-native/core/client/hooks";
import { DASHBOARD_REPORT_ACTION_TIMEOUT_MS } from "@shared/dashboard-report-timeouts";
import {
  confirmedScanBytes,
  isConfirmedPreQueryFailure,
  isSqlQueryAccessDenied,
  SqlQueryRefusalError,
  supportsSqlQueryCacheBypass,
  type SqlQueryExecutionMetadata,
} from "@shared/sql-query-contract";
import {
  MAX_CONCURRENT_FIRST_PARTY_SQL_QUERIES,
  MAX_CONCURRENT_SQL_QUERIES,
} from "@shared/sql-query-limits";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import type { DataSourceType } from "@/pages/adhoc/sql-dashboard/types";

import { recordQueryCost } from "./cost-tracker";
import {
  DASHBOARD_SESSION_LOADING_SCOPE,
  dashboardCacheScope,
} from "./prefetch-keys";
import {
  describeSqlQueryFreshness,
  type SqlQueryFreshness,
} from "./sql-query-freshness";
import {
  readSqlQuerySnapshotForSession,
  removeSqlQuerySnapshotForSession,
  writeSqlQuerySnapshotForSession,
} from "./sql-query-snapshot-session";

export { DASHBOARD_REPORT_ACTION_TIMEOUT_MS };

export interface SqlQueryResult extends Omit<
  SqlQueryExecutionMetadata,
  "bytesProcessed"
> {
  rows: Record<string, unknown>[];
  error?: string;
  schema?: { name: string; type: string }[];
  /** Bytes this request scanned, present only when both cache layers missed. */
  bytesRead?: number;
}

/** Why a query runs; the server applies the matching billed-byte cap. */
export type SqlQueryPurpose = "row-breakdown" | "panel-drilldown";

type PendingSqlQuerySlot = {
  resolve: (release: () => void) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  onAbort: () => void;
};

type SqlQueryLane = "first-party" | "external";

type SqlQuerySlotPool = {
  active: number;
  limit: number;
  pending: PendingSqlQuerySlot[];
};

const sqlQuerySlotPools: Record<SqlQueryLane, SqlQuerySlotPool> = {
  "first-party": {
    active: 0,
    limit: MAX_CONCURRENT_FIRST_PARTY_SQL_QUERIES,
    pending: [],
  },
  external: {
    active: 0,
    limit: MAX_CONCURRENT_SQL_QUERIES,
    pending: [],
  },
};

function sqlQueryLane(source: DataSourceType): SqlQueryLane {
  return source === "first-party" ? "first-party" : "external";
}

function createAbortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("SQL query aborted", "AbortError");
  }
  const error = new Error("SQL query aborted");
  error.name = "AbortError";
  return error;
}

function createDeadlineSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

function createSqlQueryRelease(pool: SqlQuerySlotPool): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pool.active = Math.max(0, pool.active - 1);
    drainSqlQuerySlots(pool);
  };
}

function drainSqlQuerySlots(pool: SqlQuerySlotPool): void {
  while (pool.active < pool.limit && pool.pending.length > 0) {
    const pending = pool.pending.shift();
    if (!pending) return;
    pending.signal?.removeEventListener("abort", pending.onAbort);
    if (pending.signal?.aborted) {
      pending.reject(createAbortError());
      continue;
    }
    pool.active += 1;
    pending.resolve(createSqlQueryRelease(pool));
  }
}

async function acquireSqlQuerySlot(
  source: DataSourceType,
  signal?: AbortSignal,
): Promise<() => void> {
  if (signal?.aborted) throw createAbortError();
  const pool = sqlQuerySlotPools[sqlQueryLane(source)];
  return new Promise((resolve, reject) => {
    const pending: PendingSqlQuerySlot = {
      resolve,
      reject,
      signal,
      onAbort: () => {
        const index = pool.pending.indexOf(pending);
        if (index >= 0) pool.pending.splice(index, 1);
        reject(createAbortError());
      },
    };
    signal?.addEventListener("abort", pending.onAbort, { once: true });
    pool.pending.push(pending);
    drainSqlQuerySlots(pool);
  });
}

type DashboardPanelQueryResponse = SqlQueryResult & {
  bytesProcessed?: number;
  message?: string;
};

type SqlQueryTimingStatus = "success" | "error" | "cancelled" | "timeout";

/** Sources whose queries scan BigQuery, so a lost request may still bill. */
function scansBigQuery(source: DataSourceType): boolean {
  return source === "bigquery" || source === "first-party";
}

/**
 * One line per query with durations and outcome only. No SQL, rows, account
 * or credentials, so it is safe to leave on in production.
 */
function logSqlQueryTiming(timing: {
  status: SqlQueryTimingStatus;
  source: DataSourceType;
  cacheType: "none" | "app" | "provider" | "unknown";
  forceRefresh: boolean;
  queueMs: number;
  requestMs: number;
  totalMs: number;
}): void {
  console.info("[sql-query] timing", {
    ...timing,
    queueMs: Math.round(timing.queueMs),
    requestMs: Math.round(timing.requestMs),
    totalMs: Math.round(timing.totalMs),
  });
}

function responseMetadata(data: DashboardPanelQueryResponse): {
  cached?: boolean;
  providerCacheHit?: boolean;
  truncated?: boolean;
  partial?: boolean;
  fetchedAt?: string;
} {
  const metadata: ReturnType<typeof responseMetadata> = {};
  if (typeof data.cached === "boolean") metadata.cached = data.cached;
  if (typeof data.providerCacheHit === "boolean") {
    metadata.providerCacheHit = data.providerCacheHit;
  }
  if (typeof data.truncated === "boolean") metadata.truncated = data.truncated;
  // Provider warnings can cut results short without setting the row-limit flag.
  // Use the same incomplete signal so snapshots cannot restore them as complete.
  if (data.partial === true) {
    metadata.partial = true;
    metadata.truncated = true;
  }
  if (data.fetchedAt !== undefined) {
    if (
      typeof data.fetchedAt === "string" &&
      Number.isFinite(Date.parse(data.fetchedAt))
    ) {
      metadata.fetchedAt = data.fetchedAt;
    } else {
      // Left absent so the panel says the time is unknown rather than guessing.
      console.warn("[sql-query] ignored an unreadable fetchedAt");
    }
  }
  return metadata;
}

export async function executeSqlQuery(
  sql: string,
  source: DataSourceType,
  signal?: AbortSignal,
  options?: {
    reportScreenshot?: boolean;
    forceRefresh?: boolean;
    purpose?: SqlQueryPurpose;
  },
): Promise<SqlQueryResult> {
  const startedAt = performance.now();
  const forceRefresh = Boolean(
    options?.forceRefresh && supportsSqlQueryCacheBypass(source),
  );
  const deadline = createDeadlineSignal(
    signal,
    DASHBOARD_REPORT_ACTION_TIMEOUT_MS,
  );
  let release: (() => void) | undefined;
  let data: DashboardPanelQueryResponse;
  let dispatchedAt: number | undefined;
  let queueMs = 0;
  let requestMs = 0;
  let status: SqlQueryTimingStatus = "success";
  let cacheType: "none" | "app" | "provider" | "unknown" = "unknown";
  try {
    release = await acquireSqlQuerySlot(source, deadline.signal);
    dispatchedAt = performance.now();
    queueMs = dispatchedAt - startedAt;
    data = await callAction<DashboardPanelQueryResponse>(
      "query-dashboard-panel",
      {
        query: sql,
        source,
        ...(forceRefresh ? { forceRefresh: true } : {}),
        ...(options?.purpose ? { purpose: options.purpose } : {}),
      },
      {
        signal: deadline.signal,
        timeoutMs: DASHBOARD_REPORT_ACTION_TIMEOUT_MS,
      },
    );
    requestMs = performance.now() - dispatchedAt;
  } catch (error) {
    const now = performance.now();
    if (dispatchedAt === undefined) queueMs = now - startedAt;
    else requestMs = now - dispatchedAt;
    status = signal?.aborted
      ? "cancelled"
      : deadline.signal.aborted
        ? "timeout"
        : "error";
    // A query still waiting for a slot never reached the warehouse. One that
    // was sent may have scanned before it failed, so its cost is unknown.
    if (
      dispatchedAt !== undefined &&
      scansBigQuery(source) &&
      !isConfirmedPreQueryFailure(error)
    ) {
      recordQueryCost({
        status: status === "cancelled" ? "cancelled" : "error",
      });
    }
    logSqlQueryTiming({
      status,
      source,
      cacheType,
      forceRefresh,
      queueMs,
      requestMs,
      totalMs: now - startedAt,
    });
    throw error;
  } finally {
    release?.();
    deadline.cleanup();
  }

  if (typeof data?.error === "string") {
    // A refusal in the body (missing key, unsupported backend) ran no scan.
    logSqlQueryTiming({
      status: "error",
      source,
      cacheType,
      forceRefresh,
      queueMs,
      requestMs,
      totalMs: performance.now() - startedAt,
    });
    throw new SqlQueryRefusalError({
      error: data.error,
      message: data.message,
    });
  }

  const metadata = responseMetadata(data);
  recordQueryCost({
    status: "success",
    cached: metadata.cached,
    providerCacheHit: metadata.providerCacheHit,
    bytesProcessed: data.bytesProcessed,
  });
  // "none" is a claim that both layers missed; a response that does not say
  // so for each layer is unknown, never a miss.
  cacheType = metadata.cached
    ? "app"
    : metadata.providerCacheHit
      ? "provider"
      : metadata.cached === false && metadata.providerCacheHit === false
        ? "none"
        : "unknown";
  logSqlQueryTiming({
    status,
    source,
    cacheType,
    forceRefresh,
    queueMs,
    requestMs,
    totalMs: performance.now() - startedAt,
  });

  const bytesRead = confirmedScanBytes({
    ...metadata,
    bytesProcessed: data.bytesProcessed,
  });
  return {
    rows: data.rows ?? [],
    schema: data.schema,
    ...metadata,
    ...(bytesRead !== null ? { bytesRead } : {}),
  };
}

export function useSqlQuery(
  queryKey: string[],
  sql: string,
  source: DataSourceType,
  options?: {
    enabled?: boolean;
    refetchInterval?: number | false;
    refetchOnMount?: boolean | "always";
    refetchOnReconnect?: boolean | "always";
    refetchOnWindowFocus?: boolean | "always";
    retry?: boolean | number;
    reportScreenshot?: boolean;
    refreshToken?: number;
    staleTime?: number;
    /**
     * Keeps the last result shown, with `isPlaceholderData` set, while a
     * different SQL string loads or fails, but only for this same scope and
     * account. The result of a failed query is never replaced by old rows:
     * `error` stays set beside them.
     */
    retainPreviousScope?: string;
    /**
     * Also holds that last result while the query is disabled, for a panel
     * that is only paused. Requires `retainPreviousScope`; without it a
     * disabled query shows nothing.
     */
    retainWhilePaused?: boolean;
    /**
     * A completed result for a SQL string is never stale, so enabling or
     * returning to a SQL that already has one does not rescan it. Only an
     * explicit `refreshToken` refresh does. Ignored when `staleTime` is set.
     */
    reuseCompletedOnEnable?: boolean;
    purpose?: SqlQueryPurpose;
    /**
     * Saves each successful result in this tab's session storage and, after a
     * reload, shows the saved copy for this exact account, SQL and source while
     * the query's one normal fetch runs. The copy keeps its original fetch
     * time and is marked `restored` in `freshness`; it is never fresh data.
     */
    snapshots?: boolean;
  },
) {
  // The signed-in user and org are part of the cache key, so one account's
  // rows are never read, refreshed, or shown for another. A loading,
  // unavailable, signed-out or signing-out session is no account: nothing is
  // read from the cache and no protected query starts until it is
  // authenticated.
  const { session, status } = useSession();
  const sessionReady = status === "authenticated" && session !== null;
  const accountScope = sessionReady
    ? dashboardCacheScope(session)
    : DASHBOARD_SESSION_LOADING_SCOPE;
  const scopedQueryKey = [...queryKey, accountScope];
  const retainScope = options?.retainPreviousScope;
  const queryKeyHash = JSON.stringify(scopedQueryKey);
  const lastShown = useRef<{
    data: SqlQueryResult;
    queryKeyHash: string;
    accountScope: string;
    retainScope: string;
  } | null>(null);
  const refreshToken = options?.refreshToken ?? 0;
  const wantsQuery = options?.enabled ?? true;
  const enabled = wantsQuery && sessionReady;
  const latestRefreshToken = useRef(refreshToken);
  const latestStartedRefreshToken = useRef(refreshToken);
  latestRefreshToken.current = refreshToken;
  // A manual refresh belongs to the query it was requested on. Sources that
  // support cache bypass keep it pending until success. It is recorded while
  // rendering because the fetch it triggers can start before any effect runs.
  const pendingManualRefresh = useRef<{
    token: number;
    queryKeyHash: string;
    failed?: boolean;
  } | null>(null);
  // The manual request whose own forced fetch last completed, for the caller
  // that shows it. A fetch that started without that request (an automatic
  // revalidation, a cancelled or failed attempt) never writes it, and it is
  // dropped as soon as the account or query it belongs to changes.
  const completedManualRefresh = useRef<{
    token: number;
    queryKeyHash: string;
    completedAt: number;
  } | null>(null);
  if (
    completedManualRefresh.current &&
    completedManualRefresh.current.queryKeyHash !== queryKeyHash
  ) {
    completedManualRefresh.current = null;
  }
  const observedRefreshToken = useRef(refreshToken);
  if (refreshToken > observedRefreshToken.current) {
    observedRefreshToken.current = refreshToken;
    pendingManualRefresh.current = { token: refreshToken, queryKeyHash };
  } else if (
    pendingManualRefresh.current &&
    pendingManualRefresh.current.queryKeyHash !== queryKeyHash
  ) {
    // The request failed or was superseded, and the panel has moved to
    // another query: that one is an ordinary automatic load.
    pendingManualRefresh.current = null;
  }
  const previousRefreshToken = useRef(refreshToken);
  const previousEnabled = useRef(enabled);
  const snapshotKey = JSON.stringify([queryKey, sql, source]);
  const restoredCopy = useRef<{
    id: string;
    result: SqlQueryResult | null;
  } | null>(null);
  const queryClient = useQueryClient();
  const query = useQuery<SqlQueryResult>({
    queryKey: scopedQueryKey,
    queryFn: async ({ signal }) => {
      latestStartedRefreshToken.current = latestRefreshToken.current;
      const manual = pendingManualRefresh.current;
      const manualRequested = manual?.queryKeyHash === queryKeyHash;
      const forceRefresh =
        manualRequested && supportsSqlQueryCacheBypass(source);
      let result: SqlQueryResult;
      try {
        result = await executeSqlQuery(sql, source, signal, {
          reportScreenshot: options?.reportScreenshot,
          forceRefresh,
          ...(options?.purpose ? { purpose: options.purpose } : {}),
        });
      } catch (error) {
        if (isSqlQueryAccessDenied(error)) {
          if (
            lastShown.current?.accountScope === accountScope &&
            lastShown.current?.retainScope === retainScope
          ) {
            lastShown.current = null;
          }
          restoredCopy.current = null;
          removeSqlQuerySnapshotForSession({
            accountScope,
            queryKey: snapshotKey,
          });
          // React Query retains data on failed revalidation by default. Remove
          // just this denied result while letting it commit the real error.
          queryClient
            .getQueryCache()
            .find({ queryKey: scopedQueryKey, exact: true })
            ?.setState({
              data: undefined,
              dataUpdatedAt: 0,
              error,
              status: "error",
            });
        }
        // The request stays pending for the cache bypass, but a later success
        // is not the one the user asked for.
        if (manual && forceRefresh && !signal.aborted) manual.failed = true;
        if (
          manualRequested &&
          !forceRefresh &&
          pendingManualRefresh.current === manual
        ) {
          pendingManualRefresh.current = null;
        }
        throw error;
      }
      if (manualRequested && pendingManualRefresh.current === manual) {
        pendingManualRefresh.current = null;
      }
      if (manual && forceRefresh && !manual.failed && !signal.aborted) {
        completedManualRefresh.current = {
          token: manual.token,
          queryKeyHash,
          completedAt: Date.now(),
        };
      }
      if (options?.snapshots) {
        writeSqlQuerySnapshotForSession({
          accountScope,
          queryKey: snapshotKey,
          result,
          signal,
        });
      }
      return result;
    },
    enabled,
    refetchInterval: options?.refetchInterval,
    refetchOnMount: options?.refetchOnMount ?? false,
    refetchOnReconnect: options?.refetchOnReconnect ?? false,
    refetchOnWindowFocus: options?.refetchOnWindowFocus ?? false,
    retry: (failureCount, error) => {
      if (isSqlQueryAccessDenied(error)) return false;
      const retry = options?.retry ?? false;
      return typeof retry === "number" ? failureCount < retry : retry;
    },
    staleTime:
      options?.staleTime ??
      (options?.reuseCompletedOnEnable ? Infinity : 5 * 60 * 1000),
  });
  const refetch = query.refetch;
  const accessDenied = isSqlQueryAccessDenied(query.error);

  useEffect(() => {
    if (accessDenied) {
      lastShown.current = null;
    } else if (query.data && sessionReady && retainScope !== undefined) {
      lastShown.current = {
        data: query.data,
        queryKeyHash,
        accountScope,
        retainScope,
      };
    } else if (
      lastShown.current?.accountScope !== accountScope ||
      lastShown.current?.retainScope !== retainScope
    ) {
      lastShown.current = null;
    }
  }, [
    query.data,
    sessionReady,
    retainScope,
    queryKeyHash,
    accountScope,
    accessDenied,
  ]);

  useEffect(() => {
    const wasEnabled = previousEnabled.current;
    previousEnabled.current = enabled;
    const refreshTokenChanged = refreshToken > previousRefreshToken.current;
    previousRefreshToken.current = refreshToken;
    if (!enabled) return;
    const pending = pendingManualRefresh.current;
    const enablingPendingRefresh = !wasEnabled && pending !== null;
    if (!pending || (!refreshTokenChanged && !enablingPendingRefresh)) {
      return;
    }
    if (
      query.isFetching &&
      latestStartedRefreshToken.current >= pending.token
    ) {
      return;
    }
    void queryClient
      .cancelQueries({ queryKey: scopedQueryKey, exact: true })
      .then(() => refetch());
  }, [
    enabled,
    query.isFetching,
    queryClient,
    scopedQueryKey,
    refetch,
    refreshToken,
  ]);

  // The saved copy is read once per account and query, and only for a query
  // with nothing in memory. Once the query has data the copy is spent, so a
  // later cache eviction cannot bring back rows older than ones already shown.
  const restoreId = `${accountScope}
${snapshotKey}`;
  let restored: SqlQueryResult | null = null;
  if (accessDenied) {
    restoredCopy.current = { id: restoreId, result: null };
  } else if (options?.snapshots && sessionReady && query.data === undefined) {
    if (restoredCopy.current?.id !== restoreId) {
      const read = readSqlQuerySnapshotForSession({
        accountScope,
        queryKey: snapshotKey,
      });
      restoredCopy.current = {
        id: restoreId,
        result: read.status === "hit" ? read.snapshot.result : null,
      };
    }
    restored = restoredCopy.current.result;
  } else if (query.data !== undefined && restoredCopy.current) {
    restoredCopy.current = { id: restoreId, result: null };
  }

  const freshnessOf = (
    data: SqlQueryResult | undefined,
    isRestored: boolean,
  ): SqlQueryFreshness | undefined =>
    describeSqlQueryFreshness(data, { source, restored: isRestored });
  // Offered only once the data it produced has been committed to the query.
  const completion = completedManualRefresh.current;
  const completedManualRefreshToken =
    completion &&
    completion.queryKeyHash === queryKeyHash &&
    query.data !== undefined &&
    query.dataUpdatedAt >= completion.completedAt
      ? completion.token
      : undefined;
  if (!sessionReady && wantsQuery) {
    return {
      ...query,
      data: undefined,
      isPlaceholderData: false,
      isLoading: true,
      freshness: undefined,
      completedManualRefreshToken: undefined,
    };
  }
  if (accessDenied) {
    return {
      ...query,
      data: undefined,
      isPlaceholderData: false,
      isLoading: false,
      freshness: undefined,
      completedManualRefreshToken: undefined,
    };
  }
  if (
    restored &&
    query.data === undefined &&
    (enabled || (options?.retainWhilePaused && sessionReady))
  ) {
    return {
      ...query,
      data: restored,
      isPlaceholderData: false,
      isLoading: false,
      freshness: freshnessOf(restored, true),
      completedManualRefreshToken: undefined,
    };
  }
  const held = lastShown.current;
  if (
    query.data === undefined &&
    (enabled || (options?.retainWhilePaused && sessionReady)) &&
    held &&
    held.accountScope === accountScope &&
    held.retainScope === retainScope
  ) {
    return {
      ...query,
      data: held.data,
      isPlaceholderData: held.queryKeyHash !== queryKeyHash,
      isLoading: false,
      freshness: freshnessOf(held.data, false),
      completedManualRefreshToken: undefined,
    };
  }
  return {
    ...query,
    freshness: freshnessOf(query.data, false),
    completedManualRefreshToken,
  };
}
