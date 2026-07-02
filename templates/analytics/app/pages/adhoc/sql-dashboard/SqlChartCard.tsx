import { useT } from "@agent-native/core/client";
import { useDraggable } from "@dnd-kit/core";
import {
  IconGripVertical,
  IconDotsVertical,
  IconExternalLink,
  IconMaximize,
  IconPencil,
  IconRefresh,
  IconTrash,
  IconCode,
  IconDownload,
} from "@tabler/icons-react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { ChartFillHeight, SqlChart } from "@/components/dashboard/SqlChart";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { serializePanelSql } from "./panel-sql";
import type { SqlPanel } from "./types";
import { ViewSqlPopover } from "./ViewSqlPopover";

interface SqlChartCardProps {
  panel: SqlPanel;
  resolvedSql?: string;
  onRemove: () => void;
  onEdit?: () => void;
  /** Persist a SQL-only edit from the inline View SQL popover. Should throw on
   *  validation failure so the popover can stay open and surface the error. */
  onSaveSql?: (sql: string) => Promise<void>;
  editable?: boolean;
  eagerLoad?: boolean;
  isDragSource?: boolean;
}

const PanelDragHandle = memo(function PanelDragHandle({
  panelId,
  label,
  className,
  iconClassName,
}: {
  panelId: string;
  label: string;
  className: string;
  iconClassName: string;
}) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef } =
    useDraggable({
      id: panelId,
    });

  const setHandleRef = useCallback(
    (node: HTMLButtonElement | null) => {
      setNodeRef(node);
      setActivatorNodeRef(node);
    },
    [setActivatorNodeRef, setNodeRef],
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={setHandleRef}
          className={className}
          aria-label={label}
          {...attributes}
          {...listeners}
        >
          <IconGripVertical className={iconClassName} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
});

export function SqlChartCard({
  panel,
  resolvedSql,
  onRemove,
  onEdit,
  onSaveSql,
  editable = true,
  eagerLoad = false,
  isDragSource = false,
}: SqlChartCardProps) {
  const t = useT();
  const queryClient = useQueryClient();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [extRefreshKey, setExtRefreshKey] = useState(0);
  const navigate = useNavigate();
  const [exportCsv, setExportCsv] = useState<(() => void) | null>(null);
  const [shouldLoadData, setShouldLoadData] = useState(
    eagerLoad ||
      panel.chartType === "section" ||
      panel.chartType === "extension",
  );
  const cardRef = useRef<HTMLDivElement | null>(null);
  const chartQueryKey = useMemo(
    () =>
      [
        "sql-chart",
        panel.id,
        serializePanelSql(resolvedSql ?? panel.sql),
        panel.source,
      ] as const,
    [panel.id, panel.source, panel.sql, resolvedSql],
  );
  const chartFetchCount = useIsFetching({ queryKey: chartQueryKey });
  const chartHasCachedData =
    queryClient.getQueryData(chartQueryKey) !== undefined;
  const isChartRefreshing = chartHasCachedData && chartFetchCount > 0;

  const setCardNodeRef = useCallback((node: HTMLDivElement | null) => {
    cardRef.current = node;
  }, []);

  const handleExportCsvChange = useCallback((handler: (() => void) | null) => {
    setExportCsv(handler ? () => handler : null);
  }, []);

  const handleRefresh = useCallback(() => {
    setShouldLoadData(true);
    void queryClient.invalidateQueries({
      queryKey: chartQueryKey,
    });
  }, [chartQueryKey, queryClient]);

  useEffect(() => {
    if (eagerLoad) {
      setShouldLoadData(true);
      return;
    }
    // Sections are layout-only and extensions render their own iframe — neither
    // waits on the intersection observer that gates SQL panels.
    if (panel.chartType === "section" || panel.chartType === "extension") {
      setShouldLoadData(true);
      return;
    }

    setShouldLoadData(false);
    const node = cardRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setShouldLoadData(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoadData(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: "320px 0px",
        threshold: 0.01,
      },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [eagerLoad, panel.chartType, panel.id]);

  useEffect(() => {
    setExportCsv(null);
  }, [panel.id]);

  // Section panels render as a flush header row (no card chrome, full width)
  // so they read as dividers between groups of panels rather than as another
  // tile in the grid.
  if (panel.chartType === "section") {
    return (
      <div
        ref={setCardNodeRef}
        style={isDragSource ? { zIndex: 50 } : undefined}
        data-dragging={isDragSource ? "true" : undefined}
        className="dashboard-section-card group relative mt-2 first:mt-0"
      >
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <h2 className="text-base font-semibold flex-1">{panel.title}</h2>
          {editable ? (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="p-1 rounded text-muted-foreground hover:text-foreground"
                        aria-label={t("sqlDashboard.sectionOptions")}
                      >
                        <IconDotsVertical className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("sqlDashboard.sectionOptions")}
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" className="w-40">
                  {onEdit && (
                    <DropdownMenuItem onSelect={() => onEdit()}>
                      <IconPencil className="h-4 w-4 mr-2" />
                      {t("sidebar.edit")}
                    </DropdownMenuItem>
                  )}
                  {onEdit && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setConfirmOpen(true);
                    }}
                  >
                    <IconTrash className="h-4 w-4 mr-2" />
                    {t("sidebar.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <PanelDragHandle
                panelId={panel.id}
                label={t("sqlDashboard.dragToReorder")}
                className="p-1 rounded cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground"
                iconClassName="h-3.5 w-3.5"
              />
            </div>
          ) : null}
        </div>
        {panel.config?.description && (
          <p className="text-sm text-muted-foreground mt-1">
            {panel.config.description}
          </p>
        )}
        {editable ? (
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("sqlDashboard.deleteSectionTitle")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("sqlDashboard.deleteSectionDescription", {
                    title: panel.title,
                  })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("sidebar.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setConfirmOpen(false);
                    onRemove();
                  }}
                >
                  {t("sidebar.delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
    );
  }

  // Extension panels render their sandboxed iframe full-bleed with no card chrome
  // or title — the extension owns its own UI. All viewers get the read-only
  // actions (full screen, refresh, open extension); editable dashboards also get
  // delete and drag.
  if (panel.chartType === "extension") {
    const extensionId = (panel.config as Record<string, unknown> | undefined)
      ?.extensionId as string | undefined;
    return (
      <div
        ref={setCardNodeRef}
        style={isDragSource ? { zIndex: 50 } : undefined}
        data-dragging={isDragSource ? "true" : undefined}
        className="dashboard-extension-card group relative h-full"
      >
        {!expanded && (
          <SqlChart
            key={extRefreshKey}
            panel={panel}
            resolvedSql={resolvedSql}
            loadData
          />
        )}
        <div className="absolute right-1 top-1 flex items-center gap-1 opacity-0 group-hover:opacity-100">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    className="p-1 rounded bg-background/80 text-muted-foreground hover:text-foreground"
                    aria-label={t("sqlDashboard.panelOptions")}
                  >
                    <IconDotsVertical className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t("sqlDashboard.panelOptions")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={() => setExpanded(true)}>
                <IconMaximize className="h-4 w-4 mr-2" />
                {t("sqlDashboard.fullScreen")}
              </DropdownMenuItem>
              {extensionId ? (
                <DropdownMenuItem
                  onSelect={() =>
                    navigate(
                      `/extensions/${extensionId}/${encodeURIComponent(
                        (panel.title ?? "extension")
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, "-"),
                      )}`,
                    )
                  }
                >
                  <IconExternalLink className="h-4 w-4 mr-2" />
                  Open extension {/* i18n-ignore */}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setExtRefreshKey((k) => k + 1)}>
                <IconRefresh className="h-4 w-4 mr-2" />
                {t("sqlDashboard.refresh")}
              </DropdownMenuItem>
              {editable ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setConfirmOpen(true);
                    }}
                  >
                    <IconTrash className="h-4 w-4 mr-2" />
                    {t("sidebar.delete")}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          {editable ? (
            <PanelDragHandle
              panelId={panel.id}
              label={t("sqlDashboard.dragToReorder")}
              className="p-1 rounded bg-background/80 cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground"
              iconClassName="h-3.5 w-3.5"
            />
          ) : null}
        </div>
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent className="flex h-[90vh] w-[95vw] max-w-[1400px] flex-col gap-4">
            <DialogHeader className="shrink-0 pr-8 text-left">
              <DialogTitle className="truncate">{panel.title}</DialogTitle>
            </DialogHeader>
            <div className="flex min-h-0 flex-1 flex-col overflow-auto">
              <ChartFillHeight>
                <SqlChart
                  key={extRefreshKey}
                  panel={panel}
                  resolvedSql={resolvedSql}
                  loadData
                />
              </ChartFillHeight>
            </div>
          </DialogContent>
        </Dialog>
        {editable ? (
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("sqlDashboard.deletePanelTitle")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("sqlDashboard.deletePanelDescription", {
                    title: panel.title,
                  })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("sidebar.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setConfirmOpen(false);
                    onRemove();
                  }}
                >
                  {t("sidebar.delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
    );
  }

  // Every non-section panel exposes at least the Full screen view action, so the
  // options menu always renders — including on read-only / shared dashboards.
  const showPanelMenu = true;

  return (
    <div
      ref={setCardNodeRef}
      style={isDragSource ? { zIndex: 50 } : undefined}
      data-dragging={isDragSource ? "true" : undefined}
      className="dashboard-chart-card group relative h-full hover:z-20 focus-within:z-20"
    >
      <Card className="flex h-full flex-col overflow-visible">
        <CardHeader className="pb-2 flex flex-row items-center gap-2 shrink-0">
          <CardTitle className="text-sm font-medium flex-1 truncate">
            {panel.title}
          </CardTitle>
          <div
            className={`flex items-center gap-1 transition-opacity ${
              isChartRefreshing
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
            }`}
          >
            {isChartRefreshing ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex size-6 items-center justify-center rounded text-muted-foreground">
                    <Spinner
                      className="size-3.5"
                      aria-label={t("sqlDashboard.refreshing")}
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t("sqlDashboard.refreshing")}</TooltipContent>
              </Tooltip>
            ) : null}
            {editable && onSaveSql ? (
              <ViewSqlPopover
                panel={panel}
                resolvedSql={resolvedSql}
                onSaveSql={onSaveSql}
              >
                <button
                  className="p-1 rounded text-muted-foreground hover:text-foreground"
                  aria-label={t("sqlDashboard.viewSql")}
                  title={t("sqlDashboard.viewSql")}
                >
                  <IconCode className="h-3.5 w-3.5" />
                </button>
              </ViewSqlPopover>
            ) : null}
            {showPanelMenu ? (
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="p-1 rounded text-muted-foreground hover:text-foreground"
                        aria-label={t("sqlDashboard.panelOptions")}
                      >
                        <IconDotsVertical className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("sqlDashboard.panelOptions")}
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onSelect={() => setExpanded(true)}>
                    <IconMaximize className="h-4 w-4 mr-2" />
                    {t("sqlDashboard.fullScreen")}
                  </DropdownMenuItem>
                  {editable || panel.chartType === "table" ? (
                    <DropdownMenuSeparator />
                  ) : null}
                  {panel.chartType === "table" && (
                    <DropdownMenuItem
                      disabled={!exportCsv}
                      onSelect={() => exportCsv?.()}
                    >
                      <IconDownload className="h-4 w-4 mr-2" />
                      {t("sqlDashboard.downloadCsv")}
                    </DropdownMenuItem>
                  )}
                  {editable && panel.chartType === "table" ? (
                    <DropdownMenuSeparator />
                  ) : null}
                  {editable && onEdit && (
                    <DropdownMenuItem onSelect={() => onEdit()}>
                      <IconPencil className="h-4 w-4 mr-2" />
                      {t("sidebar.edit")}
                    </DropdownMenuItem>
                  )}
                  {!editable ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem onSelect={handleRefresh}>
                    <IconRefresh className="h-4 w-4 mr-2" />
                    {t("sqlDashboard.refresh")}
                  </DropdownMenuItem>
                  {editable ? (
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        setConfirmOpen(true);
                      }}
                    >
                      <IconTrash className="h-4 w-4 mr-2" />
                      {t("sidebar.delete")}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {editable ? (
              <PanelDragHandle
                panelId={panel.id}
                label={t("sqlDashboard.dragToReorder")}
                className="p-1 rounded cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground"
                iconClassName="h-3.5 w-3.5"
              />
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="dashboard-chart-content flex flex-1 flex-col overflow-visible pt-0">
          <SqlChart
            panel={panel}
            resolvedSql={resolvedSql}
            loadData={shouldLoadData}
            onExportCsvChange={handleExportCsvChange}
          />
        </CardContent>
      </Card>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="flex h-[90vh] w-[95vw] max-w-[1400px] flex-col gap-4">
          <DialogHeader className="shrink-0 pr-8 text-left">
            <DialogTitle className="truncate">{panel.title}</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            <ChartFillHeight>
              <SqlChart panel={panel} resolvedSql={resolvedSql} loadData />
            </ChartFillHeight>
          </div>
        </DialogContent>
      </Dialog>

      {editable ? (
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("sqlDashboard.deletePanelTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("sqlDashboard.deletePanelDescription", {
                  title: panel.title,
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("sidebar.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmOpen(false);
                  onRemove();
                }}
              >
                {t("sidebar.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}
