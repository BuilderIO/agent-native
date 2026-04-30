import { useQuery } from "@tanstack/react-query";
import { addBytesProcessed } from "./cost-tracker";
import { getIdToken } from "./auth";
import type { DataSourceType } from "@/pages/adhoc/sql-dashboard/types";
import { appApiPath } from "@agent-native/core/client";

export interface SqlQueryResult {
  rows: Record<string, unknown>[];
  error?: string;
  schema?: { name: string; type: string }[];
}

export async function executeSqlQuery(
  sql: string,
  source: DataSourceType,
): Promise<SqlQueryResult> {
  const token = await getIdToken();
  const res = await fetch(appApiPath("/api/sql-query"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ query: sql, source }),
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

export function useSqlQuery(
  queryKey: string[],
  sql: string,
  source: DataSourceType,
  options?: {
    enabled?: boolean;
    refetchInterval?: number;
  },
) {
  return useQuery<SqlQueryResult>({
    queryKey,
    queryFn: () => executeSqlQuery(sql, source),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
    staleTime: 5 * 60 * 1000,
  });
}
