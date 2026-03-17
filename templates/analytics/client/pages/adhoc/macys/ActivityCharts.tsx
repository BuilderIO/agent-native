import { useMemo } from "react";
import { useMetricsQuery } from "@/lib/query-metrics";
import { KpiChart } from "../product-kpis/KpiChart";
import { agentChatMessagesByDayQuery, allEventsByDayQuery } from "./queries";

interface ActivityChartsProps {
  dateStart: string;
  dateEnd: string;
}

export function ActivityCharts({ dateStart, dateEnd }: ActivityChartsProps) {
  const msgSql = useMemo(
    () => agentChatMessagesByDayQuery(dateStart, dateEnd),
    [dateStart, dateEnd],
  );
  const eventsSql = useMemo(
    () => allEventsByDayQuery(dateStart, dateEnd),
    [dateStart, dateEnd],
  );

  const msgData = useMetricsQuery(["macys-agent-chat-msgs", msgSql], msgSql);
  const eventsData = useMetricsQuery(
    ["macys-all-events", eventsSql],
    eventsSql,
  );

  return (
    <>
      <h2 className="text-lg font-semibold mt-2">Activity</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <KpiChart
          title="Agent Chat Messages"
          subtitle="Daily chat messages sent across all customer spaces"
          rows={msgData.data?.rows ?? []}
          dataKey="messages"
          chartType="bar"
          color="#18B4F4"
          isLoading={msgData.isLoading}
          error={msgData.data?.error}
        />
        <KpiChart
          title="Active Users (Agent Chat)"
          subtitle="Daily unique users sending agent chat messages"
          rows={msgData.data?.rows ?? []}
          dataKey="unique_users"
          chartType="bar"
          color="#8b5cf6"
          isLoading={msgData.isLoading}
          error={msgData.data?.error}
        />
        <KpiChart
          title="All Events"
          subtitle="Daily total events from customer orgs"
          rows={eventsData.data?.rows ?? []}
          dataKey="events"
          chartType="area"
          color="#22c55e"
          isLoading={eventsData.isLoading}
          error={eventsData.data?.error}
        />
        <KpiChart
          title="Active Users (All)"
          subtitle="Daily unique users across all events"
          rows={eventsData.data?.rows ?? []}
          dataKey="unique_users"
          chartType="area"
          color="#f59e0b"
          isLoading={eventsData.isLoading}
          error={eventsData.data?.error}
        />
      </div>
    </>
  );
}
