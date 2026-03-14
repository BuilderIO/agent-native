import { useMemo } from "react";
import { useMetricsQuery } from "@/lib/query-metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  agentChatMessagesByUserQuery,
  agentChatEventsByTypeQuery,
  macysUsersQuery,
  macysSubscriptionsQuery,
} from "./queries";

interface UsersTablesProps {
  dateStart: string;
  dateEnd: string;
}

function DataTable({
  title,
  subtitle,
  columns,
  rows,
  isLoading,
  error,
}: {
  title: string;
  subtitle?: string;
  columns: { key: string; label: string; align?: "right" }[];
  rows: Record<string, unknown>[];
  isLoading: boolean;
  error?: string;
}) {
  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[160px] w-full" />
        ) : error ? (
          <p className="text-sm text-red-400 py-4 text-center">{error}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No data</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50">
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={`py-2 px-2 font-medium text-muted-foreground ${col.align === "right" ? "text-right" : "text-left"}`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-b border-border/30 hover:bg-muted/30">
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`py-1.5 px-2 ${col.align === "right" ? "text-right tabular-nums" : ""}`}
                      >
                        {String(row[col.key] ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function UsersTables({ dateStart, dateEnd }: UsersTablesProps) {
  const userMsgSql = useMemo(() => agentChatMessagesByUserQuery(dateStart, dateEnd), [dateStart, dateEnd]);
  const eventTypeSql = useMemo(() => agentChatEventsByTypeQuery(dateStart, dateEnd), [dateStart, dateEnd]);
  const usersSql = useMemo(() => macysUsersQuery(), []);
  const subsSql = useMemo(() => macysSubscriptionsQuery(), []);

  const userMsgData = useMetricsQuery(["macys-user-msgs", userMsgSql], userMsgSql);
  const eventTypeData = useMetricsQuery(["macys-event-types", eventTypeSql], eventTypeSql);
  const usersData = useMetricsQuery(["macys-users", usersSql], usersSql);
  const subsData = useMetricsQuery(["macys-subs", subsSql], subsSql);

  return (
    <>
      <h2 className="text-lg font-semibold mt-6">Users & Breakdown</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DataTable
          title="Fusion Messages by User"
          subtitle="Who is sending Fusion messages in the selected period"
          columns={[
            { key: "user_email", label: "User" },
            { key: "messages", label: "Messages", align: "right" },
            { key: "active_days", label: "Active Days", align: "right" },
            { key: "first_active", label: "First Active" },
            { key: "last_active", label: "Last Active" },
          ]}
          rows={userMsgData.data?.rows ?? []}
          isLoading={userMsgData.isLoading}
          error={userMsgData.data?.error}
        />
        <DataTable
          title="Fusion Event Types"
          subtitle="All fusion-related event types from Macy's orgs"
          columns={[
            { key: "event_type", label: "Event Type" },
            { key: "event_count", label: "Count", align: "right" },
            { key: "unique_users", label: "Users", align: "right" },
          ]}
          rows={eventTypeData.data?.rows ?? []}
          isLoading={eventTypeData.isLoading}
          error={eventTypeData.data?.error}
        />
      </div>

      <h2 className="text-lg font-semibold mt-6">Account Info</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DataTable
          title="Macy's Users"
          subtitle="All Builder accounts linked to Macy's HubSpot contacts"
          columns={[
            { key: "email", label: "Email" },
            { key: "firstname", label: "First" },
            { key: "lastname", label: "Last" },
            { key: "signup_date", label: "Signed Up" },
            { key: "org_id", label: "Org ID" },
          ]}
          rows={usersData.data?.rows ?? []}
          isLoading={usersData.isLoading}
          error={usersData.data?.error}
        />
        <DataTable
          title="Subscriptions"
          subtitle="Active and historical subscriptions across Macy's orgs"
          columns={[
            { key: "plan", label: "Plan" },
            { key: "status", label: "Status" },
            { key: "subscription_arr", label: "ARR", align: "right" },
            { key: "start_date", label: "Start Date" },
            { key: "space_id", label: "Space ID" },
          ]}
          rows={subsData.data?.rows ?? []}
          isLoading={subsData.isLoading}
          error={subsData.data?.error}
        />
      </div>
    </>
  );
}
