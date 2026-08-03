import { callAction } from "@agent-native/core/client/hooks";
import { DASHBOARD_REPORT_ACTION_TIMEOUT_MS } from "@shared/dashboard-report-timeouts";
import {
  MAX_CONCURRENT_FIRST_PARTY_SQL_QUERIES,
  MAX_CONCURRENT_SQL_QUERIES,
} from "@shared/sql-query-limits";
import { useQuery } from "@tanstack/react-query";

import type { DataSourceType } from "@/pages/adhoc/sql-dashboard/types";

import { addBytesProcessed } from "./cost-tracker";

export { DASHBOARD_REPORT_ACTION_TIMEOUT_MS };

export interface SqlQueryResult {
  rows: Record<string, unknown>[];
  error?: string;
  schema?: { name: string; type: string }[];
}

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

export async function executeSqlQuery(
  sql: string,
  source: DataSourceType,
  signal?: AbortSignal,
  options?: { reportScreenshot?: boolean },
): Promise<SqlQueryResult> {
  const release = await acquireSqlQuerySlot(source, signal);
  let data: DashboardPanelQueryResponse;
  try {
    data = await callAction<DashboardPanelQueryResponse>(
      "query-dashboard-panel",
      { query: sql, source },
      {
        signal,
        ...(options?.reportScreenshot
          ? { timeoutMs: DASHBOARD_REPORT_ACTION_TIMEOUT_MS }
          : {}),
      },
    );
  } finally {
    release();
  }

  if (typeof data?.error === "string") {
    throw new Error(
      typeof data.message === "string" && data.message
        ? data.message
        : data.error,
    );
  }

  if (data.bytesProcessed) {
    addBytesProcessed(data.bytesProcessed);
  }

  return {
    rows: data.rows ?? [],
    schema: data.schema,
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
    staleTime?: number;
  },
) {
  return useQuery<SqlQueryResult>({
    queryKey,
    queryFn: ({ signal }) =>
      executeSqlQuery(sql, source, signal, {
        reportScreenshot: options?.reportScreenshot,
      }),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
    refetchOnMount: options?.refetchOnMount ?? false,
    refetchOnReconnect: options?.refetchOnReconnect ?? false,
    refetchOnWindowFocus: options?.refetchOnWindowFocus ?? false,
    retry: options?.retry ?? false,
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
  });
}
