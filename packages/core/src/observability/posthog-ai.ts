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
 * Events are stamped when the operation BEGAN, which is what every backend
 * except PostHog reads verbatim. PostHog alone treats an AI event's timestamp
 * as the moment the operation ended and recovers the start by subtracting
 * `$ai_latency`; that shift lives in its provider, not here, so one backend's
 * convention cannot move everyone else's clock.
 *
 * PostHog DERIVES a trace's latency, tokens and cost from its children — its
 * trace query sums `$ai_latency` over every event whose `$ai_parent_id` is the
 * trace or absent, and sums tokens/cost over `$ai_generation` / `$ai_embedding`
 * only. So the `$ai_trace` event carries none of those: an `$ai_latency` here
 * was counted *in addition to* the generation's and reported roughly twice the
 * real duration. Run totals ride along under plain names for the non-PostHog
 * backends, which have no such aggregation.
 *
 * Custom properties do NOT take an `$ai_` prefix. That namespace is PostHog's
 * schema, and a name it does not define today it may define tomorrow with
 * different meaning — `input_truncated` / `spans_dropped` cannot collide.
 *
 * Content (a generation's `$ai_input` / `$ai_output_choices`, a span's
 * `$ai_input_state` / `$ai_output_state`) is gated on config and always OMITTED
 * when disabled. Sending `[]` instead would be indistinguishable from a run
 * that genuinely had no messages.
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

/**
 * `$ai_is_error: true` with no `$ai_error` is a dead end: the reader learns
 * something broke and nothing else, which is how a failed tool span reached
 * PostHog saying only "error". Emitters fall back to this rather than shipping
 * the flag alone — a layer that failed without reporting a message is itself
 * worth seeing, and is not the same as a message we chose to withhold.
 */
const UNREPORTED_ERROR: AiErrorDetail = {
  message: "failed without a reported error message",
};

export function resolveAiError(
  isError: boolean,
  error: AiErrorDetail | undefined,
): AiErrorDetail | undefined {
  if (!isError) return undefined;
  return error ?? UNREPORTED_ERROR;
}

function trackAiEvent(
  name: string,
  properties: Record<string, unknown>,
  userId: string | null,
  occurredAt: number,
): void {
  for (const key of Object.keys(properties)) {
    if (properties[key] === undefined) delete properties[key];
  }
  try {
    void import("../tracking/registry.js")
      .then(({ track }) => {
        track(name, properties, { userId: userId ?? undefined, occurredAt });
      })
      .catch(() => {});
    // coercion-ok: a throw here would break the run it is observing
  } catch {
    // Tracking must never affect the agent run or trace persistence.
  }
}

function utf8Bytes(text: string): number {
  return typeof Buffer !== "undefined"
    ? Buffer.byteLength(text, "utf8")
    : new TextEncoder().encode(text).length;
}

/** Room reserved for the marker entry that reports what was dropped. */
const OMISSION_MARKER_BYTES = 512;

/**
 * Serialize a content value under a byte ceiling.
 *
 * A message list keeps the last user message behind a marker entry naming what
 * was dropped — what was asked is what a trace is opened for, and it stays
 * small. Replacing the whole conversation with a placeholder, which is what
 * this did, left nothing at all.
 *
 * Run `toPostHogMessages` FIRST. In engine shape a tool result is a `user`
 * message, so the rescue below picked the last tool result — the one thing it
 * is documented not to keep — and the user's question was dropped from every
 * oversized generation. Normalizing moves those to `role: "tool"`.
 *
 * Anything else (a string, an object) still becomes a placeholder: there is no
 * message to keep. Either way `truncated` is true, so a cut payload can never
 * be read as a complete one.
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

  const bytes = utf8Bytes(serialized);
  if (bytes <= MAX_AI_CONTENT_BYTES) return { value, truncated: false };

  if (Array.isArray(value)) {
    // What was ASKED is the one thing worth rescuing from an oversized
    // transcript: the rest is context the thread itself still holds, and
    // keeping as much of it as fits just ships the ceiling on every event.
    // `findLast` is ES2023; this package compiles with lib ES2022.
    let lastUser: unknown;
    for (let i = value.length - 1; i >= 0; i -= 1) {
      const entry = value[i];
      if (
        !!entry &&
        typeof entry === "object" &&
        (entry as { role?: unknown }).role === "user"
      ) {
        lastUser = entry;
        break;
      }
    }
    const kept =
      lastUser !== undefined &&
      utf8Bytes(JSON.stringify(lastUser) ?? "null") <=
        MAX_AI_CONTENT_BYTES - OMISSION_MARKER_BYTES
        ? [lastUser]
        : [];
    return {
      value: [
        {
          role: "system",
          content: `[${value.length - kept.length} message(s) omitted: ${bytes} bytes exceeded the ${MAX_AI_CONTENT_BYTES}-byte trace content limit]`,
        },
        ...kept,
      ],
      truncated: true,
    };
  }

  return {
    value: `[truncated: ${bytes} bytes exceeded the ${MAX_AI_CONTENT_BYTES}-byte trace content limit]`,
    truncated: true,
  };
}

interface PostHogToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments?: unknown };
}

interface PostHogMessage {
  role: unknown;
  content?: unknown;
  tool_calls?: PostHogToolCall[];
  tool_call_id?: string;
  name?: string;
}

/** Engine parts are read structurally, not by importing the agent's type
 *  graph into the tracking boundary. */
function contentParts(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.every(
    (part) => !!part && typeof part === "object" && !Array.isArray(part),
  )
    ? (value as Record<string, unknown>[])
    : null;
}

/**
 * Attachment bodies are base64 and routinely megabytes. PostHog renders an
 * `image` part only from a URL it can fetch, so inlining the payload would
 * render nothing while spending the whole byte ceiling — and the ceiling is
 * what collapses the rest of the conversation into a marker.
 */
function mediaPlaceholder(part: Record<string, unknown>): unknown {
  const mediaType =
    typeof part.mediaType === "string" ? part.mediaType : "unknown";
  const data = typeof part.data === "string" ? part.data : "";
  const bytes = Math.floor((data.length * 3) / 4);
  const filename = typeof part.filename === "string" ? ` ${part.filename}` : "";
  const label = part.type === "image" ? "image" : `file${filename}`;
  return { type: "text", text: `[${label}: ${mediaType}, ~${bytes} bytes]` };
}

/**
 * Rewrite an engine message list into the shape PostHog's LLM analytics reads.
 *
 * PostHog normalizes on OpenAI/Anthropic conventions. This framework's engine
 * messages are a near-miss of the Vercel AI SDK's: `type: "tool-call"` /
 * `"tool-result"` with hyphens, `toolCallId` in camelCase, and — the one that
 * actually breaks — tool results carried inside a `user` message, because
 * `EngineMessage` has no `tool` role. PostHog recognizes none of that and falls
 * back to dumping the raw JSON, which is what a tool call rendering as an
 * escaped blob with its output nowhere in sight looks like.
 *
 * Anything unrecognized is passed through untouched: a shape we cannot map is
 * still better shipped as-is than dropped, and a future part type must not
 * silently vanish from traces.
 */
export function toPostHogMessages(value: unknown): unknown {
  if (!Array.isArray(value)) return value;

  const out: PostHogMessage[] = [];
  for (const message of value) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      out.push(message as PostHogMessage);
      continue;
    }
    const { role, content } = message as PostHogMessage;
    const parts = contentParts(content);
    if (!parts) {
      out.push(message as PostHogMessage);
      continue;
    }

    const toolResults: PostHogMessage[] = [];
    const toolCalls: PostHogToolCall[] = [];
    const kept: unknown[] = [];
    const text: string[] = [];
    // Text collapses to a plain string, which is what PostHog renders; any
    // other part forces the array form so nothing is silently flattened away.
    let textOnly = true;

    for (const part of parts) {
      switch (part.type) {
        case "tool-result":
          toolResults.push({
            role: "tool",
            tool_call_id:
              typeof part.toolCallId === "string" ? part.toolCallId : "",
            ...(typeof part.toolName === "string"
              ? { name: part.toolName }
              : {}),
            content: part.content,
          });
          break;
        case "tool-call":
          toolCalls.push({
            id: typeof part.id === "string" ? part.id : "",
            type: "function",
            function: {
              name: typeof part.name === "string" ? part.name : "",
              ...(part.input !== undefined ? { arguments: part.input } : {}),
            },
          });
          break;
        case "text":
          text.push(typeof part.text === "string" ? part.text : "");
          kept.push({ type: "text", text: part.text });
          break;
        case "thinking":
          textOnly = false;
          kept.push({ type: "thinking", thinking: part.text ?? "" });
          break;
        case "image":
        case "file":
          textOnly = false;
          kept.push(mediaPlaceholder(part));
          break;
        default:
          textOnly = false;
          kept.push(part);
      }
    }

    // Results answer the assistant turn before them, so they lead — otherwise
    // PostHog draws this turn's question above the answer to the last one.
    out.push(...toolResults);
    if (kept.length > 0 || toolCalls.length > 0) {
      out.push({
        role,
        content: textOnly ? text.join("\n") : kept,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    }
  }
  return out;
}

export interface AiTraceEventInput {
  runId: string;
  threadId: string | null;
  userId: string | null;
  /** Human-readable name for the run, e.g. the agent or thread name. */
  spanName: string;
  model: string;
  provider: string;
  /** Wall-clock duration of the whole run. Reported under `duration_ms`, not
   *  `$ai_latency` — see the aggregation note at the top of this file. */
  durationMs: number;
  isError: boolean;
  error?: AiErrorDetail;
  /** What KIND of failure this was — a terminal code, a cut-off reason, an
   *  engine error code. A classification, never content, so it ships even when
   *  the message is withheld. */
  errorType?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  createdAt: number;
  /** Browser session id, when the run originated from a page. Links the trace
   *  to PostHog session replay. */
  browserSessionId?: string;
  extraProperties?: Record<string, unknown>;
}

/**
 * The run's prompt and answer are NOT carried here. Every round-trip emits a
 * generation with its own `$ai_input` / `$ai_output_choices`, so a trace-level
 * copy repeated the first call's prompt and the last call's answer on a second
 * event. The trace owns what only it knows: the run's name, failure, metadata
 * and totals.
 *
 * The visible cost is that PostHog reads a trace's input and output from this
 * event and from nowhere else: traces list with a null input, and a
 * conversation is titled from the first generation's `$ai_input` instead.
 */
export function emitAiTraceEvent(input: AiTraceEventInput): void {
  trackAiEvent(
    "$ai_trace",
    {
      ...input.extraProperties,
      $ai_trace_id: input.runId,
      $ai_session_id: input.threadId ?? undefined,
      $ai_span_name: input.spanName,
      $ai_model: input.model,
      $ai_provider: input.provider,
      $ai_is_error: input.isError,
      $ai_error: resolveAiError(input.isError, input.error),
      $ai_error_type: input.isError
        ? (input.errorType ?? "run_error")
        : undefined,
      duration_ms: Math.round(input.durationMs),
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      cost_usd: input.costUsd,
      $session_id: input.browserSessionId,
      created_at: new Date(input.createdAt).toISOString(),
    },
    input.userId,
    input.createdAt,
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
  /** The tool failure's class — `tool_error`, `interrupted`. A classification,
   *  never the tool's output, so it ships with `captureToolResults` off. */
  errorType?: string;
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
      $ai_error: resolveAiError(input.isError, input.error),
      $ai_error_type: input.isError
        ? (input.errorType ?? "tool_error")
        : undefined,
      $ai_input_state: inputContent?.value,
      $ai_output_state: outputContent?.value,
      input_truncated: inputContent?.truncated || undefined,
      output_truncated: outputContent?.truncated || undefined,
      $session_id: input.browserSessionId,
      created_at: new Date(input.createdAt).toISOString(),
    },
    input.userId,
    input.createdAt,
  );
}

export interface AiFeedbackSurveyInput {
  runId: string | null;
  threadId: string | null;
  userId: string | null;
  feedbackType: "thumbs_up" | "thumbs_down" | "category" | "text";
  /** The submitted value: chosen category or free text. Ignored for thumbs,
   *  which answer a rating question and travel as PostHog's choice index. */
  value: string;
  /** Groups the events of one response. A thumbs-down and the follow-up text
   *  it opens are two `survey sent` events answering two questions of the SAME
   *  response, so they must share this id. */
  submissionId: string;
  model?: string;
  browserSessionId?: string;
}

/**
 * PostHog's thumbs survey is a choice question, and the response is the
 * choice's 1-based index — not a label. Sending "thumbs_up" put a string where
 * the rating belongs, so the vote counted as an unrecognized answer.
 *
 * @see https://posthog.com/docs/ai-observability/user-feedback/manual-event-capture
 */
const THUMB_RESPONSE_INDEX = { thumbs_up: 1, thumbs_down: 2 } as const;

/**
 * Emit PostHog's documented manual feedback event for an LLM trace.
 *
 * PostHog surfaces feedback in LLM analytics only through `survey sent` keyed
 * to a real survey id — `$ai_feedback` is not a PostHog event and renders
 * nowhere. Returns `false` and emits nothing when no survey id is configured:
 * inventing one would produce events attached to a survey that does not exist.
 *
 * A thumbs vote answers the survey's first question; a category or free-text
 * answer answers the follow-up question after it. Both share the caller's
 * `submissionId`, which is how PostHog joins them into one response.
 *
 * Sent to PostHog ONLY, not through `track()`. The survey response carries the
 * user's free-text feedback verbatim, and configuring a PostHog survey id must
 * not silently start shipping that text to Mixpanel, Amplitude, webhooks, or
 * Agent-Native Analytics. Those backends get the content-free `$ai_feedback`
 * event instead.
 *
 * @see https://posthog.com/docs/ai-observability/user-feedback/manual-event-capture
 */
export function emitAiFeedbackSurveyEvent(
  input: AiFeedbackSurveyInput,
): boolean {
  const surveyId = process.env.POSTHOG_AI_FEEDBACK_SURVEY_ID?.trim();
  if (!surveyId) return false;

  const thumbResponse =
    input.feedbackType === "thumbs_up" || input.feedbackType === "thumbs_down"
      ? THUMB_RESPONSE_INDEX[input.feedbackType]
      : undefined;

  // `$survey_response` is the survey's first question — the thumbs — and
  // `$survey_response_1` the follow-up asked after a thumbs-down. Putting the
  // free text on the first key instead would file prose where the rating
  // belongs and skew every thumbs metric in the survey.
  const responses =
    thumbResponse !== undefined
      ? { $survey_response: thumbResponse }
      : { $survey_response_1: input.value };

  const properties: Record<string, unknown> = {
    $survey_id: surveyId,
    ...responses,
    $survey_submission_id: input.submissionId,
    // A thumbs-down opens the follow-up question, so the response is not
    // complete until that answer arrives (or the user closes it without one).
    $survey_completed: input.feedbackType !== "thumbs_down",
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
