import { Skeleton } from "@agent-native/toolkit/design-system";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@agent-native/toolkit/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@agent-native/toolkit/ui/tabs";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@agent-native/toolkit/ui/toggle-group";
import { IconChartBar, IconChartLine, IconTool } from "@tabler/icons-react";
import { keepPreviousData } from "@tanstack/react-query";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { useFormatters, useT } from "../../i18n.js";
import { useActionQuery } from "../../use-action.js";
import { cn } from "../../utils.js";
import { groupRecentPrompts } from "../recent-prompt-groups.js";
import { SettingsRow } from "../SettingsRow.js";
import type { SettingsPageContext } from "../shell/registry.js";
import {
  BuilderCreditUsagePanel,
  BuilderCreditUsageSkeleton,
  type BuilderCreditUsageData,
} from "../UsageSection.js";
import {
  buildDailySeries,
  displayUnit,
  humanizeKey,
  lookbackDates,
  platformName,
  totalTokens,
  usageAmount,
  USAGE_OTHER_KEY,
  type UsageAmounts,
  type UsageBilling,
  type UsageCallsDimension,
  type UsageHistoryDimension,
  type UsageMetricsData,
  type UsageScope,
} from "./usage-model.js";
import { UsageAlertsGroup } from "./UsageAlerts.js";
import {
  UsageBarChart,
  UsageLegend,
  UsageLineChart,
  type UsageChartFormatters,
} from "./UsageCharts.js";
import { UsageChartCard, UsageGroup } from "./UsageGroup.js";

type UsageTab = "overview" | "activity";
type SeriesDimension = UsageHistoryDimension | "surface" | "tool";

const RANGES = [7, 30, 90] as const;
type UsageRange = (typeof RANGES)[number];
const RANGE_KEYS: Record<UsageRange, string> = {
  7: "agentChat.settings.usage.range7",
  30: "agentChat.settings.usage.range30",
  90: "agentChat.settings.usage.range90",
};
const ALL_APPS = "all";
const LIST_PREVIEW = 5;

const HISTORY_DIMENSIONS: Array<[UsageHistoryDimension, string]> = [
  ["feature", "agentChat.settings.usage.byFeature"],
  ["app", "agentChat.settings.usage.byApp"],
  ["model", "agentChat.settings.usage.byModel"],
];

const FEATURE_KEYS: Record<string, string> = {
  chat: "agentChat.settings.usage.featureChat",
  "sub-agents": "agentChat.settings.usage.featureSubAgents",
  automations: "agentChat.settings.usage.featureAutomations",
};

const FILTER_TRIGGER = "w-auto";

function UsageSkeleton() {
  return (
    <div className="space-y-10" aria-hidden="true">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {["w-24", "w-12", "w-14", "w-20"].map((width) => (
          <div key={width} className="rounded-xl bg-muted/60 px-4 py-3.5">
            <Skeleton className={`h-3 ${width}`} />
            <Skeleton className="mt-2.5 h-6 w-20" />
            <Skeleton className="mt-2 h-3 w-16" />
          </div>
        ))}
      </div>
      <div>
        <Skeleton className="mb-3 h-4 w-28" />
        <div className="rounded-xl border border-border/70 px-5 py-5 sm:px-6">
          <Skeleton className="h-60 w-full" />
          <div className="mt-4 flex gap-5">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/60 px-4 py-3.5">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-xl font-semibold tracking-[-0.01em] tabular-nums text-foreground">
        {value}
      </div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground/80">
        {caption}
      </div>
    </div>
  );
}

function ChartEmpty({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{children}</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

function ChartHeadline({ value, caption }: { value: string; caption: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <span className="text-2xl font-semibold tracking-[-0.02em] tabular-nums text-foreground">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{caption}</span>
    </div>
  );
}

function ShowAllRow({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  return (
    <div className="flex min-h-12 items-center justify-center px-5 py-2 sm:px-6">
      <Button type="button" variant="ghost" size="sm" onClick={onToggle}>
        {t(
          expanded
            ? "agentChat.settings.usage.showLess"
            : "agentChat.settings.usage.showAll",
        )}
      </Button>
    </div>
  );
}

function ValueText({ children }: { children: ReactNode }) {
  return (
    <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
      {children}
    </span>
  );
}

/**
 * Settings › Usage: spend, calls, and tokens across every app, with an app
 * filter. Members see only their own usage; owners and admins can switch
 * between Everyone and Just you, which the server enforces.
 */
export function UsagePage({ context }: { context: SettingsPageContext }) {
  const t = useT();
  const format = useFormatters();
  const mayViewOrganization =
    context.isAdmin && context.hasOrganization === true;
  const [tab, setTab] = useState<UsageTab>("overview");
  const [sinceDays, setSinceDays] = useState<UsageRange>(30);
  const [app, setApp] = useState<string>(ALL_APPS);
  const [scope, setScope] = useState<UsageScope>(
    mayViewOrganization ? "workspace" : "me",
  );
  const [historyDimension, setHistoryDimension] =
    useState<UsageHistoryDimension>("feature");
  const [callsDimension, setCallsDimension] =
    useState<UsageCallsDimension>("model");
  const [showAllChats, setShowAllChats] = useState(false);
  const [showAllPrompts, setShowAllPrompts] = useState(false);

  const query = useActionQuery<UsageMetricsData>(
    "get-usage-metrics",
    { sinceDays, scope, app },
    { placeholderData: keepPreviousData },
  );
  const data = query.data;
  const canViewOrganization =
    data?.access.canViewWorkspace ?? mayViewOrganization;
  const showCreditPanel = Boolean(
    data?.builderCreditUsageEnabled && data.access.canViewWorkspace,
  );
  const creditQuery = useActionQuery<BuilderCreditUsageData | null>(
    "get-builder-credit-usage",
    {},
    { enabled: showCreditPanel },
  );

  const rangeLabel = t(RANGE_KEYS[sinceDays]);
  const billing = useMemo<UsageBilling>(
    () => data?.billing ?? { unit: "usd" },
    [data?.billing],
  );
  const unit = displayUnit(billing);
  const organizationView =
    data?.viewScope === "workspace" && data.selectedUserEmail === null;
  const allApps = data?.appScope !== "app";
  const viewerEmail = data?.access.viewerEmail.toLowerCase() ?? null;

  const appName = useCallback(
    (key: string) =>
      key === "unattributed"
        ? t("agentChat.settings.usage.unattributedApp")
        : humanizeKey(key),
    [t],
  );

  const formatUsd = useCallback(
    (dollars: number) => {
      const currency = { style: "currency", currency: "USD" } as const;
      if (dollars > 0 && dollars < 0.01) {
        return `<${format.formatNumber(0.01, currency)}`;
      }
      return format.formatNumber(dollars, {
        ...currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    },
    [format],
  );
  const formatMoney = useCallback(
    (value: number) => {
      if (unit === "usd") return formatUsd(value);
      const amount = format.formatNumber(value, {
        maximumFractionDigits: value >= 10 ? 0 : value >= 1 ? 1 : 2,
      });
      return t("agentChat.settings.usage.creditAmount", {
        count: value,
        amount,
      });
    },
    [format, formatUsd, t, unit],
  );
  const amountText = useCallback(
    (entry: UsageAmounts) => formatMoney(usageAmount(entry, billing)),
    [billing, formatMoney],
  );
  const formatCount = useCallback(
    (value: number) => format.formatNumber(Math.round(value)),
    [format],
  );
  const formatDay = useCallback(
    (date: string) =>
      format.formatDate(`${date}T00:00:00Z`, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),
    [format],
  );
  const formatShare = useCallback(
    (fraction: number) => {
      const percent = {
        style: "percent",
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      } as const;
      return fraction > 0 && fraction < 0.001
        ? `<${format.formatNumber(0.001, percent)}`
        : format.formatNumber(fraction, percent);
    },
    [format],
  );
  const formatMoneyTick = useCallback(
    (value: number) =>
      format.formatNumber(value, {
        ...(unit === "usd" ? { style: "currency", currency: "USD" } : {}),
        notation: "compact",
        maximumFractionDigits: value >= 10 ? 0 : value >= 1 ? 1 : 2,
      }),
    [format, unit],
  );

  const seriesName = useCallback(
    (dimension: SeriesDimension, key: string) => {
      if (key === USAGE_OTHER_KEY) return t("agentChat.settings.usage.other");
      if (dimension === "app") return appName(key);
      if (dimension === "feature") {
        const known = FEATURE_KEYS[key];
        if (known) return t(known);
        return key.startsWith("integration:")
          ? platformName(key.slice("integration:".length))
          : key;
      }
      if (dimension === "model") {
        return key === "unknown"
          ? t("agentChat.settings.usage.unknownModel")
          : key;
      }
      if (dimension === "surface") {
        return key === "app"
          ? t("agentChat.settings.usage.surfaceApp")
          : platformName(key);
      }
      return key;
    },
    [appName, t],
  );

  const dates = useMemo(
    () => (data ? lookbackDates(data.sinceDays, data.generatedAt) : []),
    [data],
  );
  const history = useMemo(
    () =>
      data
        ? buildDailySeries(data.dailyBy[historyDimension], dates, (entry) =>
            usageAmount(entry, billing),
          )
        : null,
    [billing, data, dates, historyDimension],
  );
  const modelCalls = useMemo(
    () =>
      data
        ? buildDailySeries(
            data.dailyBy[callsDimension],
            dates,
            (entry) => entry.calls,
          )
        : null,
    [callsDimension, data, dates],
  );
  const toolCalls = useMemo(
    () =>
      data?.toolCalls.status === "ok"
        ? buildDailySeries(data.toolCalls.daily, dates, (entry) => entry.calls)
        : null,
    [data, dates],
  );

  const chartFormatters = useCallback(
    (dimension: SeriesDimension, money: boolean): UsageChartFormatters => ({
      name: (key) => seriesName(dimension, key),
      value: money ? formatMoney : formatCount,
      tick: money ? formatMoneyTick : formatCount,
      date: formatDay,
      share: formatShare,
    }),
    [
      formatCount,
      formatDay,
      formatMoney,
      formatMoneyTick,
      formatShare,
      seriesName,
    ],
  );
  const historyFormatters = useMemo(
    () => chartFormatters(historyDimension, true),
    [chartFormatters, historyDimension],
  );
  const modelCallFormatters = useMemo(
    () => chartFormatters(callsDimension, false),
    [callsDimension, chartFormatters],
  );
  const toolCallFormatters = useMemo(
    () => chartFormatters("tool", false),
    [chartFormatters],
  );

  const appOptions = useMemo(() => {
    const keys = new Set(data?.apps.map((option) => option.key) ?? []);
    if (data?.currentAppKey) keys.add(data.currentAppKey);
    if (app !== ALL_APPS) keys.add(app);
    return [...keys].sort((a, b) => appName(a).localeCompare(appName(b)));
  }, [app, appName, data]);

  const describe = (parts: Array<string | null | false>) =>
    parts.filter(Boolean).join(" · ");
  const person = (email: string) =>
    email.toLowerCase() === viewerEmail
      ? t("agentChat.settings.usage.you")
      : email;

  const filters = (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={String(sinceDays)}
        onValueChange={(value) => setSinceDays(Number(value) as UsageRange)}
      >
        <SelectTrigger
          size="sm"
          className={FILTER_TRIGGER}
          aria-label={t("agentChat.settings.usage.rangeLabel")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGES.map((range) => (
            <SelectItem key={range} value={String(range)}>
              {t(RANGE_KEYS[range])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={app} onValueChange={setApp}>
        <SelectTrigger
          size="sm"
          className={FILTER_TRIGGER}
          aria-label={t("agentChat.settings.usage.appFilterLabel")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_APPS}>
            {t("agentChat.settings.usage.allApps")}
          </SelectItem>
          {appOptions.map((key) => (
            <SelectItem key={key} value={key}>
              {appName(key)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {canViewOrganization ? (
        <Select
          value={scope}
          onValueChange={(value) => setScope(value as UsageScope)}
        >
          <SelectTrigger
            size="sm"
            className={FILTER_TRIGGER}
            aria-label={t("agentChat.settings.usage.peopleFilterLabel")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="workspace">
              {t("agentChat.settings.usage.everyone")}
            </SelectItem>
            <SelectItem value="me">
              {t("agentChat.settings.usage.justYou")}
            </SelectItem>
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );

  let body: ReactNode = null;
  if (!data && query.isError) {
    body = (
      <SettingsRow
        className="rounded-xl border border-border/70"
        label={t("agentChat.settings.usage.loadError")}
        control={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            {t("agentChat.common.retry")}
          </Button>
        }
      />
    );
  } else if (!data) {
    body = <UsageSkeleton />;
  } else if (tab === "overview") {
    const spendKey =
      unit === "usd"
        ? organizationView
          ? "agentChat.settings.usage.estimatedSpend"
          : "agentChat.settings.usage.yourEstimatedSpend"
        : organizationView
          ? "agentChat.settings.usage.creditSpend"
          : "agentChat.settings.usage.yourCreditSpend";
    const tiles: Array<[string, string]> = [
      [t(spendKey), amountText(data.totals)],
      ...(billing.unit === "mixed"
        ? [
            [
              t("agentChat.usage.otherUnclassifiedSpend"),
              formatUsd((data.totals.otherCostCents ?? 0) / 100),
            ] as [string, string],
          ]
        : []),
      [t("agentChat.settings.usage.calls"), formatCount(data.totals.calls)],
      [
        t("agentChat.settings.usage.tokens"),
        format.formatNumber(totalTokens(data.totals), {
          notation: "compact",
          maximumFractionDigits: 1,
        }),
      ],
      ...(organizationView
        ? [
            [
              t("agentChat.settings.usage.activePeople"),
              formatCount(data.totals.activeUsers),
            ] as [string, string],
          ]
        : []),
    ];
    const chats = showAllChats
      ? data.topChats
      : data.topChats.slice(0, LIST_PREVIEW);
    body = (
      <div className="space-y-10">
        {showCreditPanel ? (
          creditQuery.data ? (
            <BuilderCreditUsagePanel usage={creditQuery.data} />
          ) : creditQuery.isError ? (
            <SettingsRow
              className="rounded-xl border border-border/70"
              label={t("agentChat.usage.creditUsageUnavailable")}
              control={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void creditQuery.refetch()}
                  disabled={creditQuery.isFetching}
                >
                  {t("agentChat.common.retry")}
                </Button>
              }
            />
          ) : (
            <BuilderCreditUsageSkeleton />
          )
        ) : null}
        <div
          className={cn(
            "grid grid-cols-2 gap-2.5",
            tiles.length >= 4 ? "sm:grid-cols-4" : "sm:grid-cols-3",
            tiles.length > 4 && "lg:grid-cols-5",
          )}
        >
          {tiles.map(([label, value]) => (
            <MetricTile
              key={label}
              label={label}
              value={value}
              caption={rangeLabel}
            />
          ))}
        </div>
        <UsageGroup
          id="usage-history"
          title={t("agentChat.settings.usage.history")}
          raw
          action={
            <Select
              value={historyDimension}
              onValueChange={(value) =>
                setHistoryDimension(value as UsageHistoryDimension)
              }
            >
              <SelectTrigger
                size="sm"
                className={FILTER_TRIGGER}
                aria-label={t("agentChat.settings.usage.historyDimensionLabel")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HISTORY_DIMENSIONS.map(([value, key]) => (
                  <SelectItem key={value} value={value}>
                    {t(key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        >
          <UsageChartCard>
            {history && history.total > 0 ? (
              <>
                <UsageBarChart
                  series={history}
                  formatters={historyFormatters}
                  label={t("agentChat.settings.usage.historyChartLabel")}
                />
                <UsageLegend
                  series={history}
                  formatters={historyFormatters}
                  shares
                />
              </>
            ) : (
              <ChartEmpty icon={<IconChartBar />}>
                {t("agentChat.settings.usage.noUsage")}
              </ChartEmpty>
            )}
          </UsageChartCard>
        </UsageGroup>
        {data.topChats.length > 0 ? (
          <UsageGroup
            id="usage-top-chats"
            title={t("agentChat.settings.usage.topChats")}
          >
            {chats.map((chat) => (
              <SettingsRow
                key={chat.threadId}
                label={
                  chat.title ??
                  t(
                    chat.titleSource === "unavailable"
                      ? "agentChat.settings.usage.titleUnavailable"
                      : "agentChat.settings.usage.untitledChat",
                  )
                }
                description={describe([
                  format.formatDate(chat.lastActiveAt, {
                    month: "short",
                    day: "numeric",
                  }),
                  allApps && appName(chat.app),
                  organizationView && person(chat.ownerEmail),
                ])}
                control={<ValueText>{amountText(chat)}</ValueText>}
              />
            ))}
            {data.topChats.length > LIST_PREVIEW ? (
              <ShowAllRow
                expanded={showAllChats}
                onToggle={() => setShowAllChats((value) => !value)}
              />
            ) : null}
          </UsageGroup>
        ) : null}
        {organizationView && data.byUser.length > 0 ? (
          <UsageGroup
            id="usage-top-people"
            title={t("agentChat.settings.usage.topPeople")}
          >
            {data.byUser.map((bucket) => (
              <SettingsRow
                key={bucket.key}
                label={bucket.key}
                status={
                  bucket.key === viewerEmail ? (
                    <Badge variant="outline">
                      {t("agentChat.settings.usage.you")}
                    </Badge>
                  ) : null
                }
                control={<ValueText>{amountText(bucket)}</ValueText>}
              />
            ))}
          </UsageGroup>
        ) : null}
        <UsageAlertsGroup appName={appName} />
      </div>
    );
  } else {
    const promptGroups = groupRecentPrompts(data.recent);
    const prompts = showAllPrompts
      ? promptGroups
      : promptGroups.slice(0, LIST_PREVIEW);
    body = (
      <div className="space-y-10">
        <UsageGroup
          id="usage-tool-calls"
          title={t("agentChat.settings.usage.toolCalls")}
          raw
        >
          <UsageChartCard>
            {toolCalls ? (
              <>
                <ChartHeadline
                  value={formatCount(toolCalls.total)}
                  caption={rangeLabel}
                />
                {toolCalls.total > 0 ? (
                  <>
                    <UsageLineChart
                      series={toolCalls}
                      formatters={toolCallFormatters}
                      label={t("agentChat.settings.usage.toolCallsChartLabel")}
                    />
                    <UsageLegend
                      series={toolCalls}
                      formatters={toolCallFormatters}
                      shares={false}
                    />
                  </>
                ) : (
                  <ChartEmpty icon={<IconTool />}>
                    {t("agentChat.settings.usage.noToolCalls")}
                  </ChartEmpty>
                )}
              </>
            ) : (
              <ChartEmpty icon={<IconTool />}>
                {t("agentChat.settings.usage.toolCallsUnavailable")}
              </ChartEmpty>
            )}
          </UsageChartCard>
        </UsageGroup>
        <UsageGroup
          id="usage-model-calls"
          title={t("agentChat.settings.usage.modelCalls")}
          raw
          action={
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={callsDimension}
              onValueChange={(value) => {
                if (value) setCallsDimension(value as UsageCallsDimension);
              }}
              aria-label={t(
                "agentChat.settings.usage.modelCallsDimensionLabel",
              )}
            >
              <ToggleGroupItem value="model" className="h-8 px-2.5">
                {t("agentChat.settings.usage.byModel")}
              </ToggleGroupItem>
              <ToggleGroupItem value="surface" className="h-8 px-2.5">
                {t("agentChat.settings.usage.bySurface")}
              </ToggleGroupItem>
            </ToggleGroup>
          }
        >
          <UsageChartCard>
            {modelCalls ? (
              <ChartHeadline
                value={formatCount(modelCalls.total)}
                caption={rangeLabel}
              />
            ) : null}
            {modelCalls && modelCalls.total > 0 ? (
              <>
                <UsageLineChart
                  series={modelCalls}
                  formatters={modelCallFormatters}
                  label={t("agentChat.settings.usage.modelCallsChartLabel")}
                />
                <UsageLegend
                  series={modelCalls}
                  formatters={modelCallFormatters}
                  shares={false}
                />
              </>
            ) : (
              <ChartEmpty icon={<IconChartLine />}>
                {t("agentChat.settings.usage.noModelCalls")}
              </ChartEmpty>
            )}
          </UsageChartCard>
        </UsageGroup>
        {data.recent.length > 0 ? (
          <UsageGroup
            id="usage-recent-prompts"
            title={t("agentChat.settings.usage.recentPrompts")}
          >
            {prompts.map(({ entry, count }) => (
              <SettingsRow
                key={entry.id}
                label={
                  <span className="line-clamp-2 font-normal">
                    {entry.prompt ??
                      t(
                        entry.promptSource === "unavailable"
                          ? "agentChat.settings.usage.promptUnavailable"
                          : "agentChat.settings.usage.promptNotCaptured",
                      )}
                  </span>
                }
                description={describe([
                  format.formatDate(entry.createdAt, {
                    month: "short",
                    day: "numeric",
                  }),
                  allApps && appName(entry.app),
                  organizationView && person(entry.ownerEmail),
                  entry.model,
                ])}
                status={
                  count > 1 ? <Badge variant="outline">×{count}</Badge> : null
                }
                control={<ValueText>{amountText(entry)}</ValueText>}
              />
            ))}
            {promptGroups.length > LIST_PREVIEW ? (
              <ShowAllRow
                expanded={showAllPrompts}
                onToggle={() => setShowAllPrompts((value) => !value)}
              />
            ) : null}
          </UsageGroup>
        ) : null}
      </div>
    );
  }

  return (
    <div className="pb-4" data-usage-page="">
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as UsageTab)}
        className="space-y-4"
      >
        <TabsList aria-label={t("agentChat.settings.usage.tabsLabel")}>
          <TabsTrigger value="overview">
            {t("agentChat.settings.usage.tabOverview")}
          </TabsTrigger>
          <TabsTrigger value="activity">
            {t("agentChat.settings.usage.tabActivity")}
          </TabsTrigger>
        </TabsList>
        {filters}
        {(["overview", "activity"] as const).map((value) => (
          <TabsContent
            key={value}
            value={value}
            className={cn(
              "mt-0 pt-2 transition-opacity",
              query.isPlaceholderData && query.isFetching && "opacity-60",
            )}
            aria-busy={query.isFetching}
          >
            {tab === value ? body : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
