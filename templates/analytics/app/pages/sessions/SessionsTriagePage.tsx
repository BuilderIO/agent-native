import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useLabState } from "@agent-native/core/client/labs";
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconGauge,
  IconRefresh,
  IconX,
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
import { useReplayStorageStatus } from "@/hooks/use-replay-storage-status";
import { cn } from "@/lib/utils";

import { ANALYTICS_SESSIONS_TRIAGE_LAB } from "../../../shared/labs";
import {
  sessionDateBound,
  sessionDateForDisplay,
} from "../../../shared/session-date-bounds";
import {
  readSessionEventFilters,
  SESSION_DID_EVENT_PARAM,
  SESSION_DID_NOT_EVENT_PARAM,
} from "../../../shared/session-events";
import {
  readSessionPage,
  SESSION_PAGE_SIZE,
} from "../../../shared/session-page";
import {
  formatPerformanceValue,
  isSlowSessionFilter,
  rateWebVital,
  type SessionPerformanceSummary,
  SLOW_SESSION_FILTERS,
  type SlowSessionFilter,
} from "../../../shared/session-performance";
import {
  SessionEventFilter,
  type SessionEventConditions,
} from "./SessionEventFilter";
import {
  EmptySessionsState,
  formatSessionDuration,
  shouldShowZeroMinuteRecoveryAction,
  useDebouncedUrlFilter,
} from "./SessionsPage";

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
  performance?: SessionPerformanceSummary | null;
};

type Page = {
  recordings: Recording[];
  total: number;
  appCounts: { app: string; count: number }[];
  performanceCoverageStartedAt?: string | null;
};

const RANGES: Range[] = ["24h", "7d", "30d", "90d", "all"];
const SORTS: Sort[] = ["newest", "longest", "errors", "events", "rage"];
const DURATIONS = [0, 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];
// Every other search param counts as a filter for Clear all, so a param that
// is not a filter must be listed here or Clear all will show and drop it.
const NON_FILTER_PARAMS = new Set(["sort", "page"]);

function validRange(value: string | null): Range {
  return value === "custom" || RANGES.includes(value as Range)
    ? (value as Range)
    : "30d";
}

function rangeFrom(range: Range): string | undefined {
  if (range === "all" || range === "custom") return undefined;
  const hours =
    range === "24h" ? 24 : range === "7d" ? 168 : range === "90d" ? 2160 : 720;
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

export function readHideEmptyFilter(params: URLSearchParams): boolean {
  return params.has("hideEmpty")
    ? params.get("hideEmpty") !== "false"
    : params.get("includeZeroMinuteSessions") !== "true";
}

export function withCustomDate(
  current: URLSearchParams,
  key: "fromDate" | "toDate",
  value: string,
): URLSearchParams {
  const next = new URLSearchParams(current);
  next.set("range", "custom");
  const bound = key === "fromDate" ? "from" : "to";
  const iso = sessionDateBound(value, key === "toDate");
  if (value && iso) {
    next.set(key, value);
    next.set(bound, iso);
  } else {
    next.delete(key);
    next.delete(bound);
  }
  next.delete("page");
  return next;
}

export function withSessionFilter(
  current: URLSearchParams,
  key: string,
  value: string,
  resetPage = true,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (value) next.set(key, value);
  else next.delete(key);
  if (key === "range" && value !== "custom") {
    next.delete("fromDate");
    next.delete("toDate");
    next.delete("from");
    next.delete("to");
  }
  if (resetPage) next.delete("page");
  return next;
}

export function withSessionEventConditions(
  current: URLSearchParams,
  conditions: SessionEventConditions,
): URLSearchParams {
  const next = new URLSearchParams(current);
  next.delete(SESSION_DID_EVENT_PARAM);
  next.delete(SESSION_DID_NOT_EVENT_PARAM);
  for (const name of conditions.didEvents) {
    next.append(SESSION_DID_EVENT_PARAM, name);
  }
  for (const name of conditions.didNotEvents) {
    next.append(SESSION_DID_NOT_EVENT_PARAM, name);
  }
  next.delete("page");
  return next;
}

export function SessionsTriagePage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const eventsLab = useLabState(ANALYTICS_SESSIONS_TRIAGE_LAB);
  const eventsLabEnabled = eventsLab.enabled;
  const storageStatus = useReplayStorageStatus();
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
  const hideEmpty = readHideEmptyFilter(params);
  const hideInternal = params.get("hideInternal") === "true";
  const hasErrors = params.get("hasErrors") === "true";
  const hasNetworkErrors = params.get("hasNetworkErrors") === "true";
  const hasRageClicks = params.get("hasRageClicks") === "true";
  const minDurationMs = DURATIONS.includes(Number(params.get("minDurationMs")))
    ? Number(params.get("minDurationMs"))
    : 0;
  const requestedPage = params.get("page");
  const page = readSessionPage(requestedPage);
  const fromDate = sessionDateForDisplay(
    params.get("fromDate"),
    params.get("from"),
  );
  const toDate = sessionDateForDisplay(params.get("toDate"), params.get("to"));
  const urlEventConditions = readSessionEventFilters(params);
  // Event conditions only apply while the Lab is on; otherwise the URL keeps
  // them without hiding sessions behind a filter the user cannot see.
  const eventConditions = eventsLabEnabled
    ? urlEventConditions
    : { didEvents: [], didNotEvents: [] };
  const urlHasEventConditions =
    urlEventConditions.didEvents.length > 0 ||
    urlEventConditions.didNotEvents.length > 0;
  const urlSlow = params.get("slow");
  const slow: SlowSessionFilter | undefined =
    eventsLabEnabled && isSlowSessionFilter(urlSlow) ? urlSlow : undefined;
  const urlHasSlowFilter = isSlowSessionFilter(urlSlow);
  // A shared link with event or slow conditions waits for the Lab state
  // instead of briefly listing unfiltered sessions.
  const waitingForEventsLab =
    (urlHasEventConditions || urlHasSlowFilter) && eventsLab.isLoading;

  useEffect(() => {
    if (requestedPage === null || requestedPage === String(page)) return;
    setParams(
      (current) => {
        if (current.get("page") !== requestedPage) return current;
        const next = new URLSearchParams(current);
        if (page === 1) next.delete("page");
        else next.set("page", String(page));
        return next;
      },
      { replace: true },
    );
  }, [requestedPage, page, setParams]);

  const setCustomDate = useCallback(
    (key: "fromDate" | "toDate", value: string) => {
      setParams((current) => withCustomDate(current, key, value), {
        replace: true,
      });
    },
    [setParams],
  );

  const setEventConditions = useCallback(
    (conditions: SessionEventConditions) => {
      setParams((current) => withSessionEventConditions(current, conditions), {
        replace: true,
      });
    },
    [setParams],
  );

  const setFilter = useCallback(
    (key: string, value: string, resetPage = true) => {
      setParams(
        (current) => withSessionFilter(current, key, value, resetPage),
        {
          replace: true,
        },
      );
    },
    [setParams],
  );
  const hasActiveFilters = [...params.keys()].some(
    (key) => !NON_FILTER_PARAMS.has(key),
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
  const clearFilters = useCallback(() => {
    // A draft that never reached the URL survives the URL reset, and its
    // pending debounce would write it back, so empty the drafts too.
    setQueryInput("");
    setDomainInput("");
    setParams(
      (current) => {
        const next = new URLSearchParams();
        const currentSort = current.get("sort");
        if (currentSort) next.set("sort", currentSort);
        return next;
      },
      { replace: true },
    );
  }, [setParams, setQueryInput, setDomainInput]);
  const dateBounds = useMemo(
    () => ({
      from:
        range === "custom"
          ? (params.get("from") ?? sessionDateBound(fromDate))
          : rangeFrom(range),
      to:
        range === "custom"
          ? (params.get("to") ?? sessionDateBound(toDate, true))
          : undefined,
    }),
    [range, fromDate, toDate, params],
  );

  const { data, error, isPending, isFetching, refetch } = useActionQuery<Page>(
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
      didEvents: eventConditions.didEvents.length
        ? eventConditions.didEvents
        : undefined,
      didNotEvents: eventConditions.didNotEvents.length
        ? eventConditions.didNotEvents
        : undefined,
      slow,
      includePerformance: eventsLabEnabled || undefined,
      sort,
      offset: (page - 1) * SESSION_PAGE_SIZE,
      limit: SESSION_PAGE_SIZE,
    },
    { staleTime: 30_000, enabled: !waitingForEventsLab },
  );
  const recordings = data?.recordings ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / SESSION_PAGE_SIZE));
  useEffect(() => {
    if (!data || isPending || isFetching || error || page <= lastPage) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("page", String(lastPage));
        return next;
      },
      { replace: true },
    );
  }, [data, isPending, isFetching, error, page, lastPage, setParams]);
  const checkHiddenSessions = hideEmpty && !isPending && !error && total === 0;
  const { data: withEmptySessions } = useActionQuery<Page>(
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
      hasErrors: hasErrors || undefined,
      hasNetworkErrors: hasNetworkErrors || undefined,
      hasRageClicks: hasRageClicks || undefined,
      didEvents: eventConditions.didEvents.length
        ? eventConditions.didEvents
        : undefined,
      didNotEvents: eventConditions.didNotEvents.length
        ? eventConditions.didNotEvents
        : undefined,
      slow,
      sort,
      limit: 1,
    },
    { enabled: checkHiddenSessions, staleTime: 30_000 },
  );
  const showEmptySessionRecovery = shouldShowZeroMinuteRecoveryAction(
    !hideEmpty,
    total,
    withEmptySessions?.total ?? 0,
  );

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
              <div className="flex items-center justify-between">
                <Label>{t("sessions.range")}</Label>
                <span className="text-xs text-muted-foreground">
                  {t("sessions.utc")}
                </span>
              </div>
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
                  <div className="flex items-center justify-between gap-1">
                    <Label>{t("sessions.fromDate")}</Label>
                    {fromDate ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        aria-label={t("sessions.clearFromDate")}
                        onClick={() => setCustomDate("fromDate", "")}
                      >
                        <IconX className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
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
                  <div className="flex items-center justify-between gap-1">
                    <Label>{t("sessions.toDate")}</Label>
                    {toDate ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        aria-label={t("sessions.clearToDate")}
                        onClick={() => setCustomDate("toDate", "")}
                      >
                        <IconX className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
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
                  setFilter("hideEmpty", checked ? "true" : "false")
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
        {eventsLabEnabled ? (
          <SessionEventFilter
            conditions={eventConditions}
            from={dateBounds.from}
            to={dateBounds.to}
            app={app}
            catalogHref={eventCatalogHref(range, app)}
            onChange={setEventConditions}
          />
        ) : null}
        {eventsLabEnabled ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={slow ? "secondary" : "outline"}
                size="sm"
                className={cn(
                  "h-8 border border-input font-normal",
                  !slow && "bg-transparent hover:bg-accent",
                )}
              >
                <IconGauge />
                {slow ? slowFilterLabel(slow, t) : t("sessions.speed")}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72">
              <div className="space-y-3">
                <Select
                  value={slow ?? "all"}
                  onValueChange={(value) =>
                    setFilter("slow", value === "all" ? "" : value)
                  }
                >
                  <SelectTrigger aria-label={t("sessions.speed")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {t("sessions.anySpeed")}
                    </SelectItem>
                    {SLOW_SESSION_FILTERS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {slowFilterLabel(value, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {data ? (
                  <p className="text-xs text-muted-foreground">
                    {data.performanceCoverageStartedAt
                      ? t("sessions.speedCoverageSince", {
                          date: new Date(
                            data.performanceCoverageStartedAt,
                          ).toLocaleDateString(),
                        })
                      : t("sessions.speedCoverageStarting")}
                  </p>
                ) : null}
                <Button asChild variant="outline" size="sm">
                  <Link to={routePerformanceHref(range, app)}>
                    {t("sessions.routePerformance")}
                  </Link>
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        ) : null}
        {hasActiveFilters ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 font-normal text-muted-foreground"
            onClick={clearFilters}
          >
            <IconX />
            {t("sessions.clearFilters")}
          </Button>
        ) : null}
      </div>
      {urlHasEventConditions && !eventsLabEnabled && !eventsLab.isLoading ? (
        <p className="text-xs text-muted-foreground" role="status">
          {t("sessions.eventFiltersNeedLab")}
        </p>
      ) : null}
      {urlHasSlowFilter && !eventsLabEnabled && !eventsLab.isLoading ? (
        <p className="text-xs text-muted-foreground" role="status">
          {t("sessions.speedFilterNeedsLab")}
        </p>
      ) : null}
      <Card>
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2 text-sm">
          <div className="text-muted-foreground" aria-live="polite">
            {data ? (
              t(total === 1 ? "sessions.showingSingular" : "sessions.showing", {
                count: total.toLocaleString(),
              })
            ) : isPending ? (
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
          ) : isPending ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 7 }, (_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </div>
          ) : (
            <>
              {recordings.length === 0 &&
              storageStatus.data?.configured === false ? (
                <EmptySessionsState />
              ) : recordings.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">
                  <p>{t("sessions.noSessions")}</p>
                  {showEmptySessionRecovery ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4"
                      onClick={() => setFilter("hideEmpty", "false")}
                    >
                      {t("sessions.includeZeroMinuteSessions")}
                    </Button>
                  ) : null}
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
                        {recording.performance ? (
                          <PerformanceHints
                            performance={recording.performance}
                          />
                        ) : null}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              {total > SESSION_PAGE_SIZE && (
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

const POOR_VITAL_HINTS = [
  ["lcp", "lcpMs", "LCP"],
  ["inp", "inpMs", "INP"],
  ["cls", "cls", "CLS"],
  ["ttfb", "ttfbMs", "TTFB"],
] as const;

function PerformanceHints({
  performance,
}: {
  performance: SessionPerformanceSummary;
}) {
  const t = useT();
  const poor = POOR_VITAL_HINTS.flatMap(([metric, key, name]) => {
    const value = performance[key];
    return value !== null && rateWebVital(metric, value) === "poor"
      ? [`${name} ${formatPerformanceValue(metric, value)}`]
      : [];
  });
  return (
    <>
      {poor.map((hint) => (
        <span key={hint} className="text-destructive">
          {hint}
        </span>
      ))}
      {performance.slowRequests > 0 ? (
        <span>
          {t(
            performance.slowRequests === 1
              ? "sessions.slowRequestCountSingular"
              : "sessions.slowRequestCount",
            { count: performance.slowRequests.toLocaleString() },
          )}
        </span>
      ) : null}
    </>
  );
}

function routePerformanceHref(range: Range, app: string): string {
  const next = new URLSearchParams();
  if (range === "30d" || range === "90d") next.set("range", range);
  if (app) next.set("app", app);
  const query = next.toString();
  return `/sessions/performance${query ? `?${query}` : ""}`;
}

function slowFilterLabel(
  value: SlowSessionFilter,
  t: ReturnType<typeof useT>,
): string {
  if (value === "vitals") return t("sessions.speedPoorVitals");
  if (value === "requests") return t("sessions.speedSlowRequests");
  return t("sessions.speedSlowAny");
}

function eventCatalogHref(range: Range, app: string): string {
  const next = new URLSearchParams();
  if (range !== "custom" && range !== "30d") next.set("range", range);
  if (app) next.set("app", app);
  const query = next.toString();
  return `/sessions/events${query ? `?${query}` : ""}`;
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
