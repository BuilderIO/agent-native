import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";
import {
  setActiveRun,
  updateActiveRunSeq,
  clearActiveRun,
} from "./active-run-state.js";
import {
  AgentAutoContinueSignal,
  type ContentPart,
  readSSEStream,
} from "./sse-event-processor.js";
import { agentNativePath } from "./api-path.js";
import { normalizeChatError } from "./error-format.js";
import type { ReasoningEffort } from "../shared/reasoning-effort.js";

type AdapterHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

const AUTO_CONTINUE_PROMPT =
  "Continue from where you left off and finish the user's original request. Do not repeat completed work, do not mention internal reconnects, time limits, or step limits, and continue as if this is the same uninterrupted run.";

function normalizeMentions(text: string): string {
  return text.replace(/@\[([^\]|]+)\|[^\]]+\]/g, "@$1");
}

function truncateForContinuation(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n...[truncated ${value.length - maxChars} chars from prior partial output]`;
}

function contentToContinuationHistory(content: ContentPart[]): string {
  const chunks: string[] = [];
  for (const part of content) {
    if (part.type === "text") {
      if (part.text.trim()) chunks.push(part.text.trim());
      continue;
    }
    const toolSummary = [
      `Tool: ${part.toolName}`,
      part.argsText ? `Input: ${part.argsText}` : "",
      part.result
        ? `Result:\n${truncateForContinuation(part.result, 8_000)}`
        : "Result: interrupted before this tool returned a result",
    ]
      .filter(Boolean)
      .join("\n");
    chunks.push(toolSummary);
  }
  return truncateForContinuation(chunks.join("\n\n"), 40_000).trim();
}

function autoContinueMessage(signal: AgentAutoContinueSignal): string {
  const reason =
    signal.reason === "loop_limit"
      ? "The previous run reached an internal step budget."
      : signal.reason === "stream_ended"
        ? "The previous stream ended before the agent sent a final completion signal."
        : "The previous run reached an internal execution budget.";
  return `${AUTO_CONTINUE_PROMPT}\n\nInternal note: ${reason}`;
}

function delay(ms: number, abortSignal: AbortSignal): Promise<void> {
  if (abortSignal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    abortSignal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * The composer's exec mode is sent as explicit request metadata. The server
 * owns the plan-mode prompt and read-only tool filtering so the chat history
 * stays clean and Plan mode is enforced outside the model's goodwill.
 */
/**
 * Creates a ChatModelAdapter that connects to the agent-native
 * `/_agent-native/agent-chat` SSE endpoint. Supports reconnection via run-manager.
 */
export function createAgentChatAdapter(options?: {
  apiUrl?: string;
  tabId?: string;
  threadId?: string;
  modelRef?: { current: string | undefined };
  engineRef?: { current: string | undefined };
  effortRef?: { current: ReasoningEffort | undefined };
  execModeRef?: { current: "build" | "plan" | undefined };
}): ChatModelAdapter {
  const apiUrl =
    options?.apiUrl ?? agentNativePath("/_agent-native/agent-chat");
  const tabId = options?.tabId;
  const threadId = options?.threadId;
  const modelRef = options?.modelRef;
  const engineRef = options?.engineRef;
  const effortRef = options?.effortRef;
  const execModeRef = options?.execModeRef;

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
      const rawMessageText =
        lastUserMsg?.content
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n") ?? "";
      const requestMode =
        execModeRef?.current === "plan"
          ? "plan"
          : execModeRef?.current === "build"
            ? "act"
            : undefined;

      // Extract attachments (images as base64, text as content).
      // assistant-ui puts user attachments on msg.attachments (not on content);
      // each attachment carries its own content parts from the adapter.
      const attachments: {
        type: string;
        name: string;
        contentType?: string;
        data?: string;
        text?: string;
      }[] = [];
      if (lastUserMsg && "attachments" in lastUserMsg) {
        const msgAttachments = (
          lastUserMsg as {
            attachments?: readonly {
              name: string;
              contentType?: string;
              content: readonly Record<string, unknown>[];
            }[];
          }
        ).attachments;
        for (const att of msgAttachments ?? []) {
          for (const part of att.content) {
            if (part.type === "image" && typeof part.image === "string") {
              attachments.push({
                type: "image",
                name: att.name,
                contentType: att.contentType,
                data: part.image,
              });
            } else if (part.type === "file" && typeof part.data === "string") {
              attachments.push({
                type: "file",
                name: att.name,
                contentType:
                  att.contentType ??
                  (typeof part.mimeType === "string"
                    ? part.mimeType
                    : undefined),
                ...(part.data.startsWith("data:")
                  ? { data: part.data }
                  : { text: part.data }),
              });
            } else if (part.type === "text" && typeof part.text === "string") {
              attachments.push({
                type: "file",
                name: att.name,
                contentType: att.contentType,
                text: part.text,
              });
            }
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
            .map((p) => p.text.replace(/@\[([^\]|]+)\|[^\]]+\]/g, "@$1"))
            .join("\n"),
        }))
        .filter((m) => m.content.trim());

      // Signal that generation is starting
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("agentNative.chatRunning", {
            detail: { isRunning: true, tabId },
          }),
        );
      }

      const content: ContentPart[] = [];
      const toolCallCounter = { value: 0 };
      let runId: string | null = null;
      let lastSeq = -1;
      let currentMessageText = normalizeMentions(rawMessageText);
      let currentHistory: AdapterHistoryMessage[] = history;
      let includeAttachments = attachments.length > 0;
      let includeReferences = Boolean(runConfig?.custom?.references);

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        try {
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          if (tz) headers["x-user-timezone"] = tz;
        } catch {
          // Non-browser or Intl unavailable — tool calls will fall back to UTC.
        }

        const reconnectCurrentRun = async function* (): AsyncGenerator<
          ChatModelRunResult,
          boolean,
          unknown
        > {
          if (!runId || lastSeq < 0) return false;
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
                  if (threadId) updateActiveRunSeq(seq);
                },
                runId,
              );
              clearActiveRun();
              return true;
            } catch (reconnectErr: unknown) {
              if (
                reconnectErr instanceof Error &&
                reconnectErr.name === "AbortError"
              ) {
                clearActiveRun();
                return true;
              }
              if (reconnectErr instanceof AgentAutoContinueSignal) {
                return false;
              }
              await delay(1000, abortSignal);
            }
          }
          return false;
        };

        while (true) {
          try {
            runId = null;
            lastSeq = -1;
            const res = await fetch(apiUrl, {
              method: "POST",
              headers,
              body: JSON.stringify({
                message: currentMessageText,
                history: currentHistory,
                ...(threadId ? { threadId } : {}),
                ...(requestMode ? { mode: requestMode } : {}),
                ...(modelRef?.current ? { model: modelRef.current } : {}),
                ...(engineRef?.current ? { engine: engineRef.current } : {}),
                ...(effortRef?.current ? { effort: effortRef.current } : {}),
                ...(includeAttachments ? { attachments } : {}),
                ...(includeReferences && runConfig?.custom?.references
                  ? { references: runConfig.custom.references }
                  : {}),
              }),
              signal: abortSignal,
            });

            // Check for auth errors returned as 200 with JSON (common with middleware issues)
            const contentType = res.headers.get("content-type") || "";
            if (
              res.ok &&
              contentType.includes("application/json") &&
              !contentType.includes("text/event-stream")
            ) {
              try {
                const body = await res.text();
                const parsed = JSON.parse(body);
                if (parsed.error) {
                  throw new Error(parsed.error);
                }
              } catch (e) {
                if (
                  e instanceof Error &&
                  e.message !== "Unexpected end of JSON input"
                ) {
                  throw e;
                }
              }
            }

            if (!res.ok) {
              // 405 Method Not Allowed usually means the session is broken/expired
              // (e.g. a redirect to a login page that only accepts GET).
              if (res.status === 405) {
                if (typeof window !== "undefined") {
                  window.dispatchEvent(
                    new CustomEvent("agent-chat:auth-error", {
                      detail: { reason: "session-expired" },
                    }),
                  );
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
              }

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
                    window.dispatchEvent(
                      new Event("agent-chat:missing-api-key"),
                    );
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
                  errorText =
                    body.length > 200 ? body.slice(0, 200) + "..." : body;
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
              runId,
            );

            // Run completed normally — clear active run state
            clearActiveRun();
            return;
          } catch (err: unknown) {
            if (err instanceof Error && err.name === "AbortError") {
              // User-initiated abort (Stop button) — clear active run
              clearActiveRun();
              return;
            }

            if (err instanceof AgentAutoContinueSignal) {
              if (err.reason === "stream_ended") {
                const reconnected = yield* reconnectCurrentRun();
                if (reconnected) return;
              }
              const partialHistory = contentToContinuationHistory(content);
              currentHistory = [
                ...history,
                { role: "user", content: normalizeMentions(rawMessageText) },
                ...(partialHistory
                  ? [{ role: "assistant" as const, content: partialHistory }]
                  : []),
              ];
              currentMessageText = autoContinueMessage(err);
              includeAttachments = false;
              includeReferences = false;
              clearActiveRun();
              await delay(250, abortSignal);
              if (abortSignal.aborted) return;
              continue;
            }

            const errMsg =
              err instanceof Error ? err.message : "Something went wrong.";
            const isAuthError =
              errMsg.includes("Unauthorized") ||
              errMsg.includes("Not authenticated") ||
              errMsg.includes("401") ||
              errMsg.includes("403") ||
              errMsg.includes("405");

            // Don't try to reconnect for auth/client errors — show error directly
            if (isAuthError) {
              if (typeof window !== "undefined") {
                window.dispatchEvent(new Event("agent-chat:auth-error"));
              }
              content.push({ type: "text", text: "" });
              yield {
                content: [...content],
                status: {
                  type: "incomplete" as const,
                  reason: "error" as const,
                },
              };
              clearActiveRun();
              return;
            }

            // Connection lost — try to reconnect to the run
            const reconnected = yield* reconnectCurrentRun();
            if (reconnected) return;

            // Reconnect failed or not possible — keep going from the partial
            // streamed content instead of surfacing a transient transport error.
            if (content.length > 0) {
              const partialHistory = contentToContinuationHistory(content);
              currentHistory = [
                ...history,
                { role: "user", content: normalizeMentions(rawMessageText) },
                ...(partialHistory
                  ? [{ role: "assistant" as const, content: partialHistory }]
                  : []),
              ];
              currentMessageText = autoContinueMessage(
                new AgentAutoContinueSignal({ reason: "stream_ended" }),
              );
              includeAttachments = false;
              includeReferences = false;
              clearActiveRun();
              await delay(250, abortSignal);
              if (abortSignal.aborted) return;
              continue;
            }

            // No partial work exists, so this is still a real startup failure.
            const normalized = normalizeChatError(errMsg);
            const runError = {
              message: normalized.message,
              ...(normalized.details ? { details: normalized.details } : {}),
              errorCode: "connection_error",
              recoverable: true,
              ...(runId ? { runId } : {}),
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
              text: errMsg.startsWith("Server error:")
                ? errMsg
                : `Something went wrong: ${normalized.message}`,
            });
            yield {
              content: [...content],
              status: {
                type: "incomplete" as const,
                reason: "error" as const,
              },
              metadata: { custom: { ...(runId ? { runId } : {}), runError } },
            };
            return;
          }
        }
      } finally {
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("agentNative.chatRunning", {
              detail: { isRunning: false, tabId },
            }),
          );
        }
      }
    },
  };
}
