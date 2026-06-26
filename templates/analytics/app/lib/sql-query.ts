import { appApiPath } from "@agent-native/core/client";
import { useQuery } from "@tanstack/react-query";

import type { DataSourceType } from "@/pages/adhoc/sql-dashboard/types";

import { getIdToken } from "./auth";
import { addBytesProcessed } from "./cost-tracker";

export interface SqlQueryResult {
  rows: Record<string, unknown>[];
  error?: string;
  schema?: { name: string; type: string }[];
}

const MAX_CONCURRENT_SQL_QUERIES = 4;

type PendingSqlQuerySlot = {
  resolve: (release: () => void) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  onAbort: () => void;
};

let activeSqlQueries = 0;
const pendingSqlQuerySlots: PendingSqlQuerySlot[] = [];

function createAbortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("SQL query aborted", "AbortError");
  }
  const error = new Error("SQL query aborted");
  error.name = "AbortError";
  return error;
}

function createSqlQueryRelease(): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeSqlQueries = Math.max(0, activeSqlQueries - 1);
    drainSqlQuerySlots();
  };
}

function drainSqlQuerySlots(): void {
  while (
    activeSqlQueries < MAX_CONCURRENT_SQL_QUERIES &&
    pendingSqlQuerySlots.length > 0
  ) {
    const pending = pendingSqlQuerySlots.shift();
    if (!pending) return;
    pending.signal?.removeEventListener("abort", pending.onAbort);
    if (pending.signal?.aborted) {
      pending.reject(createAbortError());
      continue;
    }
    activeSqlQueries += 1;
    pending.resolve(createSqlQueryRelease());
  }
}

async function acquireSqlQuerySlot(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) throw createAbortError();
  return new Promise((resolve, reject) => {
    const pending: PendingSqlQuerySlot = {
      resolve,
      reject,
      signal,
      onAbort: () => {
        const index = pendingSqlQuerySlots.indexOf(pending);
        if (index >= 0) pendingSqlQuerySlots.splice(index, 1);
        reject(createAbortError());
      },
    };
    signal?.addEventListener("abort", pending.onAbort, { once: true });
    pendingSqlQuerySlots.push(pending);
    drainSqlQuerySlots();
  });
}

async function readSqlQueryError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return typeof body?.error === "string"
    ? body.error
    : `Query failed (${res.status})`;
}

export async function executeSqlQuery(
  sql: string,
  source: DataSourceType,
  signal?: AbortSignal,
): Promise<SqlQueryResult> {
  const token = await getIdToken();
  const release = await acquireSqlQuerySlot(signal);
  let res: Response;
  try {
    res = await fetch(appApiPath("/api/sql-query"), {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ query: sql, source }),
    });
  } finally {
    release();
  }

  if (!res.ok) {
    throw new Error(await readSqlQueryError(res));
  }

  const data = await res.json();

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
    staleTime?: number;
  },
) {
  return useQuery<SqlQueryResult>({
    queryKey,
    queryFn: ({ signal }) => executeSqlQuery(sql, source, signal),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
    refetchOnMount: options?.refetchOnMount ?? false,
    refetchOnReconnect: options?.refetchOnReconnect ?? false,
    refetchOnWindowFocus: options?.refetchOnWindowFocus ?? false,
    retry: options?.retry ?? false,
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
  });
}
