import { useState } from "react";
import {
  useHubspotDeals,
  useHubspotPipelines,
  useHubspotMetrics,
  type HubSpotDeal,
} from "@/lib/api-hooks";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { MetricsSummary } from "./MetricsSummary";
import { KanbanBoard } from "./KanbanBoard";
import { DealTable } from "./DealTable";
import { PovTable } from "./PovTable";

export default function HubSpotDashboard() {
  const dealsQuery = useHubspotDeals();
  const pipelinesQuery = useHubspotPipelines();
  const metricsQuery = useHubspotMetrics();
  const [selectedDeal, setSelectedDeal] = useState<HubSpotDeal | null>(null);

  const deals = dealsQuery.data?.deals ?? [];
  const stageLabels = dealsQuery.data?.stageLabels ?? {};
  const pipelines = pipelinesQuery.data?.pipelines ?? [];
  const error = (dealsQuery.error ??
    pipelinesQuery.error ??
    metricsQuery.error) as Error | null;

  return (
    <div className="space-y-4">
      {/* Error notice */}
      {error && (
        <Card className="bg-amber-950/20 border-amber-500/30">
          <CardContent className="py-3 px-4 flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="text-xs space-y-1">
              <p className="font-medium text-amber-400">HubSpot API error</p>
              <p className="text-muted-foreground">{error.message}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Key metrics */}
      <MetricsSummary
        metrics={metricsQuery.data}
        isLoading={metricsQuery.isLoading}
      />

      {/* Pipeline Kanban */}
      <KanbanBoard
        deals={deals}
        pipelines={pipelines}
        isLoading={dealsQuery.isLoading || pipelinesQuery.isLoading}
        onDealClick={setSelectedDeal}
      />

      {/* POV Deals */}
      <PovTable
        deals={deals}
        stageLabels={stageLabels}
        isLoading={dealsQuery.isLoading}
        onDealClick={setSelectedDeal}
      />

      {/* Deal lookup table */}
      <DealTable
        deals={deals}
        stageLabels={stageLabels}
        isLoading={dealsQuery.isLoading}
        selectedDeal={selectedDeal}
        onSelectDeal={setSelectedDeal}
      />
    </div>
  );
}
