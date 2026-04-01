import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";
import {
  setActiveRun,
  updateActiveRunSeq,
  clearActiveRun,
} from "./active-run-state.js";

type ContentPart =
  | { type: "text"; text: string }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      argsText: string;
      args: Record<string, string>;
      result?: string;
    };

interface SSEEvent {
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
function processEvent(
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
async function* readSSEStream(
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
 * Creates a ChatModelAdapter that connects to the agent-native
 * `/api/agent-chat` SSE endpoint. Supports reconnection via run-manager.
 */
export function createAgentChatAdapter(options?: {
  apiUrl?: string;
  tabId?: string;
  threadId?: string;
}): ChatModelAdapter {
  const apiUrl = options?.apiUrl ?? "/api/agent-chat";
  const tabId = options?.tabId;
  const threadId = options?.threadId;

  return {
    async *run({ messages, abortSignal, runConfig }) {
      // Extract latest user message and build history from prior messages
      let lastUserMsg: (typeof messages)[number] | undefined;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          lastUserMsg = messages[i];
          break;
        }
      }
      const messageText =
        lastUserMsg?.content
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n") ?? "";

      // Extract attachments (images as base64, text as content)
      const attachments: {
        type: string;
        name: string;
        contentType?: string;
        data?: string;
        text?: string;
      }[] = [];
      if (lastUserMsg) {
        for (const part of lastUserMsg.content) {
          if (part.type === "image" && "image" in part) {
            const img = part as { type: "image"; image: string };
            attachments.push({ type: "image", name: "image", data: img.image });
          } else if (part.type === "file" && "data" in part) {
            const f = part as {
              type: "file";
              data: string;
              mimeType?: string;
              name?: string;
            };
            attachments.push({
              type: "file",
              name: f.name ?? "file",
              contentType: f.mimeType,
              text: f.data,
            });
          }
        }
      }

      const history = messages
        .slice(0, -1) // exclude the latest user message
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content
            .filter(
              (p): p is { type: "text"; text: string } => p.type === "text",
            )
            .map((p) => p.text)
            .join("\n"),
        }))
        .filter((m) => m.content.trim());

      // Signal that generation is starting
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("builder.chatRunning", {
            detail: { isRunning: true, tabId },
          }),
        );
      }

      const content: ContentPart[] = [];
      const toolCallCounter = { value: 0 };
      let runId: string | null = null;
      let lastSeq = -1;

      try {
        const res = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: messageText,
            history,
            ...(threadId ? { threadId } : {}),
            ...(attachments.length > 0 ? { attachments } : {}),
            ...(runConfig?.custom?.references
              ? { references: runConfig.custom.references }
              : {}),
          }),
          signal: abortSignal,
        });

        if (!res.ok) {
          let errorText = `Server error: ${res.status}`;
          try {
            const body = await res.text();
            if (
              body.includes("apiKey") ||
              body.includes("authToken") ||
              body.includes("ANTHROPIC_API_KEY") ||
              body.includes("authentication")
            ) {
              if (typeof window !== "undefined") {
                window.dispatchEvent(new Event("agent-chat:missing-api-key"));
              }
              content.push({ type: "text", text: "" });
              yield {
                content: [...content],
                status: {
                  type: "incomplete" as const,
                  reason: "error" as const,
                },
              } as ChatModelRunResult;
              return;
            } else if (body.includes("Cannot find any path")) {
              errorText =
                "Agent chat endpoint not found. Make sure the agent-chat plugin is loaded in server/plugins/.";
            } else if (body) {
              errorText = body.length > 200 ? body.slice(0, 200) + "..." : body;
            }
          } catch {}
          throw new Error(errorText);
        }
        if (!res.body) {
          throw new Error("No response body");
        }

        // Track the run ID for reconnection
        runId = res.headers.get("X-Run-Id");
        if (runId && threadId) {
          setActiveRun({ threadId, runId, lastSeq: -1 });
        }

        yield* readSSEStream(
          res.body,
          content,
          toolCallCounter,
          tabId,
          (seq) => {
            lastSeq = seq;
            if (runId && threadId) {
              updateActiveRunSeq(seq);
            }
          },
        );

        // Run completed normally — clear active run state
        clearActiveRun();
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          // User-initiated abort (Stop button) — clear active run
          clearActiveRun();
          return;
        }

        // Connection lost — try to reconnect to the run
        if (runId && lastSeq >= 0) {
          let reconnected = false;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const reconnectRes = await fetch(
                `${apiUrl}/runs/${encodeURIComponent(runId)}/events?after=${lastSeq + 1}`,
                { signal: abortSignal },
              );
              if (!reconnectRes.ok || !reconnectRes.body) break;

              yield* readSSEStream(
                reconnectRes.body,
                content,
                toolCallCounter,
                tabId,
                (seq) => {
                  lastSeq = seq;
                  if (threadId) {
                    updateActiveRunSeq(seq);
                  }
                },
              );
              reconnected = true;
              clearActiveRun();
              break;
            } catch (reconnectErr: unknown) {
              if (
                reconnectErr instanceof Error &&
                reconnectErr.name === "AbortError"
              ) {
                clearActiveRun();
                return;
              }
              // Wait briefly before retrying
              await new Promise((r) => setTimeout(r, 1000));
            }
          }

          if (reconnected) return;
        }

        // Reconnect failed or not possible — show error
        content.push({
          type: "text",
          text: "Something went wrong. Please try again.",
        });
        yield {
          content: [...content],
          status: {
            type: "incomplete" as const,
            reason: "error" as const,
          },
        };
      } finally {
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("builder.chatRunning", {
              detail: { isRunning: false, tabId },
            }),
          );
        }
      }
    },
  };
}
