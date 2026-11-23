import { compareAndSetClientAppState } from "@agent-native/core/client/application-state";
import {
  useActionQuery,
  writeClientAppState,
} from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { IconChevronLeft, IconChevronRight, IconX } from "@tabler/icons-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TAB_ID } from "@/lib/tab-id";

import type { PivotScalar } from "../../../shared/pivot-config";
import { PROJECT_QUERY_PAGE_SIZE } from "../../../shared/project-query-page";
import type {
  VisualizationDrillInput,
  VisualizationDrillOutput,
} from "../../../shared/visualization-contracts";

export type VisualizationDrillRequest = Omit<
  VisualizationDrillInput,
  "mode" | "page"
> & {
  mode: "view-data" | "drill-down";
};

type VisualizationSelection = {
  projectId: string;
  cellId: string;
  visualizationResultId: string;
  view: "pivot" | "chart" | "table";
  drillId?: string | undefined;
  selectionId?: string | undefined;
};

export function useVisualizationSelection(selection?: VisualizationSelection) {
  const {
    projectId,
    cellId,
    visualizationResultId,
    view,
    drillId,
    selectionId,
  } = selection ?? {};
  useEffect(() => {
    if (!projectId || !cellId || !visualizationResultId || !view) return;
    const key = `notebook-visualization:${TAB_ID}`;
    const source = { requestSource: TAB_ID };
    const value = {
      projectId,
      cellId,
      visualizationResultId,
      view,
      drillId: drillId ?? null,
      selectionId: selectionId ?? null,
    };
    const pending = writeClientAppState(key, value, source);
    void pending.catch((error) =>
      console.error("Could not update visualization selection", error),
    );
    return () => {
      void pending
        .then(
          () => compareAndSetClientAppState(key, value, null, source),
          () => undefined,
        )
        .catch((error) =>
          console.error("Could not clear visualization selection", error),
        );
    };
  }, [projectId, cellId, visualizationResultId, view, drillId, selectionId]);
}

export function VisualizationResultPager({
  page,
  totalRows,
  onPage,
}: {
  page: number;
  totalRows: number;
  onPage: (page: number) => void;
}) {
  const t = useT();
  const { formatNumber } = useFormatters();
  const pages = Math.max(1, Math.ceil(totalRows / PROJECT_QUERY_PAGE_SIZE));
  return (
    <div className="flex flex-wrap items-center gap-2 border-t px-2 py-1 text-xs text-muted-foreground">
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={t("notebook.previousPage")}
        disabled={page === 1}
        onClick={() => onPage(page - 1)}
      >
        <IconChevronLeft
          size={14}
          className="rtl:rotate-180"
          aria-hidden="true"
        />
      </Button>
      <span>
        {t("notebook.pageOfPages", {
          page: formatNumber(page),
          pages: formatNumber(pages),
        })}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={t("notebook.nextPage")}
        disabled={page === pages}
        onClick={() => onPage(page + 1)}
      >
        <IconChevronRight
          size={14}
          className="rtl:rotate-180"
          aria-hidden="true"
        />
      </Button>
      <span role="status" className="ms-auto">
        {t("pivot.rowCount", { count: totalRows })}
      </span>
    </div>
  );
}

export function VisualizationResultRows({
  label,
  columns,
  rows,
  cellClassName,
  rowHeaders = false,
}: {
  label: string;
  columns: readonly string[];
  rows: readonly (readonly PivotScalar[])[];
  cellClassName?: (value: PivotScalar, column: number) => string;
  rowHeaders?: boolean;
}) {
  const t = useT();
  const { formatNumber } = useFormatters();
  return (
    <div
      className="max-w-full overflow-auto"
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      <table className="w-max min-w-full text-start text-sm">
        <thead className="border-b bg-muted">
          <tr>
            {columns.map((column, index) => (
              <th
                key={index}
                scope="col"
                className="whitespace-nowrap px-3 py-1.5 text-start"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b last:border-b-0">
              {row.map((value, offset) => {
                const DataCell = rowHeaders && offset === 0 ? "th" : "td";
                return (
                  <DataCell
                    key={offset}
                    scope={DataCell === "th" ? "row" : undefined}
                    className={`max-w-80 truncate whitespace-nowrap px-3 py-1.5 ${cellClassName?.(value, offset) ?? ""}`}
                  >
                    {value === null
                      ? t("pivot.nullCategory")
                      : typeof value === "number"
                        ? formatNumber(value)
                        : String(value)}
                  </DataCell>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function isDrillPage(
  output: VisualizationDrillOutput | undefined,
): output is Extract<VisualizationDrillOutput, { rows: unknown }> {
  return output?.status === "ready" || output?.status === "empty";
}

export function VisualizationDrillPanel({
  request,
  groupedRowHeaders = false,
  onClose,
}: {
  request: VisualizationDrillRequest;
  groupedRowHeaders?: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [page, setPage] = useState(1);
  const query = useActionQuery<VisualizationDrillOutput>(
    "open-notebook-visualization-drill",
    { ...request, page },
    { method: "POST" },
  );
  const result = query.isError ? undefined : query.data;
  const ready = isDrillPage(result) ? result : null;
  const filters = ready?.filters.map(({ name, value }) =>
    t("pivot.filterLabel", {
      field: name,
      value: value === null ? t("pivot.nullCategory") : String(value),
    }),
  );
  const title = filters
    ? t("pivot.viewing", { filters: filters.join(" · ") || t("pivot.allRows") })
    : t("pivot.viewData");
  const drillDown = request.mode === "drill-down";
  const retry = query.isError || result?.status === "unreadable";

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const section = sectionRef.current;
    heading.current?.focus();
    return () => {
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      if (
        previous &&
        previous !== document.body &&
        previous.isConnected &&
        (document.activeElement === null ||
          document.activeElement === document.body ||
          section?.contains(document.activeElement))
      ) {
        previous.focus();
      }
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      className="min-w-0 border-t"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="flex items-center justify-between gap-2 px-3 py-2">
        <h3
          id={headingId}
          ref={heading}
          tabIndex={-1}
          className="min-w-0 break-words text-sm font-medium"
        >
          {filters?.length ? (
            <>
              {t("pivot.viewing", { filters: "" })}
              {filters.map((filter, index) => (
                <span key={index}>
                  {index > 0 && <span className="sr-only"> · </span>}
                  <span className="me-1 inline-block rounded-md bg-muted px-1.5">
                    {filter}
                  </span>
                </span>
              ))}
            </>
          ) : (
            title
          )}
        </h3>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t(drillDown ? "pivot.drillUp" : "pivot.closeDrill")}
          onClick={onClose}
        >
          {drillDown ? t("pivot.drillUp") : t("share.close")}
          <IconX size={14} aria-hidden="true" />
        </Button>
      </header>
      {ready ? (
        <>
          {ready.status === "empty" ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {t("pivot.noData")}
            </p>
          ) : (
            <VisualizationResultRows
              label={title}
              columns={ready.columns.map(({ name }) => name)}
              rows={ready.rows}
              rowHeaders={drillDown && groupedRowHeaders}
            />
          )}
          <VisualizationResultPager
            page={ready.page}
            totalRows={ready.totalRows}
            onPage={setPage}
          />
        </>
      ) : query.isPending ? (
        <div className="p-3" role="status" aria-busy="true">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
          <span role="alert">
            {t(
              result?.status === "stale"
                ? "pivot.stale"
                : result?.status === "denied"
                  ? "pivot.drillDenied"
                  : "pivot.drillUnavailable",
            )}
          </span>
          {retry && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
            >
              {t("editorPreferences.retry")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
