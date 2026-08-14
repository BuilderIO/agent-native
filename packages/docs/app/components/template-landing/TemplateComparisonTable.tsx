import type { ReactNode } from "react";

export type TemplateComparisonColumn = {
  className?: string;
  emphasized?: boolean;
  header: ReactNode;
  id: string;
};

export type TemplateComparisonRow = {
  cells: Record<string, ReactNode>;
  id: string;
  label: ReactNode;
};

type TemplateComparisonTableProps = {
  caption: string;
  className?: string;
  columns: readonly TemplateComparisonColumn[];
  featureHeader: ReactNode;
  rows: readonly TemplateComparisonRow[];
};

export function TemplateComparisonTable({
  caption,
  className = "",
  columns,
  featureHeader,
  rows,
}: TemplateComparisonTableProps) {
  return (
    <div
      className={`overflow-x-auto border border-[var(--docs-border)] ${className}`}
    >
      <table className="w-full min-w-[42rem] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-[var(--table-header-bg)]">
            <th
              scope="col"
              className="w-[18%] border border-[var(--docs-border)] px-5 py-3 text-start"
            >
              <span className="sr-only">{featureHeader}</span>
            </th>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                data-emphasized={column.emphasized || undefined}
                className={`border border-[var(--docs-border)] px-8 py-3 text-center text-[15px] font-medium leading-[1.4] ${
                  column.emphasized
                    ? "bg-[var(--bg)] text-[var(--fg)]"
                    : "text-[var(--fg-secondary)]"
                } ${column.className ?? ""}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th
                scope="row"
                className="min-h-14 border border-[var(--docs-border)] px-5 py-3 text-start text-[15px] font-medium leading-[1.4] text-[var(--fg)] sm:px-8"
              >
                {row.label}
              </th>
              {columns.map((column) => (
                <td
                  key={column.id}
                  data-emphasized={column.emphasized || undefined}
                  className={`min-h-14 border border-[var(--docs-border)] px-5 py-3 text-center text-[15px] leading-[1.4] sm:px-8 ${
                    column.emphasized
                      ? "bg-[var(--bg)] text-[var(--fg)]"
                      : "text-[var(--fg-secondary)]"
                  } ${column.className ?? ""}`}
                >
                  {row.cells[column.id]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
