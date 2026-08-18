/**
 * PostHog LLM-analytics events (`$ai_trace`, `$ai_span`, `$ai_generation`
 * content fields).
 *
 * PostHog models an agent run as a tree: one `$ai_trace` per run, `$ai_span`
 * for non-model work (tool calls), and `$ai_generation` for model round-trips.
 * Every node shares `$ai_trace_id` and links upward through `$ai_parent_id`.
 * Emitting only a generation — which is what this framework did — makes PostHog
 * synthesize a placeholder trace with no tool steps in it.
 *
 * `$ai_session_id` groups traces into a conversation. It is deliberately NOT
 * PostHog's `$session_id`: the latter is the browser session used for session
 * replay, and the two are different lifetimes.
 *
 * Content (`$ai_input` / `$ai_output_choices` / `$ai_input_state` /
 * `$ai_output_state`) is gated on config and always OMITTED when disabled.
 * Sending `[]` instead would be indistinguishable from a run that genuinely had
 * no messages.
 *
 * @see https://posthog.com/docs/ai-observability/traces
 * @see https://posthog.com/docs/ai-observability/spans
 */

import { sendPostHogEvent } from "../tracking/providers.js";
import { boundedText } from "../tracking/redaction.js";

/** Hard ceiling on serialized content per `$ai_*` field. */
export const MAX_AI_CONTENT_BYTES = 128 * 1024;
/** Hard ceiling on emitted `$ai_span` events per run. */
export const MAX_AI_SPANS_PER_RUN = 100;

export interface AiErrorDetail {
  message: string;
  terminal_code?: string;
  terminal_state?: string;
  retryable?: boolean;
}

function trackAiEvent(
  name: string,
  properties: Record<string, unknown>,
  userId: string | null,
): void {
  for (const key of Object.keys(properties)) {
    if (properties[key] === undefined) delete properties[key];
  }
  try {
    void import("../tracking/registry.js")
      .then(({ track }) => {
        track(name, properties, { userId: userId ?? undefined });
      })
      .catch(() => {});
    // coercion-ok: a throw here would break the run it is observing
  } catch {
    // Tracking must never affect the agent run or trace persistence.
  }
}

/**
 * Serialize a content value under a byte ceiling.
 *
 * Returns `{ truncated: true }` with a placeholder rather than a silently
 * shortened payload — a trace that shows half a conversation as if it were the
 * whole one is worse than one that says it was cut.
 */
export function boundAiContent(value: unknown): {
  value: unknown;
  truncated: boolean;
} {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { value: "[unserializable]", truncated: true };
  }
  if (serialized === undefined) return { value: undefined, truncated: false };

  const bytes =
    typeof Buffer !== "undefined"
      ? Buffer.byteLength(serialized, "utf8")
      : new TextEncoder().encode(serialized).length;
  if (bytes <= MAX_AI_CONTENT_BYTES) return { value, truncated: false };

  return {
    value: `[truncated: ${bytes} bytes exceeded the ${MAX_AI_CONTENT_BYTES}-byte trace content limit]`,
    truncated: true,
  };
}

export interface AiTraceEventInput {
  runId: string;
  threadId: string | null;
  userId: string | null;
  /** Human-readable name for the run, e.g. the agent or thread name. */
  spanName: string;
  model: string;
  provider: string;
  latencySeconds: number;
  isError: boolean;
  error?: AiErrorDetail;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  createdAt: number;
  /** Browser session id, when the run originated from a page. Links the trace
   *  to PostHog session replay. */
  browserSessionId?: string;
  /** Omitted unless `capturePrompts` is on. */
  inputState?: unknown;
  outputState?: unknown;
  extraProperties?: Record<string, unknown>;
}

export function emitAiTraceEvent(input: AiTraceEventInput): void {
  const inputContent =
    input.inputState === undefined
      ? undefined
      : boundAiContent(input.inputState);
  const outputContent =
    input.outputState === undefined
      ? undefined
      : boundAiContent(input.outputState);

  trackAiEvent(
    "$ai_trace",
    {
      ...input.extraProperties,
      $ai_trace_id: input.runId,
      $ai_session_id: input.threadId ?? undefined,
      $ai_span_name: input.spanName,
      $ai_model: input.model,
      $ai_provider: input.provider,
      $ai_latency: input.latencySeconds,
      $ai_is_error: input.isError,
      $ai_error: input.error,
      $ai_input_tokens: input.inputTokens,
      $ai_output_tokens: input.outputTokens,
      $ai_total_cost_usd: input.costUsd,
      $ai_input_state: inputContent?.value,
      $ai_output_state: outputContent?.value,
      $ai_input_truncated: inputContent?.truncated || undefined,
      $ai_output_truncated: outputContent?.truncated || undefined,
      $session_id: input.browserSessionId,
      created_at: new Date(input.createdAt).toISOString(),
    },
    input.userId,
  );
}

export interface AiSpanEventInput {
  runId: string;
  threadId: string | null;
  userId: string | null;
  spanId: string;
  /** Defaults to the run's trace id, which is the tree root. */
  parentId?: string;
  spanName: string;
  latencySeconds: number;
  isError: boolean;
  error?: AiErrorDetail;
  createdAt: number;
  browserSessionId?: string;
  /** Omitted unless `captureToolArgs` / `captureToolResults` are on. */
  inputState?: unknown;
  outputState?: unknown;
  extraProperties?: Record<string, unknown>;
}

export function emitAiSpanEvent(input: AiSpanEventInput): void {
  const inputContent =
    input.inputState === undefined
      ? undefined
      : boundAiContent(input.inputState);
  const outputContent =
    input.outputState === undefined
      ? undefined
      : boundAiContent(input.outputState);

  trackAiEvent(
    "$ai_span",
    {
      ...input.extraProperties,
      $ai_trace_id: input.runId,
      $ai_session_id: input.threadId ?? undefined,
      $ai_span_id: input.spanId,
      $ai_parent_id: input.parentId ?? input.runId,
      $ai_span_name: input.spanName,
      $ai_latency: input.latencySeconds,
      $ai_is_error: input.isError,
      $ai_error: input.error,
      $ai_input_state: inputContent?.value,
      $ai_output_state: outputContent?.value,
      $ai_input_truncated: inputContent?.truncated || undefined,
      $ai_output_truncated: outputContent?.truncated || undefined,
      $session_id: input.browserSessionId,
      created_at: new Date(input.createdAt).toISOString(),
    },
    input.userId,
  );
}

export interface AiFeedbackSurveyInput {
  runId: string | null;
  threadId: string | null;
  userId: string | null;
  feedbackType: "thumbs_up" | "thumbs_down" | "category" | "text";
  /** The submitted value: sentiment label, chosen category, or free text. */
  value: string;
  submissionId: string;
  model?: string;
  browserSessionId?: string;
}

/**
 * Emit PostHog's documented manual feedback event for an LLM trace.
 *
 * PostHog surfaces feedback in LLM analytics only through `survey sent` keyed
 * to a real survey id — `$ai_feedback` is not a PostHog event and renders
 * nowhere. Returns `false` and emits nothing when no survey id is configured:
 * inventing one would produce events attached to a survey that does not exist.
 *
 * Sent to PostHog ONLY, not through `track()`. The survey response carries the
 * user's free-text feedback verbatim, and configuring a PostHog survey id must
 * not silently start shipping that text to Mixpanel, Amplitude, webhooks, or
 * Agent Native Analytics. Those backends get the content-free `$ai_feedback`
 * event instead.
 *
 * @see https://posthog.com/docs/ai-observability/user-feedback/manual-event-capture
 */
export function emitAiFeedbackSurveyEvent(
  input: AiFeedbackSurveyInput,
): boolean {
  const surveyId = process.env.POSTHOG_AI_FEEDBACK_SURVEY_ID?.trim();
  if (!surveyId) return false;

  const questionId = process.env.POSTHOG_AI_FEEDBACK_SURVEY_QUESTION_ID?.trim();
  // PostHog accepts `$survey_response` for a single-question survey and
  // `$survey_response_<questionId>` when the survey has named questions.
  const responseKey = questionId
    ? `$survey_response_${questionId}`
    : "$survey_response";

  const properties: Record<string, unknown> = {
    $survey_id: surveyId,
    [responseKey]: input.value,
    $survey_submission_id: input.submissionId,
    $survey_completed: true,
    $ai_trace_id: input.runId ?? undefined,
    $ai_session_id: input.threadId ?? undefined,
    $ai_model: input.model,
    $session_id: input.browserSessionId,
    feedback_type: input.feedbackType,
    source: "agent_observability",
  };
  for (const key of Object.keys(properties)) {
    if (properties[key] === undefined) delete properties[key];
  }

  return sendPostHogEvent(
    "survey sent",
    properties,
    input.userId ?? "anonymous",
  );
}

/**
 * Build a structured `$ai_error` from the run's failure information.
 *
 * Returns `undefined` when the run did not fail, so `$ai_error` is absent
 * rather than an empty object on healthy traces.
 */
export function toAiErrorDetail(
  errorMessage: string | null | undefined,
  terminalOutcome?: {
    state?: string;
    code?: string;
    retryable?: boolean;
  },
): AiErrorDetail | undefined {
  if (!errorMessage && !terminalOutcome?.code) return undefined;
  return {
    message: boundedText(
      errorMessage ?? terminalOutcome?.code ?? "error",
      1000,
    ),
    ...(terminalOutcome?.state
      ? { terminal_state: terminalOutcome.state }
      : {}),
    ...(terminalOutcome?.code ? { terminal_code: terminalOutcome.code } : {}),
    ...(terminalOutcome?.retryable !== undefined
      ? { retryable: terminalOutcome.retryable }
      : {}),
  };
}
