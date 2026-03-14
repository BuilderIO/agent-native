import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber, formatPercent, formatCurrency } from "../types";

interface Column {
  key: string;
  label: string;
  format: "text" | "number" | "percent" | "currency";
  width?: string;
}

const TAB1_COLUMNS: Column[] = [
  { key: "url", label: "Base URL", format: "text", width: "min-w-[200px]" },
  { key: "author", label: "Author", format: "text" },
  { key: "new_visitors", label: "New Visitors", format: "number" },
  { key: "pct_signups", label: "% Signups", format: "percent" },
  { key: "signups", label: "Signups", format: "number" },
  { key: "pct_paid_subs", label: "% Paid Subs", format: "percent" },
  { key: "ss_paid_subs", label: "SS Paid Subs", format: "number" },
  { key: "marketing_contact", label: "Mktg Contact", format: "number" },
  { key: "pct_icp_signups", label: "% ICP Signups", format: "percent" },
];

const TAB3_COLUMNS: Column[] = [
  { key: "url", label: "URL", format: "text", width: "min-w-[200px]" },
  { key: "author", label: "Author", format: "text" },
  { key: "type", label: "Type", format: "text" },
  { key: "ai_sub_type", label: "Sub Type", format: "text" },
  { key: "purpose", label: "Purpose", format: "text" },
  { key: "persona", label: "Persona", format: "text" },
  { key: "day_of_pub_date", label: "Pub Date", format: "text" },
  { key: "new_visitors", label: "New Visitors", format: "number" },
  { key: "pct_signups", label: "% Signups", format: "percent" },
  { key: "signups", label: "Signups", format: "number" },
  { key: "pct_paid_subs", label: "% Paid Subs", format: "percent" },
  { key: "ss_paid_subs", label: "SS Paid Subs", format: "number" },
  { key: "marketing_contact", label: "Mktg Contact", format: "number" },
  { key: "pct_icp_signups", label: "% ICP", format: "percent" },
  { key: "icp_signups", label: "ICP Signups", format: "number" },
  { key: "mql", label: "MQL", format: "number" },
  { key: "sal", label: "SAL", format: "number" },
  { key: "qualified_deals", label: "Qual Deals", format: "number" },
  { key: "qualified_pipeline", label: "Pipeline", format: "currency" },
  { key: "closed_won_amount", label: "Closed Won", format: "currency" },
  { key: "ss_arr", label: "SS ARR", format: "currency" },
];

interface PagePerformanceTableProps {
  rows: Record<string, unknown>[];
  isLoading?: boolean;
  error?: string;
  variant: "tab1" | "tab3";
  sortCol: string;
  sortDir: "asc" | "desc";
  onSortChange: (col: string, dir: "asc" | "desc") => void;
  blogOnly?: boolean;
  onBlogOnlyChange?: (blogOnly: boolean) => void;
  explainerOnly?: boolean;
  onExplainerOnlyChange?: (explainerOnly: boolean) => void;
}

export function PagePerformanceTable({
  rows,
  isLoading,
  error,
  variant,
  sortCol,
  sortDir,
  onSortChange,
  blogOnly,
  onBlogOnlyChange,
  explainerOnly,
  onExplainerOnlyChange,
}: PagePerformanceTableProps) {
  const columns = variant === "tab3" ? TAB3_COLUMNS : TAB1_COLUMNS;

  const handleSort = (col: string) => {
    if (sortCol === col) {
      onSortChange(col, sortDir === "asc" ? "desc" : "asc");
    } else {
      onSortChange(col, "desc");
    }
  };

  const formatVal = (val: unknown, format: Column["format"]): string => {
    if (val == null) return "-";
    switch (format) {
      case "number":
        return formatNumber(Number(val));
      case "percent":
        return formatPercent(Number(val));
      case "currency":
        return formatCurrency(Number(val));
      default:
        return String(val);
    }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortCol !== col) return <ArrowUpDown className="h-3 w-3 text-muted-foreground/30" />;
    return sortDir === "asc"
      ? <ArrowUp className="h-3 w-3 text-foreground" />
      : <ArrowDown className="h-3 w-3 text-foreground" />;
  };

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Page Performance</CardTitle>
          <div className="flex gap-2">
            {onBlogOnlyChange && (
              <Button
                variant={blogOnly ? "default" : "outline"}
                size="sm"
                className="text-xs h-7 px-3"
                onClick={() => onBlogOnlyChange(!blogOnly)}
              >
                Blog Only
              </Button>
            )}
            {onExplainerOnlyChange && (
              <Button
                variant={explainerOnly ? "default" : "outline"}
                size="sm"
                className="text-xs h-7 px-3"
                onClick={() => onExplainerOnlyChange(!explainerOnly)}
              >
                Explainer Only
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-red-400 py-4 text-center">{error}</p>
        ) : !isLoading && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No data
          </p>
        ) : (
          <div className="overflow-auto max-h-[500px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border">
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={cn(
                        "text-left py-2 px-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground whitespace-nowrap select-none",
                        col.width
                      )}
                      onClick={() => handleSort(col.key)}
                    >
                      <span className="flex items-center gap-1">
                        {col.label}
                        <SortIcon col={col.key} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array.from({ length: 20 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/30">
                        {columns.map((col) => (
                          <td key={col.key} className="py-1.5 px-2">
                            <Skeleton className="h-4 w-full" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : rows.map((row, i) => (
                      <tr key={i} className="border-b border-border/30 hover:bg-muted/30">
                        {columns.map((col) => (
                          <td
                            key={col.key}
                            className={cn(
                              "py-1.5 px-2 whitespace-nowrap",
                              col.format === "text" ? "max-w-[250px] truncate" : "text-right tabular-nums",
                              col.key === "url" && "font-mono text-[11px]"
                            )}
                            title={col.format === "text" ? String(row[col.key] ?? "") : undefined}
                          >
                            {col.key === "url" ? (
                              <span className="flex items-center gap-1">
                                <span className="truncate">{formatVal(row[col.key], col.format)}</span>
                                <a
                                  href={`https://www.builder.io${row[col.key]}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="shrink-0 text-muted-foreground hover:text-foreground"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </span>
                            ) : (
                              formatVal(row[col.key], col.format)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
              </tbody>
            </table>
            {!isLoading && rows.length >= 500 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                Showing top 500 rows (server-sorted by {sortCol} {sortDir})
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
