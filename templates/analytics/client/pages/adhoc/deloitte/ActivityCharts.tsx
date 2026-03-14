import { useMemo } from "react";
import { useMetricsQuery } from "@/lib/query-metrics";
import { KpiChart } from "../product-kpis/KpiChart";
import { agentChatMessagesByDay } from "./queries";

interface ActivityChartsProps {
  dateStart: string;
  dateEnd: string;
}

export function ActivityCharts({ dateStart, dateEnd }: ActivityChartsProps) {
  const msgSql = useMemo(
    () => agentChatMessagesByDay(dateStart, dateEnd),
    [dateStart, dateEnd],
  );
  const msgData = useMetricsQuery(["deloitte-agent-chat-msgs", msgSql], msgSql);

  return (
    <>
      <h2 className="text-lg font-semibold mt-2">Fusion Activity</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <KpiChart
          title="Fusion Messages"
          subtitle="Daily chat messages from Deloitte users"
          rows={msgData.data?.rows ?? []}
          dataKey="messages"
          chartType="bar"
          color="#18B4F4"
          isLoading={msgData.isLoading}
          error={msgData.data?.error}
        />
        <KpiChart
          title="Active Users (Fusion)"
          subtitle="Daily unique users sending Fusion messages"
          rows={msgData.data?.rows ?? []}
          dataKey="unique_users"
          chartType="bar"
          color="#8b5cf6"
          isLoading={msgData.isLoading}
          error={msgData.data?.error}
        />
      </div>
    </>
  );
}
