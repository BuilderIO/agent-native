/// <reference lib="es2023.intl" />
import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  formatLocaleNumber,
  useReaderLocale,
} from "@agent-native/toolkit/app/shared/reader-locale";
import { Tooltip } from "@agent-native/toolkit/design-system";
import {
  IconChartBar,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconDotsVertical,
  IconDownload,
  IconSortAscending,
  IconSortDescending,
  IconSparkles,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { describeEngineError } from "@/lib/engine-error";
import { getCachedNumberFormat } from "@/lib/intl-cache";
import type { CellOutput } from "@/lib/model/contracts";

import type getNotebookResultPage from "../../../actions/get-notebook-result-page";
import { PROJECT_QUERY_PAGE_SIZE as PAGE_SIZE } from "../../../shared/project-query-page";
import { CellErrorAlert } from "./CellErrorAlert";
import { compareNumericText } from "./CellOutputView.numeric-sort";
import {
  columnFilterType,
  defaultFilterOperator,
  isFilterConfigured,
  matchesDisplayFilter,
  type DisplayFilter,
} from "./display-filters";
import { DisplayFilterRows } from "./DisplayFilterRows";
import { csvFilename, resultCsv, resultTsv } from "./result-csv";
import { tableResultCoverage } from "./result-pagination";
import { SqlResultControls, type SqlResultDisplay } from "./TableCellControls";
import type { LoadResultPage, NotebookTableOutput } from "./types";
import { resolveWebCollapseStorage } from "./useCellCollapse";
import { displayRows } from "./useNotebookResults";
import {
  formatCellValue,
  formatTableRowCount,
  resultColumnIcon,
} from "./utils";
import { VegaChart } from "./VegaChart";

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

type ResultRows = Extract<CellOutput, { type: "table" }>["rows"];
type ResultPageRead = Awaited<ReturnType<typeof getNotebookResultPage.run>>;

const MAX_SORT_ROWS = 10_000;

async function readArtifactResultPage(
  resultId: string,
  page: number,
  signal: AbortSignal,
  failureMessage: string,
): Promise<ResultRows> {
  const result = await callAction<ResultPageRead>(
    "get-notebook-result-page",
    { resultId, page },
    { method: "GET", signal },
  );
  if (result.status !== "ready") throw new Error(failureMessage);
  return displayRows(result.rows, result.manifest.fields);
}

function sortLabelKey(type: string, direction: "Asc" | "Desc") {
  const kind =
    type === "number"
      ? "Number"
      : type === "boolean"
        ? "Boolean"
        : ["date", "datetime"].includes(type)
          ? "Date"
          : "String";
  return `notebook.sort${kind}${direction}` as const;
}

function pageEndFor(
  page: number,
  totalRows: bigint | null,
  pageSize: number,
): number {
  const end = page * pageSize;
  return totalRows !== null && totalRows < BigInt(end)
    ? Number(totalRows)
    : end;
}

export function CellOutputView({
  output,
  loading = false,
  onRetry,
  onLoadRows,
  onLoadPage,
  queryRequestId,
  hasNextPage,
  totalRows: queryTotalRows,
  queryError = false,
  onFixWithAgent,
  columnFormats,
  allowCsvDownload = false,
  downloadLabel,
  resultVariable,
  onAddChartCell,
  pageStorageKey,
  artifactPage,
  initialPage,
  queryTableControls = false,
  initialPageSize = PAGE_SIZE,
}: {
  output:
    | Exclude<CellOutput, { type: "table" }>
    | NotebookTableOutput
    | null
    | undefined;
  loading?: boolean;
  onRetry?: (() => void) | undefined;
  onLoadRows?:
    | ((requiredRowCount: number) => Promise<number | null>)
    | undefined;
  onLoadPage?: LoadResultPage | undefined;
  queryRequestId?: string | undefined;
  hasNextPage?: boolean | undefined;
  totalRows?: string | null | undefined;
  queryError?: boolean;
  onFixWithAgent?: (() => void) | undefined;
  allowCsvDownload?: boolean;
  downloadLabel?: string | null | undefined;
  resultVariable?: ReactNode;
  onAddChartCell?: (() => void) | undefined;
  pageStorageKey?: string | undefined;
  artifactPage?: number | undefined;
  initialPage?: number | undefined;
  queryTableControls?: boolean;
  initialPageSize?: (typeof PAGE_SIZE_OPTIONS)[number];
  columnFormats?: readonly (
    | "text"
    | "number"
    | "percent"
    | "currency"
    | "date"
    | "datetime"
    | ((value: unknown) => string)
    | null
  )[];
}) {
  const locale = useReaderLocale();
  const t = useT();
  const [page, setPage] = useState(1);
  const [chosenPageSize, setChosenPageSize] = useState(initialPageSize);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [display, setDisplay] = useState<SqlResultDisplay>({
    rowNumbers: true,
    typeIcons: true,
    hidden: {},
    formats: {},
  });
  const [requestedPage, setRequestedPage] = useState<number | null>(null);
  useEffect(() => {
    if (initialPage !== undefined) setRequestedPage(initialPage);
  }, [initialPage, queryRequestId]);
  useEffect(() => {
    if (!pageStorageKey) return;
    try {
      const saved = Number(
        resolveWebCollapseStorage()?.getItem(pageStorageKey),
      );
      if (Number.isSafeInteger(saved) && saved > 1) setRequestedPage(saved);
    } catch {
      return;
    }
  }, [pageStorageKey]);
  const rememberPage = useCallback(
    (next: number) => {
      setPage(next);
      setRequestedPage(next);
      if (!pageStorageKey) return;
      try {
        resolveWebCollapseStorage()?.setItem(pageStorageKey, String(next));
      } catch {
        return;
      }
    },
    [pageStorageKey],
  );
  const [pendingPage, setPendingPage] = useState<number | null>(null);
  const [loadedPage, setLoadedPage] = useState<{
    requestId: string;
    page: number;
    rows: ResultRows;
  } | null>(null);
  const [pageError, setPageError] = useState<{
    page: number;
    message: string;
  } | null>(null);
  const [sort, setSort] = useState<{
    column: number;
    direction: "asc" | "desc";
  } | null>(null);
  const [filters, setFilters] = useState<DisplayFilter[]>([]);
  const [loadedThrough, setLoadedThrough] = useState<number | null>(null);
  const [materialized, setMaterialized] = useState<{
    requestId: string;
    rows: ResultRows;
  } | null>(null);
  const [materializing, setMaterializing] = useState(false);
  const [materializeRetry, setMaterializeRetry] = useState(0);
  const materializeAttempt = useRef<string | null>(null);
  const loadInFlight = useRef(false);
  const mounted = useRef(true);
  const [loadSettled, setLoadSettled] = useState(0);
  const filterGeneration = useRef(0);
  const pendingFilterGeneration = useRef(0);
  const nextFilterId = useRef(1);
  const addFilter = (column: number, quickText = false) => {
    if (output?.type !== "table") return;
    const type = columnFilterType(
      output.columns[column] ?? { name: "" },
      output.rows,
      column,
    );
    const id = nextFilterId.current++;
    setFilters((current) => [
      ...current,
      {
        id,
        column,
        operator:
          quickText && type === "string"
            ? "contains"
            : defaultFilterOperator(type),
        value: "",
        end: "",
        values: [],
      },
    ]);
  };
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const openMenuRef = useRef(openMenu);
  useLayoutEffect(() => {
    openMenuRef.current = openMenu;
  }, [openMenu]);
  const [copyError, setCopyError] = useState(false);
  const filterRowsRef = useRef<HTMLDivElement>(null);
  const resultTableRef = useRef<HTMLTableElement>(null);
  const filterToFocus = useRef<{ column: number; filter: number } | null>(null);
  const schema =
    output?.type === "table"
      ? JSON.stringify(output.columns.map(({ name, type }) => [name, type]))
      : null;
  const previousSchema = useRef(schema);
  useEffect(() => {
    if (schema == null) return;
    if (previousSchema.current != null && previousSchema.current !== schema) {
      filterGeneration.current++;
      setPage(1);
      setPendingPage(null);
      setPageError(null);
      setLoadedThrough(null);
      setMaterialized(null);
      setMaterializing(false);
      materializeAttempt.current = null;
      setOpenMenu(null);
      setFilters((current) => (current.length ? [] : current));
      setSort(null);
    }
    previousSchema.current = schema;
  }, [schema]);
  // A filter or sort changes which rows exist, so the reader starts at the
  // first page of the new view rather than at an offset from the old one.
  const previousView = useRef({ filters, sort });
  const sortFailure = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousView.current;
    if (previous.filters === filters && previous.sort === sort) return;
    previousView.current = { filters, sort };
    setPage(1);
    setRequestedPage(null);
    setPendingPage(null);
    setPageError(
      sortFailure.current ? { page: 1, message: sortFailure.current } : null,
    );
    sortFailure.current = null;
    setLoadedThrough(null);
    filterGeneration.current++;
  }, [filters, sort]);
  useEffect(() => {
    filterGeneration.current++;
    setPendingPage(null);
    setPageError(null);
    setLoadedThrough(null);
    setMaterialized(null);
    setMaterializing(false);
    materializeAttempt.current = null;
  }, [loading, queryRequestId]);
  const baseRows = output?.type === "table" ? output.rows : [];
  const baseRowsRef = useRef(baseRows);
  baseRowsRef.current = baseRows;
  const sortRef = useRef(sort);
  sortRef.current = sort;
  const onLoadPageRef = useRef(onLoadPage);
  onLoadPageRef.current = onLoadPage;
  const coverage =
    output?.type === "table"
      ? tableResultCoverage(output, queryTotalRows, hasNextPage)
      : null;
  const totalRows = coverage?.exact ?? null;
  const activeFilters = filters.filter(isFilterConfigured);
  const activeMaterialized =
    queryRequestId != null && materialized?.requestId === queryRequestId
      ? materialized
      : null;
  const canReadArtifactPages =
    onLoadRows == null &&
    onLoadPage != null &&
    queryRequestId != null &&
    hasNextPage === true &&
    coverage?.exact != null &&
    coverage.exact <= BigInt(MAX_SORT_ROWS);
  const resultComplete =
    coverage?.complete === true || activeMaterialized != null;
  const usingMaterialized =
    activeMaterialized != null && (activeFilters.length > 0 || sort !== null);
  const rows = usingMaterialized ? activeMaterialized.rows : baseRows;
  const effectiveHasNextPage = usingMaterialized ? false : hasNextPage;
  const sortLoadable =
    !resultComplete &&
    hasNextPage === true &&
    coverage?.exact != null &&
    coverage.exact <= BigInt(MAX_SORT_ROWS) &&
    (onLoadRows != null || canReadArtifactPages);
  const sortAvailable = (resultComplete || sortLoadable) && !loading;
  const effectiveSort = sortAvailable && resultComplete ? sort : null;
  useEffect(() => {
    if (!sortAvailable) setSort(null);
  }, [sortAvailable]);
  const needsMaterialize =
    (sort !== null || activeFilters.length > 0) &&
    canReadArtifactPages &&
    activeMaterialized == null &&
    !loading;
  useEffect(() => {
    if (sort === null && activeFilters.length === 0) {
      materializeAttempt.current = null;
    }
  }, [sort, activeFilters.length]);
  useEffect(() => {
    const pageLoader = onLoadPageRef.current;
    if (
      !needsMaterialize ||
      !pageLoader ||
      !queryRequestId ||
      coverage?.exact == null
    )
      return;
    const attempt = `${queryRequestId}:${materializeRetry}`;
    if (materializeAttempt.current === attempt) return;
    materializeAttempt.current = attempt;
    const totalPages = Math.ceil(Number(coverage.exact) / PAGE_SIZE);
    const knownPage =
      artifactPage !== undefined
        ? artifactPage
        : baseRowsRef.current.length > 0
          ? 1
          : null;
    const controller = new AbortController();
    setMaterializing(true);
    void (async () => {
      try {
        const pages: ResultRows[] = [];
        for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
          if (controller.signal.aborted) return;
          if (pageNumber === knownPage) {
            pages.push(baseRowsRef.current);
            continue;
          }
          pages.push(
            artifactPage !== undefined
              ? await readArtifactResultPage(
                  queryRequestId,
                  pageNumber,
                  controller.signal,
                  t("queryPaging.failed"),
                )
              : await pageLoader((pageNumber - 1) * PAGE_SIZE, queryRequestId),
          );
        }
        if (controller.signal.aborted || !mounted.current) return;
        setMaterialized({ requestId: queryRequestId, rows: pages.flat() });
        setMaterializing(false);
      } catch (error: unknown) {
        if (controller.signal.aborted || !mounted.current) return;
        const message =
          error instanceof Error ? error.message : t("queryPaging.failed");
        setMaterializing(false);
        if (sortRef.current !== null) {
          sortFailure.current = message;
          setSort(null);
        } else {
          setPageError({ page: 1, message });
        }
      }
    })();
    return () => {
      controller.abort();
      setMaterializing(false);
    };
  }, [
    needsMaterialize,
    queryRequestId,
    coverage?.exact,
    artifactPage,
    materializeRetry,
    t,
  ]);
  const sortLoadAttempt = useRef<string | null>(null);
  useEffect(() => {
    if (sort == null || !sortLoadable || loading || !onLoadRows) return;
    const attempt = `${queryRequestId ?? ""}:${rows.length}`;
    if (sortLoadAttempt.current === attempt) return;
    sortLoadAttempt.current = attempt;
    const required = Number(coverage?.exact);
    const failed = (message: string) => {
      if (!mounted.current) return;
      sortFailure.current = message;
      setSort(null);
    };
    new Promise<number | null>((resolve) => resolve(onLoadRows(required)))
      .then((loaded) => {
        if (loaded == null || loaded <= rows.length)
          failed(t("queryPaging.failed"));
      })
      .catch((error: unknown) =>
        failed(
          error instanceof Error ? error.message : t("queryPaging.failed"),
        ),
      );
  }, [
    sort,
    sortLoadable,
    loading,
    onLoadRows,
    queryRequestId,
    rows.length,
    coverage?.exact,
    t,
  ]);
  const filteredRows =
    output?.type === "table" && activeFilters.length
      ? rows.filter((row) =>
          activeFilters.every((filter) =>
            matchesDisplayFilter(
              row[filter.column],
              filter,
              columnFilterType(
                output.columns[filter.column] ?? { name: "" },
                rows,
                filter.column,
              ),
            ),
          ),
        )
      : rows;
  const localView = activeFilters.length > 0 || effectiveSort !== null;
  const canSeek =
    !localView &&
    hasNextPage === true &&
    coverage?.lastPage != null &&
    onLoadPage != null &&
    queryRequestId != null;
  const serverPaged = canSeek || (artifactPage !== undefined && !localView);
  const pageSize = serverPaged ? PAGE_SIZE : chosenPageSize;
  const knownLastPage =
    output?.type === "table"
      ? tableResultCoverage(output, queryTotalRows, hasNextPage, pageSize)
          .lastPage
      : null;
  const lastPage =
    knownLastPage ?? Math.max(1, Math.ceil(rows.length / pageSize));
  const remotePage =
    canSeek && loadedPage?.requestId === queryRequestId ? loadedPage : null;
  const canLoad =
    effectiveHasNextPage === true && (canSeek || onLoadRows != null);
  const restorePage = useEffectEvent((target: number) => {
    void goTo(target);
  });
  useEffect(() => {
    if (
      artifactPage !== undefined ||
      requestedPage === null ||
      output?.type !== "table" ||
      localView ||
      loading
    )
      return;
    const target =
      canLoad && totalRows == null
        ? requestedPage
        : Math.min(requestedPage, lastPage);
    if (
      remotePage?.page === target ||
      rows.length >=
        pageEndFor(target, canLoad ? totalRows : BigInt(rows.length), pageSize)
    )
      setPage(target);
    else if (canLoad && pendingPage === null && pageError === null)
      restorePage(target);
  }, [
    artifactPage,
    requestedPage,
    output,
    localView,
    lastPage,
    rows.length,
    totalRows,
    canLoad,
    remotePage,
    loading,
    pendingPage,
    pageError,
    pageSize,
  ]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (pendingPage == null || loading || serverPaged) return;
    if (pendingFilterGeneration.current !== filterGeneration.current) return;
    const retryPage = pendingPage;
    const filtered = activeFilters.length > 0;
    const start = (pendingPage - 1) * pageSize;
    if (filtered) {
      if (
        filteredRows.length >= pendingPage * pageSize ||
        hasNextPage === false
      ) {
        if (filteredRows.length > start) setPage(pendingPage);
        setPendingPage(null);
        setLoadedThrough(null);
        return;
      }
    } else {
      const knownEnd = pageEndFor(pendingPage, totalRows, pageSize);
      if (
        rows.length >= knownEnd ||
        (hasNextPage === false && rows.length > start)
      ) {
        if (localView) setPage(pendingPage);
        else rememberPage(pendingPage);
        setPendingPage(null);
        setLoadedThrough(null);
        return;
      }
    }
    if (
      loadInFlight.current ||
      (loadedThrough != null && rows.length < loadedThrough)
    )
      return;
    if (!onLoadRows) {
      setPendingPage(null);
      setPageError({ page: retryPage, message: t("queryPaging.failed") });
      return;
    }
    const generation = filterGeneration.current;
    const previousCount = rows.length;
    const required = filtered
      ? previousCount + pageSize
      : pageEndFor(pendingPage, totalRows, pageSize);
    const exhaustedAt = filtered
      ? previousCount
      : Math.max(previousCount, start);
    loadInFlight.current = true;
    new Promise<number | null>((resolve) => resolve(onLoadRows(required)))
      .then((loaded) => {
        if (generation !== filterGeneration.current) return;
        if (loaded == null || loaded <= exhaustedAt) {
          setPendingPage(null);
          setPageError({
            page: retryPage,
            message: t(
              loaded == null ? "queryPaging.failed" : "queryPaging.exhausted",
            ),
          });
        } else {
          setLoadedThrough(loaded);
        }
      })
      .catch((error: unknown) => {
        if (generation !== filterGeneration.current) return;
        setPendingPage(null);
        setPageError({
          page: retryPage,
          message:
            error instanceof Error ? error.message : t("queryPaging.failed"),
        });
      })
      .finally(() => {
        loadInFlight.current = false;
        if (mounted.current) setLoadSettled((count) => count + 1);
      });
  }, [
    pendingPage,
    pageSize,
    rows.length,
    filteredRows.length,
    activeFilters.length,
    hasNextPage,
    totalRows,
    loadedThrough,
    loadSettled,
    loading,
    localView,
    serverPaged,
    onLoadRows,
    rememberPage,
    t,
  ]);

  useEffect(() => {
    if (page > lastPage) setPage(lastPage);
  }, [page, lastPage]);

  async function goTo(target: number, size = pageSize) {
    if (target < 1) return;
    setPageError(null);
    setLoadedThrough(null);
    if (
      activeFilters.length > 0 &&
      target * size > filteredRows.length &&
      canLoad
    ) {
      pendingFilterGeneration.current = filterGeneration.current;
      setPendingPage(target);
      return;
    }
    if (artifactPage !== undefined && !localView) {
      if (target === artifactPage || !onLoadPage || !queryRequestId) return;
      const generation = ++filterGeneration.current;
      setPendingPage(target);
      try {
        await onLoadPage((target - 1) * PAGE_SIZE, queryRequestId);
      } catch (error) {
        if (generation === filterGeneration.current)
          setPageError({
            page: target,
            message:
              error instanceof Error ? error.message : t("queryPaging.failed"),
          });
      } finally {
        if (generation === filterGeneration.current) setPendingPage(null);
      }
      return;
    }
    const required = pageEndFor(
      target,
      canLoad ? totalRows : BigInt(rows.length),
      size,
    );
    if (
      remotePage?.page === target ||
      rows.length >= required ||
      (hasNextPage === false && rows.length > (target - 1) * size)
    ) {
      if (localView) setPage(target);
      else rememberPage(target);
      return;
    }
    pendingFilterGeneration.current = filterGeneration.current;
    setPendingPage(target);
    if (!canSeek) return;
    const generation = filterGeneration.current;
    try {
      const pageRows = await onLoadPage(
        (target - 1) * PAGE_SIZE,
        queryRequestId,
      );
      if (generation !== filterGeneration.current) return;
      setPendingPage(null);
      setLoadedPage({
        requestId: queryRequestId,
        page: target,
        rows: pageRows,
      });
      rememberPage(target);
    } catch (error) {
      if (generation !== filterGeneration.current) return;
      setPendingPage(null);
      setPageError({
        page: target,
        message:
          error instanceof Error ? error.message : t("queryPaging.failed"),
      });
    }
  }
  if (output == null) {
    return loading ? (
      <div
        className="nb-output-pending"
        role="status"
        aria-label="Running cell"
      >
        <span className="nb-spinner" aria-hidden="true" />
      </div>
    ) : null;
  }

  if (output.type === "table") {
    const viewRows = effectiveSort
      ? [...filteredRows].sort((left, right) => {
          const a = formatCellValue(left[effectiveSort.column]);
          const b = formatCellValue(right[effectiveSort.column]);
          // Only values that actually read as numbers sort numerically; stripping
          // non-digits made "EMEA" parse as 0 and every text column compare equal.
          const comparison =
            compareNumericText(a, b) ??
            a.localeCompare(b, undefined, { numeric: true });
          return effectiveSort.direction === "asc" ? comparison : -comparison;
        })
      : filteredRows;
    // Paging follows what the reader is looking at, not the raw result: a
    // filter that narrows 100 rows to one match must show that match on page 1
    // instead of slicing at the old offset (census CEN-analytics-2-027).
    const viewLastPage = Math.max(1, Math.ceil(viewRows.length / pageSize));
    const showingRemotePage = remotePage?.page === page;
    const showingArtifactPage = artifactPage !== undefined && !localView;
    const currentPage = showingArtifactPage
      ? artifactPage
      : showingRemotePage
        ? page
        : Math.min(page, viewLastPage);
    const start = (currentPage - 1) * pageSize;
    const pageRows = showingArtifactPage
      ? rows
      : showingRemotePage
        ? remotePage.rows
        : viewRows.slice(start, start + pageSize);
    const jumpLastPage = canLoad && !localView ? lastPage : viewLastPage;
    const canAdvance = canSeek
      ? currentPage < jumpLastPage
      : currentPage < viewLastPage || canLoad;
    const totalLabel = formatTableRowCount(
      t,
      output,
      locale,
      queryTotalRows,
      hasNextPage,
    );
    // A filtered view says how much of the unfiltered result it is showing, so
    // the one visible match is never confused with the original row count.
    const shownLabel =
      activeFilters.length > 0
        ? t("queryPaging.filteredRows", {
            shown: formatLocaleNumber(viewRows.length, locale),
            total: totalLabel,
          })
        : totalLabel;
    const showPager =
      jumpLastPage > 1 ||
      canLoad ||
      rows.length > (serverPaged ? PAGE_SIZE : PAGE_SIZE_OPTIONS[0]);
    const rangeTotal = `${
      activeFilters.length > 0
        ? formatLocaleNumber(viewRows.length, locale)
        : totalRows !== null
          ? totalRows.toLocaleString(locale)
          : formatLocaleNumber(rows.length, locale)
    }${effectiveHasNextPage && (activeFilters.length > 0 || totalRows === null) ? "+" : ""}`;
    const csvComplete = coverage?.complete === true;
    const csvLabel = t("notebook.downloadCsv");
    const csvButton = (
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={csvLabel}
        disabled={!csvComplete || loading}
        onClick={() => {
          try {
            const url = URL.createObjectURL(
              new Blob([resultCsv(output.columns, output.rows)], {
                type: "text/csv;charset=utf-8",
              }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = csvFilename(downloadLabel);
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 0);
            toast.success(t("notebook.csvDownloaded"));
          } catch {
            toast.error(t("notebook.csvDownloadFailed"));
          }
        }}
      >
        <IconDownload size={14} aria-hidden="true" />
      </Button>
    );
    const copyLabel = t("notebook.dataCopy");
    const copyButton = (
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={copyLabel}
        disabled={!csvComplete || loading}
        onClick={() => {
          void navigator.clipboard
            .writeText(resultTsv(output.columns, output.rows))
            .then(
              () => toast.success(t("notebook.dataCopied")),
              () => toast.error(t("notebook.dataCopyFailed")),
            );
        }}
      >
        <IconCopy size={14} aria-hidden="true" />
      </Button>
    );
    const indexed = !queryTableControls || display.rowNumbers;
    const showTypeIcons = !queryTableControls || display.typeIcons;
    const visibleColumns = output.columns.flatMap((column, index) => {
      if (queryTableControls && display.hidden[index]) return [];
      const filterType = columnFilterType(column, rows, index);
      return [
        {
          index,
          name: column.name,
          Icon: resultColumnIcon(column.schemaType ?? column.type),
          filterType,
          numeric: filterType === "number",
        },
      ];
    });
    return (
      <div
        className={`nb-output${loading ? " is-loading" : ""}`}
        aria-busy={loading || pendingPage != null || materializing || undefined}
      >
        {copyError && (
          <div role="alert" className="nb-banner nb-banner-danger">
            {t("notebook.dataCopyFailed")}
          </div>
        )}
        {filters.length > 0 ? (
          <div ref={filterRowsRef}>
            <DisplayFilterRows
              columns={output.columns}
              rows={rows}
              filters={filters}
              onChange={setFilters}
              onAdd={() => addFilter(0)}
            />
          </div>
        ) : null}
        {coverage?.complete && coverage.count === 0n && (
          <div className="nb-output-footer nb-muted">
            {t("queryPaging.noData")}
          </div>
        )}
        {(output.columns.length > 0 || output.rows.length > 0) && (
          <div className="nb-table-scroll min-w-0 max-w-full">
            <table ref={resultTableRef} className="nb-table nb-result-grid">
              <thead>
                <tr>
                  {indexed && (
                    <th scope="col" className="nb-result-row-index">
                      <span className="sr-only">{t("notebook.rowNumber")}</span>
                      <span aria-hidden="true">#</span>
                    </th>
                  )}
                  {visibleColumns.map(
                    ({ name, Icon, index, filterType, numeric }) => (
                      <th
                        key={`${name}-${index}`}
                        scope="col"
                        className="nb-result-header"
                        aria-sort={
                          effectiveSort?.column === index
                            ? effectiveSort.direction === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        <DropdownMenu
                          modal={false}
                          open={openMenu === index}
                          onOpenChange={(open) =>
                            setOpenMenu((current) =>
                              open ? index : current === index ? null : current,
                            )
                          }
                        >
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="nb-th-control nb-th-menu"
                              style={
                                numeric ? { justifyContent: "end" } : undefined
                              }
                              aria-label={t("queryPaging.columnActions", {
                                column: name,
                              })}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                setOpenMenu(index);
                              }}
                            >
                              {showTypeIcons && (
                                <Icon
                                  size={14}
                                  className="shrink-0 text-muted-foreground"
                                  aria-hidden="true"
                                />
                              )}
                              <span>{name}</span>
                              {effectiveSort?.column === index &&
                                (effectiveSort.direction === "asc" ? (
                                  <IconSortAscending
                                    size={14}
                                    className="shrink-0"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <IconSortDescending
                                    size={14}
                                    className="shrink-0"
                                    aria-hidden="true"
                                  />
                                ))}
                              <IconDotsVertical
                                size={14}
                                className="shrink-0 text-muted-foreground"
                                aria-hidden="true"
                              />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="start"
                            aria-label={t("queryPaging.columnMenu", {
                              column: name,
                            })}
                            aria-hidden={openMenu !== index}
                            onPointerDownOutside={(event) => {
                              const target = event.detail.originalEvent.target;
                              if (
                                target instanceof Element &&
                                resultTableRef.current?.contains(target) &&
                                target.closest(".nb-th-menu")
                              )
                                event.preventDefault();
                            }}
                            onCloseAutoFocus={(event) => {
                              if (openMenuRef.current != null) {
                                event.preventDefault();
                                return;
                              }
                              const target = filterToFocus.current;
                              if (target?.column !== index) return;
                              filterToFocus.current = null;
                              const row =
                                filterRowsRef.current?.firstElementChild
                                  ?.children[target.filter];
                              const control =
                                row?.querySelector<HTMLElement>(
                                  'input, button[aria-haspopup="dialog"]',
                                ) ??
                                row?.querySelector<HTMLElement>(
                                  '[role="combobox"]',
                                );
                              if (control) {
                                event.preventDefault();
                                control.focus();
                              }
                            }}
                          >
                            <DropdownMenuItem
                              onSelect={() => {
                                setCopyError(false);
                                void (async () => {
                                  try {
                                    await navigator.clipboard.writeText(name);
                                    toast.success(
                                      t("notebook.columnNameCopied"),
                                    );
                                  } catch {
                                    setCopyError(true);
                                  }
                                })();
                              }}
                            >
                              {t("notebook.copyColumnName")}
                            </DropdownMenuItem>
                            {(["asc", "desc"] as const).map((direction) => (
                              <DropdownMenuItem
                                key={direction}
                                disabled={!sortAvailable}
                                onSelect={() =>
                                  setSort((current) =>
                                    current?.column === index &&
                                    current.direction === direction
                                      ? null
                                      : { column: index, direction },
                                  )
                                }
                              >
                                {t(
                                  sortLabelKey(
                                    filterType,
                                    direction === "asc" ? "Asc" : "Desc",
                                  ),
                                )}
                                {sort?.column === index &&
                                  sort.direction === direction && (
                                    <IconCheck size={14} aria-hidden="true" />
                                  )}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuItem
                              onSelect={() => {
                                const existing = filters
                                  .map((filter) => filter.column)
                                  .lastIndexOf(index);
                                filterToFocus.current = {
                                  column: index,
                                  filter:
                                    existing >= 0 ? existing : filters.length,
                                };
                                if (existing < 0) addFilter(index, true);
                              }}
                            >
                              {t("notebook.filterThisColumn")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, rowIndex) => (
                  <tr key={start + rowIndex}>
                    {indexed && (
                      <th scope="row" className="nb-result-row-index">
                        {formatLocaleNumber(start + rowIndex, locale)}
                      </th>
                    )}
                    {visibleColumns.map(({ numeric, index: columnIndex }) => {
                      const value = row[columnIndex];
                      const format =
                        display.formats[columnIndex] ??
                        columnFormats?.[columnIndex] ??
                        null;
                      const formatted =
                        value === null
                          ? String(value)
                          : typeof format === "function"
                            ? format(value)
                            : formatPublishedValue(value, format, locale);
                      return (
                        <td
                          key={columnIndex}
                          title={formatted}
                          className={
                            [
                              numeric ? "nb-result-number" : "",
                              value === null ? "nb-result-null" : "",
                            ]
                              .filter(Boolean)
                              .join(" ") || undefined
                          }
                          style={numeric ? { textAlign: "right" } : undefined}
                        >
                          {formatted}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {coverage?.exact === null && hasNextPage !== true ? (
          <div className="nb-output-footer nb-muted">
            {t("queryPaging.truncated", {
              count: rows.length,
              formattedCount: formatLocaleNumber(rows.length, locale),
            })}
          </div>
        ) : null}
        <div className="nb-result-footer">
          {resultVariable}
          {onAddChartCell && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={loading}
              onClick={onAddChartCell}
            >
              <IconChartBar aria-hidden="true" />
              {t("notebook.addChartCell")}
            </Button>
          )}
          {queryTableControls && (
            <div className="nb-result-controls ms-auto">
              <SqlResultControls
                columns={output.columns}
                pageRows={pageRows}
                display={display}
                update={(patch) =>
                  setDisplay((current) => ({ ...current, ...patch }))
                }
                disabled={loading}
              />
            </div>
          )}
          <span
            className={`${queryTableControls ? "" : "ms-auto "}text-muted-foreground`}
            role="status"
          >
            {pendingPage != null || materializing ? (
              <Skeleton
                className="inline-block h-3 w-16 align-middle"
                aria-label={t("queryPaging.loadingRows")}
              />
            ) : (
              shownLabel
            )}
          </span>
          {showPager ? (
            <div className="nb-table-pagination flex flex-wrap items-center gap-0.5">
              {serverPaged ? null : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="tabular-nums"
                      aria-label={t("notebook.rowsPerPage")}
                    >
                      {formatLocaleNumber(pageSize, locale)}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <DropdownMenuItem
                        key={size}
                        onSelect={() => {
                          filterGeneration.current++;
                          setPendingPage(null);
                          setLoadedThrough(null);
                          setPageError(null);
                          rememberPage(1);
                          setRequestedPage(null);
                          setChosenPageSize(size);
                          void goTo(1, size);
                        }}
                      >
                        {t("notebook.pageSizeOption", { count: size })}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <span className="px-1 text-muted-foreground tabular-nums">
                {t("visualization.charts.tablePageRows", {
                  start: formatLocaleNumber(
                    pageRows.length ? start + 1 : 0,
                    locale,
                  ),
                  end: formatLocaleNumber(start + pageRows.length, locale),
                  total: rangeTotal,
                })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("notebook.previousPage")}
                disabled={currentPage <= 1 || pendingPage != null}
                onClick={() => void goTo(currentPage - 1)}
              >
                <IconChevronLeft
                  className="rtl:rotate-180"
                  aria-hidden="true"
                />
              </Button>
              <Button
                type="button"
                variant={currentPage === 1 ? "secondary" : "ghost"}
                size="xs"
                className="min-w-6 px-1 tabular-nums"
                aria-current={currentPage === 1 ? "page" : undefined}
                disabled={pendingPage != null}
                onClick={() => void goTo(1)}
              >
                1
              </Button>
              {jumpLastPage > 2 && (
                <Button
                  type="button"
                  variant={currentPage === 2 ? "secondary" : "ghost"}
                  size="xs"
                  className="min-w-6 px-1 tabular-nums"
                  aria-current={currentPage === 2 ? "page" : undefined}
                  disabled={pendingPage != null}
                  onClick={() => void goTo(2)}
                >
                  2
                </Button>
              )}
              {currentPage > 2 && currentPage !== jumpLastPage ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  className="min-w-6 px-1 tabular-nums"
                  aria-current="page"
                  disabled={pendingPage != null}
                >
                  {currentPage}
                </Button>
              ) : null}
              {queryTableControls && jumpLastPage > 2 ? (
                <Popover open={jumpOpen} onOpenChange={setJumpOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="min-w-6 px-1"
                      aria-label={t("notebook.goToResultPage")}
                      disabled={pendingPage != null}
                    >
                      …
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-32 p-2">
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const target = Number(
                          new FormData(event.currentTarget).get("page"),
                        );
                        if (
                          !Number.isSafeInteger(target) ||
                          target < 1 ||
                          target > jumpLastPage
                        )
                          return;
                        setJumpOpen(false);
                        void goTo(target);
                      }}
                    >
                      <Input
                        name="page"
                        aria-label={t("notebook.goToResultPage")}
                        type="number"
                        min={1}
                        max={jumpLastPage}
                        step={1}
                        defaultValue={currentPage}
                        required
                      />
                    </form>
                  </PopoverContent>
                </Popover>
              ) : (
                jumpLastPage > Math.max(2, currentPage) + 1 && (
                  <span aria-hidden="true">…</span>
                )
              )}
              {jumpLastPage > 1 ? (
                <Button
                  type="button"
                  variant={currentPage === jumpLastPage ? "secondary" : "ghost"}
                  size="xs"
                  className="min-w-6 px-1 tabular-nums"
                  aria-current={
                    currentPage === jumpLastPage ? "page" : undefined
                  }
                  disabled={pendingPage != null}
                  onClick={() => void goTo(jumpLastPage)}
                >
                  {jumpLastPage}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("notebook.nextPage")}
                disabled={!canAdvance || pendingPage != null}
                onClick={() => void goTo(currentPage + 1)}
              >
                <IconChevronRight
                  className="rtl:rotate-180"
                  aria-hidden="true"
                />
              </Button>
            </div>
          ) : null}
          {allowCsvDownload ? (
            <>
              <Tooltip
                content={csvComplete ? copyLabel : t("notebook.csvIncomplete")}
                trigger={
                  csvComplete ? (
                    copyButton
                  ) : (
                    <span tabIndex={0}>{copyButton}</span>
                  )
                }
              />
              <Tooltip
                content={csvComplete ? csvLabel : t("notebook.csvIncomplete")}
                trigger={
                  csvComplete ? (
                    csvButton
                  ) : (
                    <span tabIndex={0}>{csvButton}</span>
                  )
                }
              />
            </>
          ) : null}
        </div>
        {pageError ? (
          <div
            role="alert"
            className="nb-banner nb-banner-danger"
            style={{ margin: "8px 10px" }}
          >
            <p className="nb-banner-message">{pageError.message}</p>
            <div className="nb-banner-actions">
              <button
                type="button"
                className="nb-text-button"
                disabled={pendingPage != null || materializing}
                onClick={() => {
                  if (
                    canReadArtifactPages &&
                    activeMaterialized == null &&
                    (sort !== null || activeFilters.length > 0)
                  ) {
                    materializeAttempt.current = null;
                    setPageError(null);
                    setMaterializeRetry((count) => count + 1);
                    return;
                  }
                  void goTo(pageError.page);
                }}
              >
                {t("queryPaging.retry")}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (output.type === "chart") {
    return <ChartOutput output={output} loading={loading} />;
  }

  if (output.type === "metric") {
    return (
      <div
        className={`nb-output nb-metric${loading ? " is-loading" : ""}`}
        aria-busy={loading || undefined}
      >
        {output.formatted}
      </div>
    );
  }

  if (output.type === "text") {
    return (
      <div
        className={`nb-output${loading ? " is-loading" : ""}`}
        aria-busy={loading || undefined}
      >
        <pre className="nb-output-text">{output.text}</pre>
      </div>
    );
  }

  const cancelled = output.code === "interrupted";
  const unknown = output.code === "cancel_unknown";
  if (queryError && !cancelled && !unknown) {
    const describedError = describeEngineError(output.message, t);
    const copyableError = output.detail
      ? `${describedError}\n${t("notebook.reviewTrace", { traceId: output.detail })}`
      : describedError;
    const copyQueryError = () => {
      const write = (navigator.clipboard as Clipboard | undefined)?.writeText(
        copyableError,
      );
      if (write == null) {
        toast.error(t("notebook.pythonCopyOutputFailed"));
        return;
      }
      void write.then(
        () => toast.success(t("notebook.columnNameCopied")),
        () => toast.error(t("notebook.pythonCopyOutputFailed")),
      );
    };
    return (
      <div
        className={`nb-output${loading ? " is-loading" : ""}`}
        aria-busy={loading || undefined}
      >
        <CellErrorAlert>
          <strong>{t("queryError.title")}</strong>
          <div>{t("queryError.message")}</div>
          <div className="nb-python-error-actions">
            {onFixWithAgent && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onFixWithAgent}
              >
                <IconSparkles aria-hidden="true" size={14} />
                {t("notebook.reviewFixWithAgent")}
              </Button>
            )}
            <button
              type="button"
              className="nb-text-button"
              onClick={copyQueryError}
            >
              {t("notebook.errorCopy")}
            </button>
          </div>
          <pre>
            <span>{t("queryError.exception")}</span> {describedError}
            {output.detail && (
              <>
                {"\n"}
                {t("notebook.reviewTrace", { traceId: output.detail })}
              </>
            )}
          </pre>
        </CellErrorAlert>
      </div>
    );
  }
  const text =
    output.detail == null
      ? describeEngineError(output.message, t)
      : `${describeEngineError(output.message, t)}\n\n${output.detail}`;
  return (
    <div
      className={`nb-output${loading ? " is-loading" : ""}`}
      aria-busy={loading || undefined}
    >
      {unknown ? (
        <div className="nb-output-error">{t("queryError.cancelUnknown")}</div>
      ) : cancelled ? (
        <div className="nb-output-error">
          <strong>{t("queryError.interrupted")}</strong>
        </div>
      ) : (
        <pre className="nb-output-error">{text}</pre>
      )}
      {!unknown && onRetry != null && (
        <div className="nb-output-footer">
          <button type="button" className="nb-text-button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * A stored chart output is drawn with the same drawing a configured chart cell
 * uses, so a chart cell and a chart output never drift apart.
 */
function ChartOutput({
  output,
  loading,
}: {
  output: Extract<CellOutput, { type: "chart" }>;
  loading: boolean;
}) {
  return (
    <VegaChart
      columns={output.columns}
      rows={output.rows}
      mark="bar"
      loading={loading}
    />
  );
}

const DECIMAL_LITERAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

function isDecimalLiteral(text: string): text is `${number}` {
  return DECIMAL_LITERAL.test(text);
}

export function toIntlNumeric(
  value: unknown,
): number | bigint | `${number}` | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value;
  if (typeof value !== "string") return null;
  const text = value.trim();
  return isDecimalLiteral(text) ? text : null;
}

export function formatPublishedValue(
  value: unknown,
  format:
    | "text"
    | "number"
    | "percent"
    | "currency"
    | "date"
    | "datetime"
    | "compact_number"
    | null,
  locale: string,
): string {
  if (value == null) return "";
  if (format === "date" || format === "datetime") {
    const date = new Date(String(value));
    return Number.isNaN(date.valueOf())
      ? String(value)
      : format === "date"
        ? date.toLocaleDateString(locale, { timeZone: "UTC" })
        : date.toLocaleString(locale);
  }
  if (
    ["number", "percent", "currency", "compact_number"].includes(format ?? "")
  ) {
    const numeric = toIntlNumeric(value);
    if (numeric != null) {
      const options: Intl.NumberFormatOptions =
        format === "percent"
          ? {
              style: "percent",
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }
          : format === "currency"
            ? { style: "currency", currency: "USD" }
            : format === "compact_number"
              ? { notation: "compact" }
              : {};
      const parts = getCachedNumberFormat(locale, options).formatToParts(
        numeric,
      );
      if (
        !parts.some((part) => part.type === "infinity" || part.type === "nan")
      )
        return parts.map((part) => part.value).join("");
    }
  }
  return formatCellValue(value);
}
