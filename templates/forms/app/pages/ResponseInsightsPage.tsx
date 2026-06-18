import { Link, useSearchParams } from "react-router";
import {
  IconArrowLeft,
  IconChartBar,
  IconExternalLink,
  IconRefresh,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useResponseInsights } from "@/hooks/use-responses";
import type { ResponseInsightsWidgetResult } from "@shared/types";

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatDay(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatCell(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-background px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate text-lg font-semibold tabular-nums">
        {value}
      </div>
      {detail ? (
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function SubmissionBars({
  data,
}: {
  data: Array<{ date: string; submissions: number }>;
}) {
  const max = Math.max(1, ...data.map((point) => point.submissions));
  const visibleTicks = Math.max(1, Math.ceil(data.length / 6));

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[520px] items-end gap-1.5 pt-2">
        {data.map((point, index) => {
          const height = Math.max(
            point.submissions > 0 ? 10 : 3,
            Math.round((point.submissions / max) * 148),
          );
          const showLabel =
            index === 0 ||
            index === data.length - 1 ||
            index % visibleTicks === 0;

          return (
            <div
              key={point.date}
              className="flex min-w-5 flex-1 flex-col items-center gap-1.5"
            >
              <div className="flex h-40 w-full items-end rounded-sm bg-muted/40 px-0.5">
                <div
                  className={cn(
                    "w-full rounded-sm bg-primary/80 transition-colors",
                    point.submissions === 0 && "bg-muted-foreground/30",
                  )}
                  style={{ height }}
                  title={`${formatDay(point.date)}: ${point.submissions}`}
                />
              </div>
              <div className="h-4 text-[10px] text-muted-foreground">
                {showLabel ? formatDay(point.date) : ""}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4 p-4">
      <Skeleton className="h-10 w-72" />
      <div className="grid gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-20 rounded-md" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-md" />
      <Skeleton className="h-72 rounded-md" />
    </div>
  );
}

export function ResponseInsightsPage() {
  const [params] = useSearchParams();
  const formId = params.get("formId") ?? undefined;
  const { data, isLoading, error, refetch } = useResponseInsights(formId);
  const insights = data as ResponseInsightsWidgetResult | undefined;

  if (isLoading) return <LoadingState />;

  if (
    error ||
    !insights ||
    insights.widget !== "data-insights" ||
    insights.widgetId !== "forms.responseInsights.v1"
  ) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <IconChartBar className="size-8 text-muted-foreground" />
        <div className="space-y-1">
          <h1 className="text-base font-semibold">Insights unavailable</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Response insights could not be loaded for this view.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => refetch()}
        >
          <IconRefresh className="size-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  const { summary, chartSeries, table, display } = insights;

  return (
    <div className="flex min-h-full flex-col bg-background">
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-border pl-12 pr-3 sm:px-4 md:pl-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="gap-1.5">
            <Link to="/forms">
              <IconArrowLeft className="size-3.5" />
              Forms
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{display.title}</h1>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span className="truncate">
                {formatDay(summary.rangeStart)} - {formatDay(summary.rangeEnd)}
              </span>
              {summary.truncated || summary.scopeCapped ? (
                <Badge variant="secondary" className="h-5 shrink-0 text-[10px]">
                  Sampled
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild className="gap-1.5">
          <Link to={display.primaryAction.href}>
            {display.primaryAction.label}
            <IconExternalLink className="size-3.5" />
          </Link>
        </Button>
      </header>

      <main className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Responses"
              value={formatNumber(summary.responses)}
              detail={`${formatNumber(summary.sampledResponses)} sampled`}
            />
            <Metric
              label="Forms"
              value={formatNumber(summary.forms)}
              detail={summary.scopeCapped ? "Recent forms window" : undefined}
            />
            <Metric
              label="Window"
              value={`${insights.scope.days} days`}
              detail={`${formatDay(summary.rangeStart)} to ${formatDay(summary.rangeEnd)}`}
            />
            <Metric
              label="Table"
              value={formatNumber(table.rows.length)}
              detail={
                table.truncated
                  ? `${formatNumber(table.totalRows)} total`
                  : "All visible rows"
              }
            />
          </div>

          <div className="rounded-md border border-border bg-background p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">{chartSeries.title}</h2>
                <p className="text-xs text-muted-foreground">
                  {chartSeries.sampled
                    ? "Calculated from the recent response sample"
                    : "Calculated from visible response data"}
                </p>
              </div>
              <IconChartBar className="size-4 text-muted-foreground" />
            </div>
            <SubmissionBars data={chartSeries.data} />
          </div>
        </section>

        <section className="min-w-0 rounded-md border border-border bg-background">
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">{table.title}</h2>
              <p className="text-xs text-muted-foreground">
                {formatNumber(table.rows.length)} shown
                {table.truncated
                  ? ` of ${formatNumber(table.totalRows)} total`
                  : ""}
              </p>
            </div>
          </div>
          {table.rows.length === 0 ? (
            <div className="flex min-h-64 items-center justify-center p-6 text-center text-sm text-muted-foreground">
              No responses yet.
            </div>
          ) : (
            <div className="max-h-[calc(100vh-15rem)] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    {table.columns.map((column) => (
                      <TableHead
                        key={column.key}
                        className={cn(
                          "h-9 whitespace-nowrap px-3 text-xs",
                          column.align === "right" && "text-right",
                        )}
                      >
                        {column.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {table.rows.map((row) => (
                    <TableRow key={String(row.id)}>
                      {table.columns.map((column) => (
                        <TableCell
                          key={column.key}
                          className={cn(
                            "max-w-56 truncate px-3 py-2 text-xs",
                            column.align === "right" && "text-right",
                          )}
                          title={formatCell(row[column.key])}
                        >
                          {formatCell(row[column.key])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
