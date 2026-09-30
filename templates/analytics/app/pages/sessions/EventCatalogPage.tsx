import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useLabState } from "@agent-native/core/client/labs";
import {
  IconArrowLeft,
  IconInfoCircle,
  IconRefresh,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { ANALYTICS_SESSIONS_TRIAGE_LAB } from "../../../shared/labs";
import {
  type EventCatalogEntry,
  type EventCatalogResult,
  sessionsWithEventPath,
} from "../../../shared/session-events";

const CATALOG_RANGES = ["7d", "30d", "90d"] as const;
type CatalogRange = (typeof CATALOG_RANGES)[number];
const MAX_PROPERTY_KEYS_SHOWN = 6;
const LAB_SETTINGS_PATH = `/settings/labs/lab-${ANALYTICS_SESSIONS_TRIAGE_LAB.key}`;

function validCatalogRange(value: string | null): CatalogRange {
  return CATALOG_RANGES.includes(value as CatalogRange)
    ? (value as CatalogRange)
    : "30d";
}

function catalogRangeFrom(range: CatalogRange): string {
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function filterCatalogEntries(
  entries: EventCatalogEntry[],
  query: string,
): EventCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter(
    (entry) =>
      entry.eventName.toLowerCase().includes(needle) ||
      (entry.description ?? "").toLowerCase().includes(needle) ||
      entry.propertyKeys.some((key) => key.toLowerCase().includes(needle)),
  );
}

export default function EventCatalogPage() {
  const t = useT();
  const lab = useLabState(ANALYTICS_SESSIONS_TRIAGE_LAB);
  const [params, setParams] = useSearchParams();
  const range = validCatalogRange(params.get("range"));
  const app = params.get("app") ?? "";
  const [query, setQuery] = useState("");
  const from = useMemo(() => catalogRangeFrom(range), [range]);
  const { data, error, isPending, isFetching, refetch } =
    useActionQuery<EventCatalogResult>(
      "list-event-catalog",
      { from, app: app || undefined },
      { enabled: lab.enabled, staleTime: 60_000 },
    );
  const entries = useMemo(
    () => filterCatalogEntries(data?.entries ?? [], query),
    [data?.entries, query],
  );
  const automaticOnlyApps = (data?.apps ?? []).filter(
    (item) => item.onlyAutomaticEvents,
  );
  const sessionsHref = `/sessions${
    range !== "30d" || app
      ? `?${new URLSearchParams({
          ...(range !== "30d" ? { range } : {}),
          ...(app ? { app } : {}),
        }).toString()}`
      : ""
  }`;

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Button asChild variant="ghost" size="xs" className="-ml-2">
            <Link to={sessionsHref}>
              <IconArrowLeft />
              {t("sessions.title")}
            </Link>
          </Button>
          <h1 className="text-lg font-semibold">
            {t("sessions.eventCatalog")}
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("sessions.catalogDescription")}
          </p>
        </div>
      </div>

      {lab.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !lab.enabled ? (
        <Card>
          <div className="space-y-3 p-6 text-sm">
            <p>{t("sessions.catalogNeedsLab")}</p>
            <Button asChild variant="outline" size="sm">
              <Link to={LAB_SETTINGS_PATH}>
                {t("sessions.openLabSettings")}
              </Link>
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-56 flex-1 max-sm:basis-full">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("sessions.searchEvents")}
                aria-label={t("sessions.searchEvents")}
                className="h-8"
              />
            </div>
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
                {(data?.apps ?? [])
                  .filter((item) => item.app)
                  .map((item) => (
                    <SelectItem key={item.app} value={item.app!}>
                      {item.app}
                    </SelectItem>
                  ))}
                {app && !data?.apps?.some((item) => item.app === app) ? (
                  <SelectItem value={app}>{app}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
            <Select
              value={range}
              onValueChange={(value) =>
                setParam("range", value === "30d" ? "" : value)
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
          </div>

          {automaticOnlyApps.length ? (
            <Alert role="status">
              <IconInfoCircle />
              <AlertDescription>
                {automaticOnlyApps.map((item) => (
                  <p key={item.app ?? ""}>
                    {t("sessions.catalogOnlyAutomatic", {
                      app: item.app || t("sessions.unknownApp"),
                    })}
                  </p>
                ))}
              </AlertDescription>
            </Alert>
          ) : null}

          <Card>
            <div className="hidden grid-cols-6 gap-3 border-b px-4 py-2 text-xs font-medium text-muted-foreground sm:grid">
              <span className="col-span-3">{t("sessions.eventName")}</span>
              <span>{t("sessions.app")}</span>
              <span className="text-right">{t("sessions.catalogVolume")}</span>
              <span className="text-right">
                {t("sessions.catalogLastSeen")}
              </span>
            </div>
            {error ? (
              <div className="p-6 text-sm text-destructive" role="alert">
                {t("sessions.catalogLoadFailed", { message: error.message })}
              </div>
            ) : isPending ? (
              <div className="space-y-3 p-6">
                {Array.from({ length: 6 }, (_, index) => (
                  <Skeleton key={index} className="h-12 w-full" />
                ))}
              </div>
            ) : entries.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                {query.trim()
                  ? t("sessions.catalogNoMatches")
                  : t("sessions.catalogEmpty")}
              </div>
            ) : (
              <ul className="divide-y">
                {entries.map((entry) => (
                  <li key={`${entry.app ?? ""}:${entry.eventName}`}>
                    <CatalogRow entry={entry} range={range} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function CatalogRow({
  entry,
  range,
}: {
  entry: EventCatalogEntry;
  range: CatalogRange;
}) {
  const t = useT();
  const extraKeys = entry.propertyKeys.length - MAX_PROPERTY_KEYS_SHOWN;
  return (
    <Link
      to={sessionsWithEventPath(entry.eventName, {
        app: entry.app,
        range: range === "30d" ? null : range,
      })}
      aria-label={t("sessions.catalogOpenSessions", {
        event: entry.eventName,
      })}
      className="grid gap-2 px-4 py-3 hover:bg-muted/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:grid-cols-6 sm:gap-3"
    >
      <span className="min-w-0 space-y-1 sm:col-span-3">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="min-w-0 break-all font-mono text-sm font-medium text-primary">
            {entry.eventName}
          </span>
          {entry.automatic ? (
            <Badge variant="secondary">{t("sessions.catalogAutomatic")}</Badge>
          ) : null}
          {entry.stoppedFiring ? (
            <Badge variant="outline">
              {t("sessions.catalogStoppedFiring")}
            </Badge>
          ) : null}
        </span>
        {entry.description ? (
          <span className="line-clamp-2 block text-xs text-muted-foreground">
            {entry.description}
          </span>
        ) : null}
        {entry.propertyKeys.length ? (
          <span
            className="flex flex-wrap gap-1"
            aria-label={t("sessions.catalogPropertyKeys")}
          >
            {entry.propertyKeys.slice(0, MAX_PROPERTY_KEYS_SHOWN).map((key) => (
              <code
                key={key}
                className="rounded bg-muted px-1 py-0.5 text-xs text-muted-foreground"
              >
                {key}
              </code>
            ))}
            {extraKeys > 0 ? (
              <span className="text-xs text-muted-foreground">
                {t("sessions.catalogMoreKeys", { count: String(extraKeys) })}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
      <span className="truncate text-sm text-muted-foreground">
        {entry.app || t("sessions.unknownApp")}
      </span>
      <span className="text-sm tabular-nums sm:text-right">
        {t("sessions.eventCountCompact", {
          count: entry.volume.toLocaleString(),
        })}
      </span>
      <span className="text-xs text-muted-foreground sm:text-right sm:text-sm">
        {new Date(entry.lastSeenAt).toLocaleDateString()}
      </span>
    </Link>
  );
}
