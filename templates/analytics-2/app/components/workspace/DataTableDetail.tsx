import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { InlineMarkdown } from "@agent-native/toolkit/app/review";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronRight,
  IconColumns,
  IconEye,
  IconLink,
  IconMessageCircle,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTable,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useDataDbtMetadata } from "@/hooks/use-data-dbt-metadata";
import type { DataTableDetails } from "@/lib/model/data-table-contracts";

import { DataColumnDbtTests } from "../data/DataColumnDbtTests";
import { DataDbtColumnDetail } from "../data/DataDbtColumnDetail";
import { DataTableFavorite } from "./DataFavorites";

import "../data/data-page.css";
import "./DataTableDetail.css";

export interface DataTableDetailProps {
  connectionId: string;
  connectionName?: string;
  tableId: string;
  tableName?: string | undefined;
  onNewThread?: (() => void) | undefined;
  onUseInProject?: (() => void) | undefined;
  useInProjectPending?: boolean | undefined;
}

type TableDetailTab = "preview" | "columns";

const COLUMN_FILTER_DEBOUNCE_MS = 200;

/** Failure codes this read treats as a settled denial or conflict, never a retry. */
const NON_RETRYABLE_ERROR_CODES = new Set([
  "data_table_access_denied",
  "data_table_ai_disabled",
  "data_table_id_invalid",
  "data_table_project_denied",
  "data_table_provider_unsupported",
  "data_table_request_invalid",
  "data_connection_ai_disabled",
  "data_connection_credentials_missing",
  "data_connection_not_connected",
]);

/**
 * Explicit Retry is offered only for a read that can succeed on a later
 * attempt. A genuine 403/409 (denial or conflict), an invalid request and any
 * other settled 4xx stay put; they are never re-sent through an alternate path.
 */
export function isRetryableTableReadError(error: unknown): boolean {
  if (error == null) return false;
  const record =
    typeof error === "object" ? (error as Record<string, unknown>) : null;
  const status = record?.status ?? record?.statusCode;
  if (typeof status === "number" && (status === 403 || status === 409))
    return false;
  const code = record?.errorCode ?? record?.code;
  if (typeof code === "string" && NON_RETRYABLE_ERROR_CODES.has(code))
    return false;
  if (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  )
    return false;
  return true;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "The request could not be completed.";
}

/** The canonical browser id for the table the action returned. */
function metadataTableId(
  table: DataTableDetails["table"],
  selectedTableId: string,
): string | undefined {
  const identity = [
    encodeURIComponent(table.projectId),
    encodeURIComponent(table.datasetId),
    encodeURIComponent(table.tableId),
  ].join(":");
  if (selectedTableId.startsWith("pg-table:"))
    return table.providerRevision
      ? `pg-table:${identity}:${table.providerRevision}`
      : undefined;
  return `table:${identity}`;
}

function highlight(name: string, needle: string): ReactNode {
  if (needle === "") return name;
  const index = name.toLowerCase().indexOf(needle);
  if (index < 0) return name;
  return (
    <>
      {name.slice(0, index)}
      <mark>{name.slice(index, index + needle.length)}</mark>
      {name.slice(index + needle.length)}
    </>
  );
}

type TablePreview = {
  connectionId: string;
  tableId: string;
  columns: string[];
  rows: unknown[][];
};

function useTablePreview(
  connectionId: string,
  tableId: string,
  enabled: boolean,
) {
  const query = useActionQuery(
    "get-data-table-preview",
    { connectionId, tableId },
    { enabled, retry: false },
  );
  const result = query.data as TablePreview | undefined;
  const current =
    result?.connectionId === connectionId && result.tableId === tableId
      ? result
      : undefined;
  return { query, result, current };
}

function TablePreviewPanel({
  query,
  result,
  current,
  filter,
}: ReturnType<typeof useTablePreview> & { filter: string }) {
  const t = useT();
  const visibleColumns = useMemo(() => {
    if (!current) return [];
    return current.columns
      .map((name, index) => ({ name, index }))
      .filter(
        ({ name }) => filter === "" || name.toLowerCase().includes(filter),
      );
  }, [current, filter]);
  const noMatchingColumns =
    Boolean(current) &&
    filter !== "" &&
    (current?.columns.length ?? 0) > 0 &&
    visibleColumns.length === 0;
  return (
    <div className="data-table-preview" role="tabpanel">
      {query.isPending || (result && !current) ? (
        <div
          className="data-page-source-table-scroll"
          role="status"
          aria-label={t("tablePreview.loading")}
        >
          <table className="data-page-source-table" aria-hidden="true">
            <thead>
              <tr>
                {[0, 1, 2].map((column) => (
                  <th key={column}>
                    <Skeleton className="h-4 w-24" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3].map((row) => (
                <tr key={row}>
                  {[0, 1, 2].map((column) => (
                    <td key={column}>
                      <Skeleton className="h-4 w-24" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : query.isError ? (
        <div role="alert" className="data-page-source-status">
          {(query.error as { errorCode?: string } | null)?.errorCode ===
          "data_table_preview_disabled"
            ? t("tablePreview.disabled")
            : t("tablePreview.failed")}
          {isRetryableTableReadError(query.error) && (
            <button
              type="button"
              className="data-page-link"
              onClick={() => void query.refetch()}
            >
              {t("editorPreferences.retry")}
            </button>
          )}
        </div>
      ) : current ? (
        <div className="data-page-source-table-scroll">
          <table className="data-page-source-table">
            <thead>
              <tr>
                {noMatchingColumns ? (
                  <th scope="col">{`0 columns matching "${filter}"`}</th>
                ) : (
                  visibleColumns.map(({ name, index }) => (
                    <th scope="col" key={`${name}:${index}`}>
                      {highlight(name, filter)}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {noMatchingColumns ? null : current.rows.length === 0 ? (
                <tr>
                  <td
                    className="data-table-detail-empty"
                    colSpan={Math.max(visibleColumns.length, 1)}
                    role="status"
                  >
                    {t("tablePreview.empty")}
                  </td>
                </tr>
              ) : null}
              {noMatchingColumns
                ? null
                : current.rows.map((row, index) => (
                    <tr key={index}>
                      {visibleColumns.map(({ index: columnIndex }) => {
                        const value = row[columnIndex];
                        return (
                          <td key={columnIndex}>
                            {value == null
                              ? ""
                              : typeof value === "object"
                                ? JSON.stringify(value)
                                : String(value)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function formatColumnTypeLabel(column: {
  type: string;
  columnSemanticLayerType?: string | null | undefined;
}): string {
  switch (column.columnSemanticLayerType) {
    case "DIMENSION":
      return "Dimension";
    case "MEASURE":
      return "Measure";
    case "FACT":
      return "Fact";
    default:
      return column.type;
  }
}

export function DataTableDetail({
  connectionId,
  connectionName,
  tableId,
  tableName,
  onNewThread,
  onUseInProject,
  useInProjectPending,
}: DataTableDetailProps) {
  const t = useT();
  const showHeader = connectionName !== undefined;
  const queryClient = useQueryClient();
  const query = useActionQuery(
    "get-data-table-details",
    { connectionId, tableId },
    { retry: false },
  );
  const details = query.data as DataTableDetails | undefined;

  // Late-selection guard: a response is shown only for the selection that is
  // on screen now. A previous table's payload is never painted into a newer
  // selection while the read for the new one is in flight.
  const current =
    details !== undefined &&
    details.connectionId === connectionId &&
    metadataTableId(details.table, tableId) === tableId
      ? details
      : undefined;
  const awaitingSelection = details !== undefined && current === undefined;
  const { mutate: touchRecent } = useActionMutation("touch-data-recent", {
    skipActionQueryInvalidation: true,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["action", "list-data-recents"],
      }),
  });
  const ready = current !== undefined && !query.isError;
  useEffect(() => {
    if (ready && showHeader) touchRecent({ connectionId, tableId });
  }, [ready, showHeader, connectionId, tableId, touchRecent]);

  const [copiedLink, setCopiedLink] = useState(false);
  useEffect(() => {
    setCopiedLink(false);
  }, [connectionId, tableId]);

  const copyTableLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      toast.success(t("notebook.cellActions.linkCopied"));
    } catch {
      toast.error(t("notebook.copyLinkFailed"));
    }
  };

  const [selectedTab, setSelectedTab] = useState<TableDetailTab>("preview");
  const [columnSelection, setColumnSelection] = useState<{
    connectionId: string;
    tableId: string;
    name: string;
  } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [debouncedFilter, setDebouncedFilter] = useState("");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFilter = useRef("");
  const appliedFilter = useRef("");

  // Clear the column filter and selected column when the selected table or connection changes.
  useEffect(() => {
    setColumnSelection(null);
    setFilterText("");
    setDebouncedFilter("");
    setSearchOpen(false);
    pendingFilter.current = "";
    appliedFilter.current = "";
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, [connectionId, tableId]);

  // 200 ms leading + trailing window. The first change after a quiet window
  // applies immediately; changes inside the window wait, and the last one
  // applies when the window closes.
  useEffect(() => {
    if (
      filterText === pendingFilter.current &&
      debounceTimer.current === null
    ) {
      return;
    }
    pendingFilter.current = filterText;
    if (debounceTimer.current === null) {
      appliedFilter.current = filterText;
      setDebouncedFilter(filterText.trim().toLowerCase());
    } else {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      if (pendingFilter.current !== appliedFilter.current) {
        appliedFilter.current = pendingFilter.current;
        setDebouncedFilter(pendingFilter.current.trim().toLowerCase());
      }
    }, COLUMN_FILTER_DEBOUNCE_MS);
  }, [filterText]);

  useEffect(
    () => () => {
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    },
    [],
  );

  const columns = current?.table.columns ?? [];
  const rows = useMemo(
    () =>
      columns.filter(
        (column) =>
          debouncedFilter === "" ||
          column.name.toLowerCase().includes(debouncedFilter),
      ),
    [columns, debouncedFilter],
  );

  const columnCount = current?.table.columnCount ?? columns.length;
  const name = current?.table.name ?? tableName ?? tableId;
  const tableType = current?.table.type ?? null;
  const description = current?.table.description ?? null;
  const searchColumnsLabel = t("dataBrowser.browse.searchColumnsLabel");
  const needsDetails = showHeader || selectedTab === "columns";
  const loading = needsDetails && (query.isPending || awaitingSelection);
  const failed = needsDetails && query.isError && current === undefined;
  const dbt = useDataDbtMetadata(
    connectionId,
    tableId,
    !loading && !failed && (showHeader || selectedTab === "columns"),
  );
  const tableDescription = dbt?.description?.trim() || description;
  const showPreview = selectedTab === "preview" && !loading && !failed;
  const preview = useTablePreview(connectionId, tableId, showPreview);

  const closeSearch = () => {
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    pendingFilter.current = "";
    appliedFilter.current = "";
    setFilterText("");
    setDebouncedFilter("");
    setSearchOpen(false);
  };

  const columnsPanel = (() => {
    const selectedColumn =
      columnSelection?.connectionId === connectionId &&
      columnSelection.tableId === tableId
        ? columns.find((column) => column.name === columnSelection.name)
        : undefined;
    if (selectedColumn)
      return (
        <DataDbtColumnDetail
          name={selectedColumn.name}
          type={selectedColumn.type}
          description={selectedColumn.description}
          dbtDescription={
            dbt?.columns.find((column) => column.name === selectedColumn.name)
              ?.description ?? null
          }
          tests={dbt?.tests.filter(
            (test) => test.columnName === selectedColumn.name,
          )}
          docsUrl={dbt?.docsUrl}
          onBack={() => setColumnSelection(null)}
        />
      );
    return (
      <>
        <div className="data-table-detail-columns">
          {debouncedFilter === "" && columns.length === 0 ? (
            <div className="data-table-detail-empty" role="status">
              <IconAlertTriangle size={20} aria-hidden="true" />
              <span>No columns found</span>
            </div>
          ) : (
            <div className="data-page-source-table-scroll">
              <table className="data-page-source-table">
                <thead>
                  <tr>
                    {debouncedFilter === "" ? null : (
                      <th scope="col">
                        {`${rows.length} column${
                          rows.length === 1 ? "" : "s"
                        } matching "${debouncedFilter}"`}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((column, index) => (
                    <tr key={`${column.name}:${index}`}>
                      <td>
                        <div className="data-table-detail-column">
                          <div className="data-table-detail-column-line">
                            <button
                              type="button"
                              className="data-table-detail-column-name data-table-detail-column-open"
                              onClick={() =>
                                setColumnSelection({
                                  connectionId,
                                  tableId,
                                  name: column.name,
                                })
                              }
                            >
                              {highlight(column.name, debouncedFilter)}
                            </button>
                            <span className="data-table-detail-column-type">
                              {formatColumnTypeLabel(column)}
                            </span>
                            {dbt?.tests && (
                              <DataColumnDbtTests
                                tests={dbt.tests.filter(
                                  (test) => test.columnName === column.name,
                                )}
                              />
                            )}
                          </div>
                          {dbt?.columns?.find(
                            (entry) => entry.name === column.name,
                          )?.description && (
                            <p className="data-table-detail-column-description">
                              {
                                dbt.columns.find(
                                  (entry) => entry.name === column.name,
                                )?.description
                              }
                            </p>
                          )}
                          {column.description ? (
                            <p className="data-table-detail-column-description">
                              {column.description}
                            </p>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>
    );
  })();

  const breadcrumbParts = [
    connectionName,
    current?.table.datasetId,
    name,
  ].filter((part): part is string => Boolean(part && part.trim()));

  return (
    <div className={showHeader ? "data-page-source" : undefined}>
      {showHeader && (
        <header className="data-page-source-header">
          {breadcrumbParts.length > 1 && (
            <nav
              className="data-table-detail-breadcrumb"
              aria-label="Breadcrumb"
            >
              {breadcrumbParts.map((part, index) => (
                <span
                  key={`${part}-${index}`}
                  className="data-table-detail-breadcrumb-item"
                >
                  {index > 0 && (
                    <IconChevronRight size={12} aria-hidden="true" />
                  )}
                  <span>{part}</span>
                </span>
              ))}
            </nav>
          )}
          <div className="data-page-source-title-row">
            <IconTable size={18} aria-hidden="true" />
            <h2>{name}</h2>
            <DataTableFavorite
              key={JSON.stringify([connectionId, tableId])}
              connectionId={connectionId}
              tableId={tableId}
            />
            <button
              type="button"
              data-testid="data-table-copy-link"
              className="data-table-detail-search-button"
              aria-label={
                copiedLink
                  ? t("notebook.cellActions.linkCopied")
                  : t("notebook.copyLink")
              }
              title={
                copiedLink
                  ? t("notebook.cellActions.linkCopied")
                  : t("notebook.copyLink")
              }
              onClick={() => void copyTableLink()}
            >
              {copiedLink ? (
                <IconCheck size={14} aria-hidden="true" />
              ) : (
                <IconLink size={14} aria-hidden="true" />
              )}
            </button>
          </div>
          <p className="data-page-readonly-description">
            {connectionName}
            {tableType ? ` · ${tableType}` : ""}
          </p>
          {tableDescription ? (
            <InlineMarkdown
              content={tableDescription}
              renderLists
              className="data-table-detail-description"
            />
          ) : null}
        </header>
      )}
      <div className="data-table-detail-toolbar">
        <div
          className="data-table-detail-toggle"
          role="tablist"
          aria-label="Table detail view"
          onKeyDown={(event) => {
            if (
              event.key !== "ArrowRight" &&
              event.key !== "ArrowLeft" &&
              event.key !== "Home" &&
              event.key !== "End"
            ) {
              return;
            }
            event.preventDefault();
            const order = ["preview", "columns"] as const;
            const currentIndex = order.indexOf(selectedTab);
            const nextIndex =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? order.length - 1
                  : event.key === "ArrowRight"
                    ? (currentIndex + 1) % order.length
                    : (currentIndex - 1 + order.length) % order.length;
            const nextTab = order[nextIndex];
            if (!nextTab) return;
            setSelectedTab(nextTab);
            const buttons =
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="tab"]',
              );
            buttons[nextIndex]?.focus();
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={selectedTab === "preview"}
            className="data-table-detail-toggle-option"
            onClick={() => setSelectedTab("preview")}
          >
            <IconEye size={14} aria-hidden="true" />
            Preview
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={selectedTab === "columns"}
            className="data-table-detail-toggle-option"
            onClick={() => setSelectedTab("columns")}
          >
            <IconColumns size={14} aria-hidden="true" />
            Columns{current ? ` (${columnCount})` : ""}
          </button>
        </div>
        <div className="data-table-detail-actions">
          {searchOpen ? (
            <div className="data-page-search data-table-detail-search">
              <IconSearch size={14} aria-hidden="true" />
              <input
                autoFocus
                aria-label={searchColumnsLabel}
                placeholder={searchColumnsLabel}
                value={filterText}
                onChange={(event) => setFilterText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") closeSearch();
                }}
                onBlur={() => {
                  if (filterText.trim() === "") closeSearch();
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              className="data-table-detail-search-button"
              onClick={() => setSearchOpen(true)}
            >
              <IconSearch size={14} aria-hidden="true" />
              {searchColumnsLabel}
            </button>
          )}
          {showPreview && preview.current && !preview.query.isError && (
            <button
              type="button"
              className="data-table-detail-search-button"
              aria-label={t("tablePreview.refresh")}
              title={t("tablePreview.refresh")}
              onClick={() => void preview.query.refetch()}
              disabled={preview.query.isFetching}
            >
              <IconRefresh size={14} aria-hidden="true" />
            </button>
          )}
          {showHeader && onNewThread && (
            <button
              type="button"
              data-testid="data-table-new-thread"
              className="data-table-detail-search-button"
              onClick={onNewThread}
            >
              <IconMessageCircle size={14} aria-hidden="true" />
              {t("analytics.home.createThread")}
            </button>
          )}
          {showHeader && onUseInProject && (
            <button
              type="button"
              data-testid="data-table-use-in-project"
              className="data-table-detail-search-button"
              disabled={useInProjectPending}
              onClick={onUseInProject}
            >
              <IconPlus size={14} aria-hidden="true" />
              Use in project
            </button>
          )}
        </div>
      </div>
      {loading ? (
        <div
          role="status"
          aria-label="Loading table details"
          className="data-page-spinner data-page-source-spinner"
        />
      ) : failed ? (
        <div role="alert" className="data-page-source-status">
          <span>{errorMessage(query.error)}</span>
          {isRetryableTableReadError(query.error) ? (
            <button
              type="button"
              className="data-page-link"
              onClick={() => void query.refetch()}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : selectedTab === "preview" ? (
        <TablePreviewPanel {...preview} filter={debouncedFilter} />
      ) : (
        <div role="tabpanel">{columnsPanel}</div>
      )}
    </div>
  );
}
