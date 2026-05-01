/**
 * Translation helpers between AgentEngine normalized types and
 * Vercel AI SDK (`ai` package, v6+) types.
 *
 * The framework keeps a provider-neutral content/event model (see ./types.ts).
 * These helpers convert in both directions against the v6 `TextStreamPart` and
 * `ModelMessage` shapes.
 */

import type {
  EngineTool,
  EngineMessage,
  EngineContentPart,
  EngineEvent,
} from "./types.js";

// ---------------------------------------------------------------------------
// EngineTool → AI SDK tool definition
// ---------------------------------------------------------------------------

/**
 * Convert EngineTool[] into the record shape that AI SDK's `streamText` expects
 * under the `tools` option.
 *
 * Pass the `jsonSchema` helper from the `ai` package when available so the
 * schema is wrapped in the SDK's runtime validator; fall back to the raw JSON
 * Schema object otherwise (mostly for unit tests that don't import `ai`).
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
      inputSchema: jsonSchema ? jsonSchema(rawSchema) : rawSchema,
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// EngineMessage → AI SDK ModelMessage
// ---------------------------------------------------------------------------

/**
 * Convert a single EngineMessage into **one or more** AI SDK ModelMessages.
 *
 * v6 puts tool-results in a dedicated `role: "tool"` message rather than
 * embedding them in user content. When an EngineMessage's user content mixes
 * text/images with tool-results, we emit the tool-result parts first as a
 * `{role: "tool"}` message, followed by the remaining text/image parts as a
 * `{role: "user"}` message.
 */
export function engineMessageToAISDK(msg: EngineMessage): any[] {
  // EngineMessage is `user | assistant` — both branches return below.
  if (msg.role === "user") {
    const userParts: any[] = [];
    const toolResultParts: any[] = [];
    for (const part of msg.content) {
      if (part.type === "text") {
        userParts.push({ type: "text", text: part.text });
      } else if (part.type === "image") {
        userParts.push({
          type: "image",
          image: `data:${part.mediaType};base64,${part.data}`,
          mediaType: part.mediaType,
        });
      } else if (part.type === "file") {
        userParts.push({
          type: "file",
          data: part.data,
          mediaType: part.mediaType,
          filename: part.filename,
        });
      } else if (part.type === "tool-result") {
        toolResultParts.push({
          type: "tool-result",
          toolCallId: part.toolCallId,
          toolName: part.toolName ?? "",
          output: part.isError
            ? { type: "error-text", value: part.content }
            : { type: "text", value: part.content },
        });
      }
    }

    const out: any[] = [];
    if (toolResultParts.length > 0) {
      out.push({ role: "tool", content: toolResultParts });
    }
    if (userParts.length > 0) {
      out.push({
        role: "user",
        content:
          userParts.length === 1 && userParts[0].type === "text"
            ? userParts[0].text
            : userParts,
      });
    }
    return out;
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
          input: part.input,
        });
      } else if (part.type === "thinking") {
        const reasoning: Record<string, unknown> = {
          type: "reasoning",
          text: part.text,
        };
        if (part.signature) {
          // Round-trip the Anthropic extended-thinking signature through
          // providerOptions so the model can continue its chain of thought.
          reasoning.providerOptions = {
            anthropic: { signature: part.signature },
          };
        }
        content.push(reasoning);
      }
    }
    return [
      {
        role: "assistant",
        content:
          content.length === 1 && content[0].type === "text"
            ? content[0].text
            : content,
      },
    ];
  }

  throw new Error(`unknown EngineMessage role: ${(msg as any).role}`);
}

export function engineMessagesToAISDK(messages: EngineMessage[]): any[] {
  return messages.flatMap(engineMessageToAISDK);
}

// ---------------------------------------------------------------------------
// AI SDK TextStreamPart → EngineEvent
// ---------------------------------------------------------------------------

/**
 * Translate a single part from AI SDK's `result.fullStream` into the flat
 * sequence of EngineEvent items the framework works with.
 *
 * v6 emits lifecycle events (`text-start` / `text-delta` / `text-end`,
 * `reasoning-start` / `reasoning-delta` / `reasoning-end`, `tool-input-*`).
 * We absorb the boundary events and forward only the deltas plus the terminal
 * `tool-call`, `finish-step`, and `finish` parts.
 */
export function aiSdkPartToEngineEvents(part: any): EngineEvent[] {
  const events: EngineEvent[] = [];

  switch (part?.type) {
    case "text-delta":
      if (part.text) events.push({ type: "text-delta", text: part.text });
      break;
    case "text-start":
    case "text-end":
      break;

    case "reasoning-delta":
      if (part.text) events.push({ type: "thinking-delta", text: part.text });
      break;
    case "reasoning-start":
    case "reasoning-end":
      break;

    case "tool-input-start":
    case "tool-input-delta":
    case "tool-input-end":
      // Ignored: the terminal `tool-call` part carries the full input.
      break;

    case "tool-call":
      events.push({
        type: "tool-call",
        id: part.toolCallId,
        name: part.toolName,
        input: part.input ?? {},
      });
      break;

    case "tool-result":
    case "tool-error":
      // Only fired when the SDK itself executes a tool. Our runAgentLoop
      // dispatches tools on the outside, so these don't appear in our flow.
      break;

    case "error": {
      const errMsg =
        part.error instanceof Error
          ? part.error.message
          : typeof part.error === "string"
            ? part.error
            : JSON.stringify(part.error);
      events.push({ type: "stop", reason: "error", error: errMsg });
      break;
    }

    case "finish-step":
      if (part.usage) {
        events.push(usageEventFromLanguageModelUsage(part.usage));
      }
      break;

    case "finish":
      if (part.totalUsage) {
        events.push(usageEventFromLanguageModelUsage(part.totalUsage));
      }
      events.push({
        type: "stop",
        reason: finishReasonToStopReason(part.finishReason),
      });
      break;

    case "start":
    case "start-step":
    case "source":
    case "file":
    case "abort":
    case "raw":
    default:
      break;
  }

  return events;
}

function finishReasonToStopReason(
  reason: unknown,
): "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "error" {
  switch (reason) {
    case "tool-calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content-filter":
    case "error":
      return "error";
    default:
      // Maps "stop", "other", "unknown", and anything we don't recognise.
      return "end_turn";
  }
}

function usageEventFromLanguageModelUsage(usage: any): EngineEvent {
  // v6 exposes cache/reasoning tokens via detail objects; older providers
  // put them at the top level (deprecated but still read as a fallback).
  return {
    type: "usage",
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens,
    cacheReadTokens:
      usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? 0,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
    reasoningTokens:
      usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens,
  };
}

// ---------------------------------------------------------------------------
// AI SDK StepResult → EngineContentPart[] (assistant content reconstruction)
// ---------------------------------------------------------------------------

/**
 * Reconstruct the assistant message content from an AI SDK v6 `StepResult`.
 * `step.content` is the canonical structured form — iterate it.
 */
export function aiSdkStepToAssistantContent(step: any): EngineContentPart[] {
  const parts: EngineContentPart[] = [];
  for (const part of step?.content ?? []) {
    if (part.type === "text" && part.text) {
      parts.push({ type: "text", text: part.text });
    } else if (part.type === "reasoning") {
      const signature = part.providerMetadata?.anthropic?.signature;
      const thinking: EngineContentPart = {
        type: "thinking",
        text: part.text ?? "",
      };
      if (typeof signature === "string") thinking.signature = signature;
      parts.push(thinking);
    } else if (part.type === "tool-call") {
      parts.push({
        type: "tool-call",
        id: part.toolCallId,
        name: part.toolName,
        input: part.input,
      });
    }
  }
  return parts;
}
