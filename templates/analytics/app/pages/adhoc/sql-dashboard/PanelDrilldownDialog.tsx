import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconDownload } from "@tabler/icons-react";
import { useMemo, useState } from "react";

import type { ChartDatum } from "@/components/dashboard/SqlChart";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSqlQuery } from "@/lib/sql-query";
import { cn } from "@/lib/utils";

import { interpolateDashboardPanelSql } from "./interpolate";
import { serializePanelSql } from "./panel-sql";
import type { SqlPanel } from "./types";

const HIDDEN_COLUMNS = new Set(["total_matching"]);

interface PanelDrilldownDialogProps {
  panel: SqlPanel;
  datum: ChartDatum | null;
  resolvedSql?: string;
  dashboardId?: string;
  filters?: Record<string, string>;
  onClose: () => void;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function downloadCsv(
  name: string,
  columns: string[],
  rows: Record<string, unknown>[],
) {
  const lines = [
    columns.map(csvCell).join(","),
    ...rows.map((row) =>
      columns.map((column) => csvCell(cellText(row[column]))).join(","),
    ),
  ];
  const url = URL.createObjectURL(
    new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/[^\w-]+/g, "-")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function PanelDrilldownDialog({
  panel,
  datum,
  resolvedSql,
  dashboardId,
  filters,
  onClose,
}: PanelDrilldownDialogProps) {
  const t = useT();
  const open = datum !== null;
  const [filterText, setFilterText] = useState("");
  const [showSql, setShowSql] = useState(false);
  const scopeId = dashboardId || panel.id;
  const aggregateSql = serializePanelSql(resolvedSql ?? panel.sql);

  const { data: drilldownData, isLoading: drilldownLoading } = useActionQuery(
    "get-panel-drilldown",
    { panelId: panel.id },
    { enabled: open, staleTime: 5 * 60 * 1000 },
  );
  const drilldownSql = drilldownData?.drilldown?.sql ?? null;
  const hasRecordQuery = drilldownSql !== null;

  const recordSql = useMemo(
    () =>
      drilldownSql && datum
        ? interpolateDashboardPanelSql(
            drilldownSql,
            {
              ...filters,
              drillX: datum.x,
              drillSeries: datum.series ?? "",
            },
            panel,
          )
        : "",
    [drilldownSql, datum, filters, panel],
  );

  const recordQuery = useSqlQuery(
    ["panel-drilldown", scopeId, panel.id, recordSql],
    recordSql,
    panel.source,
    { enabled: open && hasRecordQuery },
  );
  // Same key as the chart's own query, so this reads the cached aggregate rows.
  const aggregateQuery = useSqlQuery(
    ["sql-chart", scopeId, aggregateSql, panel.source],
    aggregateSql,
    panel.source,
    { enabled: open && !drilldownLoading && !hasRecordQuery },
  );

  const activeQuery = hasRecordQuery ? recordQuery : aggregateQuery;
  const allRows = activeQuery.data?.rows ?? [];
  const error =
    activeQuery.data?.error ??
    (activeQuery.error ? t("sqlDashboard.drilldownLoadFailed") : undefined);
  const loading =
    drilldownLoading || activeQuery.isLoading || activeQuery.isFetching;

  const columns = useMemo(
    () =>
      Object.keys(allRows[0] ?? {}).filter(
        (column) => !HIDDEN_COLUMNS.has(column),
      ),
    [allRows],
  );
  const totalMatching = hasRecordQuery
    ? Number(allRows[0]?.total_matching ?? allRows.length)
    : allRows.length;

  const rows = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    if (!needle) return allRows;
    return allRows.filter((row) =>
      columns.some((column) =>
        cellText(row[column]).toLowerCase().includes(needle),
      ),
    );
  }, [allRows, columns, filterText]);

  const isHighlighted = (row: Record<string, unknown>) =>
    !hasRecordQuery &&
    datum !== null &&
    columns.some((column) => cellText(row[column]) === datum.x);

  const chartValue = Number(datum?.value);
  const showMismatch =
    hasRecordQuery &&
    Number.isFinite(chartValue) &&
    datum?.value !== undefined &&
    !loading &&
    !error &&
    totalMatching !== chartValue;

  const title = datum
    ? `${panel.title}: ${datum.x}${datum.series ? ` · ${datum.series}` : ""}`
    : panel.title;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setFilterText("");
          setShowSql(false);
          onClose();
        }
      }}
    >
      <DialogContent className="flex h-[85vh] w-[95vw] max-w-[1200px] flex-col gap-3">
        <DialogHeader className="shrink-0 pr-8 text-left">
          <DialogTitle className="truncate">{title}</DialogTitle>
        </DialogHeader>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Input
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            placeholder={t("sqlDashboard.drilldownFilterRows")}
            className="h-8 max-w-xs"
          />
          <span className="text-xs text-muted-foreground tabular-nums">
            {t("sqlDashboard.drilldownShowing", {
              shown: String(rows.length),
              total: String(totalMatching),
            })}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSql((value) => !value)}
            >
              {showSql
                ? t("sqlDashboard.drilldownHideSql")
                : t("sqlDashboard.drilldownShowSql")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={rows.length === 0}
              onClick={() => downloadCsv(title, columns, rows)}
            >
              <IconDownload className="mr-1 h-4 w-4" />
              {t("sqlDashboard.drilldownDownloadCsv")}
            </Button>
          </div>
        </div>
        {showMismatch ? (
          <p className="shrink-0 text-xs text-amber-600 dark:text-amber-400">
            {t("sqlDashboard.drilldownCountMismatch", {
              chart: String(chartValue),
              total: String(totalMatching),
            })}
          </p>
        ) : null}
        {!hasRecordQuery && !loading && !error ? (
          <p className="shrink-0 text-xs text-muted-foreground">
            {t("sqlDashboard.drilldownAggregateOnly")}
          </p>
        ) : null}
        {showSql ? (
          <pre className="max-h-48 shrink-0 overflow-auto rounded-md bg-muted p-3 text-xs">
            {hasRecordQuery ? recordSql : aggregateSql}
          </pre>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          {loading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 8 }, (_, index) => (
                <Skeleton key={index} className="h-6 w-full" />
              ))}
            </div>
          ) : error ? (
            <p className="p-4 text-sm text-destructive">{error}</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {t("sqlDashboard.drilldownNoRecords")}
            </p>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  {columns.map((column) => (
                    <TableHead key={column} className="whitespace-nowrap">
                      {column}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow
                    key={index}
                    className={cn(isHighlighted(row) && "bg-primary/10")}
                  >
                    {columns.map((column) => (
                      <TableCell
                        key={column}
                        className="max-w-[320px] truncate whitespace-nowrap text-xs"
                        title={cellText(row[column])}
                      >
                        {cellText(row[column])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
