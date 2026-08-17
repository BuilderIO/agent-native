import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconActivity,
  IconAlertTriangle,
  IconArrowUpRight,
  IconApps,
  IconChartBar,
  IconCoin,
  IconMessages,
  IconUsersGroup,
} from "@tabler/icons-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { DispatchShell } from "../../components/dispatch-shell";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "../../components/ui/chart";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { UsageAlertsPanel } from "../../components/usage-alerts-panel";
import { cn } from "../../lib/utils";

export function meta() {
  return [{ title: "Metrics — Dispatch" }];
}

interface UsageMetricBucket {
  key: string;
  label: string;
  costCents: number;
  calls: number;
  chatCalls: number;
  inputTokens: number;
  outputTokens: number;
  activeUsers: number;
  lastActiveAt: number | null;
}

interface UserUsageMetric extends UsageMetricBucket {
  ownerEmail: string;
  chatThreads: number;
  chatMessages: number;
  lastChatAt: number | null;
  topApp: string | null;
  role: string | null;
}

interface UsageUserOption {
  email: string;
  role: string | null;
}

interface AppAccessMetric {
  id: string;
  name: string;
  path: string;
  status?: "ready" | "pending";
  statusLabel?: string;
  isDispatch: boolean;
  accessLabel: string;
  accessUsers: number;
  usersWithUsage: number;
  usageCalls: number;
  chatCalls: number;
  costCents: number;
  lastActiveAt: number | null;
}

interface DailyUsageMetric {
  date: string;
  costCents: number;
  calls: number;
  chatCalls: number;
  activeUsers: number;
}

interface RecentUsageMetric {
  id: number;
  createdAt: number;
  ownerEmail: string;
  app: string;
  label: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  prompt: string | null;
  promptSource: "thread" | "thread-preview" | "not-captured" | "unavailable";
  threadId: string | null;
  runId: string | null;
  taskId: string | null;
  sourcePlatform: string | null;
  sourceId: string | null;
}

interface UsageBillingMode {
  unit: "usd" | "builder-credits";
  label: string;
  shortLabel: string;
  source: "estimated-provider-cost" | "builder-agent-credits";
  hardCostMarginMultiplier?: number;
  creditsPerUsd?: number;
}

interface DispatchUsageMetrics {
  billing?: UsageBillingMode;
  viewScope?: "me" | "workspace";
  selectedUserEmail?: string | null;
  availableUsers?: UsageUserOption[];
  sinceDays: number;
  access: {
    viewerEmail: string;
    orgId: string | null;
    role: string | null;
    scope: "organization" | "solo";
    totalUsers: number;
  };
  totals: {
    costCents: number;
    calls: number;
    chatCalls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    activeUsers: number;
    chatThreads: number;
    chatMessages: number;
    workspaceApps: number;
  };
  byApp: UsageMetricBucket[];
  byUser: UserUsageMetric[];
  byLabel: UsageMetricBucket[];
  byModel: UsageMetricBucket[];
  daily: DailyUsageMetric[];
  appAccess: AppAccessMetric[];
  recent: RecentUsageMetric[];
}

const RANGES = [7, 30, 90] as const;

const USD_BILLING: UsageBillingMode = {
  unit: "usd",
  label: "Estimated spend",
  shortLabel: "Cost",
  source: "estimated-provider-cost",
};

function displayAmountFromCostCents(
  cents: number,
  billing: UsageBillingMode,
): number {
  if (billing.unit !== "builder-credits") return cents;
  const margin = billing.hardCostMarginMultiplier ?? 1.25;
  const creditsPerUsd = billing.creditsPerUsd ?? 20;
  const credits = (cents / 100) * margin * creditsPerUsd;
  return credits <= 0 ? 0 : Math.ceil(credits * 1000) / 1000;
}

function formatCredits(credits: number): string {
  if (!Number.isFinite(credits) || credits === 0) return "0 credits";
  const maximumFractionDigits = credits < 1 ? 3 : credits < 10 ? 2 : 1;
  const value = credits.toLocaleString(undefined, {
    maximumFractionDigits,
  });
  return `${value} ${credits === 1 ? "credit" : "credits"}`;
}

function formatSpend(cents: number, billing: UsageBillingMode): string {
  if (billing.unit === "builder-credits") {
    return formatCredits(displayAmountFromCostCents(cents, billing));
  }
  if (!Number.isFinite(cents) || cents === 0) return "$0.00";
  if (Math.abs(cents) < 1) return `${cents.toFixed(3)}¢`;
  if (Math.abs(cents) < 100) return `${cents.toFixed(2)}¢`;
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10_000 ? 1 : 0,
  }).format(value);
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function timeAgo(timestamp: number | null): string {
  if (!timestamp) return "No activity";
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatTrendDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function completeTrendRows(rows: DailyUsageMetric[]): DailyUsageMetric[] {
  if (rows.length < 2) return rows;
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const start = new Date(`${rows[0].date}T12:00:00`);
  const end = new Date(`${rows[rows.length - 1].date}T12:00:00`);
  const completed: DailyUsageMetric[] = [];
  for (
    const cursor = start;
    cursor <= end;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const date = cursor.toISOString().slice(0, 10);
    completed.push(
      byDate.get(date) ?? {
        date,
        costCents: 0,
        calls: 0,
        chatCalls: 0,
        activeUsers: 0,
      },
    );
  }
  return completed;
}

function displayApp(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "unattributed") return "Unattributed";
  return trimmed;
}

function maxSpend(
  rows: Array<{ costCents: number }>,
  billing: UsageBillingMode,
): number {
  return rows.reduce(
    (max, row) =>
      Math.max(max, displayAmountFromCostCents(row.costCents, billing)),
    0,
  );
}

function barWidth(value: number, max: number): string {
  if (max <= 0 || value <= 0) return "0%";
  return `${Math.max(4, Math.round((value / max) * 100))}%`;
}

function RangeSelector({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex rounded-md bg-card p-0.5">
      {RANGES.map((range) => (
        <Button
          key={range}
          type="button"
          variant={value === range ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-3 text-xs"
          onClick={() => onChange(range)}
        >
          {range}d
        </Button>
      ))}
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-lg bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <div className="text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </div>
      <div className="mt-1 truncate text-xs text-muted-foreground">
        {detail}
      </div>
    </div>
  );
}

function Panel({
  title,
  icon,
  children,
  action,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-lg bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <h2 className="truncate text-sm font-semibold text-foreground">
            {title}
          </h2>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function LoadingMetrics() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="rounded-lg bg-card p-4">
            <Skeleton className="mb-4 h-4 w-24" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="mt-3 h-3 w-28" />
          </div>
        ))}
      </div>
      <Skeleton className="h-80 rounded-lg" />
    </div>
  );
}

function ScopeSelector({
  value,
  onChange,
}: {
  value: "me" | "workspace";
  onChange: (value: "me" | "workspace") => void;
}) {
  return (
    <div className="flex rounded-md bg-card p-0.5" aria-label="Usage scope">
      {(
        [
          ["me", "My usage"],
          ["workspace", "Workspace"],
        ] as const
      ).map(([scope, label]) => (
        <Button
          key={scope}
          type="button"
          variant={value === scope ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-3 text-xs"
          aria-pressed={value === scope}
          onClick={() => onChange(scope)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

function UserSelector({
  value,
  users,
  onChange,
}: {
  value: string | null;
  users: UsageUserOption[];
  onChange: (value: string | null) => void;
}) {
  return (
    <Select
      value={value ?? "all"}
      onValueChange={(nextValue) =>
        onChange(nextValue === "all" ? null : nextValue)
      }
    >
      <SelectTrigger
        className="h-8 w-[210px] text-xs"
        aria-label="Filter usage by user"
      >
        <SelectValue placeholder="All users" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="all">All users</SelectItem>
          {users.map((user) => (
            <SelectItem key={user.email} value={user.email}>
              {user.email}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function UsageTrend({
  rows,
  billing,
}: {
  rows: DailyUsageMetric[];
  billing: UsageBillingMode;
}) {
  const chartData = completeTrendRows(rows).map((row) => ({
    ...row,
    spend: displayAmountFromCostCents(row.costCents, billing),
  }));

  return (
    <Panel
      title={
        billing.unit === "builder-credits"
          ? "Credit usage trend"
          : "Usage trend"
      }
      icon={<IconChartBar size={16} />}
      action={
        <div className="hidden items-center gap-3 text-[11px] text-muted-foreground sm:flex">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-[hsl(var(--dispatch-brand-blue))]" />
            {billing.shortLabel}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-muted-foreground" />
            Calls
          </span>
        </div>
      }
    >
      {chartData.length === 0 ? (
        <div className="flex min-h-56 items-center justify-center rounded-md border border-dashed px-4 text-sm text-muted-foreground">
          No usage in this window yet.
        </div>
      ) : (
        <ChartContainer
          config={{
            spend: {
              label: billing.shortLabel,
              color: "hsl(var(--dispatch-brand-blue))",
            },
            calls: {
              label: "Calls",
              color: "hsl(var(--muted-foreground))",
            },
          }}
          className="h-[280px] w-full aspect-auto"
        >
          <AreaChart
            data={chartData}
            margin={{ top: 8, right: 8, left: 12, bottom: 0 }}
          >
            <defs>
              <linearGradient id="usage-trend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--color-spend)"
                  stopOpacity={0.24}
                />
                <stop
                  offset="100%"
                  stopColor="var(--color-spend)"
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke="hsl(var(--border))"
              strokeDasharray="3 3"
            />
            <XAxis
              dataKey="date"
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              axisLine={false}
              tickLine={false}
              tickMargin={8}
              minTickGap={28}
              tickFormatter={formatTrendDate}
            />
            <YAxis
              yAxisId="spend"
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              axisLine={false}
              tickLine={false}
              tickMargin={8}
              width={50}
              tickFormatter={(value) =>
                billing.unit === "builder-credits"
                  ? formatCredits(Number(value))
                  : formatSpend(Number(value), billing)
              }
            />
            <YAxis yAxisId="calls" orientation="right" hide />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => formatTrendDate(String(value))}
                  formatter={(value, name) => [
                    name === "spend"
                      ? billing.unit === "builder-credits"
                        ? formatCredits(Number(value))
                        : formatSpend(Number(value), billing)
                      : `${formatNumber(Number(value))} calls`,
                    name === "spend" ? billing.shortLabel : "Calls",
                  ]}
                />
              }
            />
            <Area
              yAxisId="spend"
              dataKey="spend"
              type="monotone"
              stroke="var(--color-spend)"
              strokeWidth={2}
              fill="url(#usage-trend-fill)"
              fillOpacity={1}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2 }}
              isAnimationActive={false}
            />
            <Area
              yAxisId="calls"
              dataKey="calls"
              type="monotone"
              stroke="var(--color-calls)"
              strokeWidth={1.5}
              fill="none"
              dot={false}
              activeDot={{ r: 3, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </Panel>
  );
}

function ReviewUsageButton({
  metrics,
  billing,
}: {
  metrics: DispatchUsageMetrics;
  billing: UsageBillingMode;
}) {
  function reviewUsage() {
    const topApps = metrics.byApp
      .slice(0, 5)
      .map(
        (row) =>
          `${displayApp(row.key)}: ${formatSpend(row.costCents, billing)} / ${row.calls} calls`,
      )
      .join("; ");
    const topLabels = metrics.byLabel
      .slice(0, 5)
      .map(
        (row) =>
          `${row.label}: ${formatSpend(row.costCents, billing)} / ${row.calls} calls`,
      )
      .join("; ");
    const recentPrompts = metrics.recent
      .slice(0, 8)
      .map((row) => {
        const prompt = row.prompt
          ? row.prompt.slice(0, 180)
          : "prompt not captured";
        return `${timeAgo(row.createdAt)} | ${displayApp(row.app)} | ${row.label} | ${prompt}`;
      })
      .join("\n");

    sendToAgentChat({
      message:
        "Review this LLM usage and explain where the spend is going. Identify repeated, background, or unexpectedly expensive work, cite the strongest evidence, and suggest concrete fixes. Call out missing attribution instead of guessing.",
      context: [
        `Dispatch usage scope: ${metrics.viewScope === "workspace" ? "workspace" : "my account"}.`,
        `Lookback: ${metrics.sinceDays} days. Viewer: ${metrics.access.viewerEmail}.`,
        `Total: ${formatSpend(metrics.totals.costCents, billing)}, ${metrics.totals.calls} calls, ${metrics.totals.chatCalls} chat calls, ${formatTokens(metrics.totals.inputTokens + metrics.totals.outputTokens)} input/output tokens.`,
        `Top apps: ${topApps || "none"}.`,
        `Top work types: ${topLabels || "none"}.`,
        `Recent prompt evidence (bounded to the latest 8 rows):\n${recentPrompts || "none"}`,
      ].join("\n"),
      submit: true,
      openSidebar: true,
      chatTarget: "local",
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={reviewUsage}>
      Ask agent
    </Button>
  );
}

function AppSpendRows({
  rows,
  billing,
}: {
  rows: UsageMetricBucket[];
  billing: UsageBillingMode;
}) {
  const max = maxSpend(rows, billing);
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground">
        No LLM usage recorded for this window.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.key} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">
                {displayApp(row.key)}
              </div>
              <div className="text-xs text-muted-foreground">
                {formatNumber(row.chatCalls)} chats ·{" "}
                {formatNumber(row.activeUsers)} users
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-medium tabular-nums text-foreground">
                {formatSpend(row.costCents, billing)}
              </div>
              <div className="text-xs text-muted-foreground">
                {formatNumber(row.calls)} calls
              </div>
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-foreground"
              style={{
                width: barWidth(
                  displayAmountFromCostCents(row.costCents, billing),
                  max,
                ),
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function AppAccessTable({
  rows,
  billing,
}: {
  rows: AppAccessMetric[];
  billing: UsageBillingMode;
}) {
  const visibleRows = rows.filter((row) => !row.isDispatch);
  if (visibleRows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground">
        No workspace apps discovered yet.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="px-2 py-2 font-medium">App</th>
            <th className="px-2 py-2 font-medium">Access</th>
            <th className="px-2 py-2 text-right font-medium">Users</th>
            <th className="px-2 py-2 text-right font-medium">Chats</th>
            <th className="px-2 py-2 text-right font-medium">
              {billing.shortLabel}
            </th>
            <th className="px-2 py-2 text-right font-medium">Last activity</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr key={row.id} className="border-b last:border-0">
              <td className="px-2 py-3">
                <div className="font-medium text-foreground">{row.name}</div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  {row.path}
                </div>
              </td>
              <td className="px-2 py-3">
                <Badge
                  variant="outline"
                  className={cn(
                    row.status === "pending" &&
                      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                  )}
                >
                  {row.status === "pending"
                    ? row.statusLabel || "Builder branch"
                    : row.accessLabel}
                </Badge>
              </td>
              <td className="px-2 py-3 text-right tabular-nums">
                {formatNumber(row.usersWithUsage)} /{" "}
                {formatNumber(row.accessUsers)}
              </td>
              <td className="px-2 py-3 text-right tabular-nums">
                {formatNumber(row.chatCalls)}
              </td>
              <td className="px-2 py-3 text-right tabular-nums">
                {formatSpend(row.costCents, billing)}
              </td>
              <td className="px-2 py-3 text-right text-muted-foreground">
                {timeAgo(row.lastActiveAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserTable({
  rows,
  billing,
}: {
  rows: UserUsageMetric[];
  billing: UsageBillingMode;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground">
        No users have triggered LLM usage in this window.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="px-2 py-2 font-medium">User</th>
            <th className="px-2 py-2 font-medium">Role</th>
            <th className="px-2 py-2 font-medium">Top app</th>
            <th className="px-2 py-2 text-right font-medium">Chats</th>
            <th className="px-2 py-2 text-right font-medium">Threads</th>
            <th className="px-2 py-2 text-right font-medium">Tokens</th>
            <th className="px-2 py-2 text-right font-medium">
              {billing.shortLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 12).map((row) => (
            <tr key={row.ownerEmail} className="border-b last:border-0">
              <td className="max-w-64 px-2 py-3">
                <div className="truncate font-medium text-foreground">
                  {row.ownerEmail}
                </div>
                <div className="text-muted-foreground">
                  {timeAgo(row.lastActiveAt ?? row.lastChatAt)}
                </div>
              </td>
              <td className="px-2 py-3">
                <Badge variant="secondary">{row.role ?? "user"}</Badge>
              </td>
              <td className="px-2 py-3 text-muted-foreground">
                {displayApp(row.topApp)}
              </td>
              <td className="px-2 py-3 text-right tabular-nums">
                {formatNumber(row.chatCalls)}
              </td>
              <td className="px-2 py-3 text-right tabular-nums">
                {formatNumber(row.chatThreads)}
              </td>
              <td className="px-2 py-3 text-right tabular-nums">
                {formatTokens(row.inputTokens + row.outputTokens)}
              </td>
              <td className="px-2 py-3 text-right tabular-nums">
                {formatSpend(row.costCents, billing)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompactBreakdown({
  rows,
  empty,
  billing,
}: {
  rows: UsageMetricBucket[];
  empty: string;
  billing: UsageBillingMode;
}) {
  const max = maxSpend(rows, billing);
  if (rows.length === 0) {
    return <div className="text-sm text-muted-foreground">{empty}</div>;
  }
  return (
    <div className="space-y-3">
      {rows.slice(0, 6).map((row) => (
        <div key={row.key} className="space-y-1">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="truncate font-medium text-foreground">
              {row.label}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatSpend(row.costCents, billing)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-muted-foreground"
              style={{
                width: barWidth(
                  displayAmountFromCostCents(row.costCents, billing),
                  max,
                ),
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function RecentTable({
  rows,
  billing,
}: {
  rows: RecentUsageMetric[];
  billing: UsageBillingMode;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground">
        No prompts or LLM calls in this window.
      </div>
    );
  }
  return (
    <div className="divide-y">
      {rows.slice(0, 10).map((row) => (
        <article key={row.id} className="-mx-1 px-1 py-3 first:pt-0 last:pb-0">
          <div className="flex items-start justify-between gap-4">
            <p className="min-w-0 whitespace-pre-wrap text-sm leading-6 text-foreground">
              {row.prompt ||
                (row.promptSource === "unavailable"
                  ? "Prompt unavailable - linked thread data could not be read."
                  : "Prompt not captured for this call.")}
            </p>
            <span className="shrink-0 text-xs text-muted-foreground">
              {timeAgo(row.createdAt)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="outline">{displayApp(row.app)}</Badge>
            <Badge variant="secondary">{row.label}</Badge>
            <span>{row.model}</span>
            <span aria-hidden="true">·</span>
            <span>{formatSpend(row.costCents, billing)}</span>
            {row.ownerEmail ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="max-w-64 truncate">{row.ownerEmail}</span>
              </>
            ) : null}
            {row.threadId ? (
              <Link
                to={`/admin/thread-debug?threadId=${encodeURIComponent(row.threadId)}`}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium text-foreground transition-colors hover:bg-muted"
              >
                Inspect thread
                <IconArrowUpRight size={12} />
              </Link>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

export default function MetricsRoute() {
  const t = useT();
  const [sinceDays, setSinceDays] = useState(30);
  const [searchParams, setSearchParams] = useSearchParams();
  const scope: "me" | "workspace" =
    searchParams.get("scope") === "workspace" ? "workspace" : "me";
  const userEmail =
    scope === "workspace" ? searchParams.get("user") || null : null;

  function setScope(nextScope: "me" | "workspace") {
    const next = new URLSearchParams(searchParams);
    if (nextScope === "me") next.delete("scope");
    else next.set("scope", nextScope);
    if (nextScope === "me") next.delete("user");
    setSearchParams(next, { replace: true });
  }

  function setUserEmail(nextUserEmail: string | null) {
    const next = new URLSearchParams(searchParams);
    if (nextUserEmail) next.set("user", nextUserEmail);
    else next.delete("user");
    setSearchParams(next, { replace: true });
  }

  const { data, isLoading, error } = useActionQuery(
    "list-dispatch-usage-metrics",
    { sinceDays, scope, userEmail: userEmail ?? undefined },
  );
  const metrics = data as DispatchUsageMetrics | undefined;
  const billing = metrics?.billing ?? USD_BILLING;
  const totalTokens = useMemo(() => {
    if (!metrics) return 0;
    return (
      metrics.totals.inputTokens +
      metrics.totals.outputTokens +
      metrics.totals.cacheReadTokens +
      metrics.totals.cacheWriteTokens
    );
  }, [metrics]);

  return (
    <DispatchShell
      title={t("dispatch.nav.metrics")}
      description={
        billing.unit === "builder-credits"
          ? t("dispatch.pages.metricsDescriptionBuilder")
          : t("dispatch.pages.metricsDescriptionLlm")
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-foreground">
              {metrics?.selectedUserEmail
                ? `${metrics.selectedUserEmail}'s usage`
                : scope === "workspace"
                  ? "Workspace usage"
                  : "Your usage"}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {metrics?.selectedUserEmail
                ? "Filtered to this workspace member"
                : scope === "workspace"
                  ? `${metrics?.access.totalUsers ?? 0} users with access`
                  : metrics?.access.viewerEmail || "Signed-in account"}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ScopeSelector value={scope} onChange={setScope} />
            {scope === "workspace" && metrics ? (
              <UserSelector
                value={metrics.selectedUserEmail ?? userEmail}
                users={metrics.availableUsers ?? []}
                onChange={setUserEmail}
              />
            ) : null}
            <RangeSelector value={sinceDays} onChange={setSinceDays} />
          </div>
        </div>

        {error ? (
          <Alert variant="destructive">
            <IconAlertTriangle className="h-4 w-4" />
            <AlertTitle>{t("dispatch.pages.metricsUnavailable")}</AlertTitle>
            <AlertDescription>
              {error instanceof Error
                ? error.message
                : t("dispatch.pages.unableToLoadUsage")}
            </AlertDescription>
          </Alert>
        ) : null}

        {isLoading && !metrics ? <LoadingMetrics /> : null}

        {metrics ? (
          <>
            <UsageTrend rows={metrics.daily} billing={billing} />

            <div className="flex items-center justify-between gap-3 border-y py-3">
              <span className="text-sm text-muted-foreground">
                Review this usage with the agent
              </span>
              <ReviewUsageButton metrics={metrics} billing={billing} />
            </div>

            <UsageAlertsPanel
              scope={scope === "workspace" ? "workspace" : "user"}
              appOptions={metrics.byApp
                .filter((row) => row.key && row.key !== "unattributed")
                .map((row) => ({ id: row.key, label: displayApp(row.key) }))}
            />

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <MetricCard
                label={billing.label}
                value={formatSpend(metrics.totals.costCents, billing)}
                detail={`${formatTokens(totalTokens)} total tokens`}
                icon={<IconCoin size={17} />}
              />
              <MetricCard
                label={t("dispatch.pages.llmCalls")}
                value={formatNumber(metrics.totals.calls)}
                detail={`${formatNumber(metrics.totals.chatCalls)} chat turns`}
                icon={<IconActivity size={17} />}
              />
              <MetricCard
                label={t("dispatch.pages.activeUsers")}
                value={formatNumber(metrics.totals.activeUsers)}
                detail={`${formatNumber(metrics.access.totalUsers)} users with access`}
                icon={<IconUsersGroup size={17} />}
              />
              <MetricCard
                label={t("dispatch.pages.workspaceAppsStat")}
                value={formatNumber(metrics.totals.workspaceApps)}
                detail={`${formatNumber(metrics.byApp.length)} with usage`}
                icon={<IconApps size={17} />}
              />
              <MetricCard
                label={t("dispatch.pages.chatThreads")}
                value={formatNumber(metrics.totals.chatThreads)}
                detail={`${formatNumber(metrics.totals.chatMessages)} messages`}
                icon={<IconMessages size={17} />}
              />
            </div>

            <Panel
              title={
                billing.unit === "builder-credits"
                  ? "Credit spend by app"
                  : "Spend by app"
              }
              icon={<IconApps size={16} />}
            >
              <AppSpendRows rows={metrics.byApp} billing={billing} />
            </Panel>

            <Panel
              title="Recent prompts"
              icon={<IconMessages size={16} />}
              action={
                <span className="text-xs text-muted-foreground">
                  Latest {Math.min(metrics.recent.length, 10)} of{" "}
                  {metrics.recent.length}
                </span>
              }
            >
              <RecentTable rows={metrics.recent} billing={billing} />
            </Panel>

            <Panel title="Access By App" icon={<IconApps size={16} />}>
              <AppAccessTable rows={metrics.appAccess} billing={billing} />
            </Panel>

            <Panel title="Users" icon={<IconUsersGroup size={16} />}>
              <UserTable rows={metrics.byUser} billing={billing} />
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Models" icon={<IconChartBar size={16} />}>
                <CompactBreakdown
                  rows={metrics.byModel}
                  empty="No model usage in this window."
                  billing={billing}
                />
              </Panel>
              <Panel title="Work Types" icon={<IconActivity size={16} />}>
                <CompactBreakdown
                  rows={metrics.byLabel}
                  empty="No labeled usage in this window."
                  billing={billing}
                />
              </Panel>
            </div>
          </>
        ) : null}
      </div>
    </DispatchShell>
  );
}
