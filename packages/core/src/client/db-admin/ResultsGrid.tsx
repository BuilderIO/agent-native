/**
 * Read-only results table for the SQL editor. Renders a clean, dense grid with a
 * sticky header, zebra striping, dim NULL tokens, stringified objects, and
 * horizontal scrolling. DDL/DML statements that return no columns render a
 * "Query OK" placeholder instead.
 *
 * Results are LIMIT-capped upstream, so no virtualization is needed.
 */
import { IconCircleCheck } from "@tabler/icons-react";

import { cn } from "../utils.js";

export interface ResultsGridProps {
  columns: string[];
  rows: Record<string, unknown>[];
}

function renderCell(value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="italic text-muted-foreground/60">NULL</span>;
  }
  if (typeof value === "object") {
    let str: string;
    try {
      str = JSON.stringify(value);
    } catch {
      str = String(value);
    }
    return <span className="text-foreground/80">{str}</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-foreground/80">{String(value)}</span>;
  }
  return <span>{String(value)}</span>;
}

export function ResultsGrid({ columns, rows }: ResultsGridProps) {
  if (columns.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
        <IconCircleCheck size={28} className="text-green-500" />
        <span className="text-sm">Query OK</span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-left font-mono text-xs">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="sticky left-0 z-20 w-px border-b border-r border-border bg-muted px-3 py-1.5 text-right font-sans text-[11px] font-medium text-muted-foreground select-none">
              #
            </th>
            {columns.map((col, i) => (
              <th
                key={`${col}-${i}`}
                className="whitespace-nowrap border-b border-r border-border bg-muted px-3 py-1.5 font-sans text-[11px] font-semibold text-foreground"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + 1}
                className="px-3 py-8 text-center font-sans text-sm text-muted-foreground"
              >
                No rows returned
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className={cn(
                  "group",
                  rowIndex % 2 === 1 ? "bg-muted/30" : "bg-background",
                )}
              >
                <td
                  className={cn(
                    "sticky left-0 z-10 w-px border-b border-r border-border px-3 py-1 text-right font-sans text-[11px] text-muted-foreground select-none",
                    rowIndex % 2 === 1 ? "bg-muted/60" : "bg-background",
                  )}
                >
                  {rowIndex + 1}
                </td>
                {columns.map((col, colIndex) => (
                  <td
                    key={`${col}-${colIndex}`}
                    className="max-w-md truncate whitespace-nowrap border-b border-r border-border px-3 py-1 align-top text-foreground"
                    title={
                      row[col] === null || row[col] === undefined
                        ? "NULL"
                        : typeof row[col] === "object"
                          ? JSON.stringify(row[col])
                          : String(row[col])
                    }
                  >
                    {renderCell(row[col])}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
