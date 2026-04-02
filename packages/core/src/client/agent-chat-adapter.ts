import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";
import {
  setActiveRun,
  updateActiveRunSeq,
  clearActiveRun,
} from "./active-run-state.js";
import { type ContentPart, readSSEStream } from "./sse-event-processor.js";

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
