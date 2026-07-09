/**
 * Detail view for a single monitor: status header, overview stats, response-time
 * chart, a 90-day uptime timeline, config summary, recent check results, and
 * incident history. The colorful charts + uptime windows are driven by the
 * shared `get-monitor-stats` aggregate and the reusable `@/components/monitoring`
 * chart components; per-check config/history comes from `get-monitor`.
 */
import { useActionQuery } from "@agent-native/core/client";
import {
  IconArrowLeft,
  IconExternalLink,
  IconLoader2,
  IconPencil,
  IconPlayerPlay,
  IconTrash,
} from "@tabler/icons-react";

import {
  ResponseTimeChart,
  UptimeStatCards,
  UptimeTimelineBars,
} from "@/components/monitoring";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { fmt, useUptimeT } from "./i18n";
import type {
  MonitorCheckDiagnostics,
  MonitorDetail as MonitorDetailData,
  MonitorStats,
  MonitorSummary,
} from "./types";
import {
  describeAssertion,
  describeMatcher,
  formatDateTime,
  formatDuration,
  formatLatency,
  formatRelativeTime,
  statusLabel,
  statusTone,
  toneDotClass,
  toneTextClass,
} from "./utils";

export function MonitorDetail({
  monitorId,
  fallback,
  onBack,
  onEdit,
  onDelete,
  onRunCheck,
  running,
}: {
  monitorId: string;
  fallback?: MonitorSummary;
  onBack: () => void;
  onEdit: (monitor: MonitorSummary) => void;
  onDelete: (monitor: MonitorSummary) => void;
  onRunCheck: (monitor: MonitorSummary) => void;
  running: boolean;
}) {
  const t = useUptimeT();
  const { data, isLoading } = useActionQuery<MonitorDetailData>(
    "get-monitor",
    { id: monitorId },
    { staleTime: 5_000 },
  );
  // Aggregated windows / timeline / response series over the standard windows.
  const { data: statsData } = useActionQuery<MonitorStats[]>(
    "get-monitor-stats",
    { monitorIds: [monitorId], timelineDays: 90, responseWindowHours: 24 * 7 },
    { staleTime: 15_000 },
  );

  const monitor = data?.monitor ?? fallback ?? null;
  const results = data?.recentResults ?? [];
  const incidents = data?.incidents ?? [];
  const stats = statsData?.[0] ?? null;

  if (!monitor) {
    if (isLoading) {
      return (
        <div className="space-y-4">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-border/60 bg-muted/20 p-8 text-sm text-muted-foreground">
        {t.noChecks}
        <div className="mt-4">
          <Button variant="outline" size="sm" onClick={onBack}>
            <IconArrowLeft className="size-3.5" />
            {t.back}
          </Button>
        </div>
      </div>
    );
  }

  const tone = statusTone(monitor.lastStatus);
  const lastChecked = formatRelativeTime(monitor.lastCheckedAt);
  const windows = stats?.windows ?? {
    uptime24h: monitor.uptime24h,
    uptime7d: monitor.uptime7d,
    uptime30d: null,
    uptime90d: null,
  };
  const incidentCount = stats?.incidentCount ?? incidents.length;
  const mtbf = stats?.mtbfMs ?? null;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="-ms-2 w-fit text-muted-foreground"
          onClick={onBack}
        >
          <IconArrowLeft className="size-3.5" />
          {t.back}
        </Button>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "size-2.5 rounded-full",
                  toneDotClass(tone),
                  monitor.lastStatus === "running" && "animate-pulse",
                )}
              />
              <h2 className="truncate text-lg font-semibold">{monitor.name}</h2>
              <Badge
                variant={
                  monitor.severity === "critical" ? "destructive" : "outline"
                }
                className="shrink-0 text-[10px]"
              >
                {monitor.severity === "critical"
                  ? t.severityCritical
                  : t.severityWarning}
              </Badge>
              {!monitor.enabled ? (
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {t.pausedBadge}
                </Badge>
              ) : null}
            </div>
            <a
              href={monitor.url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {monitor.url}
              <IconExternalLink className="size-3" />
            </a>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRunCheck(monitor)}
              disabled={running}
            >
              {running ? (
                <IconLoader2 className="size-3.5 animate-spin" />
              ) : (
                <IconPlayerPlay className="size-3.5" />
              )}
              {running ? t.runningCheck : t.checkNow}
            </Button>
            <Button variant="outline" size="sm" onClick={() => onEdit(monitor)}>
              <IconPencil className="size-3.5" />
              {t.edit}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => onDelete(monitor)}
            >
              <IconTrash className="size-3.5" />
              {t.delete}
            </Button>
          </div>
        </div>
      </div>

      {/* Overview stats — wrap cleanly on narrow widths */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t.currentStatus}>
          <span className={cn("text-lg font-semibold", toneTextClass(tone))}>
            {statusLabel(monitor.lastStatus, t)}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {lastChecked
              ? fmt(t.lastChecked, { time: lastChecked })
              : t.neverChecked}
          </span>
        </StatCard>
        <StatCard label={t.latency}>
          <span className="text-lg font-semibold tabular-nums">
            {formatLatency(monitor.lastLatencyMs)}
          </span>
          {monitor.lastStatusCode != null ? (
            <span className="text-xs text-muted-foreground">
              {t.colCode} {monitor.lastStatusCode}
            </span>
          ) : null}
        </StatCard>
        <StatCard label={t.statIncidents}>
          <span className="text-lg font-semibold tabular-nums">
            {incidentCount}
          </span>
          <span className="text-xs text-muted-foreground">{t.statLast90d}</span>
        </StatCard>
        <StatCard label={t.statMtbf}>
          <span className="text-lg font-semibold tabular-nums">
            {mtbf != null ? formatDuration(mtbf) : "—"}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {t.statMtbfHint}
          </span>
        </StatCard>
      </div>

      {/* Uptime windows (24h / 7d / 30d / 90d) */}
      <UptimeStatCards
        windows={windows}
        items={[
          { key: "uptime24h", label: t.uptime24h },
          { key: "uptime7d", label: t.uptime7d },
          { key: "uptime30d", label: t.uptime30d },
          { key: "uptime90d", label: t.uptime90d },
        ]}
      />

      {monitor.lastError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {monitor.lastError}
        </div>
      ) : null}

      {/* Response time + 90-day uptime timeline */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            {t.responseTime}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t.responseTimeSubtitle}
          </p>
        </CardHeader>
        <CardContent>
          <ResponseTimeChart
            series={stats?.responseSeries ?? []}
            showMinMax
            heightClassName="h-[220px]"
            emptyText={t.noChecks}
          />

          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium">{t.uptimeTimeline90d}</span>
              <span className="text-[10px] text-muted-foreground">
                {t.uptimeTimelineDaily}
              </span>
            </div>
            <UptimeTimelineBars
              buckets={stats?.timeline ?? []}
              heightClassName="h-9"
              ariaLabel={fmt(t.uptimeTimelineAria, { name: monitor.name })}
            />
            {stats && stats.timeline.length > 0 ? (
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>{t.timelineNinetyDaysAgo}</span>
                <span>{t.timelineToday}</span>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Config summary */}
        <Card className="bg-card border-border/50 lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t.configTitle}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-xs">
            <ConfigRow label={t.configMethod} value={monitor.method} />
            <ConfigRow
              label={t.configInterval}
              value={
                t.intervals[String(monitor.intervalSeconds)] ??
                `${monitor.intervalSeconds}s`
              }
            />
            <ConfigRow
              label={t.configTimeout}
              value={`${Math.round(monitor.timeoutMs / 1000)}s`}
            />
            <ConfigRow
              label={t.configExpected}
              value={describeMatcher(monitor.expectedStatus, t)}
            />
            <ConfigRow
              label={t.configRedirects}
              value={monitor.followRedirects ? t.yes : t.no}
            />
            <ConfigRow
              label={t.configCooldown}
              value={`${monitor.cooldownMinutes}m`}
            />
            <div className="space-y-1">
              <span className="text-muted-foreground">{t.configChannels}</span>
              <div className="flex flex-wrap gap-1">
                {monitor.channels.map((channel) => (
                  <Badge
                    key={channel}
                    variant="secondary"
                    className="text-[10px]"
                  >
                    {channel}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-muted-foreground">
                {t.configAssertions}
              </span>
              {monitor.assertions.length === 0 ? (
                <p className="text-muted-foreground/80">{t.noAssertions}</p>
              ) : (
                <ul className="space-y-1">
                  {monitor.assertions.map((assertion, index) => (
                    <li
                      key={`${assertion.type}-${index}`}
                      className="rounded bg-muted/40 px-2 py-1"
                    >
                      {describeAssertion(assertion, t)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent checks */}
        <Card className="bg-card border-border/50 lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t.recentChecks}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {results.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t.noChecks}
              </p>
            ) : (
              <div className="max-h-[320px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.colTime}</TableHead>
                      <TableHead>{t.colStatus}</TableHead>
                      <TableHead className="text-end">{t.colCode}</TableHead>
                      <TableHead className="text-end">{t.colLatency}</TableHead>
                      <TableHead>{t.colDetails}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.slice(0, 50).map((result) => {
                      const resultTone = statusTone(result.status);
                      return (
                        <TableRow key={result.id}>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {formatDateTime(result.checkedAt)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={cn(
                                  "size-2 rounded-full",
                                  toneDotClass(resultTone),
                                )}
                              />
                              <span className="text-xs">
                                {statusLabel(result.status, t)}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-end text-xs tabular-nums">
                            {result.statusCode ?? "—"}
                          </TableCell>
                          <TableCell className="text-end text-xs tabular-nums">
                            {formatLatency(result.latencyMs)}
                          </TableCell>
                          <TableCell className="max-w-[220px] text-xs text-muted-foreground">
                            <div className="space-y-1">
                              {result.failedAssertions.length > 0 ? (
                                <span className="text-amber-500">
                                  {result.failedAssertions.join("; ")}
                                </span>
                              ) : result.error ? (
                                <span className="text-destructive">
                                  {result.error}
                                </span>
                              ) : (
                                <span className="text-emerald-500">{t.ok}</span>
                              )}
                              <div className="text-[11px] leading-snug text-muted-foreground/80">
                                {formatDiagnostics(result.diagnostics)}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Incidents */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{t.incidents}</CardTitle>
        </CardHeader>
        <CardContent>
          {incidents.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t.noIncidents}
            </p>
          ) : (
            <div className="space-y-2">
              {incidents.map((incident) => {
                const start = Date.parse(incident.startedAt);
                const end = incident.resolvedAt
                  ? Date.parse(incident.resolvedAt)
                  : Date.now();
                const duration = formatDuration(end - start);
                const incidentTone = statusTone(incident.status);
                return (
                  <div
                    key={incident.id}
                    className="flex flex-col gap-1 rounded-md border border-border/60 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "size-2 rounded-full",
                            toneDotClass(incidentTone),
                          )}
                        />
                        <span className="truncate text-sm font-medium">
                          {incident.cause || statusLabel(incident.status, t)}
                        </span>
                        <Badge
                          variant={
                            incident.resolvedAt ? "secondary" : "destructive"
                          }
                          className="text-[10px]"
                        >
                          {incident.resolvedAt ? t.resolved : t.ongoing}
                        </Badge>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {t.started}: {formatDateTime(incident.startedAt)} ·{" "}
                        {fmt(t.checksFailedLabel, {
                          count: incident.checksFailed,
                        })}
                      </div>
                    </div>
                    <div className="shrink-0 text-xs text-muted-foreground">
                      {t.duration}: {duration}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatDiagnostics(diagnostics: MonitorCheckDiagnostics): string {
  const timings = diagnostics.timings ?? {};
  const parts = [
    diagnostics.source,
    timings.requestMs != null
      ? `headers ${formatLatency(timings.requestMs)}`
      : null,
    timings.ssrfSetupMs != null
      ? `ssrf ${formatLatency(timings.ssrfSetupMs)}`
      : null,
    timings.bodyReadMs != null
      ? `body ${formatLatency(timings.bodyReadMs)}`
      : null,
    diagnostics.response?.finalHost
      ? `host ${diagnostics.response.finalHost}`
      : null,
    diagnostics.error?.kind ? `error ${diagnostics.error.kind}` : null,
    diagnostics.runtime?.commitRef
      ? `sha ${diagnostics.runtime.commitRef.slice(0, 7)}`
      : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function StatCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border/50 bg-card px-3 py-2.5">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-end font-medium">{value}</span>
    </div>
  );
}
