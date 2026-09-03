import { Skeleton } from "@agent-native/toolkit/design-system";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import { Checkbox } from "@agent-native/toolkit/ui/checkbox";
import { Input } from "@agent-native/toolkit/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import {
  IconArrowUpRight,
  IconBell,
  IconChartLine,
  IconChevronDown,
  IconLoader2,
  IconMail,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";

import { useActionMutation, useActionQuery } from "../use-action.js";

type UsageScope = "me" | "workspace";
type AlertUnit = "usd" | "builder-credits" | "tokens";
type AlertPeriod = "day" | "month";
type AlertChannel = "in-app" | "email";

interface UsageBilling {
  unit: "usd" | "builder-credits";
  label: string;
  hardCostMarginMultiplier?: number;
  creditsPerUsd?: number;
}

interface UsageMetricBucket {
  key: string;
  label: string;
  costCents: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  activeUsers: number;
}

interface UsageDailyMetric {
  date: string;
  costCents: number;
  calls: number;
  tokens: number;
}

interface UsageRecentMetric {
  id: number;
  createdAt: number;
  ownerEmail: string;
  app: string;
  label: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  prompt: string | null;
}

interface UsageMetricsData {
  billing: UsageBilling;
  app: string;
  viewScope: UsageScope;
  selectedUserEmail: string | null;
  availableUsers: Array<{ email: string; role: string | null }>;
  access: {
    canViewWorkspace: boolean;
    totalUsers: number;
  };
  totals: {
    costCents: number;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    activeUsers: number;
  };
  currentDay: {
    costCents: number;
    credits: number;
    calls: number;
    tokens: number;
  };
  byLabel: UsageMetricBucket[];
  byModel: UsageMetricBucket[];
  daily: UsageDailyMetric[];
  recent: UsageRecentMetric[];
}

interface UsageAlertRule {
  id: string;
  appId: string | null;
  unit: AlertUnit;
  period: AlertPeriod;
  limit: number;
  channels: AlertChannel[];
  enabled: boolean;
  isDefault: boolean;
  status: "ok" | "triggered" | "dismissed";
  current: number;
  percent: number;
  dismissedAt: number | null;
}

interface AlertDraft {
  ruleId?: string;
  appId: string | null;
  unit: AlertUnit;
  period: AlertPeriod;
  limit: string;
  inApp: boolean;
  email: boolean;
}

interface AlertMutationInput {
  operation: "save" | "set-enabled" | "dismiss";
  scope: "user" | "workspace";
  ruleId?: string;
  appId?: string | null;
  unit?: AlertUnit;
  period?: AlertPeriod;
  limit?: number;
  channels?: AlertChannel[];
  enabled?: boolean;
}

interface AlertMutationResult {
  rule?: UsageAlertRule;
}

const LOOKBACKS = [
  { value: 7, label: "7d" },
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
] as const;

function asAlertRules(value: unknown): UsageAlertRule[] {
  if (Array.isArray(value)) return value as UsageAlertRule[];
  if (value && typeof value === "object") {
    const rules = (value as { rules?: unknown }).rules;
    if (Array.isArray(rules)) return rules as UsageAlertRule[];
  }
  return [];
}

function compactNumber(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.round(value).toLocaleString();
}

function formatCost(cents: number, billing: UsageBilling): string {
  if (billing.unit === "builder-credits") {
    const credits =
      (cents / 100) *
      (billing.hardCostMarginMultiplier ?? 1.25) *
      (billing.creditsPerUsd ?? 20);
    return `${credits.toLocaleString(undefined, { maximumFractionDigits: 1 })} credits`;
  }
  if (cents < 100) return `${cents.toFixed(2)}¢`;
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatAlertValue(rule: UsageAlertRule, value: number): string {
  if (rule.unit === "usd") {
    return value.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    });
  }
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: rule.unit === "tokens" ? 0 : 2,
  })} ${rule.unit === "builder-credits" ? "credits" : "tokens"}`;
}

function appLabel(value: string | null | undefined): string {
  if (!value) return "All apps";
  const normalized = value.replace(/^agent-native-/i, "").replaceAll("-", " ");
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Trend({
  daily,
  billing,
}: {
  daily: UsageDailyMetric[];
  billing: UsageBilling;
}) {
  if (daily.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground">
        No usage recorded in this lookback.
      </div>
    );
  }

  const values = daily.map((day) =>
    billing.unit === "builder-credits"
      ? (day.costCents / 100) *
        (billing.hardCostMarginMultiplier ?? 1.25) *
        (billing.creditsPerUsd ?? 20)
      : day.costCents,
  );
  const max = Math.max(...values, 0.01);
  const points = values.map((value, index) => {
    const x = daily.length === 1 ? 50 : (index / (daily.length - 1)) * 100;
    const y = 88 - (value / max) * 72;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point}`)
    .join(" ");
  const area = `${line} L 100,96 L 0,96 Z`;

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-muted/20 px-3 pb-2 pt-3">
      <svg
        aria-label="Daily usage trend"
        className="h-32 w-full text-primary"
        viewBox="0 0 100 96"
        preserveAspectRatio="none"
        role="img"
      >
        <path d={area} className="fill-current opacity-10" />
        <path
          d={line}
          className="fill-none stroke-current"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>
          {new Date(`${daily[0]!.date}T00:00:00`).toLocaleDateString(
            undefined,
            { month: "short", day: "numeric" },
          )}
        </span>
        <span>
          {new Date(`${daily.at(-1)!.date}T00:00:00`).toLocaleDateString(
            undefined,
            { month: "short", day: "numeric" },
          )}
        </span>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  accent = false,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-card px-4 py-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div
        className={`mt-1 truncate text-xl font-semibold tracking-[-0.02em] tabular-nums ${accent ? "text-primary" : "text-foreground"}`}
      >
        {value}
      </div>
      <div className="mt-1 truncate text-xs text-muted-foreground">
        {detail}
      </div>
    </div>
  );
}

function DriverList({
  title,
  rows,
  billing,
}: {
  title: string;
  rows: UsageMetricBucket[];
  billing: UsageBilling;
}) {
  const max = Math.max(...rows.map((row) => row.costCents), 1);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
          Spend
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No usage recorded yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.slice(0, 5).map((row) => (
            <div key={row.key}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span
                  className="min-w-0 truncate text-foreground"
                  title={row.label}
                >
                  {row.label}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatCost(row.costCents, billing)}
                </span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/70"
                  style={{
                    width: `${Math.max(4, (row.costCents / max) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UsageLoadingState() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading usage">
      <div className="grid gap-3 sm:grid-cols-3">
        {["w-24", "w-16", "w-20"].map((width) => (
          <div key={width} className="rounded-lg border border-border/70 p-4">
            <Skeleton className={`h-3 ${width}`} />
            <Skeleton className="mt-3 h-6 w-24" />
            <Skeleton className="mt-2 h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-border/70 p-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-3 h-32 w-full" />
      </div>
    </div>
  );
}

function AlertEditor({
  draft,
  onChange,
  onSave,
  onCancel,
  isPending,
}: {
  draft: AlertDraft;
  onChange: (patch: Partial<AlertDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const channelCount = Number(draft.inApp) + Number(draft.email);
  return (
    <div className="mt-3 rounded-lg border border-border/70 bg-muted/20 p-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr]">
        <label className="space-y-1.5 text-xs text-muted-foreground">
          <span>Unit</span>
          <Select
            value={draft.unit}
            onValueChange={(value) => onChange({ unit: value as AlertUnit })}
          >
            <SelectTrigger className="h-9 bg-background text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="usd">Dollars</SelectItem>
              <SelectItem value="builder-credits">Builder credits</SelectItem>
              <SelectItem value="tokens">Tokens</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1.5 text-xs text-muted-foreground">
          <span>Threshold</span>
          <Input
            type="number"
            min="0.01"
            step={draft.unit === "tokens" ? "1" : "0.01"}
            value={draft.limit}
            onChange={(event) => onChange({ limit: event.target.value })}
            className="h-9 bg-background text-sm"
          />
        </label>
        <label className="space-y-1.5 text-xs text-muted-foreground">
          <span>Window</span>
          <Select
            value={draft.period}
            onValueChange={(value) =>
              onChange({ period: value as AlertPeriod })
            }
          >
            <SelectTrigger className="h-9 bg-background text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Per day</SelectItem>
              <SelectItem value="month">Per month</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Deliver via</span>
        <label className="inline-flex items-center gap-2">
          <Checkbox
            checked={draft.inApp}
            onCheckedChange={(checked) => onChange({ inApp: checked === true })}
          />
          <IconBell className="size-3.5" /> In app
        </label>
        <label className="inline-flex items-center gap-2">
          <Checkbox
            checked={draft.email}
            onCheckedChange={(checked) => onChange({ email: checked === true })}
          />
          <IconMail className="size-3.5" /> Email
        </label>
        <div className="ms-auto flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={isPending || channelCount === 0}
          >
            {isPending ? <IconLoader2 className="animate-spin" /> : null}
            Save alert
          </Button>
        </div>
      </div>
    </div>
  );
}

function UsageAlertsSection({ appId }: { appId: string | null }) {
  const query = useActionQuery<unknown>("get-usage-alerts", {
    scope: "user",
    appId,
  });
  const mutation = useActionMutation<AlertMutationResult, AlertMutationInput>(
    "manage-usage-alert",
  );
  const [editing, setEditing] = useState<AlertDraft | null>(null);
  const rules = asAlertRules(query.data);

  function saveDraft() {
    if (!editing) return;
    const limit = Number(editing.limit);
    const channels: AlertChannel[] = [];
    if (editing.inApp) channels.push("in-app");
    if (editing.email) channels.push("email");
    if (!Number.isFinite(limit) || limit <= 0 || channels.length === 0) return;
    mutation.mutate({
      operation: "save",
      scope: "user",
      ruleId: editing.ruleId,
      appId: editing.appId,
      unit: editing.unit,
      period: editing.period,
      limit,
      channels,
      enabled: true,
    });
    setEditing(null);
  }

  function editRule(rule: UsageAlertRule) {
    setEditing({
      ruleId: rule.id,
      appId: rule.appId,
      unit: rule.unit,
      period: rule.period,
      limit: String(rule.limit),
      inApp: rule.channels.includes("in-app"),
      email: rule.channels.includes("email"),
    });
  }

  return (
    <section className="rounded-lg border border-border/70 bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary">
            <IconBell className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Usage alerts
            </h2>
            <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
              Inherited defaults and app-specific thresholds for this app.
            </p>
          </div>
        </div>
        {appId ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setEditing({
                appId,
                unit: "usd",
                period: "day",
                limit: "100",
                inApp: true,
                email: true,
              })
            }
            disabled={mutation.isPending}
          >
            <IconPlus /> Add app alert
          </Button>
        ) : null}
      </div>
      <div className="divide-y divide-border/70">
        {query.isLoading && rules.length === 0 ? (
          <div className="space-y-3 px-4 py-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-72" />
          </div>
        ) : null}
        {query.isError ? (
          <div className="px-4 py-5 text-sm text-destructive">
            Usage alerts are unavailable for this account.
          </div>
        ) : null}
        {!query.isLoading && !query.isError && rules.length === 0 ? (
          <div className="px-4 py-5 text-sm text-muted-foreground">
            No alert rules are configured.
          </div>
        ) : null}
        {rules.map((rule) => {
          const isEditing = editing?.ruleId === rule.id;
          const statusLabel =
            rule.status === "triggered"
              ? "Over limit"
              : rule.status === "dismissed"
                ? "Dismissed"
                : "On track";
          return (
            <div key={rule.id} className="px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {rule.isDefault ? "All apps" : appLabel(rule.appId)}
                    </span>
                    {rule.isDefault ? (
                      <Badge variant="secondary">Inherited default</Badge>
                    ) : null}
                    <Badge
                      variant={
                        rule.status === "triggered"
                          ? "destructive"
                          : rule.status === "dismissed"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {statusLabel}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatAlertValue(rule, rule.current)} of{" "}
                    {formatAlertValue(rule, rule.limit)} · per {rule.period}
                    {rule.percent > 0 ? ` · ${rule.percent}%` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                    {rule.channels.includes("in-app") ? (
                      <span className="inline-flex items-center gap-1">
                        <IconBell className="size-3.5" /> In app
                      </span>
                    ) : null}
                    {rule.channels.includes("email") ? (
                      <span className="inline-flex items-center gap-1">
                        <IconMail className="size-3.5" /> Email
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={rule.enabled}
                    onCheckedChange={(checked) =>
                      mutation.mutate({
                        operation: "set-enabled",
                        scope: "user",
                        ruleId: rule.id,
                        enabled: checked === true,
                      })
                    }
                    aria-label={`${rule.enabled ? "Disable" : "Enable"} usage alert`}
                    disabled={mutation.isPending}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => editRule(rule)}
                    aria-label="Edit usage alert"
                    disabled={mutation.isPending}
                  >
                    <IconPencil />
                  </Button>
                  {rule.status === "triggered" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        mutation.mutate({
                          operation: "dismiss",
                          scope: "user",
                          ruleId: rule.id,
                        })
                      }
                      aria-label="Dismiss usage alert"
                      disabled={mutation.isPending}
                    >
                      <IconX />
                    </Button>
                  ) : null}
                </div>
              </div>
              {isEditing && editing ? (
                <AlertEditor
                  draft={editing}
                  onChange={(patch) =>
                    setEditing((current) =>
                      current ? { ...current, ...patch } : current,
                    )
                  }
                  onSave={saveDraft}
                  onCancel={() => setEditing(null)}
                  isPending={mutation.isPending}
                />
              ) : null}
            </div>
          );
        })}
        {editing && !editing.ruleId ? (
          <div className="px-4 py-4">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              {appLabel(editing.appId)}
            </div>
            <AlertEditor
              draft={editing}
              onChange={(patch) =>
                setEditing((current) =>
                  current ? { ...current, ...patch } : current,
                )
              }
              onSave={saveDraft}
              onCancel={() => setEditing(null)}
              isPending={mutation.isPending}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function UsageSection({
  appId = null,
  viewAllHref,
}: {
  appId?: string | null;
  viewAllHref?: string;
}) {
  const [sinceDays, setSinceDays] = useState(30);
  const [scope, setScope] = useState<UsageScope>("me");
  const [selectedUserEmail, setSelectedUserEmail] = useState<string | null>(
    null,
  );
  const query = useActionQuery<UsageMetricsData>("get-usage-metrics", {
    sinceDays,
    scope,
    userEmail:
      scope === "workspace" ? (selectedUserEmail ?? undefined) : undefined,
    appId: appId ?? undefined,
  });
  const data = query.data;
  const billing = data?.billing ?? {
    unit: "usd" as const,
    label: "Estimated spend",
  };
  const totalTokens = data
    ? data.totals.inputTokens +
      data.totals.outputTokens +
      (data.totals.cacheReadTokens ?? 0) +
      (data.totals.cacheWriteTokens ?? 0)
    : 0;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="flex flex-col gap-4 border-b border-border/70 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.1em] text-primary">
            <IconChartLine className="size-4" /> Usage
          </div>
          <h1 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-foreground">
            {appLabel(appId)} usage
          </h1>
          <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
            A focused view of spend, capacity, and the prompts driving this app.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data?.access.canViewWorkspace ? (
            <Select
              value={scope}
              onValueChange={(value) => {
                setScope(value as UsageScope);
                setSelectedUserEmail(null);
              }}
            >
              <SelectTrigger className="h-9 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="me">My usage</SelectItem>
                <SelectItem value="workspace">Workspace</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
          {scope === "workspace" && data ? (
            <Select
              value={selectedUserEmail ?? "all"}
              onValueChange={(value) =>
                setSelectedUserEmail(value === "all" ? null : value)
              }
            >
              <SelectTrigger className="h-9 w-44 text-xs">
                <SelectValue placeholder="All users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                {data.availableUsers.map((user) => (
                  <SelectItem key={user.email} value={user.email}>
                    {user.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <div className="flex items-center rounded-md border border-border/70 p-0.5">
            {LOOKBACKS.map((range) => (
              <Button
                key={range.value}
                type="button"
                variant={sinceDays === range.value ? "secondary" : "ghost"}
                size="sm"
                className="h-8 px-2.5 text-xs"
                onClick={() => setSinceDays(range.value)}
              >
                {range.label}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            aria-label="Refresh usage"
            title="Refresh usage"
          >
            {query.isFetching ? (
              <IconLoader2 className="animate-spin" />
            ) : (
              <IconRefresh />
            )}
          </Button>
        </div>
      </header>

      {query.isError && !data ? (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-4 text-sm"
          role="alert"
        >
          <div className="font-medium text-destructive">
            Usage data couldn’t be loaded.
          </div>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="mt-1 h-auto p-0"
            onClick={() => void query.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {!data && query.isLoading ? <UsageLoadingState /> : null}
      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard
              label={billing.label}
              value={formatCost(data.totals.costCents, billing)}
              detail={`${sinceDays} day lookback`}
              accent
            />
            <MetricCard
              label="Calls"
              value={data.totals.calls.toLocaleString()}
              detail={`${data.currentDay.calls.toLocaleString()} today`}
            />
            <MetricCard
              label="Tokens"
              value={compactNumber(totalTokens)}
              detail={`${compactNumber(data.currentDay.tokens)} today`}
            />
          </div>

          <section className="rounded-lg border border-border/70 bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Daily trend
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatCost(data.currentDay.costCents, billing)} used today ·{" "}
                  {data.currentDay.calls.toLocaleString()} calls
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {scope === "workspace" ? (
                  <IconUsers className="size-3.5" />
                ) : null}
                {scope === "workspace"
                  ? (selectedUserEmail ?? "All users")
                  : "Your usage"}
              </div>
            </div>
            <div className="mt-4">
              <Trend daily={data.daily} billing={billing} />
            </div>
          </section>

          <details className="group rounded-lg border border-border/70 bg-card">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 outline-none transition-colors hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
              <span>
                <span className="block text-sm font-semibold text-foreground">
                  Top usage drivers
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Breakdowns stay collapsed until you need them.
                </span>
              </span>
              <IconChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="grid gap-6 border-t border-border/70 px-4 py-4 md:grid-cols-2">
              <DriverList
                title="By workflow"
                rows={data.byLabel}
                billing={billing}
              />
              <DriverList
                title="By model"
                rows={data.byModel}
                billing={billing}
              />
            </div>
          </details>

          <details className="group rounded-lg border border-border/70 bg-card">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 outline-none transition-colors hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
              <span>
                <span className="block text-sm font-semibold text-foreground">
                  Recent prompts
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Latest recorded prompts for the selected app and user scope.
                </span>
              </span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {data.recent.length}
                <IconChevronDown className="size-4 transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <div className="border-t border-border/70">
              {data.recent.length === 0 ? (
                <p className="px-4 py-5 text-sm text-muted-foreground">
                  No recent prompts recorded.
                </p>
              ) : (
                <div className="divide-y divide-border/60">
                  {data.recent.map((entry) => (
                    <div key={entry.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span>
                          {entry.label} · {entry.model}
                        </span>
                        <span>{entry.ownerEmail}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-foreground">
                        {entry.prompt ??
                          "Prompt text was not captured for this call."}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>

          <UsageAlertsSection appId={appId} />

          {viewAllHref ? (
            <div className="flex justify-end">
              <Button asChild variant="link" size="sm" className="gap-1.5">
                <Link to={viewAllHref}>
                  View all usage
                  <IconArrowUpRight />
                </Link>
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
