import { useMemo } from "react";
import { useMetricsQuery } from "@/lib/query-metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { agentChatUsersByMessageCount } from "./queries";

interface AgentChatUsersTableProps {
  dateStart: string;
  dateEnd: string;
}

export function AgentChatUsersTable({
  dateStart,
  dateEnd,
}: AgentChatUsersTableProps) {
  const sql = useMemo(
    () => agentChatUsersByMessageCount(dateStart, dateEnd),
    [dateStart, dateEnd],
  );
  const { data, isLoading } = useMetricsQuery(
    ["deloitte-agent-chat-users", sql],
    sql,
  );

  const rows = data?.rows ?? [];

  return (
    <>
      <h2 className="text-lg font-semibold mt-6">
        Agent Chat Users by Engagement
      </h2>
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Deloitte Users Ranked by Agent Chat Messages
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[200px] w-full" />
          ) : data?.error ? (
            <p className="text-sm text-red-400 py-4 text-center">
              {data.error}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No agent chat activity from Deloitte users in this period
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="py-2 px-2 text-left font-medium text-muted-foreground">
                      Email
                    </th>
                    <th className="py-2 px-2 text-right font-medium text-muted-foreground">
                      Messages
                    </th>
                    <th className="py-2 px-2 text-right font-medium text-muted-foreground">
                      Active Days
                    </th>
                    <th className="py-2 px-2 text-left font-medium text-muted-foreground">
                      First Message
                    </th>
                    <th className="py-2 px-2 text-left font-medium text-muted-foreground">
                      Last Message
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-border/30 hover:bg-muted/30"
                    >
                      <td className="py-1.5 px-2 font-medium">
                        {String(row.email ?? "—")}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {String(row.messages ?? 0)}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {String(row.active_days ?? 0)}
                      </td>
                      <td className="py-1.5 px-2 text-muted-foreground">
                        {String(row.first_message ?? "—")}
                      </td>
                      <td className="py-1.5 px-2 text-muted-foreground">
                        {String(row.last_message ?? "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
