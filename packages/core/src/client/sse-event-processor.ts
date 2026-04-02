import type { ChatModelRunResult } from "@assistant-ui/react";

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
    content.push({
      type: "text",
      text: "I've reached the maximum number of steps for this response.",
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-chat:loop-limit", { detail: { tabId } }),
      );
    }
    return {
      action: "done",
      result: { content: [...content] } as ChatModelRunResult,
    };
  }

  if (ev.type === "error") {
    const errMsg = ev.error ?? "Unknown error";
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
    content.push({ type: "text", text: `Error: ${errMsg}` });
    return {
      action: "error",
      result: {
        content: [...content],
        status: { type: "incomplete" as const, reason: "error" as const },
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
 */
export async function* readSSEStream(
  body: ReadableStream<Uint8Array>,
  content: ContentPart[],
  toolCallCounter: { value: number },
  tabId: string | undefined,
  onSeq?: (seq: number) => void,
): AsyncGenerator<ChatModelRunResult> {
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

        if (result) yield result;
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
    yield { content: [...content] } as ChatModelRunResult;
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
}
