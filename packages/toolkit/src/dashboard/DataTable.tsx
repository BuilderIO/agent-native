import {
  IconArrowsUpDown,
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";
import { Skeleton } from "../ui/skeleton.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table.js";
import { cn } from "../utils.js";

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const TABLE_MIN_HEIGHT_CLASS = "min-h-[386px]";

export interface DataTableLabels {
  noData: string;
  rowsPerPage: string;
  of: string;
  previousPage: string;
  nextPage: string;
}

export interface DataTableProps {
  title?: string;
  data: Record<string, unknown>[];
  columns?: string[];
  loading?: boolean;
  error?: string;
  maxRows?: number;
  pageSizeOptions?: number[];
  labels?: Partial<DataTableLabels>;
}

const DEFAULT_LABELS: DataTableLabels = {
  noData: "No data available.",
  rowsPerPage: "Rows per page",
  of: "of",
  previousPage: "Previous page",
  nextPage: "Next page",
};

/** A source-agnostic, sortable and paginated dashboard table. */
export function DataTable({
  title,
  data,
  columns: columnsProp,
  loading,
  error,
  maxRows,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  labels: labelOverrides,
}: DataTableProps) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(pageSizeOptions[0] ?? 10);

  const columns = useMemo(() => {
    if (columnsProp) return columnsProp;
    return data.length === 0 ? [] : Object.keys(data[0]);
  }, [columnsProp, data]);
  const rows = useMemo(
    () =>
      maxRows != null && data.length > maxRows ? data.slice(0, maxRows) : data,
    [data, maxRows],
  );
  const sortedRows = useMemo(() => {
    if (!sortColumn) return rows;
    return [...rows].sort((a, b) => {
      const aValue = a[sortColumn];
      const bValue = b[sortColumn];
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;
      const comparison =
        typeof aValue === "number" && typeof bValue === "number"
          ? aValue - bValue
          : String(aValue).localeCompare(String(bValue));
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [rows, sortColumn, sortDirection]);
  const pageCount = Math.ceil(sortedRows.length / pageSize);
  const pagedRows = sortedRows.slice(page * pageSize, (page + 1) * pageSize);

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
    setPage(0);
  };

  const content = loading ? (
    <DataTableLoadingSkeleton />
  ) : error ? (
    <p className="py-4 text-sm text-destructive">{error}</p>
  ) : data.length === 0 ? (
    <p className="py-4 text-center text-sm text-muted-foreground">
      {labels.noData}
    </p>
  ) : (
    <div className={cn("overflow-x-auto", TABLE_MIN_HEIGHT_CLASS)}>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column}
                className="cursor-pointer select-none whitespace-nowrap hover:text-foreground"
                onClick={() => handleSort(column)}
              >
                <span className="flex items-center gap-1">
                  {column}
                  <IconArrowsUpDown
                    className={cn(
                      "h-3 w-3",
                      sortColumn === column
                        ? "text-foreground"
                        : "text-muted-foreground/50",
                    )}
                  />
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {pagedRows.map((row, index) => (
            <TableRow key={index}>
              {columns.map((column) => (
                <TableCell
                  key={column}
                  className="max-w-[300px] truncate whitespace-nowrap"
                >
                  {formatValue(row[column])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {sortedRows.length > (pageSizeOptions[0] ?? 10) && (
        <div className="flex items-center justify-between border-t border-border px-2 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>{labels.rowsPerPage}</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                setPageSize(Number(value));
                setPage(0);
              }}
            >
              <SelectTrigger className="h-6 w-16 border-border px-2 py-0 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span>
              {page * pageSize + 1}–
              {Math.min((page + 1) * pageSize, sortedRows.length)} {labels.of}{" "}
              {sortedRows.length}
            </span>
            <Button
              aria-label={labels.previousPage}
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setPage((current) => current - 1)}
              disabled={page === 0}
            >
              <IconChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              aria-label={labels.nextPage}
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setPage((current) => current + 1)}
              disabled={page >= pageCount - 1}
            >
              <IconChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  if (!title) return content;
  return (
    <Card className="border-border/50 bg-card">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}

function formatValue(value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "number")
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(4);
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function DataTableLoadingSkeleton() {
  const columnWidths = ["w-24", "w-32", "w-20", "w-28"];
  return (
    <div className={cn("space-y-1", TABLE_MIN_HEIGHT_CLASS)}>
      <div className="overflow-x-auto">
        <div className="min-w-[480px]">
          <div className="grid h-8 grid-cols-4 items-center border-b border-border px-2">
            {columnWidths.map((width, index) => (
              <Skeleton key={index} className={cn("h-3", width)} />
            ))}
          </div>
          {Array.from({ length: 10 }).map((_, row) => (
            <div
              key={row}
              className="grid h-8 grid-cols-4 items-center border-b border-border/50 px-2"
            >
              {columnWidths.map((width, column) => (
                <Skeleton
                  key={column}
                  className={cn(
                    "h-3",
                    column === 0
                      ? "w-36"
                      : column === 2
                        ? "ml-auto w-16"
                        : width,
                  )}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex h-8 items-center justify-between border-t border-border px-2 text-xs">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  );
}
