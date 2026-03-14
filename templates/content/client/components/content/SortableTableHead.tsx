import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { TableHead } from "@/components/ui/table";

export type SortDirection = "asc" | "desc";

interface SortableTableHeadProps<TColumn extends string = string> {
  column: TColumn;
  label: string;
  sortColumn: TColumn | null;
  sortDirection: SortDirection | null;
  onSort: (column: TColumn) => void;
  className?: string;
}

export function SortableTableHead<TColumn extends string>({
  column,
  label,
  sortColumn,
  sortDirection,
  onSort,
  className,
}: SortableTableHeadProps<TColumn>) {
  const isActive = sortColumn === column;

  return (
    <TableHead
      className={className}
      aria-sort={
        isActive
          ? sortDirection === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <button
        type="button"
        className="group -mx-2 flex w-full items-start gap-2 rounded-md px-2 py-1 text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onSort(column)}
      >
        <span className="whitespace-nowrap leading-snug">{label}</span>
        {isActive ? (
          sortDirection === "asc" ? (
            <ArrowUp className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
          ) : (
            <ArrowDown className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
          )
        ) : (
          <ArrowUpDown className="mt-0.5 h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60" />
        )}
      </button>
    </TableHead>
  );
}
