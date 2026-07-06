import { useActionQuery, useT } from "@agent-native/core/client";
import { Avatar, AvatarFallback } from "@agent-native/toolkit/ui/avatar";
import {
  IconEye,
  IconUser,
  IconPercentage,
  IconTarget,
} from "@tabler/icons-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  CartesianGrid,
} from "recharts";

export interface InsightsPanelProps {
  recordingId: string;
  durationMs: number;
}

interface Insights {
  views: number;
  uniqueViewers: number;
  completionRate: number;
  dropOff: { bucket: number; watching: number }[];
  ctaConversionRate: number;
  topViewers: {
    viewerEmail: string | null;
    viewerName: string | null;
    totalWatchMs: number;
    completedPct: number;
  }[];
}

export function InsightsPanel({ recordingId, durationMs }: InsightsPanelProps) {
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
    <div className="p-4 space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <Stat
          icon={<IconEye className="h-4 w-4" />}
          label={t("recordingInsights.views")}
          value={data.views}
        />
        <Stat
          icon={<IconUser className="h-4 w-4" />}
          label={t("recordingInsights.uniqueViewers")}
          value={data.uniqueViewers}
        />
        <Stat
          icon={<IconPercentage className="h-4 w-4" />}
          label={t("recordingInsights.completion")}
          value={`${Math.round(data.completionRate)}%`}
        />
        <Stat
          icon={<IconTarget className="h-4 w-4" />}
          label={t("recordingInsights.ctaConversion")}
          value={`${Math.round(data.ctaConversionRate)}%`}
        />
      </div>

      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          {t("recordingInsights.dropOff")}
        </div>
        <div className="h-40 rounded-lg border border-border bg-card p-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.dropOff}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="bucket"
                tickFormatter={(b) => {
                  const pct = (b as number) / 100;
                  const ms = pct * durationMs;
                  return msCompact(ms);
                }}
                stroke="#6b7280"
                fontSize={10}
              />
              <YAxis stroke="#6b7280" fontSize={10} />
              <ReTooltip
                formatter={(v) => [
                  t("recordingInsights.viewersCount", { count: Number(v) }),
                  t("recordingInsights.watching"),
                ]}
                labelFormatter={(b) =>
                  msCompact(((b as number) / 100) * durationMs)
                }
              />
              <Line
                type="monotone"
                dataKey="watching"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          {t("recordingInsights.recentViewers")}
        </div>
        {viewers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("recordingInsights.noViewers")}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {viewers.slice(0, 12).map((v, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-full border border-border bg-card pr-3 pl-0.5 py-0.5"
                title={v.viewerEmail ?? t("recordingInsights.anonymous")}
              >
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-[10px] bg-primary text-primary-foreground">
                    {initials(v.viewerName || v.viewerEmail || "?")}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs">
                  {v.viewerName ||
                    (v.viewerEmail
                      ? v.viewerEmail.split("@")[0]
                      : t("recordingInsights.anon"))}
                  <span className="text-muted-foreground ml-1">
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

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-semibold mt-1 text-foreground tabular-nums">
        {value}
      </div>
    </div>
  );
}

function initials(s: string): string {
  return s
    .split(/\s+|@/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function msCompact(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
