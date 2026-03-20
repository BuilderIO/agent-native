import Anthropic from "@anthropic-ai/sdk";
import {
  defineEventHandler,
  readBody,
  setResponseHeader,
  setResponseStatus,
  getMethod,
} from "h3";
import type { EventHandler as H3EventHandler } from "h3";
import type { ScriptTool, AgentChatRequest, AgentChatEvent } from "./types.js";

export interface ScriptEntry {
  tool: ScriptTool;
  run: (args: Record<string, string>) => Promise<string>;
}

export interface ProductionAgentOptions {
  scripts: Record<string, ScriptEntry>;
  systemPrompt: string;
  /** Falls back to ANTHROPIC_API_KEY env var */
  apiKey?: string;
  /** Model to use. Default: claude-sonnet-4-6 */
  model?: string;
}

function sseEvent(event: AgentChatEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

const MAX_ITERATIONS = 20;

export function createProductionAgentHandler(
  options: ProductionAgentOptions,
): H3EventHandler {
  const client = new Anthropic({
    apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
  });
  const model = options.model ?? "claude-sonnet-4-6";

  // Build Anthropic tool definitions from script registry
  const tools: Anthropic.Tool[] = Object.entries(options.scripts).map(
    ([name, entry]) => ({
      name,
      description: entry.tool.description,
      input_schema: entry.tool.parameters ?? {
        type: "object" as const,
        properties: {},
      },
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

    const { message, history = [] } = body;
    if (!message) {
      setResponseStatus(event, 400);
      return { error: "message is required" };
    }

    setResponseHeader(event, "Content-Type", "text/event-stream");
    setResponseHeader(event, "Cache-Control", "no-cache");
    setResponseHeader(event, "Connection", "keep-alive");

    const nodeRes = event.node.res;

    // Cancel the agent loop when the client disconnects
    const abort = new AbortController();
    nodeRes.on("close", () => abort.abort());

    const send = (ev: AgentChatEvent) => {
      if (!nodeRes.destroyed) nodeRes.write(sseEvent(ev));
    };

    // Build messages for Anthropic API — skip empty-content history entries
    // (assistant turns with only tool calls have content="" in the client history)
    const messages: Anthropic.MessageParam[] = [
      ...history
        .filter((m) => m.content.trim())
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      { role: "user" as const, content: message },
    ];

    try {
      // Agentic loop — keep calling Claude until it stops using tools
      let iterations = 0;
      while (true) {
        if (abort.signal.aborted || nodeRes.destroyed) break;
        if (++iterations > MAX_ITERATIONS) {
          send({
            type: "error",
            error: "Agent loop exceeded maximum iterations",
          });
          break;
        }

        const stream = client.messages.stream(
          {
            model,
            max_tokens: 4096,
            system: options.systemPrompt,
            tools,
            messages,
          },
          { signal: abort.signal },
        );

        let assistantContent: Anthropic.ContentBlock[] = [];
        let currentText = "";

        for await (const chunk of stream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            currentText += chunk.delta.text;
            send({ type: "text", text: chunk.delta.text });
          }
        }

        const finalMessage = await stream.finalMessage();
        assistantContent = finalMessage.content;

        // Add assistant turn to messages
        messages.push({ role: "assistant", content: assistantContent });

        // Check if we need to run tools
        const toolUseBlocks = assistantContent.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
        );

        if (toolUseBlocks.length === 0) {
          // No tool calls — we're done
          break;
        }

        // Execute each tool call
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
          const scriptEntry = options.scripts[toolUse.name];
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
            result = await scriptEntry.run(
              toolUse.input as Record<string, string>,
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

        // Add tool results turn
        messages.push({ role: "user", content: toolResults });
      }

      send({ type: "done" });
    } catch (err: any) {
      if (!abort.signal.aborted) {
        send({ type: "error", error: err?.message ?? "Unknown error" });
      }
    }

    if (!nodeRes.destroyed) nodeRes.end();
  });
}
