import { sendPostHogEvent } from "../tracking/providers.js";
import { boundedText } from "../tracking/redaction.js";

export const MAX_AI_CONTENT_BYTES = 128 * 1024;
export const MAX_AI_SPANS_PER_RUN = 100;

export interface AiErrorDetail {
  message: string;
  terminal_code?: string;
  terminal_state?: string;
  retryable?: boolean;
}

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

const OMISSION_MARKER_BYTES = 512;

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

function contentParts(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.every(
    (part) => !!part && typeof part === "object" && !Array.isArray(part),
  )
    ? (value as Record<string, unknown>[])
    : null;
}

function mediaPlaceholder(part: Record<string, unknown>): unknown {
  const mediaType =
    typeof part.mediaType === "string" ? part.mediaType : "unknown";
  const data = typeof part.data === "string" ? part.data : "";
  const bytes = Math.floor((data.length * 3) / 4);
  const filename = typeof part.filename === "string" ? ` ${part.filename}` : "";
  const label = part.type === "image" ? "image" : `file${filename}`;
  return { type: "text", text: `[${label}: ${mediaType}, ~${bytes} bytes]` };
}

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
  spanName: string;
  model: string;
  provider: string;
  durationMs: number;
  isError: boolean;
  error?: AiErrorDetail;
  errorType?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  createdAt: number;
  browserSessionId?: string;
  extraProperties?: Record<string, unknown>;
}

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
  parentId?: string;
  spanName: string;
  latencySeconds: number;
  isError: boolean;
  error?: AiErrorDetail;
  errorType?: string;
  createdAt: number;
  browserSessionId?: string;
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
  value: string;
  submissionId: string;
  model?: string;
  browserSessionId?: string;
}

const THUMB_RESPONSE_INDEX = { thumbs_up: 1, thumbs_down: 2 } as const;

export function emitAiFeedbackSurveyEvent(
  input: AiFeedbackSurveyInput,
): boolean {
  const surveyId = process.env.POSTHOG_AI_FEEDBACK_SURVEY_ID?.trim();
  if (!surveyId) return false;

  const thumbResponse =
    input.feedbackType === "thumbs_up" || input.feedbackType === "thumbs_down"
      ? THUMB_RESPONSE_INDEX[input.feedbackType]
      : undefined;

  const responses =
    thumbResponse !== undefined
      ? { $survey_response: thumbResponse }
      : { $survey_response_1: input.value };

  const properties: Record<string, unknown> = {
    $survey_id: surveyId,
    ...responses,
    $survey_submission_id: input.submissionId,
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
