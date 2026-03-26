import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";

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

/**
 * Creates a ChatModelAdapter that connects to the agent-native
 * `/api/agent-chat` SSE endpoint.
 */
export function createAgentChatAdapter(options?: {
  apiUrl?: string;
  tabId?: string;
}): ChatModelAdapter {
  const apiUrl = options?.apiUrl ?? "/api/agent-chat";
  const tabId = options?.tabId;

  return {
    async *run({ messages, abortSignal }) {
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

      // Accumulate content parts across the entire agentic loop
      const content: ContentPart[] = [];

      let toolCallCounter = 0;

      try {
        const res = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: messageText, history }),
          signal: abortSignal,
        });

        if (!res.ok) {
          // Try to read error body for better messages
          let errorText = `Server error: ${res.status}`;
          try {
            const body = await res.text();
            if (
              body.includes("apiKey") ||
              body.includes("authToken") ||
              body.includes("ANTHROPIC_API_KEY") ||
              body.includes("authentication")
            ) {
              // Show inline setup UI instead of raw error
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

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

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

            let ev: {
              type: string;
              text?: string;
              tool?: string;
              input?: Record<string, string>;
              result?: string;
              error?: string;
            };
            try {
              ev = JSON.parse(raw);
            } catch {
              continue;
            }

            if (ev.type === "text") {
              // Find or create a text part to append to
              const lastPart = content[content.length - 1];
              if (lastPart && lastPart.type === "text") {
                lastPart.text += ev.text ?? "";
              } else {
                content.push({ type: "text", text: ev.text ?? "" });
              }
              yield { content: [...content] } as ChatModelRunResult;
            } else if (ev.type === "tool_start") {
              const toolCallId = `tc_${++toolCallCounter}`;
              const args = (ev.input ?? {}) as Record<string, string>;
              content.push({
                type: "tool-call",
                toolCallId,
                toolName: ev.tool ?? "unknown",
                argsText: JSON.stringify(args),
                args,
              });
              yield { content: [...content] } as ChatModelRunResult;
            } else if (ev.type === "tool_done") {
              // Find the last tool call with the matching name and update its result
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
              yield { content: [...content] } as ChatModelRunResult;
            } else if (ev.type === "missing_api_key") {
              // Dispatch event for the UI to show inline setup
              if (typeof window !== "undefined") {
                window.dispatchEvent(new Event("agent-chat:missing-api-key"));
              }
              content.push({
                type: "text",
                text: "",
              });
              yield {
                content: [...content],
                status: {
                  type: "incomplete" as const,
                  reason: "error" as const,
                },
              } as ChatModelRunResult;
              return;
            } else if (ev.type === "error") {
              // Check if this is an auth-related error from the SDK
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
                yield {
                  content: [...content],
                  status: {
                    type: "incomplete" as const,
                    reason: "error" as const,
                  },
                } as ChatModelRunResult;
                return;
              }
              // Add error as text content
              content.push({
                type: "text",
                text: `Error: ${errMsg}`,
              });
              yield {
                content: [...content],
                status: {
                  type: "incomplete" as const,
                  reason: "error" as const,
                },
              } as ChatModelRunResult;
              return;
            } else if (ev.type === "done") {
              // Final yield
              yield { content: [...content] } as ChatModelRunResult;
              return;
            }
          }
        }

        // Stream ended without explicit done event
        if (content.length > 0) {
          yield { content: [...content] };
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
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
