import {
  classifyProviderError,
  describeErrorWithCauses,
} from "./error-detail.js";
import { flattenComposedRootSchema } from "./flatten-composed-root-schema.js";
import {
  createProviderToolNameMap,
  toEngineToolName,
  toProviderToolName,
  type ProviderToolNameMap,
} from "./tool-name.js";
import { backfillEngineMessagesToolResults } from "./translate-anthropic.js";
import type {
  EngineTool,
  EngineMessage,
  EngineContentPart,
  EngineEvent,
} from "./types.js";

export function engineToolsToAISDK(
  tools: EngineTool[],
  jsonSchema?: (schema: Record<string, unknown>) => unknown,
  toolNameMap = createProviderToolNameMap(tools),
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const tool of tools) {
    const inputSchema = flattenComposedRootSchema(tool.inputSchema);
    const rawSchema: Record<string, unknown> = {
      ...inputSchema,
      type: "object",
      properties: inputSchema.properties ?? {},
      required: inputSchema.required ?? [],
    };
    const providerName = toProviderToolName(tool.name, toolNameMap);
    result[providerName] = {
      description: tool.description,
      inputSchema: jsonSchema ? jsonSchema(rawSchema) : rawSchema,
    };
  }
  return result;
}

export interface EngineToAISDKOptions {
  toolResultImages?: boolean;
  toolNameMap?: ProviderToolNameMap;
}

function toolResultOutputToAISDK(
  part: Extract<EngineContentPart, { type: "tool-result" }>,
  opts?: EngineToAISDKOptions,
): any {
  if (part.isError) return { type: "error-text", value: part.content };
  if (
    opts?.toolResultImages !== true ||
    !part.images ||
    part.images.length === 0
  ) {
    return { type: "text", value: part.content };
  }
  const imageParts: any[] = [];
  for (const image of part.images) {
    if (image.url) {
      imageParts.push({ type: "image-url", url: image.url });
    } else if (image.data && image.mediaType) {
      imageParts.push({
        type: "image-data",
        data: image.data,
        mediaType: image.mediaType,
      });
    }
  }
  if (imageParts.length === 0) return { type: "text", value: part.content };
  return {
    type: "content",
    value: [{ type: "text", text: part.content }, ...imageParts],
  };
}

export function engineMessageToAISDK(
  msg: EngineMessage,
  opts?: EngineToAISDKOptions,
): any[] {
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
          toolName: toProviderToolName(part.toolName, opts?.toolNameMap),
          output: toolResultOutputToAISDK(part, opts),
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
          toolName: toProviderToolName(part.name, opts?.toolNameMap),
          input: part.input,
        });
      } else if (part.type === "thinking") {
        const reasoning: Record<string, unknown> = {
          type: "reasoning",
          text: part.text,
        };
        if (part.signature) {
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

export function engineMessagesToAISDK(
  messages: EngineMessage[],
  opts?: EngineToAISDKOptions,
): any[] {
  const toolNameMap =
    opts?.toolNameMap ?? createProviderToolNameMap([], messages);
  return backfillEngineMessagesToolResults(messages).flatMap((msg) =>
    engineMessageToAISDK(msg, { ...opts, toolNameMap }),
  );
}

export function aiSdkPartToEngineEvents(
  part: any,
  toolNameMap?: ProviderToolNameMap,
): EngineEvent[] {
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
      events.push({
        type: "tool-input-start",
        id: part.id ?? part.toolCallId,
        name: toEngineToolName(part.toolName, toolNameMap),
      });
      break;
    case "tool-input-delta":
      events.push({
        type: "tool-input-delta",
        id: part.id ?? part.toolCallId,
        name: toEngineToolName(part.toolName, toolNameMap),
        text:
          typeof part.delta === "string"
            ? part.delta
            : typeof part.text === "string"
              ? part.text
              : "",
      });
      break;
    case "tool-input-end":
      break;

    case "tool-call":
      events.push({
        type: "tool-call",
        id: part.toolCallId,
        name: toEngineToolName(part.toolName, toolNameMap),
        input: part.input ?? {},
      });
      break;

    case "tool-input-error":
    case "tool-error":
      events.push({
        type: "tool-call-error",
        id: part.toolCallId,
        name: toEngineToolName(part.toolName, toolNameMap),
        input: part.input ?? {},
        error:
          part.errorText ??
          (part.error instanceof Error
            ? part.error.message
            : typeof part.error === "string"
              ? part.error
              : JSON.stringify(part.error ?? "Invalid tool input")),
      });
      break;

    case "tool-result":
      break;

    case "error": {
      const errMsg =
        part.error instanceof Error
          ? describeErrorWithCauses(part.error)
          : typeof part.error === "string"
            ? part.error
            : JSON.stringify(part.error);
      events.push({
        type: "stop",
        reason: "error",
        error: errMsg,
        ...classifyProviderError(part.error),
      });
      break;
    }

    case "finish-step":
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
      return "end_turn";
  }
}

function usageEventFromLanguageModelUsage(usage: any): EngineEvent {
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

export function aiSdkStepToAssistantContent(
  step: any,
  toolNameMap?: ProviderToolNameMap,
): EngineContentPart[] {
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
        name: toEngineToolName(part.toolName, toolNameMap),
        input: part.input,
      });
    } else if (part.type === "tool-input-error" || part.type === "tool-error") {
      parts.push({
        type: "tool-call",
        id: part.toolCallId,
        name: toEngineToolName(part.toolName, toolNameMap),
        input: part.input ?? {},
      });
    }
  }
  return parts;
}
