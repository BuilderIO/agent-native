import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  ExternalLink,
} from "lucide-react";
import type { HubSpotDeal } from "@/lib/api-hooks";

function fmtDollars(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return val > 0 ? `$${val.toLocaleString()}` : "-";
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "-";
  }
}

interface Props {
  deals: HubSpotDeal[];
  stageLabels: Record<string, string>;
  isLoading: boolean;
  selectedDeal?: HubSpotDeal | null;
  onSelectDeal?: (deal: HubSpotDeal | null) => void;
}

type SortCol = "dealname" | "amount" | "createdate" | "closedate" | "stage";

export function DealTable({
  deals,
  stageLabels,
  isLoading,
  selectedDeal,
  onSelectDeal,
}: Props) {
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<SortCol>("amount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let result = deals;
    if (q) {
      result = deals.filter((d) => {
        const name = d.properties.dealname?.toLowerCase() ?? "";
        const stage = (stageLabels[d.properties.dealstage] ?? "").toLowerCase();
        return name.includes(q) || stage.includes(q);
      });
    }
    return [...result].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;
      if (sortCol === "amount") {
        aVal = parseFloat(a.properties.amount ?? "0") || 0;
        bVal = parseFloat(b.properties.amount ?? "0") || 0;
      } else if (sortCol === "stage") {
        aVal = stageLabels[a.properties.dealstage] ?? "";
        bVal = stageLabels[b.properties.dealstage] ?? "";
      } else {
        aVal = a.properties[sortCol] ?? "";
        bVal = b.properties[sortCol] ?? "";
      }
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDir === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }, [deals, search, sortCol, sortDir, stageLabels]);

  const handleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-card border-border/50">
        <CardContent className="py-6">
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const cols: { key: SortCol; label: string; type: "text" | "num" | "date" }[] = [
    { key: "dealname", label: "Deal Name", type: "text" },
    { key: "stage", label: "Stage", type: "text" },
    { key: "amount", label: "Amount", type: "num" },
    { key: "createdate", label: "Created", type: "date" },
    { key: "closedate", label: "Close Date", type: "date" },
  ];

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">
            Deal Lookup ({filtered.length})
          </CardTitle>
          <div className="relative w-[240px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search deals..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-7 h-8 text-xs"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-auto max-h-[500px]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="border-b border-border">
                {cols.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      "py-2 px-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground whitespace-nowrap select-none",
                      col.type === "text" ? "text-left" : "text-right"
                    )}
                    onClick={() => handleSort(col.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      <SortIcon col={col.key} sortCol={sortCol} sortDir={sortDir} />
                    </span>
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((deal) => {
                const amount = parseFloat(deal.properties.amount ?? "0") || 0;
                const stageLabel = stageLabels[deal.properties.dealstage] ?? deal.properties.dealstage;
                const isSelected = selectedDeal?.id === deal.id;

                return (
                  <tr
                    key={deal.id}
                    className={cn(
                      "border-b border-border/30 hover:bg-muted/30 cursor-pointer",
                      isSelected && "bg-primary/10"
                    )}
                    onClick={() => onSelectDeal?.(isSelected ? null : deal)}
                  >
                    <td
                      className="py-1.5 px-2 font-medium max-w-[300px] truncate"
                      title={deal.properties.dealname}
                    >
                      {deal.properties.dealname || "Untitled"}
                    </td>
                    <td className="py-1.5 px-2">
                      <StageBadge label={stageLabel} />
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-blue-400">
                      {fmtDollars(amount)}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                      {fmtDate(deal.properties.createdate)}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                      {fmtDate(deal.properties.closedate)}
                    </td>
                    <td className="py-1.5 px-1">
                      <a
                        href={`https://app.hubspot.com/contacts/deals/${deal.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={(e) => e.stopPropagation()}
                        title="Open in HubSpot"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    {search ? "No deals match your search" : "No deals found"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function StageBadge({ label }: { label: string }) {
  const lower = label.toLowerCase();
  let color = "bg-muted/40 text-muted-foreground";
  if (lower.includes("won")) color = "bg-emerald-500/15 text-emerald-400";
  else if (lower.includes("lost")) color = "bg-red-500/15 text-red-400";
  else if (lower.includes("pov") || lower.includes("poc"))
    color = "bg-purple-500/15 text-purple-400";
  else if (lower.includes("contract") || lower.includes("negotiation"))
    color = "bg-yellow-500/15 text-yellow-400";

  return (
    <span className={cn("inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium", color)}>
      {label}
    </span>
  );
}

function SortIcon({
  col,
  sortCol,
  sortDir,
}: {
  col: string;
  sortCol: string;
  sortDir: "asc" | "desc";
}) {
  if (sortCol !== col)
    return <ArrowUpDown className="h-3 w-3 text-muted-foreground/30" />;
  return sortDir === "asc" ? (
    <ArrowUp className="h-3 w-3 text-foreground" />
  ) : (
    <ArrowDown className="h-3 w-3 text-foreground" />
  );
}
