import { callAction, useT } from "@agent-native/core/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@agent-native/toolkit/ui/card";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  IconGripVertical,
  IconTrash,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconExternalLink,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useMetricsQuery } from "@/lib/query-metrics";

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

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-dragging={isDragging ? "true" : undefined}
      className={`explorer-dashboard-card group relative ${chart.width === 2 ? "explorer-dashboard-card-wide" : ""}`}
    >
      <Card className="h-full">
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
            {config?.name ?? configName}
          </CardTitle>
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
