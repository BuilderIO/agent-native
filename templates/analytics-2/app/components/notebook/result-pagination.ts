import type { CellOutput } from "@/lib/model/contracts";

import { decimalIntegerSchema } from "../../../shared/notebook-snapshot-contract";
import { PROJECT_QUERY_PAGE_SIZE } from "../../../shared/project-query-page";

type TableOutput = Extract<CellOutput, { type: "table" }>;

export function tableResultCoverage(
  output: TableOutput,
  totalRows: string | null | undefined,
  hasNextPage: boolean | undefined,
  pageSize: number = PROJECT_QUERY_PAGE_SIZE,
) {
  const materialized = BigInt(output.rows.length);
  const total = totalRows ?? output.totalRows;
  const parsed = decimalIntegerSchema.safeParse(total);
  const reported = parsed.success ? BigInt(parsed.data) : null;
  const complete =
    !output.truncated &&
    !hasNextPage &&
    output.rowCount === output.rows.length &&
    (total == null || reported === materialized);
  const exact = complete
    ? materialized
    : hasNextPage && reported !== null && reported > materialized
      ? reported
      : null;
  const pages =
    exact === null ? null : (exact + BigInt(pageSize - 1)) / BigInt(pageSize);
  return {
    complete,
    count: exact ?? materialized,
    exact,
    lastPage:
      pages !== null &&
      pages * BigInt(pageSize) <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Math.max(1, Number(pages))
        : null,
  };
}
