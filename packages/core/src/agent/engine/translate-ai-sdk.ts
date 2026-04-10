/**
 * Translation helpers between AgentEngine normalized types and
 * Vercel AI SDK (ai package) types.
 */

import type { EngineTool, EngineMessage, EngineContentPart } from "./types.js";

// ---------------------------------------------------------------------------
// EngineTool → AI SDK CoreTool shape
// ---------------------------------------------------------------------------

/**
 * Convert EngineTool[] to the `tools` Record<string, CoreTool> shape
 * that AI SDK's streamText expects.
 *
 * AI SDK v4 requires tool parameters to be Zod schemas or jsonSchema()-wrapped
 * objects. Pass the `jsonSchema` helper from the `ai` package to produce a
 * compatible schema wrapper; fall back to the raw JSON Schema object when the
 * helper is not available (older AI SDK or tests).
 */
export function engineToolsToAISDK(
  tools: EngineTool[],
  jsonSchema?: (schema: Record<string, unknown>) => unknown,
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const tool of tools) {
    const rawSchema: Record<string, unknown> = {
      type: "object",
      properties: tool.inputSchema.properties ?? {},
      required: tool.inputSchema.required ?? [],
    };
    result[tool.name] = {
      description: tool.description,
      parameters: jsonSchema ? jsonSchema(rawSchema) : rawSchema,
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// EngineMessage → AI SDK CoreMessage
// ---------------------------------------------------------------------------

export function engineMessageToAISDK(msg: EngineMessage): any {
  if (msg.role === "user") {
    const content: any[] = [];
    for (const part of msg.content) {
      if (part.type === "text") {
        content.push({ type: "text", text: part.text });
      } else if (part.type === "image") {
        content.push({
          type: "image",
          image: `data:${part.mediaType};base64,${part.data}`,
        });
      } else if (part.type === "tool-result") {
        content.push({
          type: "tool-result",
          toolCallId: part.toolCallId,
          result: part.content,
          isError: part.isError,
        });
      }
    }
    return {
      role: "user",
      content:
        content.length === 1 && content[0].type === "text"
          ? content[0].text
          : content,
    };
  }

  if (msg.role === "assistant") {
    const content: any[] = [];
    for (const part of msg.content) {
      if (part.type === "text") {
        content.push({ type: "text", text: part.text });
      } else if (part.type === "tool-call") {
        content.push({
          type: "tool-call",
          toolCallId: part.id,
          toolName: part.name,
          args: part.input,
        });
      } else if (part.type === "thinking") {
        // AI SDK 5+ supports reasoning content parts
        content.push({ type: "reasoning", text: part.text });
      }
    }
    return {
      role: "assistant",
      content:
        content.length === 1 && content[0].type === "text"
          ? content[0].text
          : content,
    };
  }

  // Exhaustive — EngineMessage only has "user" | "assistant" roles
  return { role: (msg as any).role, content: "" };
}

export function engineMessagesToAISDK(messages: EngineMessage[]): any[] {
  return messages.map(engineMessageToAISDK);
}

// ---------------------------------------------------------------------------
// AI SDK stream part → EngineEvent
// ---------------------------------------------------------------------------

export function aiSdkPartToEngineEvents(
  part: any,
): import("./types.js").EngineEvent[] {
  const events: import("./types.js").EngineEvent[] = [];

  if (part.type === "text-delta") {
    events.push({ type: "text-delta", text: part.textDelta ?? "" });
  } else if (part.type === "reasoning") {
    events.push({
      type: "thinking-delta",
      text: part.textDelta ?? part.text ?? "",
    });
  } else if (part.type === "tool-call") {
    events.push({
      type: "tool-call",
      id: part.toolCallId,
      name: part.toolName,
      input: part.args,
    });
  } else if (part.type === "error") {
    // AI SDK emits { type: "error", error: Error } when streaming fails
    const errMsg =
      (part.error instanceof Error ? part.error.message : String(part.error)) ??
      "Unknown stream error";
    events.push({ type: "stop", reason: "error", error: errMsg } as any);
  } else if (part.type === "finish") {
    // Usage info may arrive on the finish step
    if (part.usage) {
      events.push({
        type: "usage",
        inputTokens: part.usage.promptTokens ?? 0,
        outputTokens: part.usage.completionTokens ?? 0,
        cacheReadTokens: (part.usage as any).cacheReadTokens ?? 0,
        cacheWriteTokens: (part.usage as any).cacheWriteTokens ?? 0,
      });
    }
    const reason = part.finishReason;
    events.push({
      type: "stop",
      reason:
        reason === "tool-calls"
          ? "tool_use"
          : reason === "length"
            ? "max_tokens"
            : "end_turn",
    });
  }

  return events;
}

// ---------------------------------------------------------------------------
// AI SDK step result → EngineContentPart[] (assistant content for messages)
// ---------------------------------------------------------------------------

export function aiSdkStepToAssistantContent(step: any): EngineContentPart[] {
  const parts: EngineContentPart[] = [];

  if (typeof step.text === "string" && step.text) {
    parts.push({ type: "text", text: step.text });
  }

  if (Array.isArray(step.toolCalls)) {
    for (const tc of step.toolCalls) {
      parts.push({
        type: "tool-call",
        id: tc.toolCallId,
        name: tc.toolName,
        input: tc.args,
      });
    }
  }

  if (Array.isArray(step.reasoning)) {
    for (const r of step.reasoning) {
      if (r.type === "text") {
        parts.push({ type: "thinking", text: r.text });
      }
    }
  }

  return parts;
}
