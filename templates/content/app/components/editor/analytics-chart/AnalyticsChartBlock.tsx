import type {
  BlockEditProps,
  BlockReadProps,
  BlockRenderContext,
  BlockSpec,
} from "@agent-native/core/blocks/server";
import { trackEvent } from "@agent-native/core/client/analytics";
import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useLocale, useT } from "@agent-native/core/client/i18n";
import { analyticsCaptureRecords } from "@agent-native/core/shared";
import { DashboardPanelChart } from "@agent-native/toolkit/app/dashboard-charts/DashboardPanelChart";
import {
  analyticsChartBlockConfig,
  analyticsChartPanel,
  describeAnalyticsChart,
  readAnalyticsChartData,
  type AnalyticsChartData,
} from "@shared/analytics-chart-block";
import { IconChartLine, IconRefresh } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SourceEmbedFrame } from "@/components/ui/source-embed-frame";

type ContentBlockRenderContext = BlockRenderContext & {
  documentId?: string | null;
  canEdit?: boolean;
};

type CaptureResult =
  | { status: "captured"; chart: AnalyticsChartData }
  | { status: "needs_confirmation"; chart: AnalyticsChartData };

const STATUS_STALE_MS = 5 * 60_000;

/** The kept rows, drawn by the chart Analytics draws the panel with. */
function ChartBody({ data }: { data: AnalyticsChartData }) {
  const panel = useMemo(() => analyticsChartPanel(data), [data]);
  const rows = useMemo(() => analyticsCaptureRecords(data), [data]);
  return (
    <div role="figure" aria-label={describeAnalyticsChart(data)}>
      <DashboardPanelChart
        panel={panel}
        rows={rows}
        timeRange={data.timeRange}
        asOf={data.capturedAt}
      />
    </div>
  );
}

/**
 * A tag the capture contract doesn't accept, such as one written by hand,
 * is never drawn: its settings could break the chart or carry other CSS.
 */
function UnreadableChart() {
  const t = useT();
  return (
    <div
      data-analytics-chart=""
      className="rounded-md border border-border p-4 text-sm text-muted-foreground"
    >
      {t("analyticsChart.unreadable")}
    </div>
  );
}

function AnalyticsChartView({
  data,
  actions,
  notice,
}: {
  data: AnalyticsChartData;
  actions?: React.ReactNode;
  notice?: React.ReactNode;
}) {
  const t = useT();
  const { locale } = useLocale();
  const copiedOn = useMemo(() => {
    const date = new Date(data.capturedAt);
    return Number.isNaN(date.getTime())
      ? null
      : date.toLocaleDateString(locale, {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
  }, [data.capturedAt, locale]);
  const meta = [
    t("analyticsChart.dashboard", { dashboard: data.dashboard.title }),
    data.filterSummary,
    copiedOn ? t("analyticsChart.copiedOn", { date: copiedOn }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const truncated = data.truncated ? t("analyticsChart.truncated") : null;
  return (
    <SourceEmbedFrame
      data-analytics-chart=""
      title={data.panel.title}
      meta={meta}
      href={data.panel.url}
      openLabel={t("analyticsChart.openInAnalytics")}
      onOpen={() =>
        trackEvent("analytics_chart_opened", {
          panel_type: data.panel.type,
        })
      }
      actions={actions}
      notice={
        notice || truncated ? (
          <>
            {notice}
            {notice && truncated ? " " : null}
            {truncated}
          </>
        ) : undefined
      }
    >
      <ChartBody data={data} />
    </SourceEmbedFrame>
  );
}

function AnalyticsChartRead({ data }: BlockReadProps<AnalyticsChartData>) {
  const chart = useMemo(() => readAnalyticsChartData(data), [data]);
  return chart ? <AnalyticsChartView data={chart} /> : <UnreadableChart />;
}

/**
 * Whether the panel changed in Analytics since this copy, or is gone from
 * its dashboard, for an editor.
 */
function usePanelStatus(
  documentId: string | null | undefined,
  data: AnalyticsChartData,
): "changed" | "gone" | null {
  const query = useActionQuery(
    "get-analytics-chart-status",
    {
      documentId: documentId ?? "",
      dashboards: [
        { dashboardId: data.dashboard.id, panelIds: [data.panel.id] },
      ],
    },
    {
      // The action answers POST only, which keeps its list of dashboards in the body.
      method: "POST",
      enabled: Boolean(documentId && data.dashboard.id && data.panel.id),
      retry: false,
      staleTime: STATUS_STALE_MS,
      refetchOnWindowFocus: false,
    },
  );
  const entry = query.data?.dashboards.find(
    (candidate) => candidate.dashboardId === data.dashboard.id,
  );
  if (!entry || !("status" in entry)) return null;
  const panel = entry.status.panels.find(
    (candidate) => candidate.id === data.panel.id,
  );
  if (!panel) return null;
  if (panel.fingerprint === null) return "gone";
  return panel.fingerprint !== data.panel.fingerprint ? "changed" : null;
}

function AnalyticsChartEdit(props: BlockEditProps<AnalyticsChartData>) {
  const chart = useMemo(() => readAnalyticsChartData(props.data), [props.data]);
  return chart ? (
    <AnalyticsChartEditor {...props} data={chart} />
  ) : (
    <UnreadableChart />
  );
}

function AnalyticsChartEditor({
  data,
  onChange,
  blockId,
  ctx,
}: BlockEditProps<AnalyticsChartData>) {
  const t = useT();
  const { documentId } = ctx as ContentBlockRenderContext;
  const [refreshing, setRefreshing] = useState(false);
  const status = usePanelStatus(documentId, data);

  const refresh = async (acknowledgeWiderAudience = false) => {
    if (!documentId || refreshing) return;
    setRefreshing(true);
    try {
      const result = (await callAction("capture-analytics-chart", {
        documentId,
        dashboardId: data.dashboard.id,
        panelId: data.panel.id,
        filters: data.filters,
        purpose: "refresh",
        blockId,
        ...(acknowledgeWiderAudience ? { acknowledgeWiderAudience } : {}),
      })) as CaptureResult;
      if (result.status === "needs_confirmation") {
        toast.warning(
          t("analyticsChart.confirmWider", {
            dashboard: result.chart.dashboard.title,
          }),
          {
            action: {
              label: t("analyticsChart.refresh"),
              onClick: () => void refresh(true),
            },
          },
        );
        return;
      }
      onChange(result.chart);
      toast.success(t("analyticsChart.refreshed"));
    } catch (error) {
      toast.error(t("analyticsChart.refreshFailed"), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <AnalyticsChartView
      data={data}
      notice={
        status === "gone"
          ? t("analyticsChart.panelGone")
          : status === "changed"
            ? t("analyticsChart.changedRefresh")
            : null
      }
      actions={
        // A panel gone from its dashboard has nothing to refresh from.
        documentId && status !== "gone" ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <IconRefresh
              className={refreshing ? "animate-spin" : undefined}
              aria-hidden
            />
            {refreshing
              ? t("analyticsChart.refreshing")
              : t("analyticsChart.refresh")}
          </Button>
        ) : null
      }
    />
  );
}

export const analyticsChartBlock: BlockSpec<AnalyticsChartData> = {
  ...analyticsChartBlockConfig,
  Read: AnalyticsChartRead,
  Edit: AnalyticsChartEdit,
  editSurface: "inline",
  icon: IconChartLine,
};
