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
import { ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

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
  maxRows = 100,
}: DataTableProps) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const columns = useMemo(() => {
    if (columnsProp) return columnsProp;
    if (data.length === 0) return [];
    return Object.keys(data[0]);
  }, [data, columnsProp]);

  const sorted = useMemo(() => {
    if (!sortCol) return data.slice(0, maxRows);
    return [...data]
      .sort((a, b) => {
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
      })
      .slice(0, maxRows);
  }, [data, sortCol, sortDir, maxRows]);

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
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
        <div className="overflow-auto max-h-[500px]">
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
                      <ArrowUpDown
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
              {sorted.map((row, i) => (
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
          {data.length > maxRows && (
            <p className="text-xs text-muted-foreground text-center py-2">
              Showing {maxRows} of {data.length} rows
            </p>
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
