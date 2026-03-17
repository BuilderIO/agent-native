import { useMemo } from "react";
import { useMetricsQuery } from "@/lib/query-metrics";
import { KpiChart } from "../product-kpis/KpiChart";
import { agentChatMessagesByDayQuery } from "./queries";

interface AgentChatActivityChartProps {
  companyName: string;
  dateStart: string;
  dateEnd: string;
}

export function AgentChatActivityChart({
  companyName,
  dateStart,
  dateEnd,
}: AgentChatActivityChartProps) {
  const sql = useMemo(
    () => agentChatMessagesByDayQuery(companyName, dateStart, dateEnd),
    [companyName, dateStart, dateEnd],
  );

  const { data, isLoading } = useMetricsQuery(
    ["ch-agent-chat-daily", companyName, dateStart, dateEnd],
    sql,
  );
  const rows = data?.rows ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <KpiChart
        title="Agent Chat Messages"
        subtitle="Daily chat messages submitted"
        rows={rows}
        dataKey="messages"
        chartType="bar"
        color="#18B4F4"
        isLoading={isLoading}
        error={data?.error}
      />
      <KpiChart
        title="Agent Chat Active Users"
        subtitle="Daily unique users sending messages"
        rows={rows}
        dataKey="unique_users"
        chartType="bar"
        color="#8b5cf6"
        isLoading={isLoading}
        error={data?.error}
      />
    </div>
  );
}
