import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
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
  IconMessageCircle,
  IconPencil,
  IconChevronRight,
  IconArrowsMaximize,
  IconExternalLink,
  IconArrowLeft,
  IconLoader2,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { Link, useInRouterContext, useLocation } from "react-router";

import {
  AGENT_SIDEBAR_QUERY_PARAM,
  AGENT_SIDEBAR_QUERY_VALUE_OPEN,
} from "../../shared/agent-sidebar-url.js";
import { docsUrl } from "../../shared/docs-url.js";
import { requestAgentChatThreadOpen } from "../agent-chat.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import { useT } from "../i18n.js";
import { useOrg } from "../org/hooks.js";
import { cn } from "../utils.js";
import { ObservabilityReviewSummaryButton } from "./ObservabilityReviewSummaryButton.js";
import { OutputPreview } from "./OutputPreview.js";
import {
  useObservabilityOverview,
  useTraces,
  useTraceDetail,
  useFeedbackList,
  useFeedbackStats,
  useEvalStats,
  useExperiments,
  useExperimentDetail,
  useExperimentResults,
  useOutputReviews,
  useOutputReviewDetail,
  useSaveInstructionUpdate,
  useSaveReviewFeedback,
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

function reviewThreadHref(threadId: string): string {
  const isBrowser = typeof window !== "undefined";
  const url = new URL(
    isBrowser ? window.location.href : "/",
    "http://agent-native.invalid",
  );
  url.searchParams.delete("threadId");
  url.searchParams.set("thread", threadId);
  url.searchParams.set(
    AGENT_SIDEBAR_QUERY_PARAM,
    AGENT_SIDEBAR_QUERY_VALUE_OPEN,
  );
  return isBrowser ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
}

const REVIEW_ARTIFACT_APPS = {
  design: { host: "design.agent-native.com", port: 8099 },
  slides: { host: "slides.agent-native.com", port: 8086 },
  analytics: { host: "analytics.agent-native.com", port: 8088 },
} as const;

function reviewArtifactPath(
  appId: keyof typeof REVIEW_ARTIFACT_APPS,
  artifactId: string,
  path: string | undefined,
): string | undefined {
  if (!path) return undefined;
  const valid = {
    design:
      path === `/design/${artifactId}` || path === `/present/${artifactId}`,
    slides:
      path === `/deck/${artifactId}` || path === `/deck/${artifactId}/present`,
    analytics: ["dashboards", "analyses", "adhoc"].some(
      (route) => path === `/${route}/${artifactId}`,
    ),
  }[appId];
  return valid ? path : undefined;
}

export function resolveReviewArtifactHref(
  appId: keyof typeof REVIEW_ARTIFACT_APPS,
  artifactId: string,
  path: string | undefined,
  hostname = typeof window === "undefined"
    ? undefined
    : window.location.hostname,
): string | undefined {
  const safePath = reviewArtifactPath(appId, artifactId, path);
  if (!safePath || !hostname) return undefined;

  const currentHost = hostname.toLowerCase();
  if (currentHost === "localhost" || currentHost === "127.0.0.1") {
    return `http://${currentHost}:${REVIEW_ARTIFACT_APPS[appId].port}${safePath}`;
  }

  const isBeta = currentHost.startsWith("beta.");
  const normalizedHost = isBeta
    ? currentHost.slice("beta.".length)
    : currentHost;
  if (
    !Object.values(REVIEW_ARTIFACT_APPS).some(
      (app) => app.host === normalizedHost,
    )
  ) {
    return undefined;
  }

  return `https://${isBeta ? "beta." : ""}${REVIEW_ARTIFACT_APPS[appId].host}${safePath}`;
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
  const [expandedSpanId, setExpandedSpanId] = useState<string | null>(null);

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
          <div className="flex items-center justify-end">
            {data.summary.threadId && (
              <button
                type="button"
                onClick={() =>
                  requestAgentChatThreadOpen({
                    threadId: data.summary.threadId!,
                  })
                }
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <IconMessages size={14} />
                {t("observability.openFullConversation")}
              </button>
            )}
          </div>

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
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {data.spans.map((span) => {
                  const expanded = expandedSpanId === span.id;
                  const metadata = span.metadata ?? {};
                  const fields: Array<{ label: string; value: unknown }> = [];
                  if (Object.hasOwn(metadata, "input")) {
                    fields.push({
                      label: t("observability.input"),
                      value: metadata.input,
                    });
                  } else if (span.spanType === "tool_call") {
                    fields.push({
                      label: t("observability.input"),
                      value: t("observability.notCaptured"),
                    });
                  }
                  if (Object.hasOwn(metadata, "output")) {
                    fields.push({
                      label: t("observability.output"),
                      value: metadata.output,
                    });
                  } else if (span.spanType === "tool_call") {
                    fields.push({
                      label: t("observability.output"),
                      value: t("observability.notCaptured"),
                    });
                  }
                  if (span.errorMessage || span.status === "error") {
                    fields.push({
                      label: t("observability.error"),
                      value:
                        span.errorMessage ?? t("observability.notCaptured"),
                    });
                  }
                  const otherMetadata = Object.fromEntries(
                    Object.entries(metadata).filter(
                      ([key]) => key !== "input" && key !== "output",
                    ),
                  );
                  if (Object.keys(otherMetadata).length > 0) {
                    fields.push({
                      label: t("observability.metadata"),
                      value: otherMetadata,
                    });
                  }
                  if (fields.length === 0) {
                    fields.push({
                      label: t("observability.metadata"),
                      value: t("observability.notCaptured"),
                    });
                  }

                  return (
                    <Fragment key={span.id}>
                      <tr className="border-b border-border last:border-b-0">
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
                        <td className="px-2 py-2 text-right">
                          <button
                            type="button"
                            aria-label={t(
                              expanded
                                ? "observability.hideDetails"
                                : "observability.viewDetails",
                            )}
                            aria-expanded={expanded}
                            aria-controls={
                              expanded ? `span-details-${span.id}` : undefined
                            }
                            onClick={() =>
                              setExpandedSpanId(expanded ? null : span.id)
                            }
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <IconChevronRight
                              size={14}
                              className={cn(
                                "transition-transform",
                                expanded && "rotate-90",
                              )}
                            />
                          </button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr id={`span-details-${span.id}`}>
                          <td
                            colSpan={6}
                            className="border-b border-border p-3"
                          >
                            <div className="grid gap-3 sm:grid-cols-2">
                              {fields.map(({ label, value }) => (
                                <div key={label} className="min-w-0">
                                  <div className="mb-1 text-[10px] font-medium text-muted-foreground">
                                    {label}
                                  </div>
                                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 font-mono text-xs text-foreground">
                                    {typeof value === "string"
                                      ? value || '""'
                                      : (JSON.stringify(value, null, 2) ??
                                        String(value))}
                                  </pre>
                                </div>
                              ))}
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
  const {
    data: activeOrg,
    isLoading: orgLoading,
    isError: orgError,
  } = useOrg();
  const { data: reviews, isLoading } = useOutputReviews(
    days,
    100,
    activeOrg?.orgId ?? undefined,
  );
  const feedbackMutation = useSaveReviewFeedback();
  const instructionMutation = useSaveInstructionUpdate();
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [openPopover, setOpenPopover] = useState<{
    runId: string;
    kind: "feedback" | "instruction";
  } | null>(null);
  const [feedbackNote, setFeedbackNote] = useState<{
    runId: string;
    value: string;
  } | null>(null);
  const [instructionDraft, setInstructionDraft] = useState<{
    runId: string;
    value: string;
    target: "agent" | "developer" | "skill";
  } | null>(null);
  const visibleReviews = reviews?.filter(
    (review) =>
      Boolean(review.threadId?.trim()) &&
      Boolean(review.summary || review.threadTitle.trim()),
  );
  const selectedReview = visibleReviews?.find(
    (review) => review.runId === selectedRunId,
  );
  const reviewDetailQuery = useOutputReviewDetail(
    selectedReview?.runId ?? null,
  );

  if (orgLoading || isLoading) return <LoadingState />;
  if (
    orgError ||
    !activeOrg?.orgId ||
    !visibleReviews ||
    visibleReviews.length === 0
  ) {
    return <EmptyState message={t("observability.noReviews")} />;
  }

  const saveFeedback = (
    runId: string,
    feedbackType: "thumbs_up" | "thumbs_down",
  ) => {
    feedbackMutation.mutate(
      {
        runId,
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

  const saveNote = (runId: string) => {
    const note = feedbackNote?.runId === runId ? feedbackNote.value.trim() : "";
    if (!note) return;
    feedbackMutation.mutate(
      {
        runId,
        feedbackType: "text",
        value: note,
      },
      {
        onSuccess: () => {
          setFeedbackNote((current) =>
            current?.runId === runId && current.value.trim() === note
              ? null
              : current,
          );
          setOpenPopover((current) =>
            current?.runId === runId && current.kind === "feedback"
              ? null
              : current,
          );
          void queryClient.invalidateQueries({
            queryKey: ["action", "list-observability-reviews"],
          });
        },
      },
    );
  };

  const saveInstruction = (runId: string, threadId: string | null) => {
    const draft =
      instructionDraft?.runId === runId ? instructionDraft : undefined;
    if (!draft) return;
    const savedInstruction = draft.value.trim();
    if (!savedInstruction) return;
    instructionMutation.mutate(
      {
        runId,
        threadId,
        target: draft.target,
        instruction: savedInstruction,
      },
      {
        onSuccess: () => {
          setInstructionDraft((current) =>
            current?.runId === runId &&
            current.value.trim() === savedInstruction &&
            current.target === draft.target
              ? null
              : current,
          );
          setOpenPopover((current) =>
            current?.runId === runId && current.kind === "instruction"
              ? null
              : current,
          );
          void queryClient.invalidateQueries({
            queryKey: ["action", "list-observability-reviews"],
          });
        },
      },
    );
  };

  const selectedVote = selectedReview?.feedback.find(
    (entry) =>
      entry.feedbackType === "thumbs_up" ||
      entry.feedbackType === "thumbs_down",
  );
  const selectedNote = selectedReview?.feedback.find(
    (entry) => entry.feedbackType === "text",
  );
  const feedbackOpen =
    selectedReview !== undefined &&
    openPopover?.runId === selectedReview.runId &&
    openPopover.kind === "feedback";
  const instructionOpen =
    selectedReview !== undefined &&
    openPopover?.runId === selectedReview.runId &&
    openPopover.kind === "instruction";
  const activeInstructionDraft =
    selectedReview && instructionDraft?.runId === selectedReview.runId
      ? instructionDraft
      : {
          runId: selectedReview?.runId ?? "",
          value: "",
          target: "agent" as const,
        };
  const reviewMessages = reviewDetailQuery.data?.messages.length
    ? reviewDetailQuery.data.messages
    : selectedReview
      ? [
          ...(selectedReview.ask
            ? [{ role: "user" as const, text: selectedReview.ask }]
            : []),
          ...(selectedReview.answer
            ? [{ role: "assistant" as const, text: selectedReview.answer }]
            : []),
        ]
      : [];

  return (
    <>
      <div className="divide-y divide-border">
        {visibleReviews.map((review) => {
          const expanded = selectedRunId === review.runId;
          const answer = review.answer.trim();
          const hasPreview =
            (answer !== "" && !/^[-–—]+$/.test(answer)) ||
            Boolean(review.inlineAppTitle) ||
            Boolean(
              review.summary?.artifacts.some(
                (artifact) => artifact.appId === "design" && artifact.path,
              ),
            );
          const triggerId = `review-trigger-${encodeURIComponent(review.runId)}`;
          const detailId = `review-details-${encodeURIComponent(review.runId)}`;

          return (
            <div key={review.runId} className="min-w-0">
              <button
                id={triggerId}
                type="button"
                data-review-run-id={review.runId}
                aria-expanded={expanded}
                aria-controls={detailId}
                onClick={() => {
                  setSelectedRunId((current) =>
                    current === review.runId ? null : review.runId,
                  );
                  setOpenPopover(null);
                  setPreviewExpanded(false);
                }}
                className="group flex w-full min-w-0 items-center gap-3 py-3 text-left first:pt-0 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {hasPreview && (
                  <span className="h-16 w-24 shrink-0 overflow-hidden rounded-md bg-muted/60 sm:h-20 sm:w-28">
                    <OutputPreview
                      answer={review.answer}
                      designPreviewPath={
                        review.summary?.artifacts.find(
                          (artifact) => artifact.appId === "design",
                        )?.path
                      }
                      inlineAppTitle={review.inlineAppTitle}
                      previewLabel={t("observability.reviewPreview")}
                      compact
                    />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 break-words text-sm font-medium text-foreground">
                    {review.summary?.ask || review.threadTitle}
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {review.model} · {timeAgo(review.createdAt)}
                  </span>
                </span>
                <IconChevronRight
                  size={16}
                  className={cn(
                    "shrink-0 text-muted-foreground transition-transform",
                    expanded ? "rotate-90" : "group-hover:translate-x-0.5",
                  )}
                />
              </button>

              <div
                id={detailId}
                role="region"
                aria-labelledby={triggerId}
                data-review-detail-for={review.runId}
                hidden={!expanded}
              >
                {expanded && selectedReview && (
                  <div className="grid min-w-0 gap-0 border-t border-border lg:grid-cols-2">
                    <section
                      data-review-preview
                      className="min-w-0 p-3 sm:p-4"
                      aria-label={t("observability.reviewPreview")}
                    >
                      {selectedReview.summary && (
                        <div
                          data-review-summary
                          className="mb-3 space-y-2 text-sm"
                        >
                          <p className="whitespace-pre-wrap break-words text-foreground">
                            <span className="mr-1 font-medium">
                              {t("observability.ask")}:
                            </span>
                            {selectedReview.summary.ask}
                          </p>
                          <p className="whitespace-pre-wrap break-words text-muted-foreground">
                            <span className="mr-1 font-medium text-foreground">
                              {t("observability.answer")}:
                            </span>
                            {selectedReview.summary.outcome}
                          </p>
                          {selectedReview.summary.artifacts.length > 0 && (
                            <div className="flex flex-wrap gap-x-3 gap-y-1">
                              {selectedReview.summary.artifacts.map(
                                (artifact) => {
                                  const href = resolveReviewArtifactHref(
                                    artifact.appId,
                                    artifact.artifactId,
                                    artifact.path,
                                  );
                                  return (
                                    <span
                                      key={`${artifact.appId}-${artifact.artifactId}`}
                                      className="text-xs text-muted-foreground"
                                    >
                                      {href ? (
                                        <a
                                          href={href}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-primary underline-offset-2 hover:underline"
                                        >
                                          {artifact.title}
                                        </a>
                                      ) : (
                                        artifact.title
                                      )}
                                      <span className="ml-1">
                                        {artifact.appId}
                                      </span>
                                    </span>
                                  );
                                },
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="relative max-h-[min(38rem,65dvh)] min-h-64 overflow-auto rounded-md border border-border bg-background">
                        <OutputPreview
                          answer={selectedReview.answer}
                          designPreviewPath={
                            selectedReview.summary?.artifacts.find(
                              (artifact) => artifact.appId === "design",
                            )?.path
                          }
                          inlineApp={reviewDetailQuery.data?.app ?? undefined}
                          maxAppHeight={420}
                          previewLabel={t("observability.reviewPreview")}
                        />
                        <button
                          type="button"
                          data-review-lightbox-trigger
                          aria-label={t("observability.reviewPreview")}
                          title={t("observability.reviewPreview")}
                          onClick={() => setPreviewExpanded(true)}
                          className="absolute right-2 top-2 rounded-md border border-border bg-background/95 p-2 text-muted-foreground shadow-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <IconArrowsMaximize size={16} />
                        </button>
                      </div>
                      {selectedNote?.value && (
                        <p className="mt-3 flex items-start gap-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                          <IconMessageCircle
                            size={14}
                            className="mt-0.5 shrink-0"
                          />
                          {selectedNote.value}
                        </p>
                      )}
                    </section>

                    <section
                      data-review-transcript
                      className="flex min-w-0 flex-col border-t border-border lg:border-l lg:border-t-0"
                    >
                      <div className="flex max-h-[min(38rem,65dvh)] min-h-64 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3 sm:p-4">
                        {reviewDetailQuery.isLoading ? (
                          <div
                            role="status"
                            aria-label={t("agentChat.common.loading")}
                            className="space-y-4"
                          >
                            <Skeleton className="ml-auto h-14 w-3/4 rounded-xl" />
                            <Skeleton className="h-20 w-5/6 rounded-xl" />
                            <Skeleton className="ml-auto h-12 w-2/3 rounded-xl" />
                          </div>
                        ) : reviewDetailQuery.isError ? (
                          <p
                            role="alert"
                            className="text-sm text-muted-foreground"
                          >
                            {t("agentChat.common.chunkLoadFailed")}
                          </p>
                        ) : (
                          reviewMessages.map((message, index) => (
                            <div
                              key={`${message.role}-${index}`}
                              className={cn(
                                "max-w-[92%] whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-sm",
                                message.role === "user"
                                  ? "ml-auto bg-primary/10 text-foreground"
                                  : "mr-auto bg-muted text-foreground",
                              )}
                            >
                              {message.role === "assistant" && (
                                <span className="mb-1 block text-[10px] font-medium text-muted-foreground">
                                  {t("agentChat.common.agent")}
                                </span>
                              )}
                              {message.text}
                            </div>
                          ))
                        )}
                      </div>
                      {selectedReview.threadId && (
                        <a
                          href={reviewThreadHref(selectedReview.threadId)}
                          target="_blank"
                          rel="noreferrer"
                          className="flex w-fit items-center gap-1.5 px-3 pb-3 text-xs text-muted-foreground hover:text-foreground sm:px-4"
                        >
                          {t("agentTask.openThread")}
                          <IconExternalLink size={14} />
                        </a>
                      )}
                    </section>

                    <div className="col-span-full flex shrink-0 items-center gap-1 border-t border-border px-3 py-2 sm:px-4">
                      {!selectedReview.summary && (
                        <ObservabilityReviewSummaryButton
                          runId={selectedReview.runId}
                        />
                      )}
                      <div
                        role="group"
                        aria-label={t("observability.reviewFeedback")}
                        className="flex items-center gap-1"
                      >
                        <button
                          type="button"
                          aria-label={t("observability.thumbsUp")}
                          aria-pressed={
                            selectedVote?.feedbackType === "thumbs_up"
                          }
                          title={t("observability.thumbsUp")}
                          disabled={feedbackMutation.isPending}
                          onClick={() =>
                            saveFeedback(selectedReview.runId, "thumbs_up")
                          }
                          className={cn(
                            "rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50",
                            selectedVote?.feedbackType === "thumbs_up" &&
                              "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                          )}
                        >
                          <IconThumbUp size={16} />
                        </button>
                        <button
                          type="button"
                          aria-label={t("observability.thumbsDown")}
                          aria-pressed={
                            selectedVote?.feedbackType === "thumbs_down"
                          }
                          title={t("observability.thumbsDown")}
                          disabled={feedbackMutation.isPending}
                          onClick={() =>
                            saveFeedback(selectedReview.runId, "thumbs_down")
                          }
                          className={cn(
                            "rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50",
                            selectedVote?.feedbackType === "thumbs_down" &&
                              "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                          )}
                        >
                          <IconThumbDown size={16} />
                        </button>
                      </div>
                      <Popover
                        open={feedbackOpen}
                        onOpenChange={(open) => {
                          if (open) {
                            setFeedbackNote((current) =>
                              current?.runId === selectedReview.runId
                                ? current
                                : { runId: selectedReview.runId, value: "" },
                            );
                          }
                          setOpenPopover((current) => {
                            if (open) {
                              return {
                                runId: selectedReview.runId,
                                kind: "feedback",
                              };
                            }
                            return current?.runId === selectedReview.runId &&
                              current.kind === "feedback"
                              ? null
                              : current;
                          });
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            aria-label={t("observability.addFeedback")}
                            title={t("observability.addFeedback")}
                            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <IconMessageCircle size={16} />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          sideOffset={8}
                          className="w-[min(22rem,calc(100vw-2rem))] p-3"
                        >
                          <label className="block">
                            <span className="sr-only">
                              {t("observability.feedbackNote")}
                            </span>
                            <textarea
                              value={
                                feedbackNote?.runId === selectedReview.runId
                                  ? feedbackNote.value
                                  : ""
                              }
                              onChange={(event) =>
                                setFeedbackNote({
                                  runId: selectedReview.runId,
                                  value: event.target.value,
                                })
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
                            onClick={() => saveNote(selectedReview.runId)}
                            disabled={
                              !(feedbackNote?.runId === selectedReview.runId
                                ? feedbackNote.value.trim()
                                : "") || feedbackMutation.isPending
                            }
                            className="mt-2 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                          >
                            {t("observability.saveFeedback")}
                          </button>
                        </PopoverContent>
                      </Popover>
                      <Popover
                        open={instructionOpen}
                        onOpenChange={(open) => {
                          if (open) {
                            setInstructionDraft((current) =>
                              current?.runId === selectedReview.runId
                                ? current
                                : {
                                    runId: selectedReview.runId,
                                    value: "",
                                    target: "agent",
                                  },
                            );
                          }
                          setOpenPopover((current) => {
                            if (open) {
                              return {
                                runId: selectedReview.runId,
                                kind: "instruction",
                              };
                            }
                            return current?.runId === selectedReview.runId &&
                              current.kind === "instruction"
                              ? null
                              : current;
                          });
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            aria-label={t("observability.draftInstruction")}
                            title={t("observability.draftInstruction")}
                            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <IconPencil size={16} />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          sideOffset={8}
                          className="w-[min(26rem,calc(100vw-2rem))] p-3"
                        >
                          <div className="mb-2 text-xs font-medium text-foreground">
                            {t("observability.updateInstructions")}
                          </div>
                          <p className="mb-2 text-[11px] text-muted-foreground">
                            {t("observability.draftNotice")}
                          </p>
                          <select
                            value={activeInstructionDraft.target}
                            onChange={(event) =>
                              setInstructionDraft({
                                ...activeInstructionDraft,
                                target: event.target
                                  .value as typeof activeInstructionDraft.target,
                              })
                            }
                            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                            aria-label={t("observability.instructionTarget")}
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
                          <textarea
                            value={activeInstructionDraft.value}
                            onChange={(event) =>
                              setInstructionDraft({
                                ...activeInstructionDraft,
                                value: event.target.value,
                              })
                            }
                            rows={4}
                            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                            placeholder={t(
                              "observability.instructionPlaceholder",
                            )}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              saveInstruction(
                                selectedReview.runId,
                                selectedReview.threadId,
                              )
                            }
                            disabled={
                              !activeInstructionDraft.value.trim() ||
                              instructionMutation.isPending
                            }
                            className="mt-2 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                          >
                            {t("observability.saveUpdate")}
                          </button>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog
        open={Boolean(selectedReview && previewExpanded)}
        onOpenChange={setPreviewExpanded}
      >
        {selectedReview && (
          <DialogContent
            aria-describedby={undefined}
            data-review-lightbox
            className="flex max-h-[min(90dvh,900px)] w-[calc(100vw-2rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0"
          >
            <DialogHeader className="shrink-0 border-b border-border px-4 py-3">
              <DialogTitle className="line-clamp-2 break-words text-left">
                {selectedReview.ask || t("observability.reviewPreview")}
              </DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-4">
              <OutputPreview
                answer={selectedReview.answer}
                designPreviewPath={
                  selectedReview.summary?.artifacts.find(
                    (artifact) => artifact.appId === "design",
                  )?.path
                }
                inlineApp={reviewDetailQuery.data?.app ?? undefined}
                maxAppHeight={720}
                previewLabel={t("observability.reviewPreview")}
              />
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

// ─── Tab: Feedback ──────────────────────────────────────────────────────

function FeedbackTab({ days }: { days: number }) {
  const t = useT();
  const {
    data: activeOrg,
    isLoading: orgLoading,
    isError: orgError,
  } = useOrg();
  const { data: stats, isLoading: statsLoading } = useFeedbackStats(
    days,
    activeOrg?.orgId,
  );
  const { data: entries, isLoading: listLoading } = useFeedbackList(
    days,
    100,
    undefined,
    activeOrg?.orgId,
  );
  if (orgError) {
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        {t("agentChat.common.chunkLoadFailed")}
      </p>
    );
  }
  const isLoading = orgLoading || statsLoading || listLoading;
  if (isLoading) return <LoadingState />;

  const thumbsTotal = (stats?.thumbsUp ?? 0) + (stats?.thumbsDown ?? 0);
  const thumbsUpRate = thumbsTotal > 0 ? stats!.thumbsUp / thumbsTotal : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
  {
    id: "overview",
    routeSegment: "overview",
    labelKey: "observability.overview",
    icon: IconActivity,
  },
  {
    id: "review",
    routeSegment: "human-review",
    labelKey: "observability.review",
    icon: IconMessageReport,
  },
  {
    id: "conversations",
    routeSegment: "conversations",
    labelKey: "observability.conversations",
    icon: IconMessages,
  },
  {
    id: "evals",
    routeSegment: "evals",
    labelKey: "observability.evals",
    icon: IconChartBar,
  },
  {
    id: "experiments",
    routeSegment: "experiments",
    labelKey: "observability.experiments",
    icon: IconAB2,
  },
  {
    id: "feedback",
    routeSegment: "feedback",
    labelKey: "observability.feedback",
    icon: IconMessageReport,
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

export interface ObservabilityDashboardProps {
  className?: string;
  routeBasePath?: string;
  showHumanReview?: boolean;
}

type ObservabilityDashboardContentProps = ObservabilityDashboardProps & {
  routePathname?: string;
};

function RoutedObservabilityDashboard(props: ObservabilityDashboardProps) {
  const location = useLocation();
  return (
    <ObservabilityDashboardContent
      {...props}
      routePathname={location.pathname}
    />
  );
}

export function ObservabilityDashboard(props: ObservabilityDashboardProps) {
  const inRouterContext = useInRouterContext();
  return inRouterContext && props.routeBasePath ? (
    <RoutedObservabilityDashboard {...props} />
  ) : (
    <ObservabilityDashboardContent {...props} routeBasePath={undefined} />
  );
}

function ObservabilityDashboardContent({
  className,
  routeBasePath,
  routePathname,
  showHumanReview = false,
}: ObservabilityDashboardContentProps) {
  const t = useT();
  const [localTab, setLocalTab] = useState<TabId>("overview");
  const [days, setDays] = useState(7);
  const visibleTabs = showHumanReview
    ? TABS
    : TABS.filter((tab) => tab.id !== "review");
  const routeSegment =
    routeBasePath && routePathname?.startsWith(`${routeBasePath}/`)
      ? routePathname.slice(routeBasePath.length + 1).split("/")[0]
      : undefined;
  const activeTab = routeBasePath
    ? (visibleTabs.find((tab) => tab.routeSegment === routeSegment)?.id ??
      "overview")
    : localTab;
  const docsHash: Record<TabId, string> = {
    overview: "dashboard",
    conversations: "conversations",
    evals: "evals",
    experiments: "experiments",
    feedback: "feedback",
    review: "review",
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <nav
          aria-label={t("routeTitles.agentObservability")}
          className="flex gap-1 rounded-lg border border-border p-1 bg-muted/30"
        >
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const tabClassName = cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
              activeTab === tab.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            );
            const tabContent = (
              <>
                <Icon size={14} />
                {t(tab.labelKey)}
              </>
            );
            if (routeBasePath && tab.routeSegment) {
              return (
                <Link
                  key={tab.id}
                  to={`${routeBasePath}/${tab.routeSegment}`}
                  aria-current={activeTab === tab.id ? "page" : undefined}
                  className={tabClassName}
                >
                  {tabContent}
                </Link>
              );
            }
            return (
              <button
                key={tab.id}
                aria-pressed={activeTab === tab.id}
                onClick={() => setLocalTab(tab.id)}
                className={tabClassName}
              >
                {tabContent}
              </button>
            );
          })}
        </nav>
        <div className="flex items-center gap-3">
          <a
            href={docsUrl("observability", { hash: docsHash[activeTab] })}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {t("observability.learnAboutTab")}
            <IconExternalLink size={13} />
          </a>
          {activeTab !== "experiments" && (
            <RangeSelector value={days} onChange={setDays} />
          )}
        </div>
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
