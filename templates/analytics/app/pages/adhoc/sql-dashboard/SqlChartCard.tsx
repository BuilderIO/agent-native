import { useT } from "@agent-native/core/client";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  IconGripVertical,
  IconDotsVertical,
  IconMaximize,
  IconPencil,
  IconTrash,
  IconCode,
  IconDownload,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
}

export function SqlChartCard({
  panel,
  resolvedSql,
  onRemove,
  onEdit,
  onSaveSql,
  editable = true,
}: SqlChartCardProps) {
  const t = useT();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: panel.id, disabled: !editable });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [exportCsv, setExportCsv] = useState<(() => void) | null>(null);
  const [shouldLoadData, setShouldLoadData] = useState(
    panel.chartType === "section",
  );
  const cardRef = useRef<HTMLDivElement | null>(null);

  const setCardNodeRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      cardRef.current = node;
    },
    [setNodeRef],
  );

  const handleExportCsvChange = useCallback((handler: (() => void) | null) => {
    setExportCsv(handler ? () => handler : null);
  }, []);

  useEffect(() => {
    if (panel.chartType === "section") {
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
        rootMargin: "800px 0px",
        threshold: 0.01,
      },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [panel.chartType, panel.id]);

  useEffect(() => {
    setExportCsv(null);
  }, [panel.id]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.7 : 1,
  };

  // Section panels render as a flush header row (no card chrome, full width)
  // so they read as dividers between groups of panels rather than as another
  // tile in the grid.
  if (panel.chartType === "section") {
    return (
      <div
        ref={setCardNodeRef}
        style={style}
        className="group relative mt-2 first:mt-0"
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="p-1 rounded cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground"
                    aria-label={t("sqlDashboard.dragToReorder")}
                    {...attributes}
                    {...listeners}
                  >
                    <IconGripVertical className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("sqlDashboard.dragToReorder")}
                </TooltipContent>
              </Tooltip>
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

  // Every non-section panel exposes at least the Full screen view action, so the
  // options menu always renders — including on read-only / shared dashboards.
  const showPanelMenu = true;

  return (
    <div
      ref={setCardNodeRef}
      style={style}
      className="group relative h-full hover:z-20 focus-within:z-20"
    >
      <Card className="flex h-full flex-col overflow-visible">
        <CardHeader className="pb-2 flex flex-row items-center gap-2 shrink-0">
          <CardTitle className="text-sm font-medium flex-1 truncate">
            {panel.title}
          </CardTitle>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
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
                  {editable && onSaveSql ? (
                    <ViewSqlPopover
                      panel={panel}
                      resolvedSql={resolvedSql}
                      onSaveSql={onSaveSql}
                    >
                      <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                        <IconCode className="h-4 w-4 mr-2" />
                        {t("sqlDashboard.viewSql")}
                      </DropdownMenuItem>
                    </ViewSqlPopover>
                  ) : null}
                  {editable ? <DropdownMenuSeparator /> : null}
                  {editable && onEdit && (
                    <DropdownMenuItem onSelect={() => onEdit()}>
                      <IconPencil className="h-4 w-4 mr-2" />
                      {t("sidebar.edit")}
                    </DropdownMenuItem>
                  )}
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="p-1 rounded cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground"
                    aria-label={t("sqlDashboard.dragToReorder")}
                    {...attributes}
                    {...listeners}
                  >
                    <IconGripVertical className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("sqlDashboard.dragToReorder")}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col overflow-visible pt-0">
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
