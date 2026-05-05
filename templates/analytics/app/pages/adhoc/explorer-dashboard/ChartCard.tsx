import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  IconGripVertical,
  IconTrash,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconExternalLink,
} from "@tabler/icons-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getIdToken } from "@/lib/auth";
import { useMetricsQuery } from "@/lib/query-metrics";
import { ExplorerChart } from "../explorer/components/ExplorerChart";
import { buildSql } from "../explorer/sql-builder";
import type { ExplorerConfig } from "../explorer/types";
import type { DashboardChart } from "./index";
import { appApiPath } from "@agent-native/core/client";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ChartCardProps {
  chart: DashboardChart;
  configName: string;
  onRemove: () => void;
  onToggleWidth: () => void;
  onEdit: () => void;
}

async function fetchConfig(id: string): Promise<ExplorerConfig | null> {
  const token = await getIdToken();
  const res = await fetch(appApiPath(`/api/explorer-configs/${id}`), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return null;
  const data = await res.json();
  const { id: _id, ...rest } = data;
  return rest as ExplorerConfig;
}

export function DashboardChartCard({
  chart,
  configName,
  onRemove,
  onToggleWidth,
  onEdit,
}: ChartCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: chart.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.7 : 1,
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
      className={`group relative ${chart.width === 2 ? "md:col-span-2" : ""}`}
    >
      <Card className="h-full">
        <CardHeader className="pb-2 flex flex-row items-center gap-2">
          <button
            className="cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
            {...attributes}
            {...listeners}
          >
            <IconGripVertical className="h-4 w-4" />
          </button>
          <CardTitle className="text-sm font-medium flex-1 truncate">
            {config?.name ?? configName}
          </CardTitle>
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
                {chart.width === 2 ? "Half width" : "Full width"}
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
              <TooltipContent>Edit in Explorer</TooltipContent>
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
              <TooltipContent>Remove chart</TooltipContent>
            </Tooltip>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
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
              Config not found
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove chart?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove &ldquo;{config?.name ?? configName}&rdquo; from this
              dashboard? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                onRemove();
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
