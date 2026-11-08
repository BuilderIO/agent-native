import type {
  BlockEditProps,
  BlockReadProps,
  BlockRenderContext,
  BlockSpec,
} from "@agent-native/core/blocks/server";
import { trackEvent } from "@agent-native/core/client/analytics";
import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useLocale, useT } from "@agent-native/core/client/i18n";
import {
  analyticsChartBlockConfig,
  describeAnalyticsChart,
  type AnalyticsChartData,
} from "@shared/analytics-chart-block";
import { IconChartLine, IconRefresh } from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SourceEmbedFrame } from "@/components/ui/source-embed-frame";

import {
  analyticsChartSvg,
  ANALYTICS_CHART_HEIGHT,
  svgImageSource,
} from "./analytics-chart-svg";

type ContentBlockRenderContext = BlockRenderContext & {
  documentId?: string | null;
  canEdit?: boolean;
};

type CaptureResult =
  | { status: "captured"; chart: AnalyticsChartData }
  | { status: "needs_confirmation"; chart: AnalyticsChartData };

const STATUS_STALE_MS = 5 * 60_000;

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const next = Math.round(entry.contentRect.width);
        // Redraw on real resizes only, not subpixel jitter.
        if (next > 0)
          setWidth((last) => (Math.abs(last - next) > 8 ? next : last));
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function formatCell(
  value: AnalyticsChartData["rows"][number][number],
  locale: string,
) {
  if (value === null) return "";
  if (typeof value === "number") return value.toLocaleString(locale);
  return String(value);
}

function ChartBody({ data }: { data: AnalyticsChartData }) {
  const { resolvedTheme } = useTheme();
  const { locale } = useLocale();
  const [ref, width] = useWidth();
  const label = describeAnalyticsChart(data);
  const theme = resolvedTheme === "dark" ? "dark" : "light";
  const svg = useMemo(
    () => analyticsChartSvg(data, { width, theme }),
    [data, width, theme],
  );

  if (data.panel.type === "metric") {
    return (
      <div ref={ref} aria-label={label} role="group" className="py-2">
        <div className="text-3xl font-semibold tabular-nums text-foreground">
          {data.display?.value ?? formatCell(data.rows[0]?.[0] ?? null, locale)}
        </div>
        {data.display?.comparison ? (
          <div className="mt-1 text-sm text-muted-foreground">
            {data.display.comparison}
          </div>
        ) : null}
      </div>
    );
  }

  if (data.panel.type === "table") {
    return (
      <div ref={ref} className="max-h-96 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr>
              {data.columns.map((column, index) => (
                <th
                  key={`${index}:${column}`}
                  scope="col"
                  className="sticky top-0 border-b border-border bg-card px-2 py-1.5 text-start font-medium text-muted-foreground"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-border/60">
                {data.columns.map((column, index) => (
                  <td
                    key={`${index}:${column}`}
                    className={
                      typeof row[index] === "number"
                        ? "px-2 py-1 text-end tabular-nums"
                        : "px-2 py-1"
                    }
                  >
                    {formatCell(row[index] ?? null, locale)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div ref={ref} className="min-h-70">
      {svg ? (
        <img
          src={svgImageSource(svg)}
          alt={label}
          width={Math.max(280, width)}
          height={ANALYTICS_CHART_HEIGHT}
          className="block h-auto w-full"
          draggable={false}
        />
      ) : null}
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
  return <AnalyticsChartView data={data} />;
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

function AnalyticsChartEdit({
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
