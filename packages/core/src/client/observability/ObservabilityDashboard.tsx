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
import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useState } from "react";

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
  useOutputReviews,
  useSaveInstructionUpdate,
  useSubmitFeedback,
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

// ─── Tab: Human review ─────────────────────────────────────────────────

function ReviewTab({ days }: { days: number }) {
  const t = useT();
  const { data: reviews, isLoading } = useOutputReviews(days);
  const feedbackMutation = useSubmitFeedback();
  const instructionMutation = useSaveInstructionUpdate();
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [instruction, setInstruction] = useState("");
  const [instructionSaved, setInstructionSaved] = useState(false);
  const [target, setTarget] = useState<"agent" | "developer" | "skill">(
    "agent",
  );
  const selected = reviews?.find((review) => review.runId === selectedRunId);

  useEffect(() => {
    if (
      selectedRunId &&
      reviews &&
      !reviews.some((review) => review.runId === selectedRunId)
    ) {
      setSelectedRunId(null);
    }
  }, [reviews, selectedRunId]);

  if (isLoading) return <LoadingState />;
  if (!reviews || reviews.length === 0) {
    return <EmptyState message={t("observability.noReviews")} />;
  }

  const openReview = (runId: string) => {
    setSelectedRunId((current) => (current === runId ? null : runId));
    setFeedbackNote("");
    setInstruction("");
    setInstructionSaved(false);
    setTarget("agent");
  };

  const saveFeedback = (feedbackType: "thumbs_up" | "thumbs_down") => {
    if (!selected) return;
    feedbackMutation.mutate(
      {
        runId: selected.runId,
        threadId: selected.threadId ?? undefined,
        feedbackType,
      },
      {
        onSuccess: () =>
          void queryClient.invalidateQueries({
            queryKey: ["action", "list-observability-reviews"],
          }),
      },
    );
  };

  const saveNote = () => {
    if (!selected || !feedbackNote.trim()) return;
    feedbackMutation.mutate(
      {
        runId: selected.runId,
        threadId: selected.threadId ?? undefined,
        feedbackType: "text",
        value: feedbackNote.trim(),
      },
      {
        onSuccess: () => {
          setFeedbackNote("");
          void queryClient.invalidateQueries({
            queryKey: ["action", "list-observability-reviews"],
          });
        },
      },
    );
  };

  const saveInstruction = () => {
    if (!selected || !instruction.trim()) return;
    instructionMutation.mutate(
      {
        runId: selected.runId,
        threadId: selected.threadId,
        target,
        instruction: instruction.trim(),
        feedback: feedbackNote.trim() || undefined,
      },
      {
        onSuccess: () => {
          setFeedbackNote("");
          setInstruction("");
          setInstructionSaved(true);
          setTarget("agent");
          void queryClient.invalidateQueries({
            queryKey: ["action", "list-observability-reviews"],
          });
        },
      },
    );
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        {t("observability.reviewDescription")}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[760px] table-fixed text-left text-xs">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th className="w-[28%] px-3 py-2 font-medium">
                {t("observability.ask")}
              </th>
              <th className="w-[40%] px-3 py-2 font-medium">
                {t("observability.answer")}
              </th>
              <th className="w-[16%] px-3 py-2 font-medium">
                {t("observability.reviewFeedback")}
              </th>
              <th className="w-[16%] px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {reviews.map((review) => {
              const isSelected = review.runId === selectedRunId;
              const latestFeedback = review.feedback[0];
              return (
                <Fragment key={review.runId}>
                  <tr className="border-t border-border align-top">
                    <td className="px-3 py-3 text-foreground">
                      <div className="line-clamp-3 break-words">
                        {review.ask || "-"}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-foreground">
                      <div className="line-clamp-3 break-words">
                        {review.answer || "-"}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {latestFeedback
                        ? latestFeedback.feedbackType === "text"
                          ? t("observability.noteSaved")
                          : latestFeedback.feedbackType === "thumbs_up"
                            ? t("observability.looksGood")
                            : t("observability.needsChange")
                        : t("observability.notReviewed")}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openReview(review.runId)}
                        className="rounded-md border border-border px-2.5 py-1.5 font-medium text-foreground hover:bg-muted"
                      >
                        {isSelected
                          ? t("observability.closeReview")
                          : t("observability.reviewOutput")}
                      </button>
                    </td>
                  </tr>
                  {isSelected && selected && (
                    <tr className="border-t border-border">
                      <td colSpan={4} className="bg-muted/10 p-4">
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div className="space-y-3">
                            <div>
                              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                {t("observability.ask")}
                              </div>
                              <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                                {selected.ask || "-"}
                              </p>
                            </div>
                            <div>
                              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                {t("observability.answer")}
                              </div>
                              <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm text-foreground">
                                {selected.answer || "-"}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => saveFeedback("thumbs_up")}
                                className="rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted"
                              >
                                {t("observability.looksGood")}
                              </button>
                              <button
                                type="button"
                                onClick={() => saveFeedback("thumbs_down")}
                                className="rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted"
                              >
                                {t("observability.needsChange")}
                              </button>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <label className="block">
                              <span className="mb-1 block text-xs font-medium text-foreground">
                                {t("observability.feedbackNote")}
                              </span>
                              <textarea
                                value={feedbackNote}
                                onChange={(event) =>
                                  setFeedbackNote(event.target.value)
                                }
                                rows={3}
                                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                                placeholder={t(
                                  "observability.feedbackPlaceholder",
                                )}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={saveNote}
                              disabled={
                                !feedbackNote.trim() ||
                                feedbackMutation.isPending
                              }
                              className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                            >
                              {t("observability.saveFeedback")}
                            </button>
                            <div className="border-t border-border pt-3">
                              <div className="mb-1 text-xs font-medium text-foreground">
                                {t("observability.updateInstructions")}
                              </div>
                              <p className="mb-2 text-[11px] text-muted-foreground">
                                {t("observability.draftNotice")}
                              </p>
                              <div className="flex gap-2">
                                <select
                                  value={target}
                                  onChange={(event) =>
                                    setTarget(
                                      event.target.value as typeof target,
                                    )
                                  }
                                  className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                                  aria-label={t(
                                    "observability.instructionTarget",
                                  )}
                                >
                                  <option value="agent">
                                    {t("observability.agentTarget")}
                                  </option>
                                  <option value="developer">
                                    {t("observability.developerTarget")}
                                  </option>
                                  <option value="skill">
                                    {t("observability.skillTarget")}
                                  </option>
                                </select>
                              </div>
                              <textarea
                                value={instruction}
                                onChange={(event) => {
                                  setInstruction(event.target.value);
                                  setInstructionSaved(false);
                                }}
                                rows={4}
                                className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                                placeholder={t(
                                  "observability.instructionPlaceholder",
                                )}
                              />
                              <button
                                type="button"
                                onClick={saveInstruction}
                                disabled={
                                  !instruction.trim() ||
                                  instructionMutation.isPending
                                }
                                className="mt-2 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                              >
                                {instructionSaved
                                  ? t("observability.draftSaved")
                                  : t("observability.saveUpdate")}
                              </button>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
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
  {
    id: "review",
    labelKey: "observability.review",
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
      {activeTab === "review" && <ReviewTab days={days} />}
    </div>
  );
}
