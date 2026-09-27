import type Anthropic from "@anthropic-ai/sdk";

import { flattenComposedRootSchema } from "./flatten-composed-root-schema.js";
import {
  createProviderToolNameMap,
  toEngineToolName,
  toProviderToolName,
  type ProviderToolNameMap,
} from "./tool-name.js";
import type {
  EngineTool,
  EngineMessage,
  EngineContentPart,
  EngineEvent,
} from "./types.js";

type JsonSchemaRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonSchemaRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeDbExecAnthropicInputSchema(
  schema: EngineTool["inputSchema"],
): Anthropic.Tool["input_schema"] {
  const sourceProperties = isRecord(schema.properties) ? schema.properties : {};
  const statements = isRecord(sourceProperties.statements)
    ? { ...sourceProperties.statements }
    : {
        type: "string",
        description: "JSON array of write statements to execute.",
      };
  const description =
    typeof statements.description === "string" &&
    statements.description.trim().length > 0
      ? `${statements.description} For a single write, pass a one-item JSON array.`
      : "JSON array of write statements to execute. For a single write, pass a one-item JSON array.";
  statements.description = description;

  const properties: JsonSchemaRecord = { statements };
  if (isRecord(sourceProperties.format)) {
    properties.format = sourceProperties.format;
  }

  return {
    type: "object",
    properties,
    required: ["statements"],
    additionalProperties: false,
  };
}

function normalizeAnthropicInputSchema(
  toolName: string,
  schema: EngineTool["inputSchema"],
): Anthropic.Tool["input_schema"] {
  if (toolName === "db-exec") {
    return normalizeDbExecAnthropicInputSchema(schema);
  }

  return flattenComposedRootSchema(schema) as Anthropic.Tool["input_schema"];
}

export function engineToolToAnthropic(
  tool: EngineTool,
  toolNameMap?: ProviderToolNameMap,
): Anthropic.Tool {
  const providerName = toProviderToolName(tool.name, toolNameMap);
  return {
    name: providerName,
    description: tool.description,
    input_schema: normalizeAnthropicInputSchema(tool.name, tool.inputSchema),
  };
}

export function engineToolsToAnthropic(
  tools: EngineTool[],
  toolNameMap = createProviderToolNameMap(tools),
): Anthropic.Tool[] {
  return tools.map((tool) => engineToolToAnthropic(tool, toolNameMap));
}

export function stringifyToolUseInputForGateway(input: unknown): string {
  try {
    if (input === undefined || input === null) return "{}";
    return JSON.stringify(input);
  } catch {
    return "{}";
  }
}

export const UNMATCHED_TOOL_RESULT_REPLAY_PREFIX =
  "(Omitted unmatched tool results from replayed history.)";

export function unmatchedToolResultReplayText(part: {
  toolCallId: string;
  content: unknown;
  isError?: boolean;
}): string {
  const max = 2000;
  let body =
    typeof part.content === "string"
      ? part.content
      : part.content === undefined || part.content === null
        ? ""
        : (() => {
            try {
              return JSON.stringify(part.content);
            } catch {
              return String(part.content);
            }
          })();
  if (body.length > max) body = `${body.slice(0, max)}…`;
  const err = part.isError ? " isError=true" : "";
  return `${UNMATCHED_TOOL_RESULT_REPLAY_PREFIX} [tool_use_id=${part.toolCallId}${err}] ${body}`;
}

function interruptedToolResultPart(part: {
  id: string;
  name: string;
  input: unknown;
}): EngineContentPart {
  return {
    type: "tool-result",
    toolCallId: part.id,
    toolName: part.name,
    toolInput: stringifyToolUseInputForGateway(part.input),
    content: "Interrupted before this tool returned a result.",
  };
}

export function backfillEngineMessagesToolResults(
  messages: EngineMessage[],
): EngineMessage[] {
  const toolUseById = new Map<string, { name: string; input: unknown }>();
  const out: EngineMessage[] = [];
  let pendingToolUses: Array<{ id: string; name: string; input: unknown }> = [];

  const flushInterruptedToolResults = () => {
    if (pendingToolUses.length === 0) return;
    out.push({
      role: "user",
      content: pendingToolUses.map(interruptedToolResultPart),
    });
    pendingToolUses = [];
  };

  for (const msg of messages) {
    if (msg.role === "assistant") {
      flushInterruptedToolResults();
      for (const part of msg.content) {
        if (part.type === "tool-call") {
          toolUseById.set(part.id, { name: part.name, input: part.input });
        }
      }
      out.push(msg);
      pendingToolUses = msg.content
        .filter(
          (part): part is Extract<EngineContentPart, { type: "tool-call" }> =>
            part.type === "tool-call",
        )
        .map((part) => ({
          id: part.id,
          name: part.name,
          input: part.input,
        }));
      continue;
    }
    if (msg.role !== "user") {
      flushInterruptedToolResults();
      out.push(msg);
      continue;
    }
    const newContent: EngineContentPart[] = [];
    const pendingById = new Map(
      pendingToolUses.map((part) => [part.id, part] as const),
    );
    const matchedPendingToolResults = new Map<string, EngineContentPart>();
    for (const part of msg.content) {
      if (part.type !== "tool-result") {
        newContent.push(part);
        continue;
      }
      const lookup = toolUseById.get(part.toolCallId);
      const pendingLookup = pendingById.get(part.toolCallId);
      const toolName =
        typeof part.toolName === "string" && part.toolName.trim().length > 0
          ? part.toolName
          : pendingLookup?.name;
      if (!toolName?.trim()) {
        const id =
          typeof part.toolCallId === "string"
            ? part.toolCallId.trim()
            : part.toolCallId != null
              ? String(part.toolCallId).trim()
              : "";
        newContent.push({
          type: "text",
          text: unmatchedToolResultReplayText({
            toolCallId: id.length > 0 ? id : "(missing)",
            content: part.content,
            isError: part.isError,
          }),
        });
        continue;
      }
      if (pendingToolUses.length > 0 && !pendingLookup) {
        const id =
          typeof part.toolCallId === "string"
            ? part.toolCallId.trim()
            : part.toolCallId != null
              ? String(part.toolCallId).trim()
              : "";
        newContent.push({
          type: "text",
          text: unmatchedToolResultReplayText({
            toolCallId: id.length > 0 ? id : "(missing)",
            content: part.content,
            isError: part.isError,
          }),
        });
        continue;
      }
      const toolInput =
        typeof part.toolInput === "string" && part.toolInput.length > 0
          ? part.toolInput
          : stringifyToolUseInputForGateway(
              pendingLookup?.input ?? lookup?.input,
            );
      const filled: EngineContentPart = {
        type: "tool-result",
        toolCallId: part.toolCallId,
        toolName,
        toolInput,
        content: part.content,
        ...(part.isError ? { isError: true } : {}),
        ...(part.images && part.images.length > 0
          ? { images: part.images }
          : {}),
      };
      if (pendingLookup) {
        matchedPendingToolResults.set(part.toolCallId, filled);
      } else {
        newContent.push(filled);
      }
    }
    if (pendingToolUses.length > 0) {
      const pairedResults = pendingToolUses.map(
        (part) =>
          matchedPendingToolResults.get(part.id) ??
          interruptedToolResultPart(part),
      );
      newContent.unshift(...pairedResults);
      pendingToolUses = [];
    }
    if (newContent.length === 0) {
      out.push({
        role: "user",
        content: [
          {
            type: "text",
            text: UNMATCHED_TOOL_RESULT_REPLAY_PREFIX,
          },
        ],
      });
      continue;
    }
    out.push({ role: "user", content: newContent });
  }

  flushInterruptedToolResults();

  return out;
}

function replayableAnthropicPart(part: EngineContentPart): boolean {
  if (part.type !== "thinking") return true;
  if (part.redactedData || part.signature) return true;
  console.warn(
    "[anthropic-engine] dropping a thinking block with no signature; it cannot be replayed",
  );
  return false;
}

export function engineMessageToAnthropic(
  msg: EngineMessage,
  opts?: {
    builderGateway?: boolean;
    toolNameMap?: ProviderToolNameMap;
  },
): Anthropic.MessageParam {
  const builderGateway = opts?.builderGateway === true;
  const content = builderGateway
    ? msg.content
    : msg.content.filter(replayableAnthropicPart);
  return {
    role: msg.role,
    content: content.map((p) =>
      enginePartToAnthropic(p, builderGateway, opts?.toolNameMap),
    ),
  };
}

export function engineMessagesToAnthropic(
  messages: EngineMessage[],
  toolNameMap = createProviderToolNameMap([], messages),
): Anthropic.MessageParam[] {
  const normalized = backfillEngineMessagesToolResults(messages);
  return normalized.flatMap((m) => {
    const translated = engineMessageToAnthropic(m, { toolNameMap });
    return translated.content.length > 0 ? [translated] : [];
  });
}

export function engineMessagesToBuilderGatewayAnthropic(
  messages: EngineMessage[],
  toolNameMap = createProviderToolNameMap([], messages),
): Anthropic.MessageParam[] {
  const normalized = backfillEngineMessagesToolResults(messages);
  return normalized.map((m) =>
    engineMessageToAnthropic(m, { builderGateway: true, toolNameMap }),
  );
}

function enginePartToAnthropic(
  part: EngineContentPart,
  builderGateway: boolean,
  toolNameMap?: ProviderToolNameMap,
): Anthropic.ContentBlockParam {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };

    case "image":
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: part.mediaType,
          data: part.data,
        },
      };

    case "file":
      if (part.mediaType === "application/pdf") {
        return {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: part.data,
          },
          ...(part.filename ? { title: part.filename } : {}),
        } as any;
      }
      return {
        type: "text",
        text: `[Attached file: ${part.filename ?? "attachment"} (${part.mediaType})]`,
      };

    case "tool-call":
      return {
        type: "tool_use",
        id: part.id,
        name: toProviderToolName(part.name, toolNameMap),
        input: part.input as Record<string, unknown>,
      } as any;

    case "tool-result": {
      if (builderGateway) {
        const tool_name = toProviderToolName(part.toolName.trim(), toolNameMap);
        const tool_input = part.toolInput;
        return {
          type: "tool_result",
          tool_use_id: part.toolCallId,
          tool_name,
          tool_input,
          content: toolResultContentToAnthropic(part),
          ...(part.isError ? { is_error: true } : {}),
        } as any;
      }
      return {
        type: "tool_result",
        tool_use_id: part.toolCallId,
        content: toolResultContentToAnthropic(part),
        ...(part.isError ? { is_error: true } : {}),
      } as any;
    }

    case "thinking":
      if (part.redactedData) {
        return { type: "redacted_thinking", data: part.redactedData } as any;
      }
      return {
        type: "thinking",
        thinking: part.text,
        signature: part.signature ?? "",
      } as any;
  }
}

function toolResultContentToAnthropic(
  part: Extract<EngineContentPart, { type: "tool-result" }>,
): string | Anthropic.ContentBlockParam[] {
  if (part.isError || !part.images || part.images.length === 0) {
    return part.content;
  }
  const imageBlocks: Anthropic.ImageBlockParam[] = [];
  for (const image of part.images) {
    if (image.url) {
      imageBlocks.push({
        type: "image",
        source: { type: "url", url: image.url },
      });
    } else if (image.data && image.mediaType) {
      imageBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: image.mediaType,
          data: image.data,
        },
      });
    }
  }
  if (imageBlocks.length === 0) return part.content;
  return [{ type: "text", text: part.content }, ...imageBlocks];
}

export function anthropicContentToEngine(
  content: Anthropic.ContentBlock[],
  toolNameMap?: ProviderToolNameMap,
): EngineContentPart[] {
  return content
    .map((block) => {
      if (block.type === "text") {
        return { type: "text" as const, text: block.text };
      }
      if (block.type === "tool_use") {
        return {
          type: "tool-call" as const,
          id: block.id,
          name: toEngineToolName(block.name, toolNameMap),
          input: block.input,
        };
      }
      if ((block as any).type === "thinking") {
        const b = block as any;
        return {
          type: "thinking" as const,
          text: b.thinking ?? "",
          signature: b.signature,
        };
      }
      if ((block as any).type === "redacted_thinking") {
        return {
          type: "thinking" as const,
          text: "",
          redactedData: (block as any).data ?? "",
        };
      }
      console.warn(
        `[anthropic-engine] dropping unrecognized content block type "${(block as any).type}" from the assistant turn; it will not be replayed`,
      );
      return { type: "text" as const, text: "" };
    })
    .filter((p) => !(p.type === "text" && p.text === ""));
}

export interface AnthropicChunkStreamState {
  toolUseByIndex: Map<number, { id: string; name: string }>;
}

export function createAnthropicChunkStreamState(): AnthropicChunkStreamState {
  return { toolUseByIndex: new Map() };
}

export function anthropicChunkToEngineEvents(
  chunk: any,
  state?: AnthropicChunkStreamState,
  toolNameMap?: ProviderToolNameMap,
): EngineEvent[] {
  const events: EngineEvent[] = [];

  if (chunk.type === "content_block_start") {
    const block = chunk.content_block;
    if (block?.type === "tool_use") {
      const id = typeof block.id === "string" ? block.id : undefined;
      const name =
        typeof block.name === "string"
          ? toEngineToolName(block.name, toolNameMap)
          : undefined;
      if (state && typeof chunk.index === "number" && id && name) {
        state.toolUseByIndex.set(chunk.index, { id, name });
      }
      events.push({
        type: "tool-input-start",
        ...(id ? { id } : {}),
        ...(name ? { name } : {}),
      });
    }
  } else if (chunk.type === "content_block_delta") {
    if (chunk.delta?.type === "text_delta") {
      events.push({ type: "text-delta", text: chunk.delta.text });
    } else if (chunk.delta?.type === "thinking_delta") {
      events.push({ type: "thinking-delta", text: chunk.delta.thinking ?? "" });
    } else if (chunk.delta?.type === "signature_delta") {
      events.push({
        type: "thinking-delta",
        text: "",
        signature: chunk.delta.signature,
      });
    } else if (chunk.delta?.type === "input_json_delta") {
      const active =
        state && typeof chunk.index === "number"
          ? state.toolUseByIndex.get(chunk.index)
          : undefined;
      events.push({
        type: "tool-input-delta",
        ...(active?.id ? { id: active.id } : {}),
        ...(active?.name ? { name: active.name } : {}),
        text:
          typeof chunk.delta.partial_json === "string"
            ? chunk.delta.partial_json
            : "",
      });
    }
  }

  return events;
}

export interface StreamedToolInputState {
  byId: Map<string, { name: string; text: string; delivered: boolean }>;
}

export function createStreamedToolInputState(): StreamedToolInputState {
  return { byId: new Map() };
}

export function observeStreamedToolInput(
  state: StreamedToolInputState,
  event: EngineEvent,
): void {
  if (event.type === "tool-input-start" || event.type === "tool-input-delta") {
    const id = event.id;
    if (!id) return;
    const existing = state.byId.get(id);
    const text = (event.type === "tool-input-delta" && event.text) || "";
    if (existing) {
      if (!existing.name && event.name) existing.name = event.name;
      existing.text += text;
      return;
    }
    state.byId.set(id, { name: event.name ?? "", text, delivered: false });
    return;
  }
  if (event.type === "tool-call") {
    if (isEmptyToolInput(event.input)) {
      const streamedInput = parseStreamedToolInput(
        state.byId.get(event.id)?.text ?? "",
      );
      if (streamedInput !== undefined) event.input = streamedInput;
    }
    markStreamedToolInputDelivered(state, event.id);
    return;
  }
  if (event.type === "tool-call-error") {
    markStreamedToolInputDelivered(state, event.id);
  }
}

export function markStreamedToolInputDelivered(
  state: StreamedToolInputState,
  id: string,
): void {
  const existing = state.byId.get(id);
  if (existing) existing.delivered = true;
  else state.byId.set(id, { name: "", text: "", delivered: true });
}

const TRUNCATED_TOOL_INPUT_ERROR =
  "The arguments never finished streaming, so this call was not executed and nothing changed. Call the tool again with complete arguments.";

export function finalizeStreamedToolInputs(
  state: StreamedToolInputState,
  deliveredIds: Iterable<string> = [],
): EngineEvent[] {
  for (const id of deliveredIds) markStreamedToolInputDelivered(state, id);
  const events: EngineEvent[] = [];
  for (const [id, entry] of state.byId) {
    if (entry.delivered) continue;
    const input = parseStreamedToolInput(entry.text);
    if (input !== undefined) {
      events.push({ type: "tool-call", id, name: entry.name, input });
    } else {
      events.push({
        type: "tool-call-error",
        id,
        name: entry.name || "unknown-tool",
        input: entry.text,
        error: TRUNCATED_TOOL_INPUT_ERROR,
      });
    }
  }
  return events;
}

function parseStreamedToolInput(
  text: string,
): Record<string, unknown> | undefined {
  if (!text.trim()) return undefined;
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isEmptyToolInput(input: unknown): boolean {
  return input == null || (isRecord(input) && Object.keys(input).length === 0);
}

export function buildToolResultPart(
  toolCallId: string,
  toolName: string,
  content: string,
  toolInput: unknown = {},
  isError = false,
): EngineContentPart {
  return {
    type: "tool-result",
    toolCallId,
    toolName,
    toolInput: stringifyToolUseInputForGateway(toolInput),
    content,
    ...(isError ? { isError } : {}),
  };
}
