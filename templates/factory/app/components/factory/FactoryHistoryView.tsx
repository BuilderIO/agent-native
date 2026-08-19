import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertCircle,
  IconCheck,
  IconHistory,
  IconLoader2,
  IconRestore,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { FactoryCanvas, type FactoryCanvasGraph } from "./FactoryCanvas";

type FactoryGraphVersion = {
  id: string;
  factoryId: string;
  version: number;
  source: string;
  changeSummary: string;
  createdAt: string;
  createdBy: string;
  isCurrent: boolean;
};

type FactoryGraphVersionSnapshot = FactoryGraphVersion & {
  graph: FactoryCanvasGraph;
};

type FactoryGraphHistoryResponse = {
  factoryId: string;
  currentVersion: number | null;
  hasMore: boolean;
  nextBeforeVersion: number | null;
  versions: FactoryGraphVersion[];
};

type RestoreResult = {
  versionId: string;
  graphVersion: number;
  name: string;
  graph: FactoryCanvasGraph;
};

interface FactoryHistoryViewProps {
  factoryId: string;
  currentVersion: number;
  hasUnsavedChanges: boolean;
  onRestored: (result?: RestoreResult) => Promise<void>;
}

const HISTORY_PAGE_SIZE = 25;

export function FactoryHistoryView({
  factoryId,
  currentVersion,
  hasUnsavedChanges,
  onRestored,
}: FactoryHistoryViewProps) {
  const t = useT();
  const [beforeVersion, setBeforeVersion] = useState<number | undefined>();
  const firstPageHistoryQuery = useActionQuery<FactoryGraphHistoryResponse>(
    "list-factory-graph-versions",
    {
      factoryId,
      limit: HISTORY_PAGE_SIZE,
    },
  );
  const olderHistoryQuery = useActionQuery<FactoryGraphHistoryResponse>(
    "list-factory-graph-versions",
    {
      factoryId,
      limit: HISTORY_PAGE_SIZE,
      beforeVersion,
    },
    { enabled: beforeVersion !== undefined },
  );
  const historyQuery =
    beforeVersion === undefined ? firstPageHistoryQuery : olderHistoryQuery;
  const [versions, setVersions] = useState<FactoryGraphVersion[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextBeforeVersion, setNextBeforeVersion] = useState<number | null>(
    null,
  );
  const restoreMutation = useActionMutation("restore-factory-graph-version");
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const [pendingRestore, setPendingRestore] =
    useState<FactoryGraphVersion | null>(null);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(
    null,
  );
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreRefreshError, setRestoreRefreshError] = useState<string | null>(
    null,
  );
  const [restoreStatus, setRestoreStatus] = useState<string | null>(null);

  useEffect(() => {
    const page = historyQuery.data;
    if (!page) return;
    setVersions((current) => {
      if (beforeVersion === undefined) return page.versions;
      const existingIds = new Set(current.map((version) => version.id));
      return [
        ...current,
        ...page.versions.filter((version) => !existingIds.has(version.id)),
      ];
    });
    setHasMore(page.hasMore);
    setNextBeforeVersion(page.nextBeforeVersion);
  }, [beforeVersion, historyQuery.data]);

  const selectedVersion =
    versions.find((version) => version.id === selectedVersionId) ??
    versions[0] ??
    null;
  const selectedSnapshotQuery = useActionQuery<FactoryGraphVersionSnapshot>(
    "get-factory-graph-version",
    selectedVersion
      ? { factoryId, versionId: selectedVersion.id }
      : { factoryId, versionId: "" },
    { enabled: Boolean(selectedVersion) },
  );

  async function refreshHistory(preferredVersionId?: string) {
    const refreshed = await firstPageHistoryQuery.refetch();
    if (refreshed.error || !refreshed.data) {
      throw refreshed.error ?? new Error("Factory history refresh failed.");
    }
    const page = refreshed.data;
    setBeforeVersion(undefined);
    setVersions(page.versions);
    setHasMore(page.hasMore);
    setNextBeforeVersion(page.nextBeforeVersion);
    setSelectedVersionId(
      preferredVersionId &&
        page.versions.some((version) => version.id === preferredVersionId)
        ? preferredVersionId
        : (page.versions[0]?.id ?? null),
    );
  }

  function isCurrent(version: FactoryGraphVersion) {
    return version.isCurrent || version.version === currentVersion;
  }

  function requestRestore(version: FactoryGraphVersion) {
    setRestoreError(null);
    setRestoreRefreshError(null);
    setRestoreStatus(null);
    setPendingRestore(version);
  }

  function loadOlderVersions() {
    if (historyQuery.isFetching || nextBeforeVersion === null) return;
    setBeforeVersion(nextBeforeVersion);
  }

  async function confirmRestore(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const version = pendingRestore;
    if (!version || restoringVersionId) return;

    setRestoreError(null);
    setRestoreRefreshError(null);
    setRestoringVersionId(version.id);
    let rawResult: unknown;
    try {
      rawResult = await restoreMutation.mutateAsync({
        factoryId,
        versionId: version.id,
      });
    } catch (error) {
      setRestoreError(
        error instanceof Error
          ? error.message
          : t("factoryRoute.historyRestoreFailed"),
      );
      setRestoringVersionId(null);
      return;
    }

    let result: RestoreResult;
    try {
      result = readRestoreResult(rawResult);
    } catch {
      setPendingRestore(null);
      setRestoreStatus(null);
      setRestoreError(t("factoryRoute.historyRestoreUnverified"));
      try {
        await onRestored();
      } catch {
        setRestoreRefreshError(t("factoryRoute.historyRefreshFailed"));
      }
      try {
        await refreshHistory();
      } catch {
        setRestoreRefreshError(t("factoryRoute.historyRefreshFailed"));
      }
      setRestoringVersionId(null);
      return;
    }

    setPendingRestore(null);
    setRestoreStatus(t("factoryRoute.historyRestored"));
    let refreshFailed = false;
    try {
      await onRestored(result);
    } catch {
      refreshFailed = true;
    }
    try {
      await refreshHistory(result.versionId);
    } catch {
      refreshFailed = true;
    }
    if (refreshFailed) {
      setRestoreRefreshError(t("factoryRoute.historyRefreshFailed"));
    }
    setRestoringVersionId(null);
  }

  if (
    historyQuery.isLoading ||
    (versions.length === 0 && historyQuery.isFetching)
  ) {
    return (
      <div
        className="grid gap-4 p-4 lg:grid-cols-[minmax(250px,.34fr)_minmax(0,1fr)] lg:p-6"
        aria-label={t("factoryRoute.historyLoading")}
      >
        <div className="h-[520px] animate-pulse rounded-xl bg-card shadow-sm" />
        <div className="h-[520px] animate-pulse rounded-xl bg-card shadow-sm" />
      </div>
    );
  }

  if (historyQuery.isError && versions.length === 0) {
    return (
      <div className="p-4 lg:p-6">
        <Card>
          <CardContent className="flex items-center gap-2 p-4 text-sm text-destructive">
            <IconAlertCircle className="size-4 shrink-0" />
            <span>{t("factoryRoute.historyLoadError")}</span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => void historyQuery.refetch()}
            >
              {t("triage.refresh")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="p-4 lg:p-6">
        <Card>
          <CardContent className="flex min-h-72 flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <IconHistory className="size-5" />
            </span>
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {t("factoryRoute.historyEmpty")}
              </p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {t("factoryRoute.historyEmptyHint")}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(250px,.34fr)_minmax(0,1fr)] lg:p-6">
        <Card className="h-fit lg:sticky lg:top-4">
          <CardHeader className="flex-row items-center justify-between gap-3 px-4 pb-3 pt-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconHistory className="size-4 text-muted-foreground" />
              {t("factoryRoute.historyTitle")}
            </CardTitle>
            <span className="text-xs tabular-nums text-muted-foreground">
              {versions.length}
            </span>
          </CardHeader>
          <CardContent className="space-y-1 p-2">
            {versions.map((version) => {
              const current = isCurrent(version);
              const selected = selectedVersion?.id === version.id;
              return (
                <button
                  key={version.id}
                  type="button"
                  data-testid={`factory-history-version-${version.version}`}
                  aria-pressed={selected}
                  className={`flex w-full items-start gap-3 rounded-lg border-s-2 px-3 py-3 text-start transition-colors ${selected ? "border-s-primary bg-muted/70" : "border-transparent hover:bg-muted/50"}`}
                  onClick={() => {
                    setSelectedVersionId(version.id);
                    setRestoreError(null);
                    setRestoreRefreshError(null);
                    setRestoreStatus(null);
                  }}
                >
                  <span
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${current ? "bg-primary" : "bg-muted-foreground/40"}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium">
                        {t("factoryRoute.historyVersion", {
                          version: version.version,
                        })}
                      </span>
                      {current ? (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          {t("factoryRoute.historyCurrent")}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {sourceLabel(version.source, t)} ·{" "}
                      {formatDate(version.createdAt)}
                    </span>
                    <span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {version.changeSummary ||
                        t("factoryRoute.historyNoSummary")}
                    </span>
                  </span>
                </button>
              );
            })}
            {historyQuery.isError ? (
              <div
                className="flex items-center gap-2 px-3 py-2 text-xs text-destructive"
                role="alert"
              >
                <IconAlertCircle className="size-3.5 shrink-0" />
                <span>{t("factoryRoute.historyLoadError")}</span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-destructive"
                  onClick={() => void historyQuery.refetch()}
                >
                  {t("triage.refresh")}
                </Button>
              </div>
            ) : null}
            {hasMore ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1 w-full"
                disabled={historyQuery.isFetching || nextBeforeVersion === null}
                onClick={loadOlderVersions}
              >
                {historyQuery.isFetching ? (
                  <IconLoader2 className="size-3.5 animate-spin" />
                ) : null}
                {t("factoryRoute.historyLoadOlder")}
              </Button>
            ) : null}
          </CardContent>
        </Card>

        {selectedVersion ? (
          <Card className="min-w-0">
            <CardHeader className="gap-2 px-4 pb-3 pt-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <CardTitle className="text-base">
                  {t("factoryRoute.historyVersion", {
                    version: selectedVersion.version,
                  })}
                </CardTitle>
              </div>
              {isCurrent(selectedVersion) ? (
                <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                  <IconCheck className="size-3.5" />
                  {t("factoryRoute.historyCurrent")}
                </span>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4 px-3 pb-4 pt-0 sm:px-4">
              {selectedSnapshotQuery.isLoading ? (
                <div
                  className="h-[360px] animate-pulse rounded-lg bg-muted/40"
                  aria-label={t("factoryRoute.historyLoading")}
                />
              ) : selectedSnapshotQuery.isError ? (
                <div
                  className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
                  role="alert"
                >
                  <IconAlertCircle className="size-4 shrink-0" />
                  <span>{t("factoryRoute.historySnapshotLoadError")}</span>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-destructive"
                    onClick={() => void selectedSnapshotQuery.refetch()}
                  >
                    {t("triage.refresh")}
                  </Button>
                </div>
              ) : selectedSnapshotQuery.data ? (
                <>
                  <div className="overflow-hidden rounded-lg border bg-muted/10 p-2">
                    <FactoryCanvas
                      graph={selectedSnapshotQuery.data.graph}
                      preview
                    />
                  </div>

                  <dl className="grid gap-3 rounded-lg bg-muted/25 p-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        {t("factoryRoute.historySource")}
                      </dt>
                      <dd className="mt-1 font-medium">
                        {sourceLabel(selectedVersion.source, t)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        {t("factoryRoute.historyNodes")}
                      </dt>
                      <dd className="mt-1 font-medium tabular-nums">
                        {selectedSnapshotQuery.data.graph.nodes.length}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        {t("factoryRoute.historyConnections")}
                      </dt>
                      <dd className="mt-1 font-medium tabular-nums">
                        {selectedSnapshotQuery.data.graph.edges.length}
                      </dd>
                    </div>
                  </dl>

                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t("factoryRoute.historyChangeSummary")}
                    </p>
                    <p className="text-sm leading-6">
                      {selectedVersion.changeSummary ||
                        t("factoryRoute.historyNoSummary")}
                    </p>
                  </div>

                  {isCurrent(selectedVersion) ? (
                    <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm text-primary">
                      <IconCheck className="size-4 shrink-0" />
                      <span>{t("factoryRoute.historyCurrentHint")}</span>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full sm:w-auto"
                      data-testid="factory-history-restore"
                      onClick={() => requestRestore(selectedVersion)}
                      disabled={restoreMutation.isPending}
                    >
                      {restoreMutation.isPending ? (
                        <IconLoader2 className="size-4 animate-spin" />
                      ) : (
                        <IconRestore className="size-4" />
                      )}
                      {t("factoryRoute.historyRestore")}
                    </Button>
                  )}
                </>
              ) : null}

              {restoreStatus ? (
                <p
                  className="flex items-center gap-2 text-sm text-primary"
                  role="status"
                >
                  <IconCheck className="size-4 shrink-0" />
                  {restoreStatus}
                </p>
              ) : null}
              {restoreRefreshError ? (
                <p
                  className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300"
                  role="status"
                >
                  <IconAlertCircle className="size-4 shrink-0" />
                  {restoreRefreshError}
                </p>
              ) : null}
              {restoreError && !pendingRestore ? (
                <p
                  className="flex items-center gap-2 text-sm text-destructive"
                  role="alert"
                >
                  <IconAlertCircle className="size-4 shrink-0" />
                  {restoreError}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <AlertDialog
        open={pendingRestore !== null}
        onOpenChange={(open) => {
          if (!open && !restoringVersionId) {
            setPendingRestore(null);
            setRestoreError(null);
            setRestoreRefreshError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("factoryRoute.historyRestoreTitle", {
                version: pendingRestore?.version ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("factoryRoute.historyRestoreDescription")}
              {hasUnsavedChanges ? (
                <span className="mt-2 block font-medium text-amber-700 dark:text-amber-300">
                  {t("factoryRoute.historyRestoreUnsaved")}
                </span>
              ) : null}
              {restoreError ? (
                <span className="mt-2 block text-destructive" role="alert">
                  {restoreError}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(restoringVersionId)}>
              {t("factoryRoute.historyCancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={Boolean(restoringVersionId)}
              onClick={confirmRestore}
            >
              {restoringVersionId ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconRestore className="size-4" />
              )}
              {t("factoryRoute.historyRestoreConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function sourceLabel(source: string, t: ReturnType<typeof useT>) {
  switch (source) {
    case "ai":
      return t("factoryRoute.historySourceAi");
    case "restore":
      return t("factoryRoute.historySourceRestore");
    case "seed":
      return t("factoryRoute.historySourceSeed");
    case "manual":
      return t("factoryRoute.historySourceManual");
    default:
      return t("factoryRoute.historySourceSaved");
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function readRestoreResult(value: unknown): RestoreResult {
  if (!value || typeof value !== "object") {
    throw new Error("Restore did not return a usable version.");
  }
  const result = value as Record<string, unknown>;
  if (
    typeof result.versionId !== "string" ||
    typeof result.graphVersion !== "number" ||
    typeof result.name !== "string" ||
    !isFactoryCanvasGraph(result.graph)
  ) {
    throw new Error("Restore did not return a usable version.");
  }
  return {
    versionId: result.versionId,
    graphVersion: result.graphVersion,
    name: result.name,
    graph: result.graph,
  };
}

function isFactoryCanvasGraph(value: unknown): value is FactoryCanvasGraph {
  if (!value || typeof value !== "object") return false;
  const graph = value as Record<string, unknown>;
  return (
    typeof graph.version === "number" &&
    typeof graph.name === "string" &&
    Array.isArray(graph.nodes) &&
    Array.isArray(graph.edges)
  );
}
