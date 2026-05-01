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
  action: "continue" | "done" | "yield" | "error" | "missing_api_key";
  result?: ChatModelRunResult;
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
    content.push({
      type: "text",
      text: maxIterations
        ? `I reached the ${maxIterations}-step limit before finishing.`
        : "I reached the step limit before finishing.",
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-chat:loop-limit", {
          detail: { tabId, maxIterations },
        }),
      );
    }
    return {
      action: "done",
      result: {
        content: [...content],
        metadata: {
          custom: {
            loopLimit: {
              ...(maxIterations ? { maxIterations } : {}),
            },
          },
        },
      } as ChatModelRunResult,
    };
  }

  if (ev.type === "error") {
    const errMsg = ev.error ?? "Unknown error";
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

        const { action, result } = processEvent(
          ev,
          content,
          toolCallCounter,
          tabId,
        );

        if (result) yield withRunId(result);
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

  // Stream ended without explicit done event
  if (content.length > 0) {
    const runError = {
      message:
        "The response stream ended before the agent sent a completion signal. You can continue from the partial work or retry.",
      errorCode: "stream_ended",
      recoverable: true,
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
      text: `Error: ${runError.message}`,
    });
    yield withRunId({
      content: [...content],
      status: { type: "incomplete" as const, reason: "error" as const },
      metadata: { custom: { runError } },
    } as ChatModelRunResult);
  }
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
  if (content.length > 0) {
    const runError = {
      message:
        "The response stream ended before the agent sent a completion signal. You can continue from the partial work or retry.",
      errorCode: "stream_ended",
      recoverable: true,
    };
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-chat:run-error", {
          detail: { ...runError, tabId },
        }),
      );
    }
    content.push({ type: "text", text: `Error: ${runError.message}` });
    onUpdate([...content]);
  }
}
