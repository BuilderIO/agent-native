import { useQuery } from "@tanstack/react-query";
import { addBytesProcessed } from "./cost-tracker";
import { getIdToken } from "./auth";
import { appApiPath } from "@agent-native/core/client";

export interface QueryMetricsResult {
  rows: Record<string, unknown>[];
  error?: string;
  schema?: { name: string; type: string }[];
}

export async function queryMetrics(sql: string): Promise<QueryMetricsResult> {
  const token = await getIdToken();
  const res = await fetch(appApiPath("/api/query"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return {
      rows: [],
      error: body.error || `Query failed (${res.status})`,
    };
  }

  const data = await res.json();

  if (data.bytesProcessed) {
    addBytesProcessed(data.bytesProcessed);
  }

  return {
    rows: data.rows ?? [],
    schema: data.schema,
  };
}

/**
 * React Query hook for metrics queries.
 */
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
