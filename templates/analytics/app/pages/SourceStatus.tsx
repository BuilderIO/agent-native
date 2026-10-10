import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { useOrgRole } from "@agent-native/core/client/org";
import {
  IconAlertCircle,
  IconCheck,
  IconCircle,
  IconDownload,
  IconLoader2,
  IconUpload,
} from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  collectDictionaryEntries,
  DICTIONARY_EXPORT_PAGE_SIZE,
  dictionaryEntriesToCsv,
  DictionaryExportError,
} from "@/lib/data-dictionary-export";
import type { DataSourceStatusResponse } from "@/lib/data-source-status";
import {
  SOURCE_HEALTH_SOURCES,
  sourceHealthState,
  type SourceHealthState,
} from "@/lib/source-status";

interface IndexStatusAvailable {
  status: "available";
  generatedAt: string;
  entryCount: number;
  sources: Array<{ id: string; revision?: string }>;
  sourceCounts?: Array<{ source: string; entryCount: number }>;
  ageDays: number;
  staleAfterDays: number;
  stale: boolean;
}

type IndexStatus =
  | IndexStatusAvailable
  | { status: "not-configured" | "unavailable" | "invalid" };

const statusCopyKeys = {
  connected: "dataStatus.connected",
  not_connected: "dataStatus.notConnected",
  needs_reauth: "dataStatus.needsReauth",
  error: "dataStatus.error",
} as const satisfies Record<SourceHealthState, string>;

const statusIcons = {
  connected: IconCheck,
  not_connected: IconCircle,
  needs_reauth: IconAlertCircle,
  error: IconAlertCircle,
};

const sourceLabels: Record<string, string> = {
  amplitude: "Amplitude",
  bigquery: "BigQuery",
  dbt: "dbt Cloud",
  dbt_cloud: "dbt Cloud",
  dbt_semantic_layer: "dbt Cloud",
  github: "GitHub",
  sigma: "Sigma",
};

function SourceHealthRow({
  source,
  state,
}: {
  source: (typeof SOURCE_HEALTH_SOURCES)[number];
  state: SourceHealthState;
}) {
  const t = useT();
  const SourceIcon = source.icon;
  const StatusIcon = statusIcons[state];
  const statusClass =
    state === "error"
      ? "text-destructive"
      : state === "connected"
        ? "text-foreground"
        : "text-muted-foreground";

  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border/60 py-3 last:border-b-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground">
          <SourceIcon aria-hidden="true" className="size-4" />
        </span>
        <span className="truncate text-sm font-medium">{source.label}</span>
      </div>
      <Badge variant="outline" className="shrink-0 gap-1.5 font-normal">
        <StatusIcon aria-hidden="true" className={`size-3.5 ${statusClass}`} />
        {t(statusCopyKeys[state])}
      </Badge>
    </div>
  );
}

function indexStatusMessage(
  status: IndexStatus | undefined,
  failed: boolean,
  t: ReturnType<typeof useT>,
): string | null {
  if (failed || !status) return t("dataStatus.indexReadFailed");
  if (status.status === "invalid") return t("dataStatus.indexUnreadable");
  if (status.status === "unavailable") return t("dataStatus.indexReadFailed");
  if (status.status === "not-configured") {
    return t("dataStatus.indexNotImported");
  }
  return null;
}

function sourceCountRows(status: IndexStatusAvailable) {
  const counts = new Map(
    (status.sourceCounts ?? []).map(({ source, entryCount }) => [
      source,
      entryCount,
    ]),
  );
  const ids = new Set([
    ...status.sources.map(({ id }) => id),
    ...counts.keys(),
  ]);
  return [...ids]
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({
      id,
      label: sourceLabels[id] ?? id,
      count: counts.get(id),
    }));
}

function downloadCsv(csv: string) {
  const fileName = `analytics-data-dictionary-${new Date().toISOString().slice(0, 10)}.csv`;
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function SourceStatus() {
  const t = useT();
  const formatters = useFormatters();
  const { canManageOrg } = useOrgRole();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const sourceQuery = useActionQuery("data-source-status", undefined, {
    retry: false,
    staleTime: 15_000,
  });
  const indexQuery = useActionQuery(
    "get-data-dictionary-index-status",
    undefined,
    {
      retry: false,
      staleTime: 30_000,
    },
  );
  const sourceStatus = sourceQuery.data as DataSourceStatusResponse | undefined;
  const indexStatus = indexQuery.data as IndexStatus | undefined;
  const indexMessage = indexStatusMessage(indexStatus, indexQuery.isError, t);
  const indexCounts =
    indexStatus?.status === "available" ? sourceCountRows(indexStatus) : [];

  async function exportDictionary() {
    setExportError("");
    setExporting(true);
    try {
      const entries = await collectDictionaryEntries(async (nextPage) =>
        callAction(
          "list-data-dictionary",
          {
            limit: DICTIONARY_EXPORT_PAGE_SIZE,
            ...(nextPage ? { nextPage } : {}),
          },
          { method: "GET" },
        ),
      );
      if (entries.length === 0) {
        setExportError(t("dataStatus.exportEmpty"));
        return;
      }
      downloadCsv(dictionaryEntriesToCsv(entries));
    } catch (error) {
      setExportError(
        error instanceof DictionaryExportError && error.kind === "page_limit"
          ? t("dataStatus.exportLimitReached")
          : t("dataStatus.exportFailed"),
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>{t("dataStatus.sources")}</CardTitle>
        </CardHeader>
        <CardContent aria-live="polite">
          {sourceQuery.isLoading && !sourceStatus ? (
            <div
              className="space-y-3"
              aria-label={t("dataStatus.loadingSources")}
            >
              {SOURCE_HEALTH_SOURCES.map((source) => (
                <Skeleton key={source.id} className="h-11 w-full" />
              ))}
            </div>
          ) : (
            <div>
              {SOURCE_HEALTH_SOURCES.map((source) => (
                <SourceHealthRow
                  key={source.id}
                  source={source}
                  state={sourceHealthState(
                    source.id,
                    sourceStatus,
                    sourceQuery.isError,
                  )}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t("dataStatus.index")}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void exportDictionary()}
              disabled={exporting}
            >
              {exporting ? (
                <IconLoader2
                  aria-hidden="true"
                  className="size-4 animate-spin"
                />
              ) : (
                <IconDownload aria-hidden="true" className="size-4" />
              )}
              {exporting
                ? t("dataStatus.exportingDictionary")
                : t("dataStatus.exportDictionary")}
            </Button>
            {canManageOrg ? (
              <Button asChild size="sm" variant="outline">
                <Link to="/data-dictionary">
                  <IconUpload aria-hidden="true" className="size-4" />
                  {t("dataStatus.adminUpload")}
                </Link>
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {indexQuery.isLoading && !indexStatus ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-24 w-full sm:col-span-2" />
            </div>
          ) : indexMessage ? (
            <p
              role={indexQuery.isError ? "alert" : "status"}
              className={
                indexQuery.isError
                  ? "text-sm text-destructive"
                  : "text-sm text-muted-foreground"
              }
            >
              {indexMessage}
            </p>
          ) : indexStatus?.status === "available" ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-border p-3">
                  <div className="text-xs text-muted-foreground">
                    {t("dataStatus.lastBuilt")}
                  </div>
                  <div className="mt-1 text-sm font-medium">
                    {formatters.formatDate(indexStatus.generatedAt, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
                <div className="rounded-md border border-border p-3">
                  <div className="text-xs text-muted-foreground">
                    {t("dataStatus.freshness")}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {t(
                        indexStatus.stale
                          ? "dataStatus.stale"
                          : "dataStatus.fresh",
                        {
                          age: formatters.formatRelativeTime(
                            -indexStatus.ageDays,
                            "day",
                          ),
                        },
                      )}
                    </Badge>
                    <Badge variant="outline">
                      {t("dataStatus.generatedUnapproved")}
                    </Badge>
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <div className="mb-2 text-xs font-medium text-muted-foreground">
                    {t("dataStatus.entriesBySource", {
                      count: formatters.formatNumber(indexStatus.entryCount),
                    })}
                  </div>
                  {indexCounts.length > 0 ? (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {indexCounts.map((source) => (
                        <li
                          key={source.id}
                          className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                        >
                          <span className="truncate">{source.label}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {source.count === undefined
                              ? t("dataStatus.countUnavailable")
                              : formatters.formatNumber(source.count)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t("dataStatus.noSourceEntries")}
                    </p>
                  )}
                </div>
              </div>
            </>
          ) : null}
          {exportError ? (
            <p role="alert" className="text-sm text-destructive">
              {exportError}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
