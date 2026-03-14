import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { TimeSeriesChart } from "@/components/dashboard/TimeSeriesChart";
import {
  DateRangePicker,
  dateRangeToInterval,
  type DateRange,
} from "@/components/dashboard/DateRangePicker";
import { useMetricsQuery } from "@/lib/query-metrics";
import { Users, MessageSquare, Activity } from "lucide-react";

const DATE_RANGE_KEY = "analytics_date_range";
function loadDateRange(): DateRange {
  const saved = localStorage.getItem(DATE_RANGE_KEY);
  if (saved === "7d" || saved === "30d" || saved === "90d") return saved;
  return "30d";
}

function signupsTotalSql(days: number) {
  return `SELECT COUNT(*) AS total FROM @app_events
WHERE event = "signup"
  AND createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
  AND createdDate <= CURRENT_TIMESTAMP()`;
}

function activeUsersTotalSql(days: number) {
  return `SELECT COUNT(DISTINCT userId) AS total FROM @app_events
WHERE createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
  AND createdDate <= CURRENT_TIMESTAMP()
  AND userId IS NOT NULL`;
}

function agentChatMessagesTotalSql(days: number) {
  return `SELECT COUNT(*) AS total FROM @app_events
WHERE event = "fusion chat message submitted"
  AND createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
  AND createdDate <= CURRENT_TIMESTAMP()`;
}

function signupsOverTimeSql(days: number) {
  return `SELECT TIMESTAMP_TRUNC(createdDate, DAY) AS day, COUNT(*) AS signups
FROM @app_events
WHERE event = "signup"
  AND createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
  AND createdDate <= CURRENT_TIMESTAMP()
GROUP BY day ORDER BY day ASC`;
}

function activeUsersOverTimeSql(days: number) {
  return `SELECT TIMESTAMP_TRUNC(createdDate, DAY) AS day, COUNT(DISTINCT userId) AS active_users
FROM @app_events
WHERE createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
  AND createdDate <= CURRENT_TIMESTAMP()
  AND userId IS NOT NULL
GROUP BY day ORDER BY day ASC`;
}

function agentChatMessagesOverTimeSql(days: number) {
  return `SELECT TIMESTAMP_TRUNC(createdDate, DAY) AS day, COUNT(*) AS messages
FROM @app_events
WHERE event = "fusion chat message submitted"
  AND createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
  AND createdDate <= CURRENT_TIMESTAMP()
GROUP BY day ORDER BY day ASC`;
}

export default function Index() {
  const [range, setRange] = useState<DateRange>(loadDateRange);
  const handleRangeChange = (r: DateRange) => {
    setRange(r);
    localStorage.setItem(DATE_RANGE_KEY, r);
  };
  const days = dateRangeToInterval(range);

  const signups = useMetricsQuery(
    ["signups-total", range],
    signupsTotalSql(days)
  );

  const activeUsers = useMetricsQuery(
    ["active-users-total", range],
    activeUsersTotalSql(days)
  );

  const agentChatMessages = useMetricsQuery(
    ["agent-chat-msgs-total", range],
    agentChatMessagesTotalSql(days)
  );

  const signupsOverTime = useMetricsQuery(
    ["signups-time", range],
    signupsOverTimeSql(days)
  );

  const activeUsersOverTime = useMetricsQuery(
    ["active-users-time", range],
    activeUsersOverTimeSql(days)
  );

  const agentChatOverTime = useMetricsQuery(
    ["agent-chat-time", range],
    agentChatMessagesOverTimeSql(days)
  );

  const getTotal = (q: ReturnType<typeof useMetricsQuery>) =>
    q.data?.rows?.[0]?.total as number | null;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Overview</h2>
          <DateRangePicker value={range} onChange={handleRangeChange} />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            title="Signups"
            value={getTotal(signups)}
            icon={Users}
            description={`Last ${days} days`}
            isLoading={signups.isLoading}
            error={signups.data?.error}
            sql={signupsTotalSql(days)}
          />
          <MetricCard
            title="Active Users"
            value={getTotal(activeUsers)}
            icon={Activity}
            description={`Last ${days} days`}
            isLoading={activeUsers.isLoading}
            error={activeUsers.data?.error}
            sql={activeUsersTotalSql(days)}
          />
          <MetricCard
            title="Agent Chat Messages"
            value={getTotal(agentChatMessages)}
            icon={MessageSquare}
            description={`Last ${days} days`}
            isLoading={agentChatMessages.isLoading}
            error={agentChatMessages.data?.error}
            sql={agentChatMessagesTotalSql(days)}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <TimeSeriesChart
            title="Signups Over Time"
            data={signupsOverTime.data?.rows ?? []}
            xKey="day"
            yKey="signups"
            isLoading={signupsOverTime.isLoading}
            error={signupsOverTime.data?.error}
            color="#10b981"
            sql={signupsOverTimeSql(days)}
          />
          <TimeSeriesChart
            title="Active Users Over Time"
            data={activeUsersOverTime.data?.rows ?? []}
            xKey="day"
            yKey="active_users"
            isLoading={activeUsersOverTime.isLoading}
            error={activeUsersOverTime.data?.error}
            color="#6366f1"
            sql={activeUsersOverTimeSql(days)}
          />
        </div>

        <TimeSeriesChart
          title="Agent Chat Messages Over Time"
          data={agentChatOverTime.data?.rows ?? []}
          xKey="day"
          yKey="messages"
          isLoading={agentChatOverTime.isLoading}
          error={agentChatOverTime.data?.error}
          color="#f59e0b"
          sql={agentChatMessagesOverTimeSql(days)}
        />
      </div>
    </Layout>
  );
}
