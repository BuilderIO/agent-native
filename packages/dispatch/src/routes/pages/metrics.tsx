import { useMemo, useState, type ReactNode } from "react";
import { useActionQuery } from "@agent-native/core/client";
import {
  IconActivity,
  IconAlertTriangle,
  IconApps,
  IconChartBar,
  IconClockHour4,
  IconCoin,
  IconMessages,
  IconUsersGroup,
} from "@tabler/icons-react";
import { DispatchShell } from "@/components/dispatch-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

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

interface AppAccessMetric {
  id: string;
  name: string;
  path: string;
  status?: "ready" | "pending";
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
}

interface DispatchUsageMetrics {
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

function formatCost(cents: number): string {
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

function displayApp(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "unattributed") return "Unattributed";
  return trimmed;
}

function maxCost(rows: Array<{ costCents: number }>): number {
  return rows.reduce((max, row) => Math.max(max, row.costCents), 0);
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
    <div className="flex rounded-md border bg-card p-0.5">
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
    <div className="rounded-lg border bg-card p-4">
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
    <section className="rounded-lg border bg-card">
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
          <div key={index} className="rounded-lg border bg-card p-4">
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

function AppSpendRows({ rows }: { rows: UsageMetricBucket[] }) {
  const max = maxCost(rows);
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
                {formatCost(row.costCents)}
              </div>
              <div className="text-xs text-muted-foreground">
                {formatNumber(row.calls)} calls
              </div>
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-foreground"
              style={{ width: barWidth(row.costCents, max) }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function DailyActivity({ rows }: { rows: DailyUsageMetric[] }) {
  const max = Math.max(
    1,
    rows.reduce((value, row) => Math.max(value, row.calls), 0),
  );
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground">
        No activity in this window.
      </div>
    );
  }
  return (
    <div className="flex h-44 items-end gap-1">
      {rows.map((row) => (
        <div
          key={row.date}
          className="group flex min-w-0 flex-1 flex-col items-center gap-2"
        >
          <div className="relative flex h-36 w-full items-end rounded-sm bg-muted/60">
            <div
              className="w-full rounded-sm bg-foreground transition group-hover:bg-primary"
              style={{ height: `${Math.max(4, (row.calls / max) * 100)}%` }}
            />
          </div>
          <div className="hidden text-[10px] text-muted-foreground sm:block">
            {row.date.slice(5)}
          </div>
        </div>
      ))}
    </div>
  );
}

function AppAccessTable({ rows }: { rows: AppAccessMetric[] }) {
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
            <th className="px-2 py-2 text-right font-medium">Cost</th>
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
                  {row.status === "pending" ? "Building" : row.accessLabel}
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
                {formatCost(row.costCents)}
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

function UserTable({ rows }: { rows: UserUsageMetric[] }) {
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
            <th className="px-2 py-2 text-right font-medium">Cost</th>
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
                {formatCost(row.costCents)}
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
}: {
  rows: UsageMetricBucket[];
  empty: string;
}) {
  const max = maxCost(rows);
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
              {formatCost(row.costCents)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-muted-foreground"
              style={{ width: barWidth(row.costCents, max) }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function RecentTable({ rows }: { rows: RecentUsageMetric[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground">
        No recent LLM calls.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="px-2 py-2 font-medium">When</th>
            <th className="px-2 py-2 font-medium">User</th>
            <th className="px-2 py-2 font-medium">App</th>
            <th className="px-2 py-2 font-medium">Label</th>
            <th className="px-2 py-2 font-medium">Model</th>
            <th className="px-2 py-2 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 10).map((row) => (
            <tr key={row.id} className="border-b last:border-0">
              <td className="px-2 py-3 text-muted-foreground">
                {timeAgo(row.createdAt)}
              </td>
              <td className="max-w-56 px-2 py-3">
                <div className="truncate text-foreground">{row.ownerEmail}</div>
              </td>
              <td className="px-2 py-3 text-muted-foreground">
                {displayApp(row.app)}
              </td>
              <td className="px-2 py-3">
                <Badge variant="outline">{row.label}</Badge>
              </td>
              <td className="max-w-48 px-2 py-3">
                <div className="truncate text-muted-foreground">
                  {row.model}
                </div>
              </td>
              <td className="px-2 py-3 text-right tabular-nums">
                {formatCost(row.costCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MetricsRoute() {
  const [sinceDays, setSinceDays] = useState(30);
  const { data, isLoading, error } = useActionQuery(
    "list-dispatch-usage-metrics",
    { sinceDays },
    { refetchInterval: 30_000 },
  );
  const metrics = data as DispatchUsageMetrics | undefined;
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
      title="Metrics"
      description="Workspace-wide LLM spend, chat volume, user activity, and app access."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {metrics?.access.scope === "organization"
              ? `${metrics.access.totalUsers} workspace users`
              : `${metrics?.access.totalUsers ?? 0} signed-in users`}
          </div>
          <RangeSelector value={sinceDays} onChange={setSinceDays} />
        </div>

        {error ? (
          <Alert variant="destructive">
            <IconAlertTriangle className="h-4 w-4" />
            <AlertTitle>Metrics unavailable</AlertTitle>
            <AlertDescription>
              {error instanceof Error ? error.message : "Unable to load usage."}
            </AlertDescription>
          </Alert>
        ) : null}

        {isLoading && !metrics ? <LoadingMetrics /> : null}

        {metrics ? (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <MetricCard
                label="Estimated spend"
                value={formatCost(metrics.totals.costCents)}
                detail={`${formatTokens(totalTokens)} total tokens`}
                icon={<IconCoin size={17} />}
              />
              <MetricCard
                label="LLM calls"
                value={formatNumber(metrics.totals.calls)}
                detail={`${formatNumber(metrics.totals.chatCalls)} chat turns`}
                icon={<IconActivity size={17} />}
              />
              <MetricCard
                label="Active users"
                value={formatNumber(metrics.totals.activeUsers)}
                detail={`${formatNumber(metrics.access.totalUsers)} users with access`}
                icon={<IconUsersGroup size={17} />}
              />
              <MetricCard
                label="Workspace apps"
                value={formatNumber(metrics.totals.workspaceApps)}
                detail={`${formatNumber(metrics.byApp.length)} with usage`}
                icon={<IconApps size={17} />}
              />
              <MetricCard
                label="Chat threads"
                value={formatNumber(metrics.totals.chatThreads)}
                detail={`${formatNumber(metrics.totals.chatMessages)} messages`}
                icon={<IconMessages size={17} />}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
              <Panel title="Spend By App" icon={<IconChartBar size={16} />}>
                <AppSpendRows rows={metrics.byApp} />
              </Panel>
              <Panel title="Daily Activity" icon={<IconClockHour4 size={16} />}>
                <DailyActivity rows={metrics.daily} />
              </Panel>
            </div>

            <Panel title="Access By App" icon={<IconApps size={16} />}>
              <AppAccessTable rows={metrics.appAccess} />
            </Panel>

            <Panel title="Users" icon={<IconUsersGroup size={16} />}>
              <UserTable rows={metrics.byUser} />
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Models" icon={<IconChartBar size={16} />}>
                <CompactBreakdown
                  rows={metrics.byModel}
                  empty="No model usage in this window."
                />
              </Panel>
              <Panel title="Work Types" icon={<IconActivity size={16} />}>
                <CompactBreakdown
                  rows={metrics.byLabel}
                  empty="No labeled usage in this window."
                />
              </Panel>
            </div>

            <Panel title="Recent LLM Calls" icon={<IconActivity size={16} />}>
              <RecentTable rows={metrics.recent} />
            </Panel>
          </>
        ) : null}
      </div>
    </DispatchShell>
  );
}
