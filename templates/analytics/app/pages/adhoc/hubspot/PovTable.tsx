import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink } from "lucide-react";
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

interface PovTableProps {
  deals: HubSpotDeal[];
  stageLabels: Record<string, string>;
  isLoading: boolean;
  onDealClick?: (deal: HubSpotDeal) => void;
}

export function PovTable({
  deals,
  stageLabels,
  isLoading,
  onDealClick,
}: PovTableProps) {
  const povDeals = useMemo(() => {
    return deals
      .filter((d) => {
        const label = (stageLabels[d.properties.dealstage] ?? "").toLowerCase();
        return (
          label.includes("pov") ||
          label.includes("poc") ||
          label.includes("proof")
        );
      })
      .sort((a, b) => {
        const aAmt = parseFloat(a.properties.amount ?? "0") || 0;
        const bAmt = parseFloat(b.properties.amount ?? "0") || 0;
        return bAmt - aAmt;
      });
  }, [deals, stageLabels]);

  const totalValue = useMemo(
    () =>
      povDeals.reduce(
        (sum, d) => sum + (parseFloat(d.properties.amount ?? "0") || 0),
        0,
      ),
    [povDeals],
  );

  if (isLoading) {
    return (
      <Card className="bg-card border-border/50">
        <CardContent className="py-6">
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border/50 border-t-2 border-t-purple-500">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">
            POV Deals ({povDeals.length})
          </CardTitle>
          <span className="text-xs text-purple-400 font-medium tabular-nums">
            Total: {fmtDollars(totalValue)}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {povDeals.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            No deals currently in POV stage
          </p>
        ) : (
          <div className="overflow-auto max-h-[500px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border">
                  <th className="py-2 px-2 text-left font-medium text-muted-foreground">
                    Deal Name
                  </th>
                  <th className="py-2 px-2 text-left font-medium text-muted-foreground">
                    Stage
                  </th>
                  <th className="py-2 px-2 text-right font-medium text-muted-foreground">
                    Amount
                  </th>
                  <th className="py-2 px-2 text-right font-medium text-muted-foreground">
                    Close Date
                  </th>
                  <th className="py-2 px-2 text-right font-medium text-muted-foreground">
                    Created
                  </th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {povDeals.map((deal) => {
                  const amount = parseFloat(deal.properties.amount ?? "0") || 0;
                  const stageLabel =
                    stageLabels[deal.properties.dealstage] ??
                    deal.properties.dealstage;

                  return (
                    <tr
                      key={deal.id}
                      className="border-b border-border/30 hover:bg-muted/30 cursor-pointer"
                      onClick={() => onDealClick?.(deal)}
                    >
                      <td
                        className="py-1.5 px-2 font-medium max-w-[300px] truncate"
                        title={deal.properties.dealname}
                      >
                        {deal.properties.dealname || "Untitled"}
                      </td>
                      <td className="py-1.5 px-2">
                        <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-purple-500/15 text-purple-400 whitespace-nowrap">
                          {stageLabel}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-blue-400">
                        {fmtDollars(amount)}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                        {fmtDate(deal.properties.closedate)}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                        {fmtDate(deal.properties.createdate)}
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
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
