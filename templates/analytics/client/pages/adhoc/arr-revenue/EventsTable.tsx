import { useMetricsQuery } from "@/lib/query-metrics";
import { DataTable } from "@/components/dashboard/DataTable";
import { rawEventsQuery } from "./queries";

interface EventsTableProps {
  fiscalYear: number;
}

const COLUMNS = [
  "fiscal_date",
  "customer_name",
  "product_group",
  "product",
  "status",
  "status_group",
  "plan",
  "arr_change",
  "current_arr",
  "fiscal_quarter",
  "org_id",
];

export function EventsTable({ fiscalYear }: EventsTableProps) {
  const sql = rawEventsQuery(fiscalYear, 500);
  const { data, isLoading } = useMetricsQuery(
    ["arr-raw-events", String(fiscalYear)],
    sql
  );

  return (
    <DataTable
      title="Recent ARR Events"
      data={data?.rows ?? []}
      columns={COLUMNS}
      isLoading={isLoading}
      error={data?.error}
      maxRows={500}
    />
  );
}
