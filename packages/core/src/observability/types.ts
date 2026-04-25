/**
 * Shared types for the agent observability system.
 *
 * Covers traces, feedback, evals, experiments, and satisfaction scoring.
 * Each domain module imports from here so the data model is consistent
 * across the entire observability stack.
 */

// ─── Traces ───────────────────────────────────────────────────────────

export type SpanType = "llm_call" | "tool_call" | "agent_run";
export type SpanStatus = "success" | "error";

export interface TraceSpan {
  id: string;
  runId: string;
  threadId: string | null;
  /** Owner of the run that produced this span. Null for legacy rows
   *  written before per-user isolation; null also means "no auth context"
   *  (background tasks, etc.) and is filtered out of per-user reads. */
  userId: string | null;
  parentSpanId: string | null;
  spanType: SpanType;
  name: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costCentsX100: number;
  durationMs: number;
  status: SpanStatus;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

export interface TraceSummary {
  runId: string;
  threadId: string | null;
  /** See `TraceSpan.userId`. */
  userId: string | null;
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

// ─── Feedback ────────────���────────────────────────────────────────────

export type FeedbackType = "thumbs_up" | "thumbs_down" | "category" | "text";

export interface FeedbackEntry {
  id: string;
  runId: string | null;
  threadId: string | null;
  messageSeq: number | null;
  feedbackType: FeedbackType;
  value: string;
  userId: string | null;
  createdAt: number;
}

export interface SatisfactionScore {
  id: string;
  threadId: string;
  /** Owner of the thread the score was computed for. Same null semantics
   *  as `TraceSpan.userId`. */
  userId: string | null;
  frustrationScore: number;
  rephrasingScore: number;
  abandonmentScore: number;
  sentimentScore: number;
  lengthTrendScore: number;
  computedAt: number;
}

// ─── Evals ─────────��──────────────────────────────────────────────────

export type EvalType = "automated" | "llm_judge" | "human";

export interface EvalResult {
  id: string;
  runId: string;
  threadId: string | null;
  /** Owner of the run being evaluated. Same null semantics as
   *  `TraceSpan.userId`. */
  userId: string | null;
  evalType: EvalType;
  criteria: string;
  score: number;
  reasoning: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

export interface EvalDataset {
  id: string;
  name: string;
  description: string;
  entries: EvalTestCase[];
  createdAt: number;
  updatedAt: number;
}

export interface EvalTestCase {
  input: string;
  expectedOutput?: string;
  context?: Record<string, unknown>;
  tags?: string[];
}

export interface EvalCriteria {
  name: string;
  description: string;
  rubric?: string;
  scoreRange?: { min: number; max: number };
}

// ─── Experiments ───────��──────────────────────────────────────────────

export type ExperimentStatus = "draft" | "running" | "paused" | "completed";

export interface ExperimentVariant {
  id: string;
  weight: number;
  config: Record<string, unknown>;
}

export interface Experiment {
  id: string;
  name: string;
  status: ExperimentStatus;
  variants: ExperimentVariant[];
  metrics: string[];
  assignmentLevel: "user" | "session";
  startedAt: number | null;
  endedAt: number | null;
  createdAt: number;
}

export interface ExperimentAssignment {
  experimentId: string;
  userId: string;
  variantId: string;
  assignedAt: number;
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

// ─── Observability config ─────────────────────────────────────────────

export interface ObservabilityConfig {
  enabled: boolean;
  capturePrompts: boolean;
  captureToolArgs: boolean;
  captureToolResults: boolean;
  evalSampleRate: number;
  exporters: ObservabilityExporterConfig[];
}

export interface ObservabilityExporterConfig {
  type: "otlp" | "console" | "custom";
  endpoint?: string;
  headers?: Record<string, string>;
}

export const DEFAULT_OBSERVABILITY_CONFIG: ObservabilityConfig = {
  enabled: true,
  capturePrompts: false,
  captureToolArgs: false,
  captureToolResults: false,
  evalSampleRate: 0,
  exporters: [],
};
