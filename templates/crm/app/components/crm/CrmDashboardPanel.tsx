import { useActionQuery } from "@agent-native/core/client/hooks";
import {
  GenericChartPanel,
  MetricCard,
  type GenericChartConfig,
} from "@agent-native/toolkit/dashboard";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@agent-native/toolkit/ui/card";

import type { CrmDashboardPanelConfig } from "@/lib/types";

type PanelResult = {
  rows: Record<string, unknown>[];
  schema?: Array<{ name: string; type: string }>;
  truncated?: boolean;
};

export function CrmDashboardPanel({
  dashboardId,
  panel,
}: {
  dashboardId: string;
  panel: CrmDashboardPanelConfig;
}) {
  const query = useActionQuery<PanelResult>(
    "get-crm-dashboard-panel" as never,
    { dashboardId, panelId: panel.id } as never,
  );
  const error = query.error instanceof Error ? query.error.message : undefined;
  const rows = query.data?.rows ?? [];

  if (panel.chartType === "metric") {
    return (
      <MetricCard
        title={panel.title}
        value={metricValue(rows)}
        description={query.data?.truncated ? "Source is bounded" : undefined}
        loading={query.isLoading}
        error={error}
      />
    );
  }

  const chart: GenericChartConfig = {
    chartType: panel.chartType,
    xKey: "stage",
    yKeys: ["pipelineValue", "opportunities"],
    ...(panel.chartType === "table"
      ? { columns: ["stage", "pipelineValue", "opportunities"] }
      : {}),
  };
  return (
    <Card className="border-border/70 bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{panel.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <GenericChartPanel
          data={query.data?.rows}
          config={panel}
          chart={chart}
          loading={query.isLoading}
          error={error}
          emptyMessage="No opportunities are available in this pipeline yet."
        />
      </CardContent>
    </Card>
  );
}

function metricValue(rows: Record<string, unknown>[]) {
  return rows.reduce(
    (total, row) =>
      total + (typeof row.pipelineValue === "number" ? row.pipelineValue : 0),
    0,
  );
}
