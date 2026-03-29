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
const encoder = new TextEncoder();

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

    const { message, history = [], references = [] } = body;
    if (!message) {
      setResponseStatus(event, 400);
      return { error: "message is required" };
    }

    setResponseHeader(event, "Content-Type", "text/event-stream");
    setResponseHeader(event, "Cache-Control", "no-cache");
    setResponseHeader(event, "Connection", "keep-alive");

    const abort = new AbortController();

    // Use ReadableStream for cross-runtime compatibility (Node + CF Workers)
    const stream = new ReadableStream({
      async start(controller) {
        const send = (ev: AgentChatEvent) => {
          try {
            controller.enqueue(encoder.encode(sseEvent(ev)));
          } catch {
            // Stream already closed
          }
        };

        // Check for API key before attempting any API calls
        const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          send({ type: "missing_api_key" });
          controller.close();
          return;
        }

        const client = new Anthropic({ apiKey });

        // Build enriched user message with references
        let enrichedMessage = message;
        if (references.length > 0) {
          const fileRefs = references.filter((r) => r.type === "file");
          const skillRefs = references.filter((r) => r.type === "skill");

          const parts: string[] = [];
          if (fileRefs.length > 0) {
            parts.push(
              "Referenced files:\n" +
                fileRefs
                  .map(
                    (r) =>
                      `- ${r.path}${r.source === "resource" ? " (resource)" : ""}`,
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

          const mentionRefs = references.filter((r) => r.type === "mention");
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

          enrichedMessage = `${parts.join("\n\n")}\n\n${message}`;
        }

        // Build messages for Anthropic API — skip empty-content history entries
        // (assistant turns with only tool calls have content="" in the client history)
        const messages: Anthropic.MessageParam[] = [
          ...history
            .filter((m) => m.content.trim())
            .map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
          { role: "user" as const, content: enrichedMessage },
        ];

        try {
          // Agentic loop — keep calling Claude until it stops using tools
          let iterations = 0;
          while (true) {
            if (abort.signal.aborted) break;
            if (++iterations > MAX_ITERATIONS) {
              send({
                type: "error",
                error: "Agent loop exceeded maximum iterations",
              });
              break;
            }

            const apiStream = client.messages.stream(
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

            for await (const chunk of apiStream) {
              if (
                chunk.type === "content_block_delta" &&
                chunk.delta.type === "text_delta"
              ) {
                currentText += chunk.delta.text;
                send({ type: "text", text: chunk.delta.text });
              }
            }

            const finalMessage = await apiStream.finalMessage();
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

        controller.close();
      },
      cancel() {
        abort.abort();
      },
    });

    return stream;
  });
}
