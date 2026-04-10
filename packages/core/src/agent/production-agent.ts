import {
  defineEventHandler,
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
import type {
  AgentEngine,
  EngineTool,
  EngineMessage,
  EngineContentPart,
} from "./engine/types.js";
import { resolveEngine, registerBuiltinEngines } from "./engine/index.js";
import { ASSISTANT_CONTENT_KEY } from "./engine/anthropic-engine.js";
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
import { readBody } from "../server/h3-helpers.js";

// Register built-in engines on first import
registerBuiltinEngines();

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
  ) => Promise<any>;
  /** HTTP exposure config. `false` = agent-only. Omitted = auto-inferred from name. */
  http?: import("../action.js").ActionHttpConfig | false;
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
  /** Falls back to ANTHROPIC_API_KEY env var. Ignored when `engine` is provided. */
  apiKey?: string;
  /** Agent engine to use. Defaults to the "anthropic" engine. */
  engine?:
    | AgentEngine
    | string
    | { name: string; config: Record<string, unknown> };
  /** Model to use. Default: claude-sonnet-4-6 */
  model?: string;
  /** Provider-specific options passed through to the engine */
  providerOptions?: EngineMessage extends never ? never : any;
  /** Called when a run completes (for server-side thread persistence) */
  onRunComplete?: (run: ActiveRun, threadId: string | undefined) => void;
  /** Called when a run starts, with the send function for emitting events and the threadId */
  onRunStart?: (
    send: (event: AgentChatEvent) => void,
    threadId: string,
  ) => void;
  /** Resolve the owner email from the H3 event (for usage tracking) */
  resolveOwnerEmail?: (event: any) => string | Promise<string>;
  /** Enable per-user usage limit checking and token tracking */
  trackUsage?: boolean;
  /** Usage limit in cents (default: 100 = $1.00) */
  usageLimitCents?: number;
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

/** Accumulated token usage from an agent loop run */
export interface AgentLoopUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
}

/**
 * Convert ActionEntry registry to EngineTool array.
 */
export function actionsToEngineTools(
  actions: Record<string, ActionEntry>,
): EngineTool[] {
  return Object.entries(actions).map(([name, entry]) => ({
    name,
    description: entry.tool.description,
    inputSchema: (entry.tool.parameters ?? {
      type: "object",
      properties: {},
    }) as EngineTool["inputSchema"],
  }));
}

/**
 * The core agent loop — calls the engine iteratively until no more tool calls.
 * Decoupled from HTTP transport so it can run in the background.
 * Returns accumulated token usage for cost tracking.
 */
export async function runAgentLoop(opts: {
  engine: AgentEngine;
  model: string;
  systemPrompt: string;
  tools: EngineTool[];
  messages: EngineMessage[];
  actions: Record<string, ActionEntry>;
  send: (event: AgentChatEvent) => void;
  signal: AbortSignal;
  providerOptions?: any;
}): Promise<AgentLoopUsage> {
  const {
    engine,
    model,
    systemPrompt,
    tools,
    messages,
    actions,
    send,
    signal,
  } = opts;

  const usage: AgentLoopUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    model,
  };

  let iterations = 0;
  while (true) {
    if (signal.aborted) break;
    if (++iterations > MAX_ITERATIONS) {
      send({ type: "loop_limit" });
      break;
    }

    let assistantContent: EngineContentPart[] | undefined;
    let hasToolCalls = false;

    for (let retry = 0; ; retry++) {
      try {
        const streamOpts = {
          model,
          systemPrompt,
          messages,
          tools,
          abortSignal: signal,
          providerOptions: opts.providerOptions,
        };

        const eventStream = engine.stream(streamOpts);
        let thinkingBuffer = "";

        for await (const event of eventStream) {
          if (event.type === "text-delta") {
            send({ type: "text", text: event.text });
          } else if (event.type === "thinking-delta") {
            thinkingBuffer += event.text;
            // Thinking deltas are not forwarded to the SSE client yet —
            // we accumulate them. In a future iteration, we can surface
            // them as a collapsible "reasoning" section in the UI.
          } else if (event.type === "tool-call") {
            hasToolCalls = true;
          } else if (event.type === "usage") {
            usage.inputTokens += event.inputTokens;
            usage.outputTokens += event.outputTokens;
            usage.cacheReadTokens += event.cacheReadTokens ?? 0;
            usage.cacheWriteTokens += event.cacheWriteTokens ?? 0;
          } else if (event.type === "stop" && event.reason === "error") {
            throw new Error(event.error ?? "Engine stream error");
          }
        }

        // Retrieve the assistant content blocks stored by the engine.
        // AnthropicEngine sets streamOpts[ASSISTANT_CONTENT_KEY] after streaming.
        assistantContent = (streamOpts as any)[ASSISTANT_CONTENT_KEY];

        // If engine didn't populate assistant content (e.g. AI SDK engine),
        // rebuild it from the messages state we tracked via tool-call events.
        // The AI SDK engine stores it under AISDK_ASSISTANT_CONTENT_KEY.
        if (!assistantContent) {
          const { AISDK_ASSISTANT_CONTENT_KEY } =
            await import("./engine/ai-sdk-engine.js");
          assistantContent = (streamOpts as any)[AISDK_ASSISTANT_CONTENT_KEY];
        }

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

    if (!assistantContent) {
      // No content — done
      break;
    }

    messages.push({ role: "assistant", content: assistantContent });

    const toolCallParts = assistantContent.filter(
      (p): p is import("./engine/types.js").EngineToolCallPart =>
        p.type === "tool-call",
    );

    if (toolCallParts.length === 0) break;

    // Run all tool calls in parallel — engines often return multiple tool-call
    // blocks in one turn. Running them concurrently saves wall-clock time.
    const toolResultParts: EngineContentPart[] = await Promise.all(
      toolCallParts.map(async (toolCall) => {
        const actionEntry = actions[toolCall.name];
        if (!actionEntry) {
          const result = `Error: Unknown tool "${toolCall.name}"`;
          send({
            type: "tool_start",
            tool: toolCall.name,
            input: toolCall.input as Record<string, string>,
          });
          send({ type: "tool_done", tool: toolCall.name, result });
          return {
            type: "tool-result" as const,
            toolCallId: toolCall.id,
            content: result,
            isError: true,
          };
        }

        send({
          type: "tool_start",
          tool: toolCall.name,
          input: toolCall.input as Record<string, string>,
        });

        let result: string;
        let isError = false;
        try {
          const raw = await actionEntry.run(
            toolCall.input as Record<string, string>,
            { send },
          );
          result = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
        } catch (err: any) {
          result = `Error running ${toolCall.name}: ${err?.message ?? String(err)}`;
          isError = true;
        }

        send({ type: "tool_done", tool: toolCall.name, result });
        return {
          type: "tool-result" as const,
          toolCallId: toolCall.id,
          content: result,
          ...(isError ? { isError } : {}),
        };
      }),
    );

    messages.push({ role: "user", content: toolResultParts });
  }

  send({ type: "done" });
  return usage;
}

export function createProductionAgentHandler(
  options: ProductionAgentOptions,
): H3EventHandler {
  const model = options.model ?? "claude-sonnet-4-6";

  // Resolve actions — prefer `actions`, fall back to deprecated `scripts`
  const resolvedActions = options.actions ?? options.scripts ?? {};

  // Build engine tools from action registry
  const engineTools = actionsToEngineTools(resolvedActions);

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

    // Resolve engine (async — reads settings if needed)
    let engine: AgentEngine;
    try {
      engine = await resolveEngine({
        engineOption: options.engine,
        apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
        model,
      });
    } catch {
      engine = await resolveEngine({
        apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
      });
    }

    // Check for API key before starting a run (only for anthropic engine)
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (engine.name === "anthropic" && !apiKey) {
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

    // Check usage limit before starting a run (production hosted mode)
    if (options.trackUsage && options.resolveOwnerEmail) {
      try {
        const ownerEmail = await options.resolveOwnerEmail(event);
        if (ownerEmail && ownerEmail !== "local@localhost") {
          const { checkUsageLimit } = await import("../usage/store.js");
          const result = await checkUsageLimit(
            ownerEmail,
            options.usageLimitCents,
          );
          if (!result.allowed) {
            setResponseHeader(event, "Content-Type", "text/event-stream");
            setResponseHeader(event, "Cache-Control", "no-cache");
            setResponseHeader(event, "Connection", "keep-alive");
            const encoder = new TextEncoder();
            return new ReadableStream({
              start(controller) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "usage_limit_reached", usageCents: result.usageCents, limitCents: result.limitCents })}\n\n`,
                  ),
                );
                controller.close();
              },
            });
          }
        }
      } catch {
        // Usage check failed — allow the request to proceed
      }
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

    const enrichedMessage = enrichMessage(message, references);

    // Auto-inject current screen context so the agent always knows what
    // the user is looking at without needing to call view-screen first.
    let screenContext = "";
    try {
      const viewScreenAction = resolvedActions["view-screen"];
      if (viewScreenAction) {
        const result = await viewScreenAction.run({});
        if (result && result !== "(no output)") {
          screenContext = `\n\n<current-screen>\n${result}\n</current-screen>`;
        }
      } else {
        const navigation = await readAppState("navigation");
        if (navigation) {
          screenContext = `\n\n<current-screen>\n${JSON.stringify(navigation, null, 2)}\n</current-screen>`;
        }
      }
    } catch {
      // DB not ready or no navigation state — skip silently
    }

    // Pre-compute agent references for A2A resolution inside the run
    const agentRefs = references.filter((r) => r.type === "agent");

    // Build user content: text + any image attachments
    const userContent: EngineContentPart[] = [];
    if (attachments?.length) {
      for (const att of attachments) {
        if (att.type === "image" && att.data) {
          const match = att.data.match(/^data:(image\/[^;]+);base64,(.+)$/);
          if (match) {
            userContent.push({
              type: "image",
              data: match[2],
              mediaType: match[1] as
                | "image/jpeg"
                | "image/png"
                | "image/gif"
                | "image/webp",
            });
          }
        }
      }
    }
    userContent.push({
      type: "text",
      text: enrichedMessage + screenContext,
    });

    const messages: EngineMessage[] = [
      ...history
        .filter((m) => m.content.trim())
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: [{ type: "text" as const, text: m.content }],
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
                const a2aClient = new A2AClient(ref.path);
                const callerEmail = process.env.AGENT_USER_EMAIL;

                const a2aMetadata: Record<string, unknown> = {};
                if (callerEmail) a2aMetadata.userEmail = callerEmail;
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
                  for await (const task of a2aClient.stream(
                    {
                      role: "user",
                      parts: [
                        {
                          type: "text",
                          text: enrichedMessage + screenContext,
                        },
                      ],
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
                  if (!responseText) {
                    responseText = await callAgent(
                      ref.path,
                      enrichedMessage + screenContext,
                    );
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

          const agentResponses_local: string[] = [];
          for (const result of results) {
            if (result.status === "fulfilled") {
              agentResponses_local.push(result.value);
            }
          }

          if (agentResponses_local.length > 0) {
            const agentContext =
              "Responses from other agents:\n\n" +
              agentResponses_local.join("\n\n");
            const lastMsg = messages[messages.length - 1];
            if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
              const textPart = lastMsg.content.find(
                (p): p is import("./engine/types.js").EngineTextPart =>
                  p.type === "text",
              );
              if (textPart) {
                textPart.text = agentContext + "\n\n" + textPart.text;
              }
            }
          }
        }

        const loopUsage = await runAgentLoop({
          engine,
          model,
          systemPrompt,
          tools: engineTools,
          messages,
          actions: resolvedActions,
          send,
          signal,
          providerOptions: options.providerOptions,
        });

        // Record token usage for cost tracking (production hosted mode)
        if (options.trackUsage && options.resolveOwnerEmail) {
          try {
            const ownerEmail = await options.resolveOwnerEmail(event);
            if (
              ownerEmail &&
              ownerEmail !== "local@localhost" &&
              (loopUsage.inputTokens > 0 || loopUsage.outputTokens > 0)
            ) {
              const { recordUsage } = await import("../usage/store.js");
              await recordUsage(
                ownerEmail,
                loopUsage.inputTokens,
                loopUsage.outputTokens,
                loopUsage.model,
              );
            }
          } catch {
            // Usage recording failed — don't break the run
          }
        }
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
