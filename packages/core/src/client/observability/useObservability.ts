import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentNativePath } from "../api-path.js";

const BASE = agentNativePath("/_agent-native/observability");

function fetchJson<T>(url: string): Promise<T> {
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<T>;
  });
}

// ─── Overview ──────────────────────────────────────────────────────────

export interface ObservabilityOverview {
  totalRuns: number;
  totalCostCents: number;
  avgDurationMs: number;
  toolSuccessRate: number;
  avgFrustrationScore: number;
  thumbsUpRate: number;
  avgEvalScore: number;
}

export function useObservabilityOverview(sinceDays = 7) {
  const sinceMs = Date.now() - sinceDays * 86_400_000;
  return useQuery({
    queryKey: ["observability", "overview", sinceDays],
    queryFn: () => fetchJson<ObservabilityOverview>(`${BASE}?since=${sinceMs}`),
    refetchInterval: 30_000,
  });
}

// ─── Traces ────────────────────────────────────────────────────────────

export interface TraceSummary {
  runId: string;
  threadId: string | null;
  totalSpans: number;
  llmCalls: number;
  toolCalls: number;
  successfulTools: number;
  failedTools: number;
  totalDurationMs: number;
  totalCostCentsX100: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  model: string;
  createdAt: number;
}

export function useTraces(sinceDays = 7, limit = 100) {
  const sinceMs = Date.now() - sinceDays * 86_400_000;
  return useQuery({
    queryKey: ["observability", "traces", sinceDays, limit],
    queryFn: () =>
      fetchJson<TraceSummary[]>(
        `${BASE}/traces?since=${sinceMs}&limit=${limit}`,
      ),
    refetchInterval: 30_000,
  });
}

export interface TraceSpan {
  id: string;
  runId: string;
  threadId: string | null;
  parentSpanId: string | null;
  spanType: "llm_call" | "tool_call" | "agent_run";
  name: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costCentsX100: number;
  durationMs: number;
  status: "success" | "error";
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

export interface TraceDetail {
  summary: TraceSummary;
  spans: TraceSpan[];
}

export function useTraceDetail(runId: string | null) {
  return useQuery({
    queryKey: ["observability", "trace", runId],
    queryFn: () =>
      fetchJson<TraceDetail>(`${BASE}/traces/${encodeURIComponent(runId!)}`),
    enabled: !!runId,
  });
}

// ─── Feedback ──────────────────────────────────────────────────────────

export interface FeedbackEntry {
  id: string;
  runId: string | null;
  threadId: string | null;
  messageSeq: number | null;
  feedbackType: "thumbs_up" | "thumbs_down" | "category" | "text";
  value: string;
  userId: string | null;
  createdAt: number;
}

export function useFeedbackList(sinceDays = 7, limit = 100) {
  const sinceMs = Date.now() - sinceDays * 86_400_000;
  return useQuery({
    queryKey: ["observability", "feedback", sinceDays, limit],
    queryFn: () =>
      fetchJson<FeedbackEntry[]>(
        `${BASE}/feedback?since=${sinceMs}&limit=${limit}`,
      ),
    refetchInterval: 30_000,
  });
}

export interface FeedbackStats {
  total: number;
  thumbsUp: number;
  thumbsDown: number;
  categories: Record<string, number>;
}

export function useFeedbackStats(sinceDays = 7) {
  const sinceMs = Date.now() - sinceDays * 86_400_000;
  return useQuery({
    queryKey: ["observability", "feedback-stats", sinceDays],
    queryFn: () =>
      fetchJson<FeedbackStats>(`${BASE}/feedback/stats?since=${sinceMs}`),
    refetchInterval: 30_000,
  });
}

export function useSubmitFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      threadId?: string;
      runId?: string;
      messageSeq?: number;
      feedbackType: string;
      value?: string;
      userId?: string;
    }) => {
      const res = await fetch(`${BASE}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{ id: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["observability", "feedback"],
      });
      queryClient.invalidateQueries({
        queryKey: ["observability", "feedback-stats"],
      });
    },
  });
}

// ─── Satisfaction ──────────────────────────────────────────────────────

export interface SatisfactionScore {
  id: string;
  threadId: string;
  frustrationScore: number;
  rephrasingScore: number;
  abandonmentScore: number;
  sentimentScore: number;
  lengthTrendScore: number;
  computedAt: number;
}

export function useSatisfaction(sinceDays = 7) {
  const sinceMs = Date.now() - sinceDays * 86_400_000;
  return useQuery({
    queryKey: ["observability", "satisfaction", sinceDays],
    queryFn: () =>
      fetchJson<SatisfactionScore[]>(`${BASE}/satisfaction?since=${sinceMs}`),
    refetchInterval: 30_000,
  });
}

// ─── Evals ─────────────────────────────────────────────────────────────

export interface EvalStats {
  totalEvals: number;
  avgScore: number;
  byCriteria: Array<{ criteria: string; avgScore: number; count: number }>;
}

export function useEvalStats(sinceDays = 7) {
  const sinceMs = Date.now() - sinceDays * 86_400_000;
  return useQuery({
    queryKey: ["observability", "eval-stats", sinceDays],
    queryFn: () => fetchJson<EvalStats>(`${BASE}/evals/stats?since=${sinceMs}`),
    refetchInterval: 30_000,
  });
}

// ─── Experiments ───────────────────────────────────────────────────────

export interface Experiment {
  id: string;
  name: string;
  status: "draft" | "running" | "paused" | "completed";
  variants: Array<{
    id: string;
    weight: number;
    config: Record<string, unknown>;
  }>;
  metrics: string[];
  assignmentLevel: "user" | "session";
  startedAt: number | null;
  endedAt: number | null;
  createdAt: number;
}

export function useExperiments() {
  return useQuery({
    queryKey: ["observability", "experiments"],
    queryFn: () => fetchJson<Experiment[]>(`${BASE}/experiments`),
    refetchInterval: 30_000,
  });
}

export function useExperimentDetail(id: string | null) {
  return useQuery({
    queryKey: ["observability", "experiment", id],
    queryFn: () =>
      fetchJson<Experiment>(`${BASE}/experiments/${encodeURIComponent(id!)}`),
    enabled: !!id,
  });
}

export interface ExperimentMetricResult {
  id: string;
  experimentId: string;
  variantId: string;
  metric: string;
  value: number;
  sampleSize: number;
  confidenceLow: number;
  confidenceHigh: number;
  computedAt: number;
}

export function useExperimentResults(id: string | null) {
  return useQuery({
    queryKey: ["observability", "experiment-results", id],
    queryFn: () =>
      fetchJson<ExperimentMetricResult[]>(
        `${BASE}/experiments/${encodeURIComponent(id!)}/results`,
      ),
    enabled: !!id,
  });
}
