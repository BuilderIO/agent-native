import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";
import {
  setActiveRun,
  updateActiveRunSeq,
  clearActiveRun,
} from "./active-run-state.js";
import { type ContentPart, readSSEStream } from "./sse-event-processor.js";
import { agentNativePath } from "./api-path.js";

/**
 * Instruction prefixed to the outgoing user message when the composer's
 * exec mode is "plan". Lives in the request body only — not in the
 * displayed chat history — so the user's bubble stays clean while the
 * LLM still sees the planning constraint on every plan-mode turn.
 */
export const PLAN_MODE_INSTRUCTION =
  `PLAN MODE ACTIVE: Before making any changes, you MUST:\n` +
  `1. Explore the codebase to understand what's needed\n` +
  `2. Write a plan to \`.builder/plans/YYYY-MM-DD-<topic>.md\`\n` +
  `3. Present your approach clearly and wait for the user's explicit approval\n` +
  `Do NOT edit any files, run any scripts, or make any changes until the user says to proceed.`;

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
  execModeRef?: { current: "build" | "plan" | undefined };
}): ChatModelAdapter {
  const apiUrl =
    options?.apiUrl ?? agentNativePath("/_agent-native/agent-chat");
  const tabId = options?.tabId;
  const threadId = options?.threadId;
  const modelRef = options?.modelRef;
  const engineRef = options?.engineRef;
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

      // Prepend the plan-mode instruction to the LLM-bound message when the
      // composer's exec mode is "plan". The chat UI keeps the original text
      // (rendered from `lastUserMsg.content`), so the user's bubble stays
      // clean — only the request body carries the prefix.
      const messageText =
        execModeRef?.current === "plan"
          ? `${PLAN_MODE_INSTRUCTION}\n\n${rawMessageText}`
          : rawMessageText;

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
                text: part.data,
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
        const res = await fetch(apiUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            message: messageText.replace(/@\[([^\]|]+)\|[^\]]+\]/g, "@$1"),
            history,
            ...(threadId ? { threadId } : {}),
            ...(modelRef?.current ? { model: modelRef.current } : {}),
            ...(engineRef?.current ? { engine: engineRef.current } : {}),
            ...(attachments.length > 0 ? { attachments } : {}),
            ...(runConfig?.custom?.references
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
          runId,
        );

        // Run completed normally — clear active run state
        clearActiveRun();
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          // User-initiated abort (Stop button) — clear active run
          clearActiveRun();
          return;
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
                runId,
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

        // Reconnect failed or not possible — show error with details
        content.push({
          type: "text",
          text: errMsg.startsWith("Server error:")
            ? errMsg
            : `Something went wrong: ${errMsg}`,
        });
        yield {
          content: [...content],
          status: {
            type: "incomplete" as const,
            reason: "error" as const,
          },
          ...(runId ? { metadata: { custom: { runId } } } : {}),
        };
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
