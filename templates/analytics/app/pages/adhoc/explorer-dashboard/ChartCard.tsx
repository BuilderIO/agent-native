import { callAction, useT } from "@agent-native/core/client";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  IconGripVertical,
  IconTrash,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconDotsVertical,
  IconExternalLink,
  IconMessageCircle,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  DashboardPanelChatContextArgs,
  SelectDashboardPanelOptions,
} from "@/hooks/use-dashboard-chat-context";
import { useMetricsQuery } from "@/lib/query-metrics";
import { cn } from "@/lib/utils";

import { ExplorerChart } from "../explorer/components/ExplorerChart";
import { buildSql } from "../explorer/sql-builder";
import type { ExplorerConfig } from "../explorer/types";
import type { DashboardChart } from "./index";

interface ChartCardProps {
  chart: DashboardChart;
  configName: string;
  onRemove: () => void;
  onToggleWidth: () => void;
  onEdit: () => void;
  editable?: boolean;
  selectedForChat?: boolean;
  selectPanelForChat: (
    panel: DashboardPanelChatContextArgs,
    options?: SelectDashboardPanelOptions,
  ) => void;
}

async function fetchConfig(id: string): Promise<ExplorerConfig | null> {
  try {
    const data = await callAction(
      "get-explorer-config",
      { id },
      { method: "GET" },
    );
    if (!data || typeof data !== "object") return null;
    const { id: _id, ...rest } = data as Record<string, unknown>;
    return rest as unknown as ExplorerConfig;
  } catch {
    return null;
  }
}

export function DashboardChartCard({
  chart,
  configName,
  onRemove,
  onToggleWidth,
  onEdit,
  editable = true,
  selectedForChat = false,
  selectPanelForChat,
}: ChartCardProps) {
  const t = useT();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: chart.id, disabled: !editable });

  const style = {
    transform: isDragging ? undefined : CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  const { data: config } = useQuery({
    queryKey: ["explorer-config", chart.configId],
    queryFn: () => fetchConfig(chart.configId),
    staleTime: 60_000,
  });

  const sql = useMemo(() => (config ? buildSql(config) : ""), [config]);

  const { data: result, isLoading: queryLoading } = useMetricsQuery(
    ["dashboard-chart", chart.configId, sql],
    sql,
    { enabled: !!sql },
  );

  const isLoading = !config || queryLoading;
  const displayTitle = config?.name ?? configName;
  const handleSelectForChat = useCallback(
    (options?: SelectDashboardPanelOptions) => {
      selectPanelForChat(
        {
          panelId: chart.id,
          panelTitle: displayTitle,
          panelKind: config?.chartType === "table" ? "table" : "chart",
          chartType: config?.chartType,
          configId: chart.configId,
        },
        options,
      );
    },
    [
      chart.configId,
      chart.id,
      config?.chartType,
      displayTitle,
      selectPanelForChat,
    ],
  );
  const handleCardClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          "button, a, input, textarea, select, [role='menuitem'], [data-no-panel-chat-select]",
        )
      ) {
        return;
      }
      handleSelectForChat({ focus: false });
    },
    [handleSelectForChat],
  );

  return (
    <div
      ref={setNodeRef}
      onClick={handleCardClick}
      style={style}
      data-dragging={isDragging ? "true" : undefined}
      data-chat-selected={selectedForChat ? "true" : undefined}
      className={`explorer-dashboard-card group relative ${chart.width === 2 ? "explorer-dashboard-card-wide" : ""}`}
    >
      <Card
        className={cn(
          "h-full transition-colors",
          selectedForChat && "border-foreground/35 ring-1 ring-foreground/10",
        )}
      >
        <CardHeader className="pb-2 flex flex-row items-center gap-2">
          {editable ? (
            <button
              className="cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
              {...attributes}
              {...listeners}
            >
              <IconGripVertical className="h-4 w-4" />
            </button>
          ) : null}
          <CardTitle className="text-sm font-medium flex-1 truncate">
            {displayTitle}
          </CardTitle>
          <div className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
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
                <DropdownMenuItem
                  onSelect={() =>
                    handleSelectForChat({ openSidebar: true, focus: true })
                  }
                >
                  <IconMessageCircle className="h-4 w-4 mr-2" />
                  {t("explorerDashboard.chatWithChart")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {editable ? (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onToggleWidth}
                    className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {chart.width === 2 ? (
                      <IconArrowsMinimize className="h-3.5 w-3.5" />
                    ) : (
                      <IconArrowsMaximize className="h-3.5 w-3.5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {chart.width === 2
                    ? t("explorerDashboard.halfWidth")
                    : t("explorerDashboard.fullWidth")}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onEdit}
                    className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <IconExternalLink className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("explorerDashboard.editInExplorer")}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setConfirmOpen(true)}
                    className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("explorerDashboard.removeChart")}
                </TooltipContent>
              </Tooltip>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="explorer-dashboard-chart-content pt-0">
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : config ? (
            <ExplorerChart
              config={config}
              result={result}
              isLoading={false}
              sql={sql}
            />
          ) : (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
              {t("explorerDashboard.configNotFound")}
            </div>
          )}
        </CardContent>
      </Card>

      {editable ? (
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("explorerDashboard.removeChartTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("explorerDashboard.removeChartDescription", {
                  name: config?.name ?? configName,
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
                {t("explorerDashboard.removeChart")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}
