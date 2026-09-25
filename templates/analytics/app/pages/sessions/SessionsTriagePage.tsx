import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconRefresh,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { formatSessionDuration, useDebouncedUrlFilter } from "./SessionsPage";

type Range = "24h" | "7d" | "30d" | "90d" | "all" | "custom";
type Sort = "newest" | "longest" | "errors" | "events" | "rage";
type VisitorType = "internal" | "work" | "personal";

type Recording = {
  id: string;
  sessionId: string;
  userId: string | null;
  userKey: string | null;
  anonymousId: string | null;
  startedAt: string;
  durationMs: number | null;
  eventCount: number;
  pageCount: number;
  errorCount: number;
  networkErrorCount: number;
  rageClickCount: number;
  app: string | null;
  template: string | null;
  path: string | null;
  hostname: string | null;
};

type Page = {
  recordings: Recording[];
  total: number;
  appCounts: { app: string; count: number }[];
};

const PAGE_SIZE = 100;
const RANGES: Range[] = ["24h", "7d", "30d", "90d", "all"];
const SORTS: Sort[] = ["newest", "longest", "errors", "events", "rage"];
const DURATIONS = [0, 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];

function validRange(value: string | null): Range {
  return value === "custom" || RANGES.includes(value as Range)
    ? (value as Range)
    : "30d";
}

function startOfDate(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function endOfDate(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function rangeFrom(range: Range): string | undefined {
  if (range === "all" || range === "custom") return undefined;
  const hours =
    range === "24h" ? 24 : range === "7d" ? 168 : range === "90d" ? 2160 : 720;
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

export function SessionsTriagePage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("triage") === "1") return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("triage", "1");
        return next;
      },
      { replace: true },
    );
  }, [params, setParams]);
  const range = validRange(params.get("range"));
  const app = params.get("app") ?? "";
  const query = params.get("q") ?? "";
  const domain = params.get("emailDomain") ?? "";
  const sort = SORTS.includes(params.get("sort") as Sort)
    ? (params.get("sort") as Sort)
    : "newest";
  const visitorType = (["internal", "work", "personal"] as VisitorType[]).find(
    (value) => value === params.get("visitorType"),
  );
  const hideEmpty = params.get("hideEmpty") !== "false";
  const hideInternal = params.get("hideInternal") === "true";
  const hasErrors = params.get("hasErrors") === "true";
  const hasNetworkErrors = params.get("hasNetworkErrors") === "true";
  const hasRageClicks = params.get("hasRageClicks") === "true";
  const minDurationMs = DURATIONS.includes(Number(params.get("minDurationMs")))
    ? Number(params.get("minDurationMs"))
    : 0;
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const fromDate = params.get("fromDate") ?? "";
  const toDate = params.get("toDate") ?? "";

  const setCustomDate = useCallback(
    (key: "fromDate" | "toDate", value: string) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("range", "custom");
          next.set("triage", "1");
          const bound = key === "fromDate" ? "from" : "to";
          const iso =
            key === "fromDate" ? startOfDate(value) : endOfDate(value);
          if (value && iso) {
            next.set(key, value);
            next.set(bound, iso);
          } else {
            next.delete(key);
            next.delete(bound);
          }
          next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const setFilter = useCallback(
    (key: string, value: string, resetPage = true) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("triage", "1");
          if (value) next.set(key, value);
          else next.delete(key);
          if (resetPage) next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const commitQuery = useCallback(
    (value: string) => setFilter("q", value),
    [setFilter],
  );
  const commitDomain = useCallback(
    (value: string) => setFilter("emailDomain", value.trim()),
    [setFilter],
  );
  const [queryInput, setQueryInput] = useDebouncedUrlFilter(query, commitQuery);
  const [domainInput, setDomainInput] = useDebouncedUrlFilter(
    domain,
    commitDomain,
  );
  const dateBounds = useMemo(
    () => ({
      from:
        range === "custom"
          ? (params.get("from") ?? startOfDate(fromDate))
          : rangeFrom(range),
      to:
        range === "custom"
          ? (params.get("to") ?? endOfDate(toDate))
          : undefined,
    }),
    [range, fromDate, toDate, params],
  );

  const { data, error, isLoading, isFetching, refetch } = useActionQuery<Page>(
    "list-session-recordings",
    {
      paginated: true,
      ...dateBounds,
      app: app || undefined,
      query: query || undefined,
      emailDomain: domain || undefined,
      visitorType,
      hideInternal: hideInternal || undefined,
      minDurationMs: minDurationMs || undefined,
      hideEmpty: hideEmpty || undefined,
      hasErrors: hasErrors || undefined,
      hasNetworkErrors: hasNetworkErrors || undefined,
      hasRageClicks: hasRageClicks || undefined,
      sort,
      offset: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
    },
    { staleTime: 30_000 },
  );
  const recordings = data?.recordings ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function toggle(key: string, enabled: boolean) {
    setFilter(key, enabled ? "true" : "");
  }

  return (
    <div className="analytics-sessions-page mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-56 flex-1 max-sm:basis-full">
          <Input
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder={t("sessions.searchPlaceholder")}
            aria-label={t("sessions.searchPlaceholder")}
            className="h-8 bg-transparent"
          />
        </div>
        <Select
          value={app || "all"}
          onValueChange={(value) =>
            setFilter("app", value === "all" ? "" : value)
          }
        >
          <SelectTrigger
            className="h-8 w-auto min-w-28 gap-2 bg-transparent"
            aria-label={t("sessions.app")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("sessions.allApps")}</SelectItem>
            {(data?.appCounts ?? []).map(({ app: name, count }) => (
              <SelectItem key={name} value={name}>
                {name} ({count.toLocaleString()})
              </SelectItem>
            ))}
            {app && !data?.appCounts?.some(({ app: name }) => name === app) ? (
              <SelectItem value={app}>{app}</SelectItem>
            ) : null}
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border border-input bg-transparent font-normal hover:bg-accent"
            >
              <IconCalendar />
              {range === "custom"
                ? t("sessions.customRange")
                : rangeLabel(range, t)}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72">
            <div className="space-y-3">
              <Label>{t("sessions.range")}</Label>
              <Select
                value={range}
                onValueChange={(value) => setFilter("range", value)}
              >
                <SelectTrigger aria-label={t("sessions.range")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RANGES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {rangeLabel(value, t)}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">
                    {t("sessions.customRange")}
                  </SelectItem>
                </SelectContent>
              </Select>
              <div className="grid grid-cols-2 gap-2">
                <div
                  className="space-y-1"
                  role="group"
                  aria-label={t("sessions.fromDate")}
                >
                  <Label>{t("sessions.fromDate")}</Label>
                  <DatePicker
                    value={fromDate}
                    placeholder={t("sessions.fromDate")}
                    onChange={(value) => setCustomDate("fromDate", value)}
                  />
                </div>
                <div
                  className="space-y-1"
                  role="group"
                  aria-label={t("sessions.toDate")}
                >
                  <Label>{t("sessions.toDate")}</Label>
                  <DatePicker
                    value={toDate}
                    placeholder={t("sessions.toDate")}
                    onChange={(value) => setCustomDate("toDate", value)}
                  />
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <Select
          value={String(minDurationMs)}
          onValueChange={(value) =>
            setFilter("minDurationMs", value === "0" ? "" : value)
          }
        >
          <SelectTrigger
            className="h-8 w-auto min-w-32 gap-2 bg-transparent"
            aria-label={t("sessions.duration")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DURATIONS.map((value) => (
              <SelectItem key={value} value={String(value)}>
                {durationLabel(value, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={
                hasErrors || hasNetworkErrors || hasRageClicks || !hideEmpty
                  ? "secondary"
                  : "outline"
              }
              size="sm"
              className={cn(
                "h-8 border border-input font-normal",
                !(
                  hasErrors ||
                  hasNetworkErrors ||
                  hasRageClicks ||
                  !hideEmpty
                ) && "bg-transparent hover:bg-accent",
              )}
            >
              {t("sessions.signals")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56">
            <div className="space-y-3">
              <CheckFilter
                label={t("sessions.hideEmptySessions")}
                checked={hideEmpty}
                onChange={(checked) =>
                  setFilter("hideEmpty", checked ? "" : "false")
                }
              />
              <CheckFilter
                label={t("sessions.errors")}
                checked={hasErrors}
                onChange={(checked) => toggle("hasErrors", checked)}
              />
              <CheckFilter
                label={t("sessions.networkErrors")}
                checked={hasNetworkErrors}
                onChange={(checked) => toggle("hasNetworkErrors", checked)}
              />
              <CheckFilter
                label={t("sessions.rageClicksFilter")}
                checked={hasRageClicks}
                onChange={(checked) => toggle("hasRageClicks", checked)}
              />
            </div>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={
                visitorType || hideInternal || domain ? "secondary" : "outline"
              }
              size="sm"
              className={cn(
                "h-8 border border-input font-normal",
                !(visitorType || hideInternal || domain) &&
                  "bg-transparent hover:bg-accent",
              )}
            >
              {t("sessions.visitors")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64">
            <div className="space-y-3">
              <Select
                value={visitorType ?? "all"}
                onValueChange={(value) =>
                  setFilter("visitorType", value === "all" ? "" : value)
                }
              >
                <SelectTrigger aria-label={t("sessions.visitors")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("sessions.allVisitors")}
                  </SelectItem>
                  <SelectItem value="internal">
                    {t("sessions.internalVisitors")}
                  </SelectItem>
                  <SelectItem value="work">
                    {t("sessions.workVisitors")}
                  </SelectItem>
                  <SelectItem value="personal">
                    {t("sessions.personalVisitors")}
                  </SelectItem>
                </SelectContent>
              </Select>
              <CheckFilter
                label={t("sessions.hideInternal")}
                checked={hideInternal}
                onChange={(checked) => toggle("hideInternal", checked)}
              />
              <div className="space-y-1">
                <Label htmlFor="sessions-email-domain">
                  {t("sessions.emailDomain")}
                </Label>
                <Input
                  id="sessions-email-domain"
                  aria-label={t("sessions.emailDomain")}
                  value={domainInput}
                  onChange={(event) => setDomainInput(event.target.value)}
                  placeholder="example.com"
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <Card>
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2 text-sm">
          <div className="text-muted-foreground" aria-live="polite">
            {data ? (
              t(total === 1 ? "sessions.showingSingular" : "sessions.showing", {
                count: total.toLocaleString(),
              })
            ) : isLoading ? (
              <Skeleton className="h-4 w-24" />
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Select
              value={sort}
              onValueChange={(value) =>
                setFilter("sort", value === "newest" ? "" : value)
              }
            >
              <SelectTrigger
                className="h-8 w-auto gap-2 border-transparent bg-transparent shadow-none text-xs"
                aria-label={t("sessions.sortBy")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {sortLabel(value, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              onClick={() => void refetch()}
              disabled={isFetching}
              aria-label={t("sessions.refresh")}
            >
              <IconRefresh className={cn(isFetching && "animate-spin")} />
            </Button>
          </div>
        </div>
        <div>
          {error ? (
            <div className="p-6 text-sm text-destructive" role="alert">
              {t("sessions.loadFailed", { message: error.message })}
            </div>
          ) : isLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 7 }, (_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </div>
          ) : (
            <>
              {recordings.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">
                  {t("sessions.noSessions")}
                </div>
              ) : (
                <div className="divide-y">
                  {recordings.map((recording) => (
                    <Link
                      key={recording.id}
                      to={`/sessions/${encodeURIComponent(recording.id)}`}
                      className="grid gap-2 px-4 py-3 hover:bg-muted/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:grid-cols-4"
                      aria-label={`${t("sessions.watchReplay")}: ${recording.userId || recording.userKey || recording.anonymousId || t("sessions.anonymous")}`}
                    >
                      <span className="font-medium text-primary">
                        {formatSessionDuration(recording.durationMs)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {recording.userId ||
                            recording.userKey ||
                            recording.anonymousId ||
                            t("sessions.anonymous")}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {new Date(recording.startedAt).toLocaleString()}
                        </span>
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-primary">
                          {recording.path ||
                            recording.hostname ||
                            recording.sessionId}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {recording.app ||
                            recording.template ||
                            t("sessions.unknownApp")}
                        </span>
                      </span>
                      <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          {t("sessions.eventCountCompact", {
                            count: recording.eventCount.toLocaleString(),
                          })}
                        </span>
                        {recording.errorCount > 0 && (
                          <span className="text-destructive">
                            {t(
                              recording.errorCount === 1
                                ? "sessions.errorCountSingular"
                                : "sessions.errorCount",
                              { count: recording.errorCount.toLocaleString() },
                            )}
                          </span>
                        )}
                        <span>
                          {t(
                            recording.networkErrorCount === 1
                              ? "sessions.networkErrorCountSingular"
                              : "sessions.networkErrorCount",
                            {
                              count:
                                recording.networkErrorCount.toLocaleString(),
                            },
                          )}
                        </span>
                        {recording.rageClickCount > 0 && (
                          <span>
                            {t(
                              recording.rageClickCount === 1
                                ? "sessions.rageClickCountSingular"
                                : "sessions.rageClicks",
                              {
                                count:
                                  recording.rageClickCount.toLocaleString(),
                              },
                            )}
                          </span>
                        )}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              {total > PAGE_SIZE && (
                <div className="flex items-center justify-between border-t px-4 py-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setFilter("page", String(page - 1), false)}
                  >
                    <IconChevronLeft />
                    {t("sessions.previousPage")}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {t("sessions.pageOf", {
                      page: String(page),
                      total: String(lastPage),
                    })}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= lastPage}
                    onClick={() => setFilter("page", String(page + 1), false)}
                  >
                    {t("sessions.nextPage")}
                    <IconChevronRight />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

function CheckFilter({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <Checkbox
        aria-label={label}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      {label}
    </label>
  );
}

function rangeLabel(value: Range, t: ReturnType<typeof useT>): string {
  if (value === "24h") return t("sessions.last24h");
  if (value === "7d") return t("sessions.last7d");
  if (value === "30d") return t("sessions.last30d");
  if (value === "90d") return t("sessions.last90d");
  return t("sessions.allTime");
}

function durationLabel(value: number, t: ReturnType<typeof useT>): string {
  if (value === 0) return t("sessions.anyDuration");
  return t("sessions.minDuration", { minutes: String(value / 60_000) });
}

function sortLabel(value: Sort, t: ReturnType<typeof useT>): string {
  if (value === "newest") return t("sessions.sortNewest");
  if (value === "longest") return t("sessions.sortLongest");
  if (value === "errors") return t("sessions.sortErrors");
  if (value === "events") return t("sessions.sortEvents");
  return t("sessions.sortRageClicks");
}
