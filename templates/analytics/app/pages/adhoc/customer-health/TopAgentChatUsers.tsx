import { useMemo } from "react";
import { useMetricsQuery } from "@/lib/query-metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { topAgentChatUsersQuery } from "./queries";
import { TablePagination, usePagination } from "./TablePagination";

interface TopAgentChatUsersProps {
  companyName: string;
  dateStart: string;
  dateEnd: string;
}

export function TopAgentChatUsers({
  companyName,
  dateStart,
  dateEnd,
}: TopAgentChatUsersProps) {
  const sql = useMemo(
    () => topAgentChatUsersQuery(companyName, dateStart, dateEnd),
    [companyName, dateStart, dateEnd],
  );

  const { data, isLoading } = useMetricsQuery(
    ["ch-top-users", companyName, dateStart, dateEnd],
    sql,
  );
  const rows = data?.rows ?? [];
  const { page, totalPages, pageItems, setPage } = usePagination(rows);

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          Top Agent Chat Users
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Ranked by message count (excludes internal users)
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[200px] w-full" />
        ) : data?.error ? (
          <p className="text-sm text-red-400 py-4 text-center">{data.error}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No agent chat activity found
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="py-2 px-2 font-medium text-muted-foreground text-left">
                      Email
                    </th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-right">
                      Messages
                    </th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-right">
                      Active Days
                    </th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-left">
                      First Active
                    </th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-left">
                      Last Active
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-border/30 hover:bg-muted/30"
                    >
                      <td className="py-1.5 px-2 truncate max-w-[240px]">
                        {String(row.email ?? "—")}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {Number(row.messages).toLocaleString()}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {String(row.active_days ?? "—")}
                      </td>
                      <td className="py-1.5 px-2">
                        {String(row.first_message ?? "—")}
                      </td>
                      <td className="py-1.5 px-2">
                        {String(row.last_message ?? "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
