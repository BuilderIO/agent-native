import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";

import { InsightsChart } from "@/components/player/insights-chart";
import {
  ViewerAvatar,
  viewerLabel,
} from "@/components/player/recording-views-badge";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

export interface InsightsPanelProps {
  recordingId: string;
  durationMs: number;
}

interface Insights {
  views: number;
  uniqueViewers: number;
  reactions?: number;
  completionRate: number;
  ctaConversionRate: number;
  topViewers: {
    viewerEmail: string | null;
    viewerName: string | null;
    totalWatchMs: number;
    completedPct: number;
  }[];
}

export function InsightsPanel({ recordingId }: InsightsPanelProps) {
  const t = useT();
  const q = useActionQuery<Insights>("get-recording-insights", { recordingId });
  const vq = useActionQuery<{ viewers: Insights["topViewers"] }>(
    "list-viewers",
    { recordingId, limit: 12 },
  );

  if (q.isLoading) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {t("recordingInsights.loading")}
      </div>
    );
  }
  const data = q.data;
  const viewers = vq.data?.viewers ?? [];

  if (!data) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {t("recordingInsights.noData")}
      </div>
    );
  }

  return (
    <div className="grid gap-6 p-4">
      <InsightsChart
        views={data.views}
        uniqueViewers={data.uniqueViewers}
        reactions={data.reactions ?? 0}
        completionRate={data.completionRate}
        ctaConversionRate={data.ctaConversionRate}
      />

      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          {t("recordingInsights.recentViewers")}
        </div>
        {viewers.length === 0 ? (
          <Empty className="flex-none gap-2 border px-4 py-5 md:p-5">
            <EmptyHeader>
              <EmptyTitle className="text-sm font-normal text-muted-foreground">
                {t("recordingInsights.noViewers")}
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-wrap gap-2">
            {viewers.slice(0, 12).map((v, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-full border border-border bg-card pe-3 ps-0.5 py-0.5"
                title={v.viewerEmail ?? t("recordingInsights.anonymous")}
              >
                <ViewerAvatar viewer={v} />
                <span className="text-xs">
                  {viewerLabel(v, t("recordingInsights.anonymous"))}
                  <span className="text-muted-foreground ms-1">
                    {Math.round(v.completedPct)}%
                  </span>
                </span>
              </div>
            ))}
            {viewers.length > 12 ? (
              <span className="text-xs text-muted-foreground self-center">
                {t("recordingInsights.moreViewers", {
                  count: viewers.length - 12,
                })}
              </span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
