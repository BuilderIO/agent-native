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
const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_STARTUP_RECOVERY_ATTEMPTS = 8;
const MAX_STALLED_TRANSIENT_CONTINUATIONS = 8;
const MAX_TOTAL_TRANSIENT_CONTINUATIONS = 32;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 8_000;

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

function combineContinuationHistory(fragments: string[]): string {
  return truncateForContinuation(
    fragments.filter(Boolean).join("\n\n"),
    40_000,
  ).trim();
}

function visibleTransientContinuationContent(
  content: ContentPart[],
): ContentPart[] {
  return content.filter(
    (part) => part.type === "tool-call" && part.result !== undefined,
  );
}

function hasContinuationProgress(content: ContentPart[]): boolean {
  return content.some((part) =>
    part.type === "text"
      ? part.text.trim().length > 0
      : part.result !== undefined,
  );
}

function snapshotContent(content: ContentPart[]): ContentPart[] {
  return content.map((part) =>
    part.type === "text" ? { ...part } : { ...part, args: { ...part.args } },
  );
}

function autoContinueMessage(signal: AgentAutoContinueSignal): string {
  const reason =
    signal.reason === "loop_limit"
      ? "The previous run reached an internal step budget."
      : signal.reason === "no_progress"
        ? "The previous run stopped producing progress events while the connection stayed open."
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

function retryDelay(attempt: number, abortSignal: AbortSignal): Promise<void> {
  const base = Math.min(
    RETRY_MAX_DELAY_MS,
    RETRY_BASE_DELAY_MS * Math.pow(2, attempt),
  );
  const jitter = base * 0.2;
  const ms = Math.max(0, base + (Math.random() * 2 - 1) * jitter);
  return delay(ms, abortSignal);
}

function isRetryableStartupError(message: string): boolean {
  const msg = message.toLowerCase();
  if (
    msg.includes("unauthorized") ||
    msg.includes("not authenticated") ||
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("404") ||
    msg.includes("405") ||
    msg.includes("missing api key") ||
    msg.includes("api key") ||
    msg.includes("context_length") ||
    msg.includes("input_too_long") ||
    msg.includes("too many tokens") ||
    msg.includes("prompt is too long") ||
    msg.includes("credits-limit") ||
    msg.includes("billing") ||
    msg.includes("permission")
  ) {
    return false;
  }
  return (
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("connection") ||
    msg.includes("reset") ||
    msg.includes("econnreset") ||
    msg.includes("socket") ||
    msg.includes("timeout") ||
    msg.includes("gateway timeout") ||
    msg.includes("inactivity timeout") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("server error: 408") ||
    msg.includes("server error: 429") ||
    msg.includes("server error: 500") ||
    msg.includes("server error: 502") ||
    msg.includes("server error: 503") ||
    msg.includes("server error: 504") ||
    msg.includes("429") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("529")
  );
}

function isAuthErrorMessage(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("authentication required") ||
    msg.includes("unauthorized") ||
    msg.includes("not authenticated") ||
    msg.includes("session expired") ||
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("405")
  );
}

function isMissingCredentialMessage(message: string): boolean {
  const msg = message.toLowerCase();
  return (
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
      const userMessageText =
        rawMessageText.trim() || attachments.length === 0
          ? rawMessageText
          : "Use the attached context.";

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
      let currentMessageText = normalizeMentions(userMessageText);
      let currentHistory: AdapterHistoryMessage[] = history;
      let includeAttachments = attachments.length > 0;
      let includeReferences = Boolean(runConfig?.custom?.references);
      let startupRecoveryAttempts = 0;
      let stalledTransientContinuationAttempts = 0;
      let totalTransientContinuationAttempts = 0;
      const continuationHistoryFragments: string[] = [];
      let visibleContinuationPrefix: ContentPart[] = [];
      let lastAutoContinueReason: string | null = null;
      const attemptedRunIds: string[] = [];

      const connectionRecoveryDetails = (): string => {
        return [
          lastAutoContinueReason
            ? `last_auto_continue_reason: ${lastAutoContinueReason}`
            : "",
          `stalled_transient_continuations: ${stalledTransientContinuationAttempts}`,
          `total_transient_continuations: ${totalTransientContinuationAttempts}`,
          attemptedRunIds.length > 0
            ? `attempted_runs: ${attemptedRunIds.join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n");
      };

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
          if (!runId) return false;
          for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
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
                if (reconnectErr.reason === "no_progress") {
                  throw reconnectErr;
                }
                return false;
              }
              await retryDelay(attempt, abortSignal);
            }
          }
          return false;
        };

        const abortCurrentRun = async (): Promise<void> => {
          if (!runId) return;
          try {
            await fetch(`${apiUrl}/runs/${encodeURIComponent(runId)}/abort`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reason: "no_progress" }),
              signal: abortSignal,
            });
          } catch {
            // Best effort. The follow-up POST will still reconnect or 409 if
            // the producer is alive and cannot be aborted cross-isolate.
          } finally {
            clearActiveRun();
          }
        };

        const reconnectActiveRunForThread = async function* (): AsyncGenerator<
          ChatModelRunResult,
          boolean,
          unknown
        > {
          if (!threadId) return false;
          for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
            try {
              const activeRes = await fetch(
                `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId)}`,
                { signal: abortSignal },
              );
              if (!activeRes.ok) return false;
              const active = await activeRes.json();
              if (active?.active && active.runId) {
                const activeRunId = String(active.runId);
                runId = activeRunId;
                if (!attemptedRunIds.includes(activeRunId)) {
                  attemptedRunIds.push(activeRunId);
                }
                lastSeq = -1;
                setActiveRun({ threadId, runId: activeRunId, lastSeq: -1 });
                const reconnected = yield* reconnectCurrentRun();
                if (reconnected) return true;
              }
              return false;
            } catch (activeErr: unknown) {
              if (
                activeErr instanceof Error &&
                activeErr.name === "AbortError"
              ) {
                clearActiveRun();
                return true;
              }
              await retryDelay(attempt, abortSignal);
            }
          }
          return false;
        };

        const visibleContentForContinuation = (): ContentPart[] => {
          if (
            visibleContinuationPrefix.length > 0 &&
            visibleContinuationPrefix.every(
              (part, index) => content[index] === part,
            )
          ) {
            return content.slice(visibleContinuationPrefix.length);
          }
          return content;
        };

        const prepareAutoContinuation = (
          signal: AgentAutoContinueSignal,
        ): { ok: boolean; resetVisibleContent: boolean } => {
          lastAutoContinueReason = signal.reason;
          const isTransient = signal.reason !== "loop_limit";
          const visibleContent = visibleContentForContinuation();
          const currentPartialHistory =
            contentToContinuationHistory(visibleContent);
          const madeProgress = hasContinuationProgress(visibleContent);

          if (signal.reason === "loop_limit") {
            stalledTransientContinuationAttempts = 0;
          } else {
            totalTransientContinuationAttempts += 1;
            stalledTransientContinuationAttempts = madeProgress
              ? 0
              : stalledTransientContinuationAttempts + 1;
            if (
              stalledTransientContinuationAttempts >
                MAX_STALLED_TRANSIENT_CONTINUATIONS ||
              totalTransientContinuationAttempts >
                MAX_TOTAL_TRANSIENT_CONTINUATIONS
            ) {
              return { ok: false, resetVisibleContent: false };
            }
          }

          if (isTransient && currentPartialHistory) {
            continuationHistoryFragments.push(currentPartialHistory);
          }
          const partialHistory = combineContinuationHistory(
            isTransient
              ? continuationHistoryFragments
              : [...continuationHistoryFragments, currentPartialHistory],
          );
          currentHistory = [
            ...history,
            { role: "user", content: normalizeMentions(userMessageText) },
            ...(partialHistory
              ? [{ role: "assistant" as const, content: partialHistory }]
              : []),
          ];
          currentMessageText = autoContinueMessage(signal);
          includeAttachments = false;
          includeReferences = false;
          startupRecoveryAttempts = 0;
          clearActiveRun();
          if (!isTransient) {
            return { ok: true, resetVisibleContent: false };
          }

          const preservedContent = visibleTransientContinuationContent(content);
          content.splice(0, content.length, ...preservedContent);
          visibleContinuationPrefix = preservedContent;
          return { ok: true, resetVisibleContent: true };
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
              if (res.status === 409) {
                let handledConflict = false;
                try {
                  const body = await res.json();
                  if (body?.activeRunId) {
                    handledConflict = true;
                    runId = String(body.activeRunId);
                    if (!attemptedRunIds.includes(runId)) {
                      attemptedRunIds.push(runId);
                    }
                    lastSeq = -1;
                    if (threadId) {
                      setActiveRun({ threadId, runId, lastSeq: -1 });
                    }
                    const reconnected = yield* reconnectCurrentRun();
                    if (reconnected) return;
                  }
                } catch {
                  // Fall through to the generic response handling below.
                }
                if (handledConflict) {
                  await delay(1000, abortSignal);
                  if (abortSignal.aborted) return;
                  continue;
                }
              }

              if (res.status === 401 || res.status === 403) {
                if (typeof window !== "undefined") {
                  window.dispatchEvent(
                    new CustomEvent("agent-chat:auth-error", {
                      detail: { reason: "auth-required" },
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
                if (isAuthErrorMessage(body)) {
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(
                      new CustomEvent("agent-chat:auth-error", {
                        detail: { reason: "auth-required" },
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
                if (isMissingCredentialMessage(body)) {
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
            if (runId && !attemptedRunIds.includes(runId)) {
              attemptedRunIds.push(runId);
            }
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
              if (err.reason === "no_progress") {
                await abortCurrentRun();
              }
              if (err.reason === "stream_ended") {
                const reconnected = yield* reconnectCurrentRun();
                if (reconnected) return;
                const activeReconnected = yield* reconnectActiveRunForThread();
                if (activeReconnected) return;
              }
              const continuation = prepareAutoContinuation(err);
              if (!continuation.ok) {
                const message =
                  "The agent connection kept failing after several automatic recovery attempts.";
                const runError = {
                  message,
                  details: connectionRecoveryDetails(),
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
                  text: `Something went wrong: ${message}`,
                });
                yield {
                  content: [...content],
                  status: {
                    type: "incomplete" as const,
                    reason: "error" as const,
                  },
                  metadata: {
                    custom: { ...(runId ? { runId } : {}), runError },
                  },
                };
                clearActiveRun();
                return;
              }
              if (continuation.resetVisibleContent) {
                yield {
                  content: snapshotContent(content),
                } as ChatModelRunResult;
              }
              await delay(250, abortSignal);
              if (abortSignal.aborted) return;
              continue;
            }

            const errMsg =
              err instanceof Error ? err.message : "Something went wrong.";
            const isAuthError = isAuthErrorMessage(errMsg);

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

            if (isMissingCredentialMessage(errMsg)) {
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
              };
              clearActiveRun();
              return;
            }

            // Connection lost — try to reconnect to the run
            const reconnected = yield* reconnectCurrentRun();
            if (reconnected) return;
            const activeReconnected = yield* reconnectActiveRunForThread();
            if (activeReconnected) return;

            // Reconnect failed or not possible — keep going from the partial
            // streamed content instead of surfacing a transient transport error.
            if (content.length > 0) {
              const continuation = prepareAutoContinuation(
                new AgentAutoContinueSignal({ reason: "stream_ended" }),
              );
              if (!continuation.ok) {
                const message =
                  "The agent connection kept failing after several automatic recovery attempts.";
                const runError = {
                  message,
                  details: connectionRecoveryDetails(),
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
                  text: `Something went wrong: ${message}`,
                });
                yield {
                  content: [...content],
                  status: {
                    type: "incomplete" as const,
                    reason: "error" as const,
                  },
                  metadata: {
                    custom: { ...(runId ? { runId } : {}), runError },
                  },
                };
                clearActiveRun();
                return;
              }
              if (continuation.resetVisibleContent) {
                yield {
                  content: snapshotContent(content),
                } as ChatModelRunResult;
              }
              await delay(250, abortSignal);
              if (abortSignal.aborted) return;
              continue;
            }

            if (
              isRetryableStartupError(errMsg) &&
              startupRecoveryAttempts < MAX_STARTUP_RECOVERY_ATTEMPTS
            ) {
              await retryDelay(startupRecoveryAttempts++, abortSignal);
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
