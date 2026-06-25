import {
  IconActivity,
  IconMessages,
  IconThumbUp,
  IconThumbDown,
  IconClock,
  IconCoin,
  IconTool,
  IconMoodSmile,
  IconChartBar,
  IconAB2,
  IconMessageReport,
  IconChevronRight,
  IconArrowLeft,
  IconLoader2,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { useState } from "react";

import { useT } from "../i18n.js";
import { cn } from "../utils.js";
import {
  useObservabilityOverview,
  useTraces,
  useTraceDetail,
  useFeedbackList,
  useFeedbackStats,
  useSatisfaction,
  useEvalStats,
  useExperiments,
  useExperimentDetail,
  useExperimentResults,
  type TraceSummary,
  type Experiment,
} from "./useObservability.js";

// ─── Helpers ────────────────────────────────────────────────────────────

function formatCost(centsX100: number): string {
  const cents = centsX100 / 100;
  if (cents < 1) return `${cents.toFixed(3)}¢`;
  if (cents < 100) return `${cents.toFixed(2)}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}

function formatCostCents(cents: number): string {
  if (cents < 1) return `${cents.toFixed(3)}¢`;
  if (cents < 100) return `${cents.toFixed(2)}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function truncateId(id: string, len = 8): string {
  return id.length > len ? id.slice(0, len) + "…" : id;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const RANGES = [
  { value: 7, label: "7d" },
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
] as const;

// ─── Shared components ──────────────────────────────────────────────────

function RangeSelector({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex gap-1 rounded-md border border-border p-0.5">
      {RANGES.map((r) => (
        <button
          key={r.value}
          onClick={() => onChange(r.value)}
          className={cn(
            "px-2.5 py-1 text-xs rounded",
            value === r.value
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <div className="text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: "draft" | "running" | "paused" | "completed" | "success" | "error";
}) {
  const styles: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    running: "bg-blue-500/15 text-blue-500",
    paused: "bg-yellow-500/15 text-yellow-500",
    completed: "bg-green-500/15 text-green-500",
    success: "bg-green-500/15 text-green-500",
    error: "bg-red-500/15 text-red-500",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
        styles[status] ?? styles.draft,
      )}
    >
      {status}
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <IconLoader2 size={20} className="animate-spin text-muted-foreground" />
    </div>
  );
}

// ─── Tab: Overview ──────────────────────────────────────────────────────

function OverviewTab({ days }: { days: number }) {
  const t = useT();
  const { data, isLoading } = useObservabilityOverview(days);

  if (isLoading) return <LoadingState />;
  if (!data) return <EmptyState message={t("observability.noData")} />;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <MetricCard
        label={t("observability.totalRuns")}
        value={String(data.totalRuns)}
        icon={<IconActivity size={16} />}
      />
      <MetricCard
        label={t("observability.totalCost")}
        value={formatCostCents(data.totalCostCents)}
        icon={<IconCoin size={16} />}
      />
      <MetricCard
        label={t("observability.avgLatency")}
        value={formatDuration(data.avgDurationMs)}
        icon={<IconClock size={16} />}
      />
      <MetricCard
        label={t("observability.toolSuccess")}
        value={formatPercent(data.toolSuccessRate)}
        icon={<IconTool size={16} />}
      />
      <MetricCard
        label={t("observability.thumbsUp")}
        value={formatPercent(data.thumbsUpRate)}
        icon={<IconThumbUp size={16} />}
      />
      <MetricCard
        label={t("observability.avgEvalScore")}
        value={data.avgEvalScore.toFixed(2)}
        icon={<IconMoodSmile size={16} />}
      />
    </div>
  );
}

// ─── Tab: Conversations ─────────────────────────────────────────────────

function ConversationsTab({ days }: { days: number }) {
  const t = useT();
  const { data: traces, isLoading } = useTraces(days);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  if (selectedRunId) {
    return (
      <TraceDetailView
        runId={selectedRunId}
        onBack={() => setSelectedRunId(null)}
      />
    );
  }

  if (isLoading) return <LoadingState />;
  if (!traces || traces.length === 0)
    return <EmptyState message={t("observability.noConversations")} />;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full table-fixed text-left text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="px-3 py-2 font-medium text-muted-foreground w-[15%]">
              {t("observability.run")}
            </th>
            <th className="px-3 py-2 font-medium text-muted-foreground w-[20%]">
              {t("observability.model")}
            </th>
            <th className="px-3 py-2 font-medium text-muted-foreground">
              {t("observability.duration")}
            </th>
            <th className="px-3 py-2 font-medium text-muted-foreground">
              {t("observability.cost")}
            </th>
            <th className="px-3 py-2 font-medium text-muted-foreground">
              {t("observability.tools")}
            </th>
            <th className="px-3 py-2 font-medium text-muted-foreground">
              {t("observability.time")}
            </th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {traces.map((trace: TraceSummary) => (
            <tr
              key={trace.runId}
              onClick={() => setSelectedRunId(trace.runId)}
              className="border-b border-border last:border-b-0 cursor-pointer hover:bg-accent/30"
            >
              <td className="px-3 py-2 font-mono text-foreground truncate">
                {truncateId(trace.runId)}
              </td>
              <td className="px-3 py-2 text-muted-foreground truncate">
                {trace.model || "unknown"}
              </td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground">
                {formatDuration(trace.totalDurationMs)}
              </td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground">
                {formatCost(trace.totalCostCentsX100)}
              </td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground">
                {trace.toolCalls}
                {trace.failedTools > 0 && (
                  <span className="ml-1 text-red-500">
                    {t("observability.failedCount", {
                      count: trace.failedTools,
                    })}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-muted-foreground truncate">
                {timeAgo(trace.createdAt)}
              </td>
              <td className="px-3 py-2">
                <IconChevronRight size={14} className="text-muted-foreground" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TraceDetailView({
  runId,
  onBack,
}: {
  runId: string;
  onBack: () => void;
}) {
  const t = useT();
  const { data, isLoading } = useTraceDetail(runId);

  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3"
      >
        <IconArrowLeft size={14} />
        {t("observability.backToList")}
      </button>

      {isLoading && <LoadingState />}

      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border p-3">
              <div className="text-[10px] text-muted-foreground mb-1">
                {t("observability.model")}
              </div>
              <div className="text-sm font-medium text-foreground truncate">
                {data.summary.model || "unknown"}
              </div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-[10px] text-muted-foreground mb-1">
                {t("observability.duration")}
              </div>
              <div className="text-sm font-medium tabular-nums text-foreground">
                {formatDuration(data.summary.totalDurationMs)}
              </div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-[10px] text-muted-foreground mb-1">
                {t("observability.cost")}
              </div>
              <div className="text-sm font-medium tabular-nums text-foreground">
                {formatCost(data.summary.totalCostCentsX100)}
              </div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-[10px] text-muted-foreground mb-1">
                {t("observability.spans")}
              </div>
              <div className="text-sm font-medium tabular-nums text-foreground">
                {data.summary.totalSpans}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full table-fixed text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-3 py-2 font-medium text-muted-foreground w-[15%]">
                    {t("observability.type")}
                  </th>
                  <th className="px-3 py-2 font-medium text-muted-foreground w-[35%]">
                    {t("observability.name")}
                  </th>
                  <th className="px-3 py-2 font-medium text-muted-foreground">
                    {t("observability.duration")}
                  </th>
                  <th className="px-3 py-2 font-medium text-muted-foreground">
                    {t("observability.tokens")}
                  </th>
                  <th className="px-3 py-2 font-medium text-muted-foreground">
                    {t("observability.status")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.spans.map((span) => (
                  <tr
                    key={span.id}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="px-3 py-2 truncate">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {span.spanType.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium text-foreground truncate">
                      {span.name}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {formatDuration(span.durationMs)}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {span.inputTokens + span.outputTokens > 0
                        ? `${span.inputTokens} / ${span.outputTokens}`
                        : "-"}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={span.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Evals ─────────────────────────────────────────────────────────

function EvalsTab({ days }: { days: number }) {
  const t = useT();
  const { data, isLoading } = useEvalStats(days);

  if (isLoading) return <LoadingState />;
  if (!data || data.totalEvals === 0)
    return <EmptyState message={t("observability.noEvals")} />;

  const maxCount = Math.max(...data.byCriteria.map((c) => c.count), 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label={t("observability.totalEvals")}
          value={String(data.totalEvals)}
          icon={<IconChartBar size={16} />}
        />
        <MetricCard
          label={t("observability.avgScore")}
          value={data.avgScore.toFixed(2)}
          icon={<IconMoodSmile size={16} />}
        />
      </div>

      {data.byCriteria.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-foreground mb-2">
            {t("observability.scoresByCriteria")}
          </h3>
          <div className="space-y-2">
            {data.byCriteria.map((c) => (
              <div key={c.criteria}>
                <div className="flex items-center justify-between gap-2 text-xs mb-1 min-w-0">
                  <span className="text-foreground truncate min-w-0">
                    {c.criteria}
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {c.avgScore.toFixed(2)} avg ({c.count})
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-foreground/70 rounded-full"
                    style={{ width: `${(c.count / maxCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Experiments ───────────────────────────────────────────────────

function ExperimentsTab() {
  const t = useT();
  const { data: experiments, isLoading } = useExperiments();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (selectedId) {
    return (
      <ExperimentDetailView
        id={selectedId}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  if (isLoading) return <LoadingState />;
  if (!experiments || experiments.length === 0)
    return <EmptyState message={t("observability.noExperiments")} />;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full table-fixed text-left text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="px-3 py-2 font-medium text-muted-foreground w-[40%]">
              {t("observability.name")}
            </th>
            <th className="px-3 py-2 font-medium text-muted-foreground">
              {t("observability.status")}
            </th>
            <th className="px-3 py-2 font-medium text-muted-foreground">
              {t("observability.variants")}
            </th>
            <th className="px-3 py-2 font-medium text-muted-foreground">
              {t("observability.created")}
            </th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {experiments.map((exp: Experiment) => (
            <tr
              key={exp.id}
              onClick={() => setSelectedId(exp.id)}
              className="border-b border-border last:border-b-0 cursor-pointer hover:bg-accent/30"
            >
              <td className="px-3 py-2 font-medium text-foreground truncate">
                {exp.name}
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={exp.status} />
              </td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground">
                {exp.variants.length}
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {timeAgo(exp.createdAt)}
              </td>
              <td className="px-3 py-2">
                <IconChevronRight size={14} className="text-muted-foreground" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExperimentDetailView({
  id,
  onBack,
}: {
  id: string;
  onBack: () => void;
}) {
  const t = useT();
  const { data: exp, isLoading } = useExperimentDetail(id);
  const { data: results } = useExperimentResults(id);

  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3"
      >
        <IconArrowLeft size={14} />
        {t("observability.backToExperiments")}
      </button>

      {isLoading && <LoadingState />}

      {exp && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <h3 className="text-sm font-medium text-foreground truncate min-w-0">
              {exp.name}
            </h3>
            <StatusBadge status={exp.status} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-border p-3">
              <div className="text-[10px] text-muted-foreground mb-1">
                {t("observability.variants")}
              </div>
              <div className="text-sm font-medium tabular-nums text-foreground">
                {exp.variants.length}
              </div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-[10px] text-muted-foreground mb-1">
                {t("observability.metrics")}
              </div>
              <div className="text-sm font-medium tabular-nums text-foreground">
                {exp.metrics.length}
              </div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-[10px] text-muted-foreground mb-1">
                {t("observability.level")}
              </div>
              <div className="text-sm font-medium text-foreground capitalize">
                {exp.assignmentLevel}
              </div>
            </div>
          </div>

          {exp.variants.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-foreground mb-2">
                {t("observability.variants")}
              </h4>
              <div className="space-y-1">
                {exp.variants.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between rounded border border-border px-3 py-2 text-xs"
                  >
                    <span className="font-mono text-foreground">
                      {truncateId(v.id)}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      Weight: {v.weight}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {results && results.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-foreground mb-2">
                {t("observability.results")}
              </h4>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full table-fixed text-left text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-3 py-2 font-medium text-muted-foreground w-[20%]">
                        {t("observability.variant")}
                      </th>
                      <th className="px-3 py-2 font-medium text-muted-foreground w-[25%]">
                        {t("observability.metric")}
                      </th>
                      <th className="px-3 py-2 font-medium text-muted-foreground">
                        {t("observability.value")}
                      </th>
                      <th className="px-3 py-2 font-medium text-muted-foreground">
                        CI
                      </th>
                      <th className="px-3 py-2 font-medium text-muted-foreground">
                        N
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b border-border last:border-b-0"
                      >
                        <td className="px-3 py-2 font-mono text-foreground truncate">
                          {truncateId(r.variantId)}
                        </td>
                        <td className="px-3 py-2 text-foreground truncate">
                          {r.metric}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-foreground">
                          {r.value.toFixed(3)}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">
                          [{r.confidenceLow.toFixed(3)},{" "}
                          {r.confidenceHigh.toFixed(3)}]
                        </td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">
                          {r.sampleSize}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Feedback ──────────────────────────────────────────────────────

function FeedbackTab({ days }: { days: number }) {
  const t = useT();
  const { data: stats, isLoading: statsLoading } = useFeedbackStats(days);
  const { data: entries, isLoading: listLoading } = useFeedbackList(days);
  const { data: satisfaction } = useSatisfaction(days);

  const isLoading = statsLoading || listLoading;
  if (isLoading) return <LoadingState />;

  const thumbsTotal = (stats?.thumbsUp ?? 0) + (stats?.thumbsDown ?? 0);
  const thumbsUpRate = thumbsTotal > 0 ? stats!.thumbsUp / thumbsTotal : 0;
  const avgFrustration =
    satisfaction && satisfaction.length > 0
      ? satisfaction.reduce((sum, s) => sum + s.frustrationScore, 0) /
        satisfaction.length
      : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label={t("observability.totalFeedback")}
          value={String(stats?.total ?? 0)}
          icon={<IconMessageReport size={16} />}
        />
        <MetricCard
          label={t("observability.thumbsUp")}
          value={String(stats?.thumbsUp ?? 0)}
          icon={<IconThumbUp size={16} />}
        />
        <MetricCard
          label={t("observability.thumbsDown")}
          value={String(stats?.thumbsDown ?? 0)}
          icon={<IconThumbDown size={16} />}
        />
        <MetricCard
          label={t("observability.frustration")}
          value={avgFrustration.toFixed(2)}
          icon={<IconAlertTriangle size={16} />}
        />
      </div>

      {thumbsTotal > 0 && (
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground mb-2">
            {t("observability.thumbsUpRate")}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full"
                style={{ width: `${thumbsUpRate * 100}%` }}
              />
            </div>
            <span className="text-sm font-medium tabular-nums text-foreground">
              {formatPercent(thumbsUpRate)}
            </span>
          </div>
        </div>
      )}

      {stats?.categories && Object.keys(stats.categories).length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-foreground mb-2">
            {t("observability.categories")}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(stats.categories).map(([cat, count]) => (
              <span
                key={cat}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[10px] text-foreground max-w-[200px]"
              >
                <span className="truncate">{cat}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {count}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {entries && entries.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-foreground mb-2">
            Recent feedback
          </h3>
          <div className="space-y-1 max-h-64 overflow-y-auto overflow-x-hidden rounded-lg border border-border">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-2 px-3 py-2 text-xs border-b border-border last:border-b-0 min-w-0"
              >
                <span className="shrink-0">
                  {entry.feedbackType === "thumbs_up" && (
                    <IconThumbUp size={14} className="text-green-500" />
                  )}
                  {entry.feedbackType === "thumbs_down" && (
                    <IconThumbDown size={14} className="text-red-500" />
                  )}
                  {entry.feedbackType === "category" && (
                    <IconChartBar size={14} className="text-blue-500" />
                  )}
                  {entry.feedbackType === "text" && (
                    <IconMessages size={14} className="text-muted-foreground" />
                  )}
                </span>
                <span className="flex-1 min-w-0 truncate text-foreground">
                  {entry.feedbackType === "text" ||
                  entry.feedbackType === "category"
                    ? entry.value
                    : entry.feedbackType.replace("_", " ")}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {timeAgo(entry.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Dashboard ─────────────────────────────────────────────────────

const TABS = [
  { id: "overview", labelKey: "observability.overview", icon: IconActivity },
  {
    id: "conversations",
    labelKey: "observability.conversations",
    icon: IconMessages,
  },
  { id: "evals", labelKey: "observability.evals", icon: IconChartBar },
  {
    id: "experiments",
    labelKey: "observability.experiments",
    icon: IconAB2,
  },
  {
    id: "feedback",
    labelKey: "observability.feedback",
    icon: IconMessageReport,
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

export interface ObservabilityDashboardProps {
  className?: string;
}

export function ObservabilityDashboard({
  className,
}: ObservabilityDashboardProps) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [days, setDays] = useState(7);

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-1 rounded-lg border border-border p-1 bg-muted/30">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
                  activeTab === tab.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon size={14} />
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>
        {activeTab !== "experiments" && (
          <RangeSelector value={days} onChange={setDays} />
        )}
      </div>

      {activeTab === "overview" && <OverviewTab days={days} />}
      {activeTab === "conversations" && <ConversationsTab days={days} />}
      {activeTab === "evals" && <EvalsTab days={days} />}
      {activeTab === "experiments" && <ExperimentsTab />}
      {activeTab === "feedback" && <FeedbackTab days={days} />}
    </div>
  );
}
