import {
  deleteClientAppState,
  setClientAppState,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  BREAKDOWN_OVER_BYTE_CAP_ERROR,
  BREAKDOWN_SMALL_GROUP,
  breakdownRowDimensions,
  buildBreakdownTable,
  planBreakdown,
  ROW_BREAKDOWN_MAX_BYTES_BILLED,
  rowsForBreakdown,
  type PanelBreakdown,
} from "@shared/row-breakdown";
import { SqlQueryRefusalError } from "@shared/sql-query-contract";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  formatCell,
  isNumericColumnFormat,
} from "@/components/dashboard/SqlChart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatBytes } from "@/lib/cost-tracker";
import { useSqlQuery } from "@/lib/sql-query";
import { cn } from "@/lib/utils";

import { interpolateDashboardPanelSql } from "./interpolate";
import { serializePanelSql } from "./panel-sql";
import type { SqlPanel, TableColumnConfig } from "./types";

export const ROW_BREAKDOWN_STATE_KEY = "row-breakdown";

// A reload skips unmount cleanup, so a breakdown open before it would outlive
// the page in app state. The first sheet to mount clears it once; writes to one
// key run in order, so a row opened right after still lands.
let clearedSincePageLoad = false;

export interface RowBreakdownSelection {
  row: Record<string, unknown>;
  /** The table's rows in display order, for moving between them. */
  rows: Record<string, unknown>[];
  /** Every row the panel query returned, before the table's row limit. */
  resultRows: Record<string, unknown>[];
  /** The panel query returned only part of its rows. */
  resultTruncated: boolean;
  /** When this row was opened; a breakdown fetched before then cost this row nothing. */
  openedAt: number;
}

function shownColumns(
  panel: SqlPanel,
  row: Record<string, unknown>,
): TableColumnConfig[] {
  const configured = (panel.config?.columns ?? []).filter(
    (column) =>
      !column.hidden && Object.prototype.hasOwnProperty.call(row, column.key),
  );
  return configured.length > 0
    ? configured
    : Object.keys(row).map((key) => ({ key }));
}

export function RowBreakdownSheet({
  panel,
  breakdowns,
  dashboardId,
  filters,
  selection,
  onSelectionChange,
}: {
  panel: SqlPanel;
  breakdowns: PanelBreakdown[];
  dashboardId?: string;
  filters: Record<string, string>;
  selection: RowBreakdownSelection | null;
  onSelectionChange: (selection: RowBreakdownSelection | null) => void;
}) {
  const t = useT();
  const [column, setColumn] = useState(breakdowns[0].column);
  const activeColumn = breakdowns.some((item) => item.column === column)
    ? column
    : breakdowns[0].column;
  const breakdown =
    breakdowns.find((item) => item.column === activeColumn) ?? breakdowns[0];
  const row = selection?.row;
  const panelRows = selection?.rows ?? [];
  const resultRows = selection?.resultRows ?? [];
  const columns = useMemo(
    () => (row ? shownColumns(panel, row) : []),
    [panel, row],
  );
  const dimensions = useMemo(
    () =>
      breakdownRowDimensions(
        panel.config?.columns,
        row,
        activeColumn,
        resultRows,
      ),
    [panel.config?.columns, row, activeColumn, resultRows],
  );
  const sizeKey =
    columns.find(
      (item) => !dimensions.includes(item.key) && item.format === "number",
    )?.key ?? null;
  const panelSql = serializePanelSql(panel.sql);
  const plan = planBreakdown({
    column: activeColumn,
    panelRows: resultRows,
    panelSql,
    vars: filters,
  });
  const breakdownSql =
    plan.kind === "query"
      ? interpolateDashboardPanelSql(panelSql, plan.vars, panel)
      : "";
  // One query returns every row's split, so the cache key leaves out the
  // clicked row: the next row on the same filters reads nothing.
  const query = useSqlQuery(
    ["row-breakdown", dashboardId ?? "", panel.id, panel.source, breakdownSql],
    breakdownSql,
    panel.source,
    {
      enabled: selection !== null && plan.kind === "query",
      reuseCompletedOnEnable: true,
      purpose: "row-breakdown",
    },
  );

  // A block that runs but never selects the column comes back without it,
  // which would otherwise read as one "(none)" group.
  const firstQueryRow = query.data?.rows[0];
  const unavailable =
    plan.kind === "unavailable" ||
    (plan.kind === "query" &&
      firstQueryRow !== undefined &&
      !Object.prototype.hasOwnProperty.call(firstQueryRow, activeColumn));
  const sourceRows =
    plan.kind === "reuse"
      ? resultRows
      : unavailable
        ? null
        : (query.data?.rows ?? null);
  const table = useMemo(() => {
    if (!sourceRows || !row) return null;
    return buildBreakdownTable({
      rows: rowsForBreakdown(sourceRows, dimensions, row),
      column: activeColumn,
      sizeKey,
      // A reused row is one (row, column) pair, not the whole row it names.
      parentSize: sizeKey && plan.kind === "query" ? row[sizeKey] : null,
    });
  }, [sourceRows, row, dimensions, activeColumn, sizeKey, plan.kind]);

  const rowName = row
    ? JSON.stringify(
        Object.fromEntries(dimensions.map((key) => [key, row[key]])),
      )
    : null;
  const published = useRef(false);
  const open = selection !== null;
  useEffect(() => {
    if (clearedSincePageLoad) return;
    clearedSincePageLoad = true;
    deleteClientAppState(ROW_BREAKDOWN_STATE_KEY).catch((error) => {
      console.warn(
        "[row-breakdown] Could not clear a breakdown left by the last page",
        error,
      );
    });
  }, []);
  useEffect(() => {
    // Every table panel mounts this sheet closed; only one that was open
    // clears the state on close.
    if (!open && !published.current) return;
    published.current = open;
    const state = open
      ? {
          dashboardId: dashboardId ?? null,
          panelId: panel.id,
          panelTitle: panel.title,
          row: rowName ? JSON.parse(rowName) : null,
          breakdownColumn: activeColumn,
        }
      : null;
    setClientAppState(ROW_BREAKDOWN_STATE_KEY, state).catch((error) => {
      console.warn(
        "[row-breakdown] Could not publish the open breakdown",
        error,
      );
    });
  }, [open, dashboardId, panel.id, panel.title, rowName, activeColumn]);
  // A sheet that unmounts open (the dashboard closed, the panel was removed)
  // must not leave its row behind for view-screen to report elsewhere.
  useEffect(
    () => () => {
      if (!published.current) return;
      setClientAppState(ROW_BREAKDOWN_STATE_KEY, null).catch((error) => {
        console.warn(
          "[row-breakdown] Could not clear the open breakdown",
          error,
        );
      });
    },
    [],
  );

  const valueColumns = columns.filter(
    (item) => !dimensions.includes(item.key) && item.key !== activeColumn,
  );
  const groupLabel = (value: unknown) =>
    value == null || value === ""
      ? t("sqlDashboard.rowBreakdownNoValue")
      : formatCell(value, undefined);

  const moveSelection = (offset: number) => {
    if (!selection) return;
    const index = panelRows.indexOf(selection.row);
    const next = panelRows[index + offset];
    if (index >= 0 && next) {
      onSelectionChange({
        row: next,
        rows: panelRows,
        resultRows,
        resultTruncated: selection.resultTruncated,
        openedAt: Date.now(),
      });
    }
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (
      event.target instanceof Element &&
      event.target.closest("[role='combobox'], [role='listbox']")
    ) {
      return;
    }
    event.preventDefault();
    moveSelection(event.key === "ArrowDown" ? 1 : -1);
  };

  const costNote =
    plan.kind === "reuse"
      ? t("sqlDashboard.rowBreakdownFromPanel")
      : !query.data || query.isPlaceholderData
        ? null
        : selection && query.dataUpdatedAt < selection.openedAt
          ? t("sqlDashboard.rowBreakdownAlreadyLoaded")
          : query.data.cached || query.data.providerCacheHit
            ? t("sqlDashboard.rowBreakdownFromCache")
            : typeof query.data.bytesRead === "number"
              ? t("sqlDashboard.rowBreakdownBytesRead", {
                  bytes: formatBytes(query.data.bytesRead),
                })
              : null;

  const numericCell = (item: TableColumnConfig) =>
    isNumericColumnFormat(item.format)
      ? "whitespace-nowrap text-right tabular-nums"
      : "";

  return (
    <Sheet
      modal={false}
      open={open}
      onOpenChange={(open) => {
        if (!open) onSelectionChange(null);
      }}
    >
      <SheetContent
        side="right"
        showOverlay={false}
        data-no-panel-chat-select
        className="flex w-full flex-col gap-4 p-5 focus:outline-none sm:w-[440px] sm:max-w-[440px]"
        onKeyDown={handleKeyDown}
        // Focus stays on the clicked row, whose arrow keys move the panel; the
        // column picker would otherwise take them.
        onOpenAutoFocus={(event) => event.preventDefault()}
        // Clicking another row of this table moves the panel instead of
        // closing it.
        onInteractOutside={(event) => {
          const target = event.target;
          if (
            target instanceof Element &&
            target.closest(`[data-row-breakdown-panel="${panel.id}"]`)
          ) {
            event.preventDefault();
          }
        }}
      >
        <SheetTitle className="truncate pe-8 text-base">
          {row
            ? dimensions
                .filter((key) => columns.some((item) => item.key === key))
                .map((key) => groupLabel(row[key]))
                .join(" · ")
            : null}
        </SheetTitle>
        {breakdowns.length > 1 ? (
          <Select value={activeColumn} onValueChange={setColumn}>
            <SelectTrigger
              className="h-8 w-48 text-sm"
              aria-label={t("sqlDashboard.rowBreakdownBy")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {breakdowns.map((item) => (
                <SelectItem key={item.column} value={item.column}>
                  {item.label ?? item.column}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto">
          {unavailable ? (
            <p className="text-sm text-muted-foreground">
              {t("sqlDashboard.rowBreakdownUnavailable", {
                column: breakdown.label ?? breakdown.column,
              })}
            </p>
          ) : query.error && plan.kind === "query" ? (
            <p className="text-sm text-destructive">
              {query.error instanceof SqlQueryRefusalError &&
              query.error.code === BREAKDOWN_OVER_BYTE_CAP_ERROR
                ? t("sqlDashboard.rowBreakdownOverByteCap", {
                    gib: ROW_BREAKDOWN_MAX_BYTES_BILLED / 1024 ** 3,
                  })
                : query.error instanceof Error
                  ? query.error.message
                  : String(query.error)}
            </p>
          ) : !table ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-7 w-full" />
              ))}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="w-full px-2 py-1.5 text-start font-medium">
                    {breakdown.label ?? breakdown.column}
                  </th>
                  {valueColumns.map((item) => (
                    <th
                      key={item.key}
                      className={cn(
                        "whitespace-nowrap px-2 py-1.5 font-medium",
                        isNumericColumnFormat(item.format)
                          ? "text-right"
                          : "text-start",
                      )}
                    >
                      {item.label ?? item.key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.kind === "query" ? (
                  <tr className="border-b border-border font-medium">
                    <td className="px-2 py-1.5">
                      {t("sqlDashboard.rowBreakdownAll")}
                    </td>
                    {valueColumns.map((item) => (
                      <td
                        key={item.key}
                        className={cn("px-2 py-1.5", numericCell(item))}
                      >
                        {row ? formatCell(row[item.key], item.format) : ""}
                      </td>
                    ))}
                  </tr>
                ) : null}
                {table.groups.length === 0 && !table.other ? (
                  <tr>
                    <td
                      colSpan={valueColumns.length + 1}
                      className="px-2 py-3 text-muted-foreground"
                    >
                      {t("sqlDashboard.rowBreakdownEmpty")}
                    </td>
                  </tr>
                ) : null}
                {table.groups.map((group, index) => (
                  <tr
                    key={`${String(group.value)}-${index}`}
                    className={cn(
                      "border-b border-border/50",
                      group.small && "text-muted-foreground",
                    )}
                  >
                    <td className="max-w-0 truncate px-2 py-1.5">
                      {group.small ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>{groupLabel(group.value)}</span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("sqlDashboard.rowBreakdownSmallGroup", {
                              count: BREAKDOWN_SMALL_GROUP,
                            })}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        groupLabel(group.value)
                      )}
                    </td>
                    {valueColumns.map((item) => (
                      <td
                        key={item.key}
                        className={cn("px-2 py-1.5", numericCell(item))}
                      >
                        {formatCell(group.row[item.key], item.format)}
                      </td>
                    ))}
                  </tr>
                ))}
                {table.other ? (
                  <tr className="border-b border-border/50 text-muted-foreground">
                    <td className="px-2 py-1.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>{t("sqlDashboard.rowBreakdownOther")}</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("sqlDashboard.rowBreakdownOtherHint")}
                        </TooltipContent>
                      </Tooltip>
                    </td>
                    {valueColumns.map((item) => (
                      <td
                        key={item.key}
                        className={cn("px-2 py-1.5", numericCell(item))}
                      >
                        {item.key === sizeKey
                          ? formatCell(table.other?.size, item.format)
                          : ""}
                      </td>
                    ))}
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
        {(plan.kind === "query" && query.data?.truncated) ||
        (plan.kind === "reuse" && selection?.resultTruncated) ? (
          <p className="text-xs text-muted-foreground">
            {t("sqlDashboard.rowBreakdownTruncated")}
          </p>
        ) : null}
        {costNote ? (
          <p className="text-xs text-muted-foreground">{costNote}</p>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
