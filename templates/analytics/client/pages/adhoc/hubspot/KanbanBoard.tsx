import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { HubSpotDeal, HubSpotPipeline } from "@/lib/api-hooks";

function fmtDollars(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toLocaleString()}`;
}

interface KanbanColumn {
  stageId: string;
  label: string;
  deals: HubSpotDeal[];
  totalValue: number;
}

interface Props {
  deals: HubSpotDeal[];
  pipelines: HubSpotPipeline[];
  isLoading: boolean;
  onDealClick?: (deal: HubSpotDeal) => void;
}

export function KanbanBoard({ deals, pipelines, isLoading, onDealClick }: Props) {
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);

  // Default to "Enterprise: New Business" if available, otherwise first pipeline
  const activePipeline = useMemo(() => {
    if (!pipelines.length) return null;
    if (selectedPipelineId) return pipelines.find((p) => p.id === selectedPipelineId) ?? pipelines[0];
    const enterprise = pipelines.find((p) => p.label.includes("Enterprise") && p.label.includes("New"));
    return enterprise ?? pipelines[0];
  }, [pipelines, selectedPipelineId]);

  const columns = useMemo(() => {
    if (!activePipeline) return [];

    const stageOrder = activePipeline.stages
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder);

    const byStage = new Map<string, HubSpotDeal[]>();
    for (const deal of deals) {
      if (deal.properties.pipeline !== activePipeline.id) continue;
      const list = byStage.get(deal.properties.dealstage) ?? [];
      list.push(deal);
      byStage.set(deal.properties.dealstage, list);
    }

    return stageOrder.map<KanbanColumn>((stage) => {
      const stageDeals = byStage.get(stage.id) ?? [];
      const totalValue = stageDeals.reduce(
        (sum, d) => sum + (parseFloat(d.properties.amount ?? "0") || 0),
        0
      );
      return {
        stageId: stage.id,
        label: stage.label,
        deals: stageDeals.sort(
          (a, b) =>
            (parseFloat(b.properties.amount ?? "0") || 0) -
            (parseFloat(a.properties.amount ?? "0") || 0)
        ),
        totalValue,
      };
    });
  }, [deals, activePipeline]);

  if (isLoading) {
    return (
      <Card className="bg-card border-border/50">
        <CardContent className="py-6">
          <div className="flex gap-3 overflow-x-auto">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[300px] w-[220px] flex-shrink-0 rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Pipeline Board</CardTitle>
          {pipelines.length > 1 && (
            <div className="flex rounded-md overflow-hidden border border-border text-[10px]">
              {pipelines
                .filter((p) => p.stages.length > 1)
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPipelineId(p.id)}
                    className={cn(
                      "px-2 py-1 transition-colors whitespace-nowrap",
                      activePipeline?.id === p.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/30 hover:bg-muted/50 text-muted-foreground"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2.5 overflow-x-auto pb-2">
          {columns.map((col) => (
            <KanbanColumnCard
              key={col.stageId}
              column={col}
              onDealClick={onDealClick}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function getStageColor(label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes("closed won") || lower === "won") return "border-t-emerald-500";
  if (lower.includes("closed lost") || lower === "lost") return "border-t-red-500";
  if (lower.includes("stalled") || lower.includes("disqualified")) return "border-t-orange-500";
  if (lower.includes("pov") || lower.includes("poc") || lower.includes("proof")) return "border-t-purple-500";
  if (lower.includes("paper") || lower.includes("contract") || lower.includes("negotiat")) return "border-t-yellow-500";
  return "border-t-blue-500/50";
}

function KanbanColumnCard({
  column,
  onDealClick,
}: {
  column: KanbanColumn;
  onDealClick?: (deal: HubSpotDeal) => void;
}) {
  return (
    <div
      className={cn(
        "flex-shrink-0 w-[210px] rounded-lg border border-border/50 bg-muted/10 border-t-2",
        getStageColor(column.label)
      )}
    >
      <div className="px-2.5 py-2 border-b border-border/30">
        <p className="text-xs font-medium truncate" title={column.label}>
          {column.label}
        </p>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-[10px] text-muted-foreground">
            {column.deals.length} deal{column.deals.length !== 1 ? "s" : ""}
          </span>
          <span className="text-[10px] text-blue-400 font-medium tabular-nums">
            {fmtDollars(column.totalValue)}
          </span>
        </div>
      </div>

      <div className="p-1.5 space-y-1 max-h-[400px] overflow-y-auto">
        {column.deals.length === 0 && (
          <p className="text-[10px] text-muted-foreground/50 text-center py-4">
            No deals
          </p>
        )}
        {column.deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} onClick={onDealClick} />
        ))}
      </div>
    </div>
  );
}

function DealCard({
  deal,
  onClick,
}: {
  deal: HubSpotDeal;
  onClick?: (deal: HubSpotDeal) => void;
}) {
  const amount = parseFloat(deal.properties.amount ?? "0") || 0;
  const name = deal.properties.dealname || "Untitled Deal";

  return (
    <button
      onClick={() => onClick?.(deal)}
      className="w-full text-left rounded-md bg-card border border-border/30 p-2 hover:border-border transition-colors"
    >
      <p className="text-[11px] font-medium leading-tight truncate" title={name}>
        {name}
      </p>
      {amount > 0 && (
        <p className="text-[10px] text-blue-400 tabular-nums mt-0.5">
          {fmtDollars(amount)}
        </p>
      )}
    </button>
  );
}
