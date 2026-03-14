import { useMemo } from "react";
import { useMetricsQuery } from "@/lib/query-metrics";
import { filterOptionsQuery } from "./queries";

export function useFilterOptions(
  column: string,
  table: "pageviews" | "signups" | "bpc" | "bpc_author" | "crm",
  dateStart?: string,
  dateEnd?: string,
) {
  const sql = useMemo(
    () => filterOptionsQuery(column, table, dateStart, dateEnd),
    [column, table, dateStart, dateEnd],
  );

  const query = useMetricsQuery(
    ["filter-options", table, column, dateStart ?? "", dateEnd ?? ""],
    sql,
  );

  const options = useMemo(() => {
    if (!query.data?.rows) return [];
    return query.data.rows.map((r) => String(r.val ?? "")).filter(Boolean);
  }, [query.data]);

  return { options, isLoading: query.isLoading };
}
