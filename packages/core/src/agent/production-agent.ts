import Anthropic from "@anthropic-ai/sdk";
import {
  defineEventHandler,
  readBody,
  setResponseHeader,
  setResponseStatus,
  getMethod,
} from "h3";
import type { EventHandler as H3EventHandler } from "h3";
import type {
  ActionTool,
  AgentChatRequest,
  AgentChatEvent,
  AgentChatReference,
} from "./types.js";
import { readAppState } from "../application-state/script-helpers.js";
import {
  startRun,
  subscribeToRun,
  getActiveRunForThread,
  getActiveRunForThreadAsync,
  getRun,
  abortRun,
} from "./run-manager.js";
import type { ActiveRun } from "./run-manager.js";

/** Context passed to action run() for emitting intermediate events */
export interface ActionRunContext {
  /** Emit an SSE event to the client (e.g., agent_call_text for streaming) */
  send: (event: AgentChatEvent) => void;
}

export interface ActionEntry {
  tool: ActionTool;
  run: (
    args: Record<string, string>,
    context?: ActionRunContext,
  ) => Promise<string>;
}

/** @deprecated Use `ActionEntry` instead */
export type ScriptEntry = ActionEntry;

export interface ProductionAgentOptions {
  /** Action entries for the agent. Use `actions` (preferred) or `scripts` (deprecated alias). */
  actions?: Record<string, ActionEntry>;
  /** @deprecated Use `actions` instead */
  scripts?: Record<string, ActionEntry>;
  /** Static system prompt string, or async function called per-request with the H3 event */
  systemPrompt: string | ((event: any) => string | Promise<string>);
  /** Falls back to ANTHROPIC_API_KEY env var */
  apiKey?: string;
  /** Model to use. Default: claude-sonnet-4-6 */
  model?: string;
  /** Called when a run completes (for server-side thread persistence) */
  onRunComplete?: (run: ActiveRun, threadId: string | undefined) => void;
  /** Called when a run starts, with the send function for emitting events and the threadId */
  onRunStart?: (
    send: (event: AgentChatEvent) => void,
    threadId: string,
  ) => void;
}

const MAX_ITERATIONS = 40;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

function generateRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Check if an error is transient and should be retried */
function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("overloaded") ||
    msg.includes("rate_limit") ||
    msg.includes("529") ||
    msg.includes("503") ||
    msg.includes("too many requests")
  );
}

/** Wait with exponential backoff, respecting abort signal */
function retryDelay(attempt: number, signal: AbortSignal): Promise<void> {
  const ms = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

/** Build enriched message with file/skill/mention references */
function enrichMessage(
  message: string,
  references: AgentChatReference[],
): string {
  if (references.length === 0) return message;

  const fileRefs = references.filter((r) => r.type === "file");
  const skillRefs = references.filter((r) => r.type === "skill");
  const mentionRefs = references.filter((r) => r.type === "mention");

  const parts: string[] = [];
  if (fileRefs.length > 0) {
    parts.push(
      "Referenced files:\n" +
        fileRefs
          .map(
            (r) => `- ${r.path}${r.source === "resource" ? " (resource)" : ""}`,
          )
          .join("\n"),
    );
  }
  if (skillRefs.length > 0) {
    parts.push(
      "Applied skills:\n" +
        skillRefs
          .map(
            (r) =>
              `- ${r.name} (${r.path})${r.source === "resource" ? " — read with resource-read" : " — read with read-file"}`,
          )
          .join("\n"),
    );
  }
  if (mentionRefs.length > 0) {
    parts.push(
      "Referenced items:\n" +
        mentionRefs
          .map(
            (r) =>
              `- [${r.refType || "item"}] ${r.name}${r.refId ? ` (id: ${r.refId})` : ""}${r.path ? ` (path: ${r.path})` : ""}`,
          )
          .join("\n"),
    );
  }

  return `${parts.join("\n\n")}\n\n${message}`;
}

/**
 * The core agent loop — calls Claude iteratively until no more tool calls.
 * Decoupled from HTTP transport so it can run in the background.
 */
export async function runAgentLoop(opts: {
  client: Anthropic;
  model: string;
  systemPrompt: string;
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  actions: Record<string, ActionEntry>;
  send: (event: AgentChatEvent) => void;
  signal: AbortSignal;
}): Promise<void> {
  const {
    client,
    model,
    systemPrompt,
    tools,
    messages,
    actions,
    send,
    signal,
  } = opts;

  let iterations = 0;
  while (true) {
    if (signal.aborted) break;
    if (++iterations > MAX_ITERATIONS) {
      send({ type: "loop_limit" });
      break;
    }

    let assistantContent: Anthropic.ContentBlock[] | undefined;
    for (let retry = 0; ; retry++) {
      try {
        const apiStream = client.messages.stream(
          {
            model,
            max_tokens: 16384,
            system: systemPrompt,
            tools,
            messages,
          },
          { signal },
        );

        for await (const chunk of apiStream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            send({ type: "text", text: chunk.delta.text });
          }
        }

        const finalMessage = await apiStream.finalMessage();
        assistantContent = finalMessage.content;
        break;
      } catch (err: unknown) {
        if (signal.aborted) throw err;
        if (retry < MAX_RETRIES && isRetryableError(err)) {
          // Clear partial text from the failed attempt so the retry
          // doesn't produce garbled duplicate output
          send({ type: "clear" });
          send({
            type: "text",
            text: `*Retrying in ${(RETRY_BASE_DELAY_MS * Math.pow(2, retry)) / 1000}s...*\n\n`,
          });
          await retryDelay(retry, signal);
          continue;
        }
        throw err;
      }
    }
    if (!assistantContent) break;

    messages.push({ role: "assistant", content: assistantContent });

    const toolUseBlocks = assistantContent.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      const actionEntry = actions[toolUse.name];
      if (!actionEntry) {
        const result = `Error: Unknown tool "${toolUse.name}"`;
        send({
          type: "tool_start",
          tool: toolUse.name,
          input: toolUse.input as Record<string, string>,
        });
        send({ type: "tool_done", tool: toolUse.name, result });
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result,
        });
        continue;
      }

      send({
        type: "tool_start",
        tool: toolUse.name,
        input: toolUse.input as Record<string, string>,
      });

      let result: string;
      try {
        result = await actionEntry.run(
          toolUse.input as Record<string, string>,
          { send },
        );
      } catch (err: any) {
        result = `Error running ${toolUse.name}: ${err?.message ?? String(err)}`;
      }

      send({ type: "tool_done", tool: toolUse.name, result });
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  send({ type: "done" });
}

export function createProductionAgentHandler(
  options: ProductionAgentOptions,
): H3EventHandler {
  const model = options.model ?? "claude-sonnet-4-6";

  // Resolve actions — prefer `actions`, fall back to deprecated `scripts`
  const resolvedActions = options.actions ?? options.scripts ?? {};

  // Build Anthropic tool definitions from action registry
  const tools: Anthropic.Tool[] = Object.entries(resolvedActions).map(
    ([name, entry]) => ({
      name,
      description: entry.tool.description,
      input_schema: entry.tool.parameters as Anthropic.Tool["input_schema"],
    }),
  );

  return defineEventHandler(async (event) => {
    if (getMethod(event) !== "POST") {
      setResponseStatus(event, 405);
      return { error: "Method not allowed" };
    }

    let body: AgentChatRequest;
    try {
      body = await readBody(event);
    } catch {
      setResponseStatus(event, 400);
      return { error: "Invalid request body" };
    }

    const {
      message,
      history = [],
      references = [],
      threadId,
      attachments,
    } = body;
    if (!message) {
      setResponseStatus(event, 400);
      return { error: "message is required" };
    }

    // Check for API key before starting a run
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      setResponseHeader(event, "Content-Type", "text/event-stream");
      setResponseHeader(event, "Cache-Control", "no-cache");
      setResponseHeader(event, "Connection", "keep-alive");
      const encoder = new TextEncoder();
      return new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "missing_api_key" })}\n\n`,
            ),
          );
          controller.close();
        },
      });
    }

    // Resolve system prompt before starting the run
    let systemPrompt: string;
    try {
      systemPrompt =
        typeof options.systemPrompt === "function"
          ? await options.systemPrompt(event)
          : options.systemPrompt;
    } catch (err: any) {
      setResponseHeader(event, "Content-Type", "text/event-stream");
      setResponseHeader(event, "Cache-Control", "no-cache");
      const encoder = new TextEncoder();
      return new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", error: `Failed to load system prompt: ${err?.message ?? String(err)}` })}\n\n`,
            ),
          );
          controller.close();
        },
      });
    }

    const client = new Anthropic({ apiKey });
    const enrichedMessage = enrichMessage(message, references);

    // Auto-inject current screen context so the agent always knows what
    // the user is looking at without needing to call view-screen first.
    let screenContext = "";
    try {
      const navigation = await readAppState("navigation");
      if (navigation) {
        screenContext = `\n\n<current-screen>\n${JSON.stringify(navigation, null, 2)}\n</current-screen>`;
      }
    } catch {
      // DB not ready or no navigation state — skip silently
    }

    // Pre-compute agent references for A2A resolution inside the run
    const agentRefs = references.filter((r) => r.type === "agent");

    // Build user content: text + any image attachments
    const userContent: Anthropic.ContentBlockParam[] = [];
    if (attachments?.length) {
      for (const att of attachments) {
        if (att.type === "image" && att.data) {
          const match = att.data.match(/^data:(image\/[^;]+);base64,(.+)$/);
          if (match) {
            userContent.push({
              type: "image",
              source: {
                type: "base64",
                media_type: match[1] as
                  | "image/jpeg"
                  | "image/png"
                  | "image/gif"
                  | "image/webp",
                data: match[2],
              },
            });
          }
        }
      }
    }
    userContent.push({
      type: "text",
      text: enrichedMessage + screenContext,
    });

    const messages: Anthropic.MessageParam[] = [
      ...history
        .filter((m) => m.content.trim())
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      { role: "user" as const, content: userContent },
    ];

    // Start agent loop in background via run-manager
    const runId = generateRunId();
    startRun(
      runId,
      threadId ?? runId,
      async (send, signal) => {
        // Notify listeners that a run has started (used by agent teams)
        if (options.onRunStart) {
          options.onRunStart(send, threadId ?? runId);
        }

        // Resolve agent @-mentions via A2A calls (inside run so we can emit SSE events)
        if (agentRefs.length > 0) {
          const { A2AClient, callAgent } = await import("../a2a/client.js");
          const agentResponses: string[] = [];

          const results = await Promise.allSettled(
            agentRefs.map(async (ref) => {
              send({
                type: "agent_call",
                agent: ref.name,
                status: "start",
              });
              try {
                // Try streaming first — shows progressive text in the UI
                const client = new A2AClient(ref.path);
                const callerEmail = process.env.AGENT_USER_EMAIL;

                // Build A2A metadata with identity info
                const a2aMetadata: Record<string, unknown> = {};
                if (callerEmail) a2aMetadata.userEmail = callerEmail;
                // In prod, include Google token for verification
                if (process.env.NODE_ENV === "production" && callerEmail) {
                  try {
                    const { listOAuthAccountsByOwner } =
                      await import("../oauth-tokens/store.js");
                    const accounts = await listOAuthAccountsByOwner(
                      "google",
                      callerEmail,
                    );
                    const tokens = accounts[0]?.tokens;
                    if (tokens?.access_token) {
                      a2aMetadata.googleToken = tokens.access_token;
                    }
                  } catch {}
                }

                let responseText = "";
                let lastSentLength = 0;

                try {
                  for await (const task of client.stream(
                    {
                      role: "user",
                      parts: [{ type: "text", text: message }],
                    },
                    Object.keys(a2aMetadata).length > 0
                      ? { metadata: a2aMetadata }
                      : undefined,
                  )) {
                    const newText =
                      task.status?.message?.parts
                        ?.filter(
                          (p): p is { type: "text"; text: string } =>
                            p.type === "text",
                        )
                        ?.map((p) => p.text)
                        ?.join("") ?? "";

                    if (newText.length > lastSentLength) {
                      send({
                        type: "agent_call_text",
                        agent: ref.name,
                        text: newText.slice(lastSentLength),
                      });
                      lastSentLength = newText.length;
                    }
                    responseText = newText;
                  }
                } catch {
                  // Streaming failed — fall back to blocking call
                  if (!responseText) {
                    responseText = await callAgent(ref.path, message);
                  }
                }

                send({
                  type: "agent_call",
                  agent: ref.name,
                  status: "done",
                });
                return `<agent-response name="${ref.name}" id="${ref.refId}">\n${responseText}\n</agent-response>`;
              } catch (err: any) {
                send({
                  type: "agent_call",
                  agent: ref.name,
                  status: "error",
                });
                return `<agent-response name="${ref.name}" id="${ref.refId}" error="true">\nFailed to reach ${ref.name}: ${err?.message}\n</agent-response>`;
              }
            }),
          );

          for (const result of results) {
            if (result.status === "fulfilled") {
              agentResponses.push(result.value);
            }
          }

          if (agentResponses.length > 0) {
            const agentContext =
              "Responses from other agents:\n\n" + agentResponses.join("\n\n");
            // Prepend agent responses to the last user message's text content
            const lastMsg = messages[messages.length - 1];
            if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
              const textBlock = lastMsg.content.find(
                (b): b is Anthropic.TextBlockParam => b.type === "text",
              );
              if (textBlock) {
                textBlock.text = agentContext + "\n\n" + textBlock.text;
              }
            }
          }
        }

        return runAgentLoop({
          client,
          model,
          systemPrompt,
          tools,
          messages,
          actions: resolvedActions,
          send,
          signal,
        });
      },
      options.onRunComplete
        ? (run) => options.onRunComplete!(run, threadId)
        : undefined,
    );

    // Subscribe to the run and stream events to the client
    const stream = subscribeToRun(runId, 0);
    if (!stream) {
      setResponseStatus(event, 500);
      return { error: "Failed to start agent run" };
    }

    setResponseHeader(event, "Content-Type", "text/event-stream");
    setResponseHeader(event, "Cache-Control", "no-cache");
    setResponseHeader(event, "Connection", "keep-alive");
    setResponseHeader(event, "X-Run-Id", runId);

    return stream;
  });
}

export {
  getActiveRunForThread,
  getActiveRunForThreadAsync,
  getRun,
  abortRun,
  subscribeToRun,
};
