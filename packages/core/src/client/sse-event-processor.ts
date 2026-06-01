import type { ChatModelRunResult } from "@assistant-ui/react";
import type { AgentMcpAppPayload } from "../mcp-client/app-result.js";
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
      mcpApp?: AgentMcpAppPayload;
    };

export interface SSEEvent {
  type: string;
  text?: string;
  tool?: string;
  label?: string;
  input?: Record<string, string>;
  result?: string;
  mcpApp?: AgentMcpAppPayload;
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
  | "no_progress"
  | "stream_ended"
  | "stale_run";

export type AgentActivityTrailEntry = { label: string; tool?: string };

export class AgentAutoContinueSignal extends Error {
  readonly reason: AgentAutoContinueReason;
  readonly maxIterations?: number;
  readonly activityTrail: AgentActivityTrailEntry[];

  constructor(options: {
    reason: AgentAutoContinueReason;
    maxIterations?: number;
    activityTrail?: AgentActivityTrailEntry[];
  }) {
    super(`Agent run needs automatic continuation: ${options.reason}`);
    this.name = "AgentAutoContinueSignal";
    this.reason = options.reason;
    this.maxIterations = options.maxIterations;
    this.activityTrail = options.activityTrail ?? [];
  }
}

export const SSE_NO_PROGRESS_TIMEOUT_MS = 75_000;

type ActivityTrailEntry = AgentActivityTrailEntry;

function appendActivityTrail(
  trail: ActivityTrailEntry[],
  next: ActivityTrailEntry,
) {
  const label = next.label.trim();
  if (!label) return;
  const tool = next.tool?.trim();
  const last = trail[trail.length - 1];
  if (last?.label === label && last.tool === tool) return;
  trail.push({ label, ...(tool ? { tool } : {}) });
  if (trail.length > 8) {
    trail.splice(0, trail.length - 8);
  }
}

async function readChunkWithProgressTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  lastMeaningfulEventAt: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  const elapsed = Date.now() - lastMeaningfulEventAt;
  const timeoutMs = Math.max(0, SSE_NO_PROGRESS_TIMEOUT_MS - elapsed);
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const readPromise = reader.read();
  // If the timeout wins and cancellation causes the pending read to reject,
  // swallow that rejection because the generator is already recovering.
  void readPromise.catch(() => {});

  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timeoutId = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const result = await Promise.race([readPromise, timeoutPromise]);
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
  if (result === "timeout") {
    await reader.cancel("no_progress").catch(() => {});
    throw new AgentAutoContinueSignal({ reason: "no_progress" });
  }
  return result;
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
    code === "http_401" ||
    code === "http_403" ||
    code === "rate_limit_exceeded" ||
    code === "gateway_not_enabled" ||
    code === "missing_api_key" ||
    code === "missing_credentials" ||
    code === "invalid_request_error" ||
    code === "request_too_large" ||
    code === "not_found_error" ||
    code === "model_not_found" ||
    // `builder_gateway_error` is the no-detail fallback the Builder engine
    // emits when the gateway returns `{type:"stop",reason:"error"}` with no
    // explanation — almost always the upstream provider giving up (model
    // quota hit, account misconfiguration, opaque downstream failure). The
    // production-agent already retries this synchronously up to MAX_RETRIES
    // before the error escapes to the SSE stream, so by the time the client
    // sees it, retrying again with another POST /agent-chat will hit the
    // same wall. This used to send the chat into a 32-continuation runaway
    // (each turn cleared+regenerated visible content) for users hitting a
    // misbehaving Builder route. Surface the error instead.
    code === "builder_gateway_error"
  ) {
    return false;
  }

  if (
    code === "builder_gateway_network_error" ||
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

  if (msg.includes("daily gateway request cap")) return false;

  // "gateway error" intentionally absent — that's the no-detail Builder
  // gateway fallback and the production-agent already retries it
  // synchronously up to MAX_RETRIES before the error escapes here. Treating
  // it as auto-recoverable on top of that produced a 32-continuation
  // runaway in production for users hitting a misbehaving Builder route.
  // (See `code === "builder_gateway_error"` in the not-recoverable list.)
  return (
    msg.includes("overloaded") ||
    msg.includes("rate_limit") ||
    msg.includes("too many requests") ||
    msg.includes("timeout") ||
    msg.includes("gateway timeout") ||
    msg.includes("inactivity timeout") ||
    msg.includes("socket hang up") ||
    msg.includes("connection reset") ||
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

function isMissingCredentialText(message: string, errorCode?: string): boolean {
  const code = String(errorCode ?? "").toLowerCase();
  const msg = message.toLowerCase();
  return (
    code === "missing_api_key" ||
    code === "missing_credentials" ||
    msg.includes("apikey") ||
    msg.includes("authtoken") ||
    msg.includes("anthropic_api_key") ||
    msg.includes("missing_api_key") ||
    msg.includes("missing api key") ||
    msg.includes("missing credentials") ||
    msg.includes("no llm provider") ||
    msg.includes("llm provider is connected")
  );
}

function dispatchActivityClear(tabId: string | undefined) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("agent-chat:activity-clear", {
      detail: { tabId },
    }),
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
    dispatchActivityClear(tabId);
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

  if (ev.type === "activity") {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-chat:activity", {
          detail: {
            label: ev.label ?? "Working",
            ...(ev.tool ? { tool: ev.tool } : {}),
            tabId,
          },
        }),
      );
    }
    return { action: "continue" };
  }

  if (ev.type === "tool_start") {
    const toolCallId = `tc_${++toolCallCounter.value}`;
    const args = (ev.input ?? {}) as Record<string, string>;
    const tool = ev.tool ?? "unknown";
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-start", {
          detail: { tool, input: args },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agent-chat:activity", {
          detail: {
            label: `Running ${tool}`,
            tool,
            tabId,
          },
        }),
      );
    }
    content.push({
      type: "tool-call",
      toolCallId,
      toolName: tool,
      argsText: JSON.stringify(args),
      args,
    });
    return {
      action: "yield",
      result: { content: [...content] } as ChatModelRunResult,
    };
  }

  if (ev.type === "tool_done") {
    // Normalize identically to tool_start (which stores `ev.tool ?? "unknown"`)
    // so a tool_done frame with an undefined tool name still matches its
    // pending tool-call entry instead of leaving it forever unresolved.
    const doneTool = ev.tool ?? "unknown";
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-done", {
          detail: { tool: doneTool, result: ev.result },
        }),
      );
    }
    for (let i = content.length - 1; i >= 0; i--) {
      const part = content[i];
      if (
        part.type === "tool-call" &&
        part.toolName === doneTool &&
        part.result === undefined
      ) {
        part.result = ev.result ?? "";
        if (ev.mcpApp) part.mcpApp = ev.mcpApp;
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
    content.push({
      type: "text",
      text: "No LLM provider is connected. Open Agent settings > LLM, then connect Builder.io or add a provider key.",
    });
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
      ev.reason === "no_progress" ||
      ev.reason === "run_timeout"
        ? ev.reason
        : ev.errorCode === "stream_ended" ||
            ev.errorCode === "loop_limit" ||
            ev.errorCode === "no_progress" ||
            ev.errorCode === "run_timeout"
          ? ev.errorCode
          : ev.error === "stream_ended" ||
              ev.error === "loop_limit" ||
              ev.error === "no_progress" ||
              ev.error === "run_timeout"
            ? ev.error
            : ev.status === "stream_ended" ||
                ev.status === "loop_limit" ||
                ev.status === "no_progress" ||
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
            ev.errorCode === "stale_run"
              ? "stale_run"
              : ev.errorCode === "builder_gateway_timeout" ||
                  ev.errorCode === "run_timeout" ||
                  errMsg.toLowerCase().includes("timeout")
                ? "run_timeout"
                : "stream_ended",
        },
      };
    }
    const normalized = normalizeChatError(errMsg);
    if (isMissingCredentialText(errMsg, ev.errorCode)) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("agent-chat:missing-api-key"));
      }
      content.push({
        type: "text",
        text: formatChatErrorText(errMsg, ev.upgradeUrl, ev.errorCode),
      });
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
  let lastMeaningfulEventAt = Date.now();
  const activityTrail: ActivityTrailEntry[] = [];

  const withStreamMetadata = (r: ChatModelRunResult): ChatModelRunResult => {
    if (!runId && activityTrail.length === 0) return r;
    const metadata = (r.metadata ?? {}) as Record<string, unknown>;
    const custom =
      metadata.custom && typeof metadata.custom === "object"
        ? (metadata.custom as Record<string, unknown>)
        : {};
    const runError =
      runId && custom.runError && typeof custom.runError === "object"
        ? {
            ...(custom.runError as Record<string, unknown>),
            runId,
          }
        : custom.runError;
    return {
      ...r,
      metadata: {
        ...metadata,
        custom: {
          ...custom,
          ...(runId ? { runId } : {}),
          ...(runError ? { runError } : {}),
          ...(activityTrail.length > 0
            ? { activityTrail: [...activityTrail] }
            : {}),
        },
      },
    };
  };

  try {
    while (true) {
      const { done, value } = await readChunkWithProgressTimeout(
        reader,
        lastMeaningfulEventAt,
      );
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      let sawDataEvent = false;

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
        sawDataEvent = true;
        lastMeaningfulEventAt = Date.now();

        // Track sequence number for reconnection
        if (ev.seq !== undefined && onSeq) {
          onSeq(ev.seq);
        }

        if (ev.type === "clear") {
          activityTrail.length = 0;
        } else if (ev.type === "activity") {
          appendActivityTrail(activityTrail, {
            label: ev.label ?? "Working",
            ...(ev.tool ? { tool: ev.tool } : {}),
          });
        } else if (ev.type === "tool_start") {
          const tool = ev.tool ?? "unknown";
          appendActivityTrail(activityTrail, {
            label: `Running ${tool}`,
            tool,
          });
        }

        const { action, result, autoContinue } = processEvent(
          ev,
          content,
          toolCallCounter,
          tabId,
        );

        if (result) yield withStreamMetadata(result);
        if (action === "auto_continue") {
          throw new AgentAutoContinueSignal(
            autoContinue
              ? { ...autoContinue, activityTrail: [...activityTrail] }
              : { reason: "stream_ended", activityTrail: [...activityTrail] },
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

      if (
        !sawDataEvent &&
        Date.now() - lastMeaningfulEventAt >= SSE_NO_PROGRESS_TIMEOUT_MS
      ) {
        throw new AgentAutoContinueSignal({ reason: "no_progress" });
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The timeout path cancels the stream before unwinding; some runtimes
      // still consider the pending read active for a tick.
    }
  }

  // Stream ended without explicit done event. Even an empty content array is
  // abnormal here: a healthy run emits a terminal `done` event. Treat this as
  // recoverable so the adapter can first reconnect to the run, then continue
  // from durable history if the producer is gone.
  throw new AgentAutoContinueSignal({
    reason: "stream_ended",
    activityTrail: [...activityTrail],
  });
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
  let lastMeaningfulEventAt = Date.now();
  // Tracks whether the most recent content state was already pushed via
  // onUpdate inside the loop, so the post-loop flush below doesn't emit the
  // identical content a second time when the stream closes without a terminal
  // event.
  let emittedLatestContent = false;

  try {
    while (true) {
      const { done, value } = await readChunkWithProgressTimeout(
        reader,
        lastMeaningfulEventAt,
      );
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      let updated = false;
      let sawDataEvent = false;
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
        sawDataEvent = true;
        lastMeaningfulEventAt = Date.now();

        const { action, autoContinue } = processEvent(
          ev,
          content,
          toolCallCounter,
          tabId,
        );

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
          throw new AgentAutoContinueSignal(
            autoContinue ?? { reason: "stream_ended" },
          );
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
        emittedLatestContent = true;
      }
      if (
        !sawDataEvent &&
        Date.now() - lastMeaningfulEventAt >= SSE_NO_PROGRESS_TIMEOUT_MS
      ) {
        throw new AgentAutoContinueSignal({ reason: "no_progress" });
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // See readSSEStream: cancellation may race lock release in browsers.
    }
  }
  if (content.length > 0 && !emittedLatestContent) onUpdate([...content]);
  throw new AgentAutoContinueSignal({ reason: "stream_ended" });
}
