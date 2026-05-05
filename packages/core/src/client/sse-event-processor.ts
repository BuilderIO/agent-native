import type { ChatModelRunResult } from "@assistant-ui/react";
import { formatChatErrorText, normalizeChatError } from "./error-format.js";

export type ContentPart =
  | { type: "text"; text: string }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      argsText: string;
      args: Record<string, string>;
      result?: string;
    };

export interface SSEEvent {
  type: string;
  text?: string;
  tool?: string;
  input?: Record<string, string>;
  result?: string;
  error?: string;
  seq?: number;
  agent?: string;
  status?: string;
  reason?: string;
  // Agent task fields
  taskId?: string;
  threadId?: string;
  description?: string;
  preview?: string;
  currentStep?: string;
  summary?: string;
  // Structured error metadata — Builder gateway sets these on quota/auth/setup
  // failures so the UI can render a CTA alongside the error text.
  errorCode?: string;
  upgradeUrl?: string;
  details?: string;
  recoverable?: boolean;
  maxIterations?: number;
}

export type AgentAutoContinueReason =
  | "run_timeout"
  | "loop_limit"
  | "stream_ended";

export class AgentAutoContinueSignal extends Error {
  readonly reason: AgentAutoContinueReason;
  readonly maxIterations?: number;

  constructor(options: {
    reason: AgentAutoContinueReason;
    maxIterations?: number;
  }) {
    super(`Agent run needs automatic continuation: ${options.reason}`);
    this.name = "AgentAutoContinueSignal";
    this.reason = options.reason;
    this.maxIterations = options.maxIterations;
  }
}

function isAutoRecoverableError(ev: SSEEvent, errMsg: string): boolean {
  const code = String(ev.errorCode ?? "").toLowerCase();
  const msg = errMsg.toLowerCase();

  if (
    code === "context_length_exceeded" ||
    code === "input_too_long" ||
    code.startsWith("credits-limit") ||
    code === "billing_error" ||
    code === "unauthorized" ||
    code === "authentication_error" ||
    code === "permission_error" ||
    code === "gateway_not_enabled" ||
    code === "missing_api_key" ||
    code === "missing_credentials" ||
    code === "invalid_request_error" ||
    code === "request_too_large" ||
    code === "not_found_error" ||
    code === "model_not_found"
  ) {
    return false;
  }

  if (
    code === "builder_gateway_timeout" ||
    code === "stale_run" ||
    code === "timeout" ||
    code === "timeout_error" ||
    code === "http_408" ||
    code === "http_429" ||
    code === "http_500" ||
    code === "http_502" ||
    code === "http_503" ||
    code === "http_504" ||
    code === "rate_limited" ||
    code === "too_many_concurrent_requests" ||
    code === "overloaded_error"
  ) {
    return true;
  }

  if (ev.recoverable === true) return true;

  return (
    msg.includes("overloaded") ||
    msg.includes("rate_limit") ||
    msg.includes("too many requests") ||
    msg.includes("timeout") ||
    msg.includes("gateway timeout") ||
    msg.includes("inactivity timeout") ||
    msg.includes("connection") ||
    msg.includes("network") ||
    msg.includes("stream closed") ||
    msg.includes("stream ended") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("529")
  );
}

/**
 * Process a single SSE event and update the content accumulator.
 * Returns: "continue" to keep going, "done" to stop, or a yield-ready result.
 */
export function processEvent(
  ev: SSEEvent,
  content: ContentPart[],
  toolCallCounter: { value: number },
  tabId: string | undefined,
): {
  action:
    | "continue"
    | "done"
    | "yield"
    | "error"
    | "missing_api_key"
    | "auto_continue";
  result?: ChatModelRunResult;
  autoContinue?: {
    reason: AgentAutoContinueReason;
    maxIterations?: number;
  };
} {
  if (ev.type === "clear") {
    // Server is retrying — discard partial text/tool output from the failed attempt
    content.length = 0;
    return { action: "continue" };
  }

  if (ev.type === "text") {
    const lastPart = content[content.length - 1];
    if (lastPart && lastPart.type === "text") {
      lastPart.text += ev.text ?? "";
    } else {
      content.push({ type: "text", text: ev.text ?? "" });
    }
    return {
      action: "yield",
      result: { content: [...content] } as ChatModelRunResult,
    };
  }

  if (ev.type === "tool_start") {
    const toolCallId = `tc_${++toolCallCounter.value}`;
    const args = (ev.input ?? {}) as Record<string, string>;
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-start", {
          detail: { tool: ev.tool ?? "unknown", input: args },
        }),
      );
    }
    content.push({
      type: "tool-call",
      toolCallId,
      toolName: ev.tool ?? "unknown",
      argsText: JSON.stringify(args),
      args,
    });
    return {
      action: "yield",
      result: { content: [...content] } as ChatModelRunResult,
    };
  }

  if (ev.type === "tool_done") {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-done", {
          detail: { tool: ev.tool ?? "unknown", result: ev.result },
        }),
      );
    }
    for (let i = content.length - 1; i >= 0; i--) {
      const part = content[i];
      if (
        part.type === "tool-call" &&
        part.toolName === ev.tool &&
        part.result === undefined
      ) {
        part.result = ev.result ?? "";
        break;
      }
    }
    return {
      action: "yield",
      result: { content: [...content] } as ChatModelRunResult,
    };
  }

  if (ev.type === "agent_call") {
    const agentName = ev.agent ?? "agent";
    if (ev.status === "start") {
      const toolCallId = `tc_${++toolCallCounter.value}`;
      content.push({
        type: "tool-call",
        toolCallId,
        toolName: `agent:${agentName}`,
        argsText: "",
        args: {},
      });
    } else if (ev.status === "done" || ev.status === "error") {
      for (let i = content.length - 1; i >= 0; i--) {
        const part = content[i];
        if (
          part.type === "tool-call" &&
          part.toolName === `agent:${agentName}` &&
          part.result === undefined
        ) {
          part.result = ev.status === "error" ? "Error calling agent" : "Done";
          break;
        }
      }
    }
    return {
      action: "yield",
      result: { content: [...content] } as ChatModelRunResult,
    };
  }

  if (ev.type === "agent_call_text") {
    const agentName = ev.agent ?? "agent";
    // Find the in-progress agent tool-call and append streaming text to argsText
    for (let i = content.length - 1; i >= 0; i--) {
      const part = content[i];
      if (
        part.type === "tool-call" &&
        part.toolName === `agent:${agentName}` &&
        part.result === undefined
      ) {
        part.argsText += ev.text ?? "";
        break;
      }
    }
    return {
      action: "yield",
      result: { content: [...content] } as ChatModelRunResult,
    };
  }

  // ─── Agent task events (sub-agent chips) ─────────────────────────
  // These events are dispatched as CustomEvents so AgentTaskCard components
  // can listen for updates to their specific taskId.
  if (
    ev.type === "agent_task" ||
    ev.type === "agent_task_update" ||
    ev.type === "agent_task_complete"
  ) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("agent-task-event", { detail: ev }));
    }
    // Don't add to content — the agent-teams tool call handles rendering
    return { action: "continue" };
  }

  if (ev.type === "missing_api_key") {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("agent-chat:missing-api-key"));
    }
    content.push({ type: "text", text: "" });
    return {
      action: "missing_api_key",
      result: {
        content: [...content],
        status: { type: "incomplete" as const, reason: "error" as const },
      } as ChatModelRunResult,
    };
  }

  if (ev.type === "loop_limit") {
    const maxIterations =
      typeof ev.maxIterations === "number" ? ev.maxIterations : undefined;
    return {
      action: "auto_continue",
      autoContinue: {
        reason: "loop_limit",
        ...(maxIterations ? { maxIterations } : {}),
      },
    };
  }

  if (ev.type === "auto_continue") {
    const reason =
      ev.reason === "stream_ended" ||
      ev.reason === "loop_limit" ||
      ev.reason === "run_timeout"
        ? ev.reason
        : ev.errorCode === "stream_ended" ||
            ev.errorCode === "loop_limit" ||
            ev.errorCode === "run_timeout"
          ? ev.errorCode
          : ev.error === "stream_ended" ||
              ev.error === "loop_limit" ||
              ev.error === "run_timeout"
            ? ev.error
            : ev.status === "stream_ended" ||
                ev.status === "loop_limit" ||
                ev.status === "run_timeout"
              ? ev.status
              : "run_timeout";
    return {
      action: "auto_continue",
      autoContinue: {
        reason,
        ...(typeof ev.maxIterations === "number"
          ? { maxIterations: ev.maxIterations }
          : {}),
      },
    };
  }

  if (ev.type === "error") {
    const errMsg = ev.error ?? "Unknown error";
    if (
      (ev.errorCode === "run_timeout" && ev.recoverable) ||
      isAutoRecoverableError(ev, errMsg)
    ) {
      return {
        action: "auto_continue",
        autoContinue: {
          reason:
            ev.errorCode === "builder_gateway_timeout" ||
            ev.errorCode === "run_timeout" ||
            errMsg.toLowerCase().includes("timeout")
              ? "run_timeout"
              : "stream_ended",
        },
      };
    }
    const normalized = normalizeChatError(errMsg);
    if (
      errMsg.includes("apiKey") ||
      errMsg.includes("authToken") ||
      errMsg.includes("ANTHROPIC_API_KEY") ||
      errMsg.includes("authentication")
    ) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("agent-chat:missing-api-key"));
      }
      content.push({ type: "text", text: "" });
      return {
        action: "missing_api_key",
        result: {
          content: [...content],
          status: { type: "incomplete" as const, reason: "error" as const },
        } as ChatModelRunResult,
      };
    }
    const runError = {
      message: normalized.message,
      ...(normalized.details || ev.details
        ? { details: ev.details ?? normalized.details }
        : {}),
      ...(ev.errorCode ? { errorCode: ev.errorCode } : {}),
      ...(ev.recoverable ? { recoverable: ev.recoverable } : {}),
    };
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-chat:run-error", {
          detail: { ...runError, tabId },
        }),
      );
    }
    content.push({
      type: "text",
      text: formatChatErrorText(errMsg, ev.upgradeUrl, ev.errorCode),
    });
    return {
      action: "error",
      result: {
        content: [...content],
        status: { type: "incomplete" as const, reason: "error" as const },
        metadata: { custom: { runError } },
      } as ChatModelRunResult,
    };
  }

  if (ev.type === "done") {
    return {
      action: "done",
      result: { content: [...content] } as ChatModelRunResult,
    };
  }

  return { action: "continue" };
}

/**
 * Read and process SSE events from a ReadableStream response body.
 * Yields ChatModelRunResult for each meaningful event.
 *
 * When `runId` is provided, every yielded result carries
 * `metadata.custom.runId` so the UI can expose the trace ID via
 * "Copy Request ID" — including mid-stream, so users can grab it before
 * the run completes (or if the run hangs / ends prematurely).
 */
export async function* readSSEStream(
  body: ReadableStream<Uint8Array>,
  content: ContentPart[],
  toolCallCounter: { value: number },
  tabId: string | undefined,
  onSeq?: (seq: number) => void,
  runId?: string | null,
): AsyncGenerator<ChatModelRunResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  const withRunId = (r: ChatModelRunResult): ChatModelRunResult => {
    if (!runId) return r;
    const metadata = (r.metadata ?? {}) as Record<string, unknown>;
    const custom =
      metadata.custom && typeof metadata.custom === "object"
        ? (metadata.custom as Record<string, unknown>)
        : {};
    const runError =
      custom.runError && typeof custom.runError === "object"
        ? {
            ...(custom.runError as Record<string, unknown>),
            runId,
          }
        : custom.runError;
    return {
      ...r,
      metadata: {
        ...metadata,
        custom: { ...custom, runId, ...(runError ? { runError } : {}) },
      },
    };
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;

        let ev: SSEEvent;
        try {
          ev = JSON.parse(raw);
        } catch {
          continue;
        }

        // Track sequence number for reconnection
        if (ev.seq !== undefined && onSeq) {
          onSeq(ev.seq);
        }

        const { action, result, autoContinue } = processEvent(
          ev,
          content,
          toolCallCounter,
          tabId,
        );

        if (result) yield withRunId(result);
        if (action === "auto_continue") {
          throw new AgentAutoContinueSignal(
            autoContinue ?? { reason: "stream_ended" },
          );
        }
        if (
          action === "done" ||
          action === "error" ||
          action === "missing_api_key"
        ) {
          return;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Stream ended without explicit done event. Even an empty content array is
  // abnormal here: a healthy run emits a terminal `done` event. Treat this as
  // recoverable so the adapter can first reconnect to the run, then continue
  // from durable history if the producer is gone.
  throw new AgentAutoContinueSignal({ reason: "stream_ended" });
}

/**
 * Read raw SSE events from a ReadableStream and process them into ContentPart[].
 * Unlike readSSEStream, this doesn't yield ChatModelRunResult — it updates the
 * content array in-place and calls onUpdate for each meaningful change.
 * Designed for reconnection scenarios where we render outside assistant-ui's runtime.
 */
export async function readSSEStreamRaw(
  body: ReadableStream<Uint8Array>,
  content: ContentPart[],
  toolCallCounter: { value: number },
  tabId: string | undefined,
  onUpdate: (content: ContentPart[]) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      let updated = false;
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;

        let ev: SSEEvent;
        try {
          ev = JSON.parse(raw);
        } catch {
          continue;
        }

        const { action } = processEvent(ev, content, toolCallCounter, tabId);

        if (
          action === "yield" ||
          action === "done" ||
          action === "error" ||
          action === "missing_api_key"
        ) {
          updated = true;
        }
        if (action === "auto_continue") {
          onUpdate([...content]);
          return;
        }
        if (
          action === "done" ||
          action === "error" ||
          action === "missing_api_key"
        ) {
          onUpdate([...content]);
          return;
        }
      }

      if (updated) {
        onUpdate([...content]);
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (content.length > 0) onUpdate([...content]);
}
