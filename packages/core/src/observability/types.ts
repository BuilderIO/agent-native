
import type { AgentMcpAppPayload } from "../mcp-client/app-result.js";


export type SpanType = "llm_call" | "tool_call" | "agent_run";
export type SpanStatus = "success" | "error";

export interface TraceSpan {
  id: string;
  runId: string;
  threadId: string | null;
  userId: string | null;
  orgId?: string | null;
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
  userId: string | null;
  orgId?: string | null;
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
  runCount?: number;
}


export type FeedbackType = "thumbs_up" | "thumbs_down" | "category" | "text";

export interface FeedbackEntry {
  id: string;
  runId: string | null;
  threadId: string | null;
  messageSeq: number | null;
  feedbackType: FeedbackType;
  value: string;
  idempotencyKey?: string | null;
  userId: string | null;
  orgId?: string | null;
  source?: "chat" | "human_review";
  createdAt: number;
}

export type InstructionUpdateStatus = "draft" | "approved" | "applied";

export interface InstructionUpdate {
  id: string;
  runId: string;
  threadId: string | null;
  target: "agent" | "developer" | "skill";
  instruction: string;
  feedback: string;
  status: InstructionUpdateStatus;
  userId: string;
  orgId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface OutputReviewListRow {
  runId: string;
  orgId: string;
  readOnly: boolean;
  threadId: string | null;
  ask: string;
  answer: string;
  hasInlineApp: boolean;
  inlineAppTitle?: string;
  threadTitle: string;
  summary: HumanReviewSummaryPayload | null;
  artifacts: HumanReviewArtifactRef[];
  runs: OutputReviewRun[];
  runCount: number;
  authorName?: string;
  authorAvatar?: string;
  model: string;
  createdAt: number;
  feedback: FeedbackEntry[];
  instructionUpdate: InstructionUpdate | null;
}

export interface OutputReviewRun {
  runId: string;
  model: string;
  createdAt: number;
}

export interface HumanReviewArtifactRef {
  appId: "design" | "slides" | "analytics";
  artifactId: string;
  title: string;
  path?: string;
}

export interface HumanReviewSummaryPayload {
  ask: string;
  outcome: string;
  artifacts: HumanReviewArtifactRef[];
}

export interface HumanReviewSummary extends HumanReviewSummaryPayload {
  runId: string;
  orgId: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface OutputReviewThreadMessage {
  role: "user" | "assistant";
  text: string;
  toolCalls?: string[];
}

export interface OutputReviewDetail {
  runId: string;
  orgId: string;
  app: AgentMcpAppPayload | null;
  messages: OutputReviewThreadMessage[];
  artifacts: HumanReviewArtifactRef[];
  summary: HumanReviewSummaryPayload | null;
  ask: string;
  answer: string;
}

export type ObservabilityReviewScope =
  | { kind: "organization"; orgId: string }
  | { kind: "all"; activeOrgId: string };

export interface ObservabilityReviewThreadScope {
  orgId: string;
  threadId: string;
}

export function observabilityReviewThreadKey(
  orgId: string,
  threadId: string,
): string {
  return JSON.stringify([orgId, threadId]);
}

/** @deprecated Use OutputReviewListRow for list data. */
export interface OutputReviewRow extends OutputReviewListRow {
  inlineApp?: AgentMcpAppPayload;
}

export interface SatisfactionScore {
  id: string;
  threadId: string;
  userId: string | null;
  frustrationScore: number;
  rephrasingScore: number;
  abandonmentScore: number;
  sentimentScore: number;
  lengthTrendScore: number;
  computedAt: number;
}


export type EvalType = "automated" | "llm_judge" | "human";

export interface EvalResult {
  id: string;
  runId: string;
  threadId: string | null;
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
  /**
   * Email of the user who created this experiment. Used to scope mutations
   * (PUT /experiments/:id, POST /experiments/:id/results) so one user can't
   * silently change another user's experiment in a multi-tenant deployment.
   * Null on legacy rows from before the owner_email migration shipped.
   */
  ownerEmail?: string | null;
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


export interface ObservabilityConfig {
  enabled: boolean;
  capturePrompts: boolean;
  captureToolArgs: boolean;
  captureToolResults: boolean;
  captureLlmSpans: boolean;
  evalSampleRate: number;
  inferredSentimentEnabled: boolean;
  inferredSentimentSampleRate: number;
  inferredSentimentModel: string;
}
