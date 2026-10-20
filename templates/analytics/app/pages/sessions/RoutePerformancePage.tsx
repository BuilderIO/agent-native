import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useLabState } from "@agent-native/core/client/labs";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconInfoCircle,
  IconRefresh,
} from "@tabler/icons-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { ANALYTICS_SESSIONS_TRIAGE_LAB } from "../../../shared/labs";
import {
  formatPerformanceValue,
  type HistogramPercentile,
  type MetricSummary,
  type PerformanceMetric,
  rateWebVital,
  readRoutePerformanceRange,
  type RoutePerformanceResult,
  type RoutePerformanceRow,
  routePerformanceRangeBounds,
} from "../../../shared/session-performance";
import { SessionsLabGate } from "./SessionsLabGate";

const VITAL_COLUMNS = [
  ["ttfb", "TTFB"],
  ["lcp", "LCP"],
  ["inp", "INP"],
  ["cls", "CLS"],
] as const;

export default function RoutePerformancePage() {
  const t = useT();
  const lab = useLabState(ANALYTICS_SESSIONS_TRIAGE_LAB);
  const [params, setParams] = useSearchParams();
  const range = readRoutePerformanceRange(params.get("range"));
  const app = params.get("app") ?? "";
  const bounds = useMemo(() => routePerformanceRangeBounds(range), [range]);
  const { data, error, isPending, isFetching, refetch } =
    useActionQuery<RoutePerformanceResult>(
      "list-route-performance",
      { ...bounds, app: app || undefined },
      { enabled: lab.enabled, staleTime: 60_000 },
    );
  const apps = useMemo(
    () => [...new Set([...(data?.apps ?? []), app])].filter(Boolean).sort(),
    [data?.apps, app],
  );
  const sessionsParams = new URLSearchParams();
  if (range !== "30d") sessionsParams.set("range", range);
  if (app) sessionsParams.set("app", app);
  const sessionsQuery = sessionsParams.toString();
  const sessionsHref = `/sessions${sessionsQuery ? `?${sessionsQuery}` : ""}`;

  function setParam(key: string, value: string) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5">
      <div className="min-w-0 space-y-1">
        <Button asChild variant="ghost" size="xs" className="-ml-2">
          <Link to={sessionsHref}>
            <IconArrowLeft />
            {t("sessions.title")}
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">
          {t("sessions.routePerformance")}
        </h1>
      </div>

      <SessionsLabGate lab={lab} needsLab={t("sessions.perfNeedsLab")}>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={app || "all"}
            onValueChange={(value) =>
              setParam("app", value === "all" ? "" : value)
            }
          >
            <SelectTrigger
              className="h-8 w-auto min-w-28"
              aria-label={t("sessions.app")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("sessions.allApps")}</SelectItem>
              {apps.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={range}
            onValueChange={(value) =>
              setParam("range", value === "7d" ? "" : value)
            }
          >
            <SelectTrigger
              className="h-8 w-auto min-w-28"
              aria-label={t("sessions.range")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">{t("sessions.last7d")}</SelectItem>
              <SelectItem value="30d">{t("sessions.last30d")}</SelectItem>
              <SelectItem value="90d">{t("sessions.last90d")}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label={t("sessions.refresh")}
          >
            <IconRefresh className={cn(isFetching && "animate-spin")} />
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t("sessions.perfAccuracy")}
                >
                  <IconInfoCircle />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                {t("sessions.perfAccuracy")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {data ? (
            <span className="text-xs text-muted-foreground">
              {data.coverageStartedAt
                ? t("sessions.speedCoverageSince", {
                    date: new Date(data.coverageStartedAt).toLocaleDateString(),
                  })
                : t("sessions.speedCoverageStarting")}
            </span>
          ) : null}
        </div>

        {data?.incompleteDates.length ? (
          <Alert role="status">
            <IconAlertTriangle />
            <AlertDescription>
              {t("sessions.perfIncomplete", {
                dates: data.incompleteDates.join(", "),
              })}
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          {error ? (
            <div className="p-6 text-sm text-destructive" role="alert">
              {t("sessions.perfLoadFailed", { message: error.message })}
            </div>
          ) : isPending ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-8 w-full" />
              ))}
            </div>
          ) : data.routes.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {t("sessions.perfEmpty")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("sessions.perfRoute")}</TableHead>
                  <TableHead>{t("sessions.app")}</TableHead>
                  {VITAL_COLUMNS.map(([metric, name]) => (
                    <TableHead key={metric} className="text-end">
                      {name}
                    </TableHead>
                  ))}
                  <TableHead className="text-end">
                    {t("sessions.perfRequests")}
                  </TableHead>
                  <TableHead className="text-end">
                    {t("sessions.speedSlowRequests")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.routes.map((row) => (
                  <RoutePerformanceTableRow
                    key={`${row.app}:${row.route}`}
                    row={row}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
        {data?.truncated ? (
          <p className="text-xs text-muted-foreground">
            {t("sessions.perfTruncated", {
              count: data.routes.length.toLocaleString(),
            })}
          </p>
        ) : null}
      </SessionsLabGate>
    </div>
  );
}

function RoutePerformanceTableRow({ row }: { row: RoutePerformanceRow }) {
  const t = useT();
  return (
    <TableRow>
      <TableCell className="max-w-[320px] break-all font-mono text-xs">
        {row.route}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {row.app || t("sessions.unknownApp")}
      </TableCell>
      {VITAL_COLUMNS.map(([metric]) => (
        <TableCell key={metric} className="text-end">
          <PercentilePair metric={metric} summary={row[metric]} />
        </TableCell>
      ))}
      <TableCell className="text-end">
        <PercentilePair metric="request" summary={row.request} />
      </TableCell>
      <TableCell className="text-end text-xs tabular-nums">
        {row.request ? (
          Math.round(row.request.slow).toLocaleString()
        ) : (
          <NoData />
        )}
      </TableCell>
    </TableRow>
  );
}

/** "p50 / p95"; the p95 turns red when it is a poor Core Web Vital. */
function PercentilePair({
  metric,
  summary,
}: {
  metric: PerformanceMetric;
  summary: MetricSummary | null;
}) {
  if (!summary?.p50 || !summary.p95) return <NoData />;
  const poor =
    metric !== "request" && rateWebVital(metric, summary.p95.value) === "poor";
  return (
    <span className="whitespace-nowrap text-xs tabular-nums">
      <PercentileValue metric={metric} value={summary.p50} />
      <span className="text-muted-foreground"> / </span>
      <span className={cn(poor && "text-destructive")}>
        <PercentileValue metric={metric} value={summary.p95} />
      </span>
    </span>
  );
}

function PercentileValue({
  metric,
  value,
}: {
  metric: PerformanceMetric;
  value: HistogramPercentile;
}) {
  const t = useT();
  const formatted = formatPerformanceValue(metric, value.value);
  return (
    <>
      {value.atLeast
        ? t("sessions.perfAtLeast", { value: formatted })
        : formatted}
    </>
  );
}

function NoData() {
  const t = useT();
  return (
    <span className="text-xs text-muted-foreground">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{t("sessions.perfNoData")}</span>
    </span>
  );
}
