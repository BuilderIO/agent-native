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
  ScriptTool,
  AgentChatRequest,
  AgentChatEvent,
  AgentChatReference,
} from "./types.js";
import {
  startRun,
  subscribeToRun,
  getActiveRunForThread,
  getRun,
  abortRun,
} from "./run-manager.js";
import type { ActiveRun } from "./run-manager.js";

export interface ScriptEntry {
  tool: ScriptTool;
  run: (args: Record<string, string>) => Promise<string>;
}

export interface ProductionAgentOptions {
  scripts: Record<string, ScriptEntry>;
  /** Static system prompt string, or async function called per-request with the H3 event */
  systemPrompt: string | ((event: any) => string | Promise<string>);
  /** Falls back to ANTHROPIC_API_KEY env var */
  apiKey?: string;
  /** Model to use. Default: claude-sonnet-4-6 */
  model?: string;
  /** Called when a run completes (for server-side thread persistence) */
  onRunComplete?: (run: ActiveRun, threadId: string | undefined) => void;
}

const MAX_ITERATIONS = 40;

function generateRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
async function runAgentLoop(opts: {
  client: Anthropic;
  model: string;
  systemPrompt: string;
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  scripts: Record<string, ScriptEntry>;
  send: (event: AgentChatEvent) => void;
  signal: AbortSignal;
}): Promise<void> {
  const {
    client,
    model,
    systemPrompt,
    tools,
    messages,
    scripts,
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

    const apiStream = client.messages.stream(
      {
        model,
        max_tokens: 4096,
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
    const assistantContent = finalMessage.content;

    messages.push({ role: "assistant", content: assistantContent });

    const toolUseBlocks = assistantContent.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      const scriptEntry = scripts[toolUse.name];
      if (!scriptEntry) {
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
        result = await scriptEntry.run(toolUse.input as Record<string, string>);
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

  // Build Anthropic tool definitions from script registry
  const tools: Anthropic.Tool[] = Object.entries(options.scripts).map(
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

    const { message, history = [], references = [], threadId } = body;
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

    const messages: Anthropic.MessageParam[] = [
      ...history
        .filter((m) => m.content.trim())
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      { role: "user" as const, content: enrichedMessage },
    ];

    // Start agent loop in background via run-manager
    const runId = generateRunId();
    startRun(
      runId,
      threadId ?? runId,
      (send, signal) =>
        runAgentLoop({
          client,
          model,
          systemPrompt,
          tools,
          messages,
          scripts: options.scripts,
          send,
          signal,
        }),
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

export { getActiveRunForThread, getRun, abortRun, subscribeToRun };
