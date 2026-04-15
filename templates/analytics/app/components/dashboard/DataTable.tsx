import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  IconArrowsUpDown,
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

interface DataTableProps {
  title?: string;
  data: Record<string, unknown>[];
  columns?: string[];
  isLoading?: boolean;
  error?: string;
  maxRows?: number;
}

export function DataTable({
  title,
  data,
  columns: columnsProp,
  isLoading,
  error,
  maxRows,
}: DataTableProps) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const columns = useMemo(() => {
    if (columnsProp) return columnsProp;
    if (data.length === 0) return [];
    return Object.keys(data[0]);
  }, [data, columnsProp]);

  // Cap the dataset at `maxRows` before sorting/paginating. Callers pass this
  // to avoid spending a bunch of work formatting + sorting thousands of rows
  // the user will never scroll to. Applied before sort so a 10k-row query
  // trimmed to 200 rows sorts 200, not 10k.
  const rows = useMemo(
    () =>
      maxRows != null && data.length > maxRows ? data.slice(0, maxRows) : data,
    [data, maxRows],
  );

  const sorted = useMemo(() => {
    if (!sortCol) return rows;
    return [...rows].sort((a, b) => {
      const aVal = a[sortCol];
      const bVal = b[sortCol];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortCol, sortDir]);

  const pageCount = Math.ceil(sorted.length / pageSize);
  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize);

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
    setPage(0);
  };

  const formatValue = (val: unknown): string => {
    if (val == null) return "-";
    if (typeof val === "number") {
      if (Number.isInteger(val)) return val.toLocaleString();
      return val.toFixed(4);
    }
    if (typeof val === "object") return JSON.stringify(val);
    return String(val);
  };

  const content = (
    <>
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-red-400 py-4">{error}</p>
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No data
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead
                    key={col}
                    className="cursor-pointer hover:text-foreground select-none whitespace-nowrap"
                    onClick={() => handleSort(col)}
                  >
                    <span className="flex items-center gap-1">
                      {col}
                      <IconArrowsUpDown
                        className={cn(
                          "h-3 w-3",
                          sortCol === col
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
              {paged.map((row, i) => (
                <TableRow key={i}>
                  {columns.map((col) => (
                    <TableCell
                      key={col}
                      className="whitespace-nowrap max-w-[300px] truncate"
                    >
                      {formatValue(row[col])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {sorted.length > PAGE_SIZE_OPTIONS[0] && (
            <div className="flex items-center justify-between px-2 py-2 border-t border-border text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>Rows per page:</span>
                <select
                  className="bg-background border border-border rounded px-1 py-0.5 text-xs"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(0);
                  }}
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span>
                  {page * pageSize + 1}–
                  {Math.min((page + 1) * pageSize, sorted.length)} of{" "}
                  {sorted.length}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page === 0}
                >
                  <IconChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= pageCount - 1}
                >
                  <IconChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );

  if (!title) return content;

  return (
    <Card className="bg-card border-border/50">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}
