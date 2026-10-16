import { appApiPath } from "@agent-native/core/client/api-path";
import { useQuery } from "@tanstack/react-query";

import { getIdToken } from "./auth";
import { recordQueryCost } from "./cost-tracker";

export interface QueryMetricsResult {
  rows: Record<string, unknown>[];
  error?: string;
  schema?: { name: string; type: string }[];
}

export function queryRunTelemetry(
  result: QueryMetricsResult | undefined,
  queryError?: unknown,
) {
  const failed = Boolean(result?.error || queryError);
  return {
    query_status: failed ? "error" : "success",
    row_count: failed ? 0 : (result?.rows.length ?? 0),
    column_count: failed ? 0 : (result?.schema?.length ?? 0),
    ...(failed ? { error_category: "query_error" } : {}),
  };
}

export async function queryMetrics(sql: string): Promise<QueryMetricsResult> {
  const token = await getIdToken();
  let res: Response;
  try {
    res = await fetch(appApiPath("/api/query"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ query: sql }),
    });
  } catch (error) {
    // A request that was sent and lost may still have scanned.
    recordQueryCost({
      status:
        error instanceof Error && error.name === "AbortError"
          ? "cancelled"
          : "error",
    });
    throw error;
  }

  if (!res.ok) {
    // /api/query returns 401 before runQuery; provider failures are mapped to
    // 400. Keep other failures unknown because they may have scanned.
    if (res.status !== 401) recordQueryCost({ status: "error" });
    const body = await res.json().catch(() => ({}));
    return {
      rows: [],
      error: body.error || `Query failed (${res.status})`,
    };
  }

  let data: {
    rows?: Record<string, unknown>[];
    schema?: { name: string; type: string }[];
    bytesProcessed?: unknown;
    cached?: unknown;
    providerCacheHit?: unknown;
  };
  try {
    data = await res.json();
  } catch (error) {
    recordQueryCost({
      status:
        error instanceof Error && error.name === "AbortError"
          ? "cancelled"
          : "error",
    });
    throw error;
  }

  recordQueryCost({
    status: "success",
    ...(typeof data.cached === "boolean" ? { cached: data.cached } : {}),
    ...(typeof data.providerCacheHit === "boolean"
      ? { providerCacheHit: data.providerCacheHit }
      : {}),
    bytesProcessed: data.bytesProcessed,
  });

  return {
    rows: data.rows ?? [],
    schema: data.schema,
  };
}

export function useMetricsQuery(
  queryKey: string[],
  sql: string,
  options?: {
    enabled?: boolean;
    refetchInterval?: number;
  },
) {
  return useQuery<QueryMetricsResult>({
    queryKey,
    queryFn: () => queryMetrics(sql),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
    staleTime: 5 * 60 * 1000,
  });
}
