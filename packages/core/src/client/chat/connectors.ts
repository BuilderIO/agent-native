import {
  createHttpAgentChatRuntime,
  type AgentChatRuntime,
  type AgentChatRuntimeKnownEvent,
  type AgentChatRuntimeMessage,
  type AgentChatRuntimeMessageId,
  type AgentChatRuntimeSessionId,
  type AgentChatRuntimeToolCallId,
  type AgentChatRuntimeTurnId,
  type AgentChatRuntimeUsage,
  type CreateHttpAgentChatRuntimeOptions,
} from "./runtime.js";

type ConnectorRuntimeOptions = Omit<
  CreateHttpAgentChatRuntimeOptions<AgentChatRuntimeKnownEvent>,
  "mapEvent"
>;

export interface CreateOpenAIAgentsChatRuntimeOptions extends ConnectorRuntimeOptions {}

export interface CreateOpenAIResponsesChatRuntimeOptions extends ConnectorRuntimeOptions {}

export interface CreateAgUiChatRuntimeOptions extends ConnectorRuntimeOptions {}

export interface CreateClaudeAgentChatRuntimeOptions extends ConnectorRuntimeOptions {}

export interface CreateVercelAiChatRuntimeOptions extends ConnectorRuntimeOptions {}

interface RuntimeEventContext {
  sessionId: AgentChatRuntimeSessionId;
  turnId?: AgentChatRuntimeTurnId;
  runId?: string;
}

type MessageContentState =
  | { type: "text"; text: string; id?: string }
  | {
      type: "reasoning";
      text: string;
      id?: string;
      signature?: string;
    };

interface MessageState {
  id: AgentChatRuntimeMessageId;
  role: "assistant" | "user" | "system" | "tool";
  content: MessageContentState[];
  started: boolean;
  done: boolean;
}

interface ToolState {
  id: AgentChatRuntimeToolCallId;
  name: string;
  argsText: string;
  started: boolean;
  done: boolean;
}

interface ConnectorTurnState {
  fallbackMessageId: string;
  activeMessageId?: string;
  activeReasoningMessageId?: string;
  messages: Map<string, MessageState>;
  tools: Map<string, ToolState>;
  contentBlocks: Map<
    string,
    {
      messageId?: string;
      toolId?: string;
      partId?: string;
      type?: string;
    }
  >;
}

function runtimeConnectorId(prefix: string): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function turnKey(context: RuntimeEventContext): string {
  return `${context.sessionId}:${context.turnId ?? context.runId ?? "turn"}`;
}

function baseEvent(context: RuntimeEventContext) {
  return {
    sessionId: context.sessionId,
    turnId: context.turnId,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function recordString(
  record: Record<string, unknown> | null,
  ...keys: string[]
): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function recordText(
  record: Record<string, unknown> | null,
  ...keys: string[]
): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function recordKey(
  record: Record<string, unknown> | null,
  ...keys: string[]
): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return undefined;
}

function nestedRecord(
  record: Record<string, unknown> | null,
  ...keys: string[]
): Record<string, unknown> | null {
  if (!record) return null;
  for (const key of keys) {
    const value = asRecord(record[key]);
    if (value) return value;
  }
  return null;
}

function normalizeEventType(type: string | undefined): string {
  return (type ?? "")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[.-]/g, "_")
    .toUpperCase();
}

function ensureMessage(
  state: ConnectorTurnState,
  id: string | undefined,
  role: MessageState["role"] = "assistant",
): MessageState {
  const messageId = id || state.fallbackMessageId;
  let message = state.messages.get(messageId);
  if (!message) {
    message = {
      id: messageId,
      role,
      content: [],
      started: false,
      done: false,
    };
    state.messages.set(messageId, message);
  }
  return message;
}

function messageFromState(message: MessageState): AgentChatRuntimeMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content.map((part) => ({ ...part })),
  };
}

function appendContentEvents(
  context: RuntimeEventContext,
  state: ConnectorTurnState,
  input: {
    messageId?: string;
    role?: MessageState["role"];
    type: "text" | "reasoning";
    text: string;
    partId?: string;
    signature?: string;
  },
): AgentChatRuntimeKnownEvent[] {
  if (!input.text && !input.signature) return [];
  const message = ensureMessage(state, input.messageId, input.role);
  const events: AgentChatRuntimeKnownEvent[] = [];
  if (!message.started) {
    message.started = true;
    events.push({
      type: "message-start",
      ...baseEvent(context),
      message: messageFromState(message),
    });
  }

  const last = message.content.at(-1);
  let part = input.partId
    ? message.content.find(
        (candidate) =>
          candidate.type === input.type && candidate.id === input.partId,
      )
    : last?.type === input.type && !last.id
      ? last
      : undefined;
  if (!part) {
    const nextPart: MessageContentState =
      input.type === "reasoning"
        ? {
            type: "reasoning",
            text: "",
            ...(input.partId ? { id: input.partId } : {}),
          }
        : {
            type: "text",
            text: "",
            ...(input.partId ? { id: input.partId } : {}),
          };
    message.content.push(nextPart);
    part = nextPart;
  }
  part.text += input.text;
  if (part.type === "reasoning" && input.signature) {
    part.signature = input.signature;
  }
  events.push({
    type: "message-delta",
    ...baseEvent(context),
    messageId: message.id,
    delta:
      input.type === "reasoning"
        ? {
            type: "reasoning",
            text: input.text,
            partId: input.partId,
            signature: input.signature,
          }
        : { type: "text", text: input.text, partId: input.partId },
  });
  return events;
}

function appendTextEvents(
  context: RuntimeEventContext,
  state: ConnectorTurnState,
  input: {
    messageId?: string;
    role?: MessageState["role"];
    text: string;
    partId?: string;
  },
): AgentChatRuntimeKnownEvent[] {
  return appendContentEvents(context, state, { ...input, type: "text" });
}

function appendReasoningEvents(
  context: RuntimeEventContext,
  state: ConnectorTurnState,
  input: {
    messageId?: string;
    text: string;
    partId?: string;
    signature?: string;
  },
): AgentChatRuntimeKnownEvent[] {
  return appendContentEvents(context, state, {
    ...input,
    type: "reasoning",
  });
}

function messageHasContent(
  message: MessageState | undefined,
  type?: "text" | "reasoning",
): boolean {
  return (
    message?.content.some(
      (part) => (!type || part.type === type) && Boolean(part.text),
    ) ?? false
  );
}

function finishMessageEvents(
  context: RuntimeEventContext,
  state: ConnectorTurnState,
  messageId?: string,
): AgentChatRuntimeKnownEvent[] {
  const messages = messageId
    ? [ensureMessage(state, messageId)]
    : [...state.messages.values()];
  const events: AgentChatRuntimeKnownEvent[] = [];
  for (const message of messages) {
    if (!message.started || message.done) continue;
    message.done = true;
    events.push({
      type: "message-done",
      ...baseEvent(context),
      message: messageFromState(message),
    });
  }
  return events;
}

function ensureTool(
  state: ConnectorTurnState,
  id: string | undefined,
  name: string | undefined,
): ToolState {
  const toolId = id || runtimeConnectorId("tool");
  let tool = state.tools.get(toolId);
  if (!tool) {
    tool = {
      id: toolId,
      name: name || "tool",
      argsText: "",
      started: false,
      done: false,
    };
    state.tools.set(toolId, tool);
  }
  if (name) tool.name = name;
  return tool;
}

function startToolEvents(
  context: RuntimeEventContext,
  state: ConnectorTurnState,
  input: {
    id?: string;
    name?: string;
    input?: unknown;
  },
): AgentChatRuntimeKnownEvent[] {
  const tool = ensureTool(state, input.id, input.name);
  if (tool.started) return [];
  tool.started = true;
  return [
    {
      type: "tool-start",
      ...baseEvent(context),
      toolCall: {
        id: tool.id,
        name: tool.name,
        input: input.input,
        inputText:
          input.input === undefined
            ? undefined
            : stringifyToolValue(input.input),
      },
    },
  ];
}

function appendToolArgsEvents(
  context: RuntimeEventContext,
  state: ConnectorTurnState,
  input: {
    id?: string;
    name?: string;
    delta?: string;
  },
): AgentChatRuntimeKnownEvent[] {
  if (!input.delta) return [];
  const tool = ensureTool(state, input.id, input.name);
  tool.argsText += input.delta;
  const events = startToolEvents(context, state, {
    id: tool.id,
    name: tool.name,
  });
  events.push({
    type: "tool-delta",
    ...baseEvent(context),
    toolCallId: tool.id,
    inputTextDelta: input.delta,
  });
  return events;
}

function finishToolEvents(
  context: RuntimeEventContext,
  state: ConnectorTurnState,
  input: {
    id?: string;
    name?: string;
    result?: unknown;
    resultText?: string;
    error?: string;
  },
): AgentChatRuntimeKnownEvent[] {
  const tool = ensureTool(state, input.id, input.name);
  const events = startToolEvents(context, state, {
    id: tool.id,
    name: tool.name,
  });
  if (
    tool.done &&
    input.result === undefined &&
    !input.resultText &&
    !input.error
  ) {
    return events;
  }
  tool.done = true;
  events.push({
    type: "tool-done",
    ...baseEvent(context),
    toolCallId: tool.id,
    toolName: tool.name,
    status: input.error ? "failed" : "completed",
    result: input.result,
    resultText:
      input.resultText ??
      (input.result === undefined
        ? tool.argsText
        : stringifyToolValue(input.result)),
    error: input.error,
  });
  return events;
}

function stringifyToolValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  if (!record) return undefined;
  const direct = recordString(record, "text", "content", "output");
  if (direct) return direct;
  const content = record.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const partRecord = asRecord(part);
        return (
          recordString(partRecord, "text", "content", "value") ??
          recordString(nestedRecord(partRecord, "text"), "value")
        );
      })
      .filter(Boolean)
      .join("");
  }
  return undefined;
}

function extractToolId(
  record: Record<string, unknown> | null,
): string | undefined {
  return recordString(
    record,
    "toolCallId",
    "tool_call_id",
    "callId",
    "call_id",
    "toolUseId",
    "tool_use_id",
    "itemId",
    "item_id",
    "id",
  );
}

function extractToolName(
  record: Record<string, unknown> | null,
): string | undefined {
  return recordString(
    record,
    "toolCallName",
    "tool_call_name",
    "toolName",
    "tool_name",
    "name",
  );
}

function extractMessageId(
  event: Record<string, unknown> | null,
  state: ConnectorTurnState,
): string {
  return (
    recordString(event, "messageId", "message_id", "itemId", "item_id", "id") ??
    recordString(nestedRecord(event, "message"), "id") ??
    state.activeMessageId ??
    state.fallbackMessageId
  );
}

function extractUsage(
  record: Record<string, unknown> | null,
): AgentChatRuntimeUsage | null {
  const usage = nestedRecord(record, "usage");
  const inputTokens =
    numberValue(usage?.input_tokens) ?? numberValue(usage?.inputTokens);
  const outputTokens =
    numberValue(usage?.output_tokens) ?? numberValue(usage?.outputTokens);
  const totalTokens =
    numberValue(usage?.total_tokens) ??
    numberValue(usage?.totalTokens) ??
    (inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined);
  const costUsd =
    numberValue(record?.total_cost_usd) ?? numberValue(record?.cost_usd);
  const costCents = costUsd === undefined ? undefined : costUsd * 100;
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    costCents === undefined
  ) {
    return null;
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    costCents,
  };
}

function normalizeContentBlockType(
  block: Record<string, unknown> | null,
): string {
  return normalizeEventType(recordString(block, "type"));
}

function mapClaudeContentBlocks(
  context: RuntimeEventContext,
  state: ConnectorTurnState,
  message: Record<string, unknown>,
): AgentChatRuntimeKnownEvent[] {
  const messageId = extractMessageId(message, state);
  state.activeMessageId = messageId;
  const content = message.content;
  const events: AgentChatRuntimeKnownEvent[] = [];
  if (!Array.isArray(content)) return events;

  for (const [index, value] of content.entries()) {
    const block = asRecord(value);
    const blockType = normalizeContentBlockType(block);
    if (blockType === "TEXT") {
      const text = recordText(block, "text");
      const existing = state.messages.get(messageId);
      if (text && !messageHasContent(existing, "text")) {
        events.push(
          ...appendTextEvents(context, state, {
            messageId,
            text,
            partId: `${messageId}:content:${index}`,
          }),
        );
      }
      continue;
    }

    if (blockType === "THINKING") {
      const text = recordText(block, "thinking", "text") ?? "";
      const signature = recordString(block, "signature");
      if (text || signature) {
        events.push(
          ...appendReasoningEvents(context, state, {
            messageId,
            text,
            partId: `${messageId}:content:${index}`,
            signature,
          }),
        );
      }
      continue;
    }

    if (blockType === "TOOL_USE") {
      const toolId = extractToolId(block);
      const toolName = extractToolName(block);
      events.push(
        ...startToolEvents(context, state, {
          id: toolId,
          name: toolName,
          input: block?.input,
        }),
      );
      events.push(
        ...finishToolEvents(context, state, {
          id: toolId,
          name: toolName,
          result: block?.input,
        }),
      );
      continue;
    }

    if (blockType === "TOOL_RESULT") {
      const isError = block?.is_error === true || block?.isError === true;
      events.push(
        ...finishToolEvents(context, state, {
          id: extractToolId(block),
          name: extractToolName(block),
          result: block?.content ?? block?.result,
          resultText: extractText(block),
          error: isError ? (extractText(block) ?? "Tool failed.") : undefined,
        }),
      );
    }
  }

  events.push(...finishMessageEvents(context, state, messageId));
  return events;
}

function unwrapClaudeAgentEvent(raw: unknown): unknown {
  const record = asRecord(raw);
  const type = normalizeEventType(recordString(record, "type"));
  const event = nestedRecord(record, "event");
  if (event && (type === "STREAM_EVENT" || recordString(event, "type"))) {
    return event;
  }
  return raw;
}

function mapClaudeAgentEvent(
  raw: unknown,
  context: RuntimeEventContext,
  state: ConnectorTurnState,
): AgentChatRuntimeKnownEvent[] {
  const event = asRecord(unwrapClaudeAgentEvent(raw));
  const type = normalizeEventType(recordString(event, "type"));
  const base = baseEvent(context);
  if (!event || !type) return [];

  if (type === "MESSAGE_START") {
    const message = nestedRecord(event, "message");
    const messageId = extractMessageId(message ?? event, state);
    state.activeMessageId = messageId;
    const stateMessage = ensureMessage(state, messageId);
    if (stateMessage.started) return [];
    stateMessage.started = true;
    return [
      {
        type: "message-start",
        ...base,
        message: messageFromState(stateMessage),
      },
    ];
  }

  if (type === "CONTENT_BLOCK_START") {
    const block = nestedRecord(event, "content_block", "contentBlock");
    const blockKey = recordKey(event, "index") ?? extractToolId(block);
    const blockType = normalizeContentBlockType(block);
    const messageId = state.activeMessageId;
    const toolId =
      blockType === "TOOL_USE"
        ? (extractToolId(block) ?? (blockKey ? `tool-${blockKey}` : undefined))
        : undefined;
    const partId =
      blockKey && messageId ? `${messageId}:content:${blockKey}` : undefined;
    if (blockKey) {
      state.contentBlocks.set(blockKey, {
        messageId,
        toolId,
        partId,
        type: blockType,
      });
    }
    if (blockType === "TOOL_USE") {
      return startToolEvents(context, state, {
        id: toolId,
        name: extractToolName(block),
        input: block?.input,
      });
    }
    if (blockType === "THINKING") {
      const text = recordText(block, "thinking", "text") ?? "";
      const signature = recordString(block, "signature");
      if (text || signature) {
        return appendReasoningEvents(context, state, {
          messageId,
          text,
          partId,
          signature,
        });
      }
    }
    return [];
  }

  if (type === "CONTENT_BLOCK_DELTA") {
    const delta = nestedRecord(event, "delta");
    const deltaType = normalizeEventType(recordString(delta, "type"));
    const blockRef = state.contentBlocks.get(recordKey(event, "index") ?? "");
    if (deltaType === "TEXT_DELTA") {
      return appendTextEvents(context, state, {
        messageId: blockRef?.messageId ?? state.activeMessageId,
        text: recordText(delta, "text") ?? "",
        partId: blockRef?.partId,
      });
    }
    if (deltaType === "THINKING_DELTA") {
      return appendReasoningEvents(context, state, {
        messageId: blockRef?.messageId ?? state.activeMessageId,
        text: recordText(delta, "thinking", "text") ?? "",
        partId: blockRef?.partId,
      });
    }
    if (deltaType === "SIGNATURE_DELTA") {
      return appendReasoningEvents(context, state, {
        messageId: blockRef?.messageId ?? state.activeMessageId,
        text: "",
        partId: blockRef?.partId,
        signature: recordString(delta, "signature"),
      });
    }
    if (deltaType === "INPUT_JSON_DELTA") {
      return appendToolArgsEvents(context, state, {
        id: blockRef?.toolId ?? extractToolId(event),
        name: extractToolName(event),
        delta: recordString(delta, "partial_json", "partialJson", "text"),
      });
    }
    return [];
  }

  if (type === "CONTENT_BLOCK_STOP") {
    const blockKey = recordKey(event, "index");
    const blockRef = blockKey ? state.contentBlocks.get(blockKey) : undefined;
    if (blockKey) state.contentBlocks.delete(blockKey);
    if (blockRef?.toolId || blockRef?.type === "TOOL_USE") {
      return finishToolEvents(context, state, {
        id: blockRef.toolId,
      });
    }
    return [];
  }

  if (type === "MESSAGE_STOP") {
    return finishMessageEvents(context, state, state.activeMessageId);
  }

  if (type === "ASSISTANT" || type === "ASSISTANT_MESSAGE") {
    return mapClaudeContentBlocks(context, state, event);
  }

  if (type === "USER" || type === "USER_MESSAGE") {
    return mapClaudeContentBlocks(context, state, event);
  }

  if (type === "SYSTEM" || type === "SYSTEM_MESSAGE") {
    return [
      {
        type: "status",
        ...base,
        message:
          recordString(event, "message", "subtype") ?? "Claude agent update",
        metadata: event,
      },
    ];
  }

  if (type === "RESULT" || type === "RESULT_MESSAGE") {
    const usage = extractUsage(event);
    return [
      ...(usage ? [{ type: "usage" as const, ...base, usage }] : []),
      ...finishMessageEvents(context, state),
      {
        type: "done",
        ...base,
        reason:
          recordString(event, "subtype") === "error" ? "error" : "complete",
      },
    ];
  }

  if (type === "ERROR") {
    return [
      {
        type: "error",
        ...base,
        error:
          recordString(event, "message", "error") ??
          "Claude agent stream failed.",
        code: recordString(event, "code", "name"),
      },
      { type: "done", ...base, reason: "error" },
    ];
  }

  return [];
}

function unwrapOpenAIResponsesEvent(raw: unknown): unknown {
  const record = asRecord(raw);
  const data = asRecord(record?.data);
  return data?.event ?? data ?? raw;
}

function mapOpenAIResponsesEvent(
  raw: unknown,
  context: RuntimeEventContext,
  state: ConnectorTurnState,
): AgentChatRuntimeKnownEvent[] {
  const event = asRecord(raw);
  const type = normalizeEventType(recordString(event, "type"));
  const base = baseEvent(context);
  if (!event || !type) return [];

  if (
    type === "RESPONSE_REASONING_SUMMARY_TEXT_DELTA" ||
    type === "REASONING_SUMMARY_TEXT_DELTA" ||
    type === "RESPONSE_REASONING_TEXT_DELTA" ||
    type === "REASONING_TEXT_DELTA"
  ) {
    const messageId = recordString(event, "item_id", "itemId", "messageId");
    const index = recordKey(
      event,
      "summary_index",
      "summaryIndex",
      "content_index",
      "contentIndex",
    );
    const partKind = type.includes("SUMMARY") ? "summary" : "content";
    return appendReasoningEvents(context, state, {
      messageId,
      text: stringValue(event.delta) ?? "",
      partId: messageId
        ? `${messageId}:${partKind}:${index ?? "0"}`
        : undefined,
    });
  }

  if (
    type === "RESPONSE_REASONING_SUMMARY_TEXT_DONE" ||
    type === "REASONING_SUMMARY_TEXT_DONE" ||
    type === "RESPONSE_REASONING_TEXT_DONE" ||
    type === "REASONING_TEXT_DONE"
  ) {
    const messageId = recordString(event, "item_id", "itemId", "messageId");
    const index = recordKey(
      event,
      "summary_index",
      "summaryIndex",
      "content_index",
      "contentIndex",
    );
    const partKind = type.includes("SUMMARY") ? "summary" : "content";
    const partId = messageId
      ? `${messageId}:${partKind}:${index ?? "0"}`
      : undefined;
    const existing = state.messages
      .get(messageId ?? state.fallbackMessageId)
      ?.content.find((part) => part.type === "reasoning" && part.id === partId);
    return existing?.text
      ? []
      : appendReasoningEvents(context, state, {
          messageId,
          text: stringValue(event.text) ?? "",
          partId,
        });
  }

  if (type === "RESPONSE_OUTPUT_TEXT_DELTA" || type === "OUTPUT_TEXT_DELTA") {
    return appendTextEvents(context, state, {
      messageId: recordString(event, "item_id", "itemId", "messageId"),
      text: stringValue(event.delta) ?? "",
    });
  }

  if (type === "RESPONSE_OUTPUT_TEXT_DONE" || type === "OUTPUT_TEXT_DONE") {
    const text = stringValue(event.text);
    return [
      ...(text &&
      ![...state.messages.values()].some((message) =>
        messageHasContent(message, "text"),
      )
        ? appendTextEvents(context, state, {
            messageId: recordString(event, "item_id", "itemId", "messageId"),
            text,
          })
        : []),
      ...finishMessageEvents(
        context,
        state,
        recordString(event, "item_id", "itemId", "messageId"),
      ),
    ];
  }

  if (type === "RESPONSE_OUTPUT_ITEM_ADDED") {
    const item = nestedRecord(event, "item");
    const itemType = normalizeEventType(recordString(item, "type"));
    if (itemType.includes("FUNCTION_CALL") || extractToolName(item)) {
      return startToolEvents(context, state, {
        id: extractToolId(item),
        name: extractToolName(item),
        input: item?.arguments,
      });
    }
  }

  if (type === "RESPONSE_FUNCTION_CALL_ARGUMENTS_DELTA") {
    return appendToolArgsEvents(context, state, {
      id: extractToolId(event),
      name: extractToolName(event),
      delta: stringValue(event.delta),
    });
  }

  if (type === "RESPONSE_FUNCTION_CALL_ARGUMENTS_DONE") {
    return finishToolEvents(context, state, {
      id: extractToolId(event),
      name: extractToolName(event),
      resultText: recordString(event, "arguments", "text"),
    });
  }

  if (type === "RESPONSE_OUTPUT_ITEM_DONE") {
    const item = nestedRecord(event, "item");
    const itemType = normalizeEventType(recordString(item, "type"));
    if (itemType.includes("FUNCTION_CALL") || extractToolName(item)) {
      return finishToolEvents(context, state, {
        id: extractToolId(item),
        name: extractToolName(item),
        resultText: recordString(item, "arguments", "output"),
      });
    }
    if (itemType === "REASONING") return [];
    const text = extractText(item);
    if (
      text &&
      ![...state.messages.values()].some((message) =>
        messageHasContent(message, "text"),
      )
    ) {
      return [
        ...appendTextEvents(context, state, {
          messageId: recordString(item, "id"),
          text,
        }),
        ...finishMessageEvents(context, state, recordString(item, "id")),
      ];
    }
  }

  if (type === "RESPONSE_COMPLETED" || type === "RESPONSE_DONE") {
    return [
      ...finishMessageEvents(context, state),
      { type: "done", ...base, reason: "complete" },
    ];
  }

  if (type === "RESPONSE_FAILED" || type === "RESPONSE_ERROR") {
    const error = nestedRecord(event, "error");
    return [
      {
        type: "error",
        ...base,
        error:
          recordString(error, "message", "error") ??
          recordString(event, "message", "error") ??
          "OpenAI agent stream failed.",
        code: recordString(error, "code", "type"),
      },
      { type: "done", ...base, reason: "error" },
    ];
  }

  if (type === "RESPONSE_INCOMPLETE") {
    return [
      ...finishMessageEvents(context, state),
      { type: "done", ...base, reason: "interrupted" },
    ];
  }

  return [];
}

function mapOpenAIAgentsEvent(
  raw: unknown,
  context: RuntimeEventContext,
  state: ConnectorTurnState,
): AgentChatRuntimeKnownEvent[] {
  const event = asRecord(raw);
  const type = normalizeEventType(recordString(event, "type"));
  const base = baseEvent(context);
  if (!event || !type) return [];

  if (type === "RAW_MODEL_STREAM_EVENT" || type === "RAW_RESPONSE_EVENT") {
    return mapOpenAIResponsesEvent(
      unwrapOpenAIResponsesEvent(raw),
      context,
      state,
    );
  }

  if (type === "RUN_ITEM_STREAM_EVENT") {
    const name = normalizeEventType(recordString(event, "name"));
    const item = nestedRecord(event, "item");
    if (name === "MESSAGE_OUTPUT_CREATED") {
      const text = extractText(item);
      if (
        !text ||
        [...state.messages.values()].some((message) =>
          messageHasContent(message, "text"),
        )
      ) {
        return [];
      }
      const messageId = recordString(item, "id") ?? state.fallbackMessageId;
      return [
        ...appendTextEvents(context, state, { messageId, text }),
        ...finishMessageEvents(context, state, messageId),
      ];
    }
    if (
      name === "TOOL_CALLED" ||
      name === "TOOL_SEARCH_CALLED" ||
      name === "MCP_LIST_TOOLS"
    ) {
      return startToolEvents(context, state, {
        id: extractToolId(item) ?? extractToolId(event),
        name:
          extractToolName(item) ?? extractToolName(event) ?? name.toLowerCase(),
        input: item?.arguments ?? item?.input,
      });
    }
    if (name === "TOOL_OUTPUT" || name === "TOOL_SEARCH_OUTPUT_CREATED") {
      return finishToolEvents(context, state, {
        id: extractToolId(item) ?? extractToolId(event),
        name: extractToolName(item) ?? extractToolName(event),
        result: item?.output ?? item?.result ?? item?.content ?? item,
      });
    }
    if (name === "MCP_APPROVAL_REQUESTED") {
      const approvalId =
        recordString(item, "approvalKey", "approval_key", "id") ??
        runtimeConnectorId("approval");
      return [
        {
          type: "approval-request",
          ...base,
          approvalId,
          toolCallId: extractToolId(item),
          toolName: extractToolName(item),
          message:
            recordString(item, "message", "label") ?? "Approve this tool call?",
          input: item?.input ?? item?.arguments,
        },
      ];
    }
    if (
      name === "HANDOFF_REQUESTED" ||
      name === "HANDOFF_OCCURRED" ||
      name === "HANDOFF_OCCURED"
    ) {
      return [
        {
          type: "status",
          ...base,
          message:
            name === "HANDOFF_REQUESTED"
              ? "Agent handoff requested"
              : "Agent handoff completed",
          metadata: item ?? undefined,
        },
      ];
    }
  }

  if (type === "AGENT_UPDATED_STREAM_EVENT") {
    const agent = nestedRecord(event, "new_agent", "newAgent");
    return [
      {
        type: "status",
        ...base,
        message: `Switched to ${recordString(agent, "name") ?? "another agent"}`,
        metadata: agent ?? undefined,
      },
    ];
  }

  return mapOpenAIResponsesEvent(raw, context, state);
}

function mapVercelAiEvent(
  raw: unknown,
  context: RuntimeEventContext,
  state: ConnectorTurnState,
): AgentChatRuntimeKnownEvent[] {
  const event = asRecord(raw);
  const type = normalizeEventType(recordString(event, "type"));
  const base = baseEvent(context);
  if (!event || !type) return [];
  const vercelMessageId =
    recordString(event, "messageId", "message_id") ??
    state.activeMessageId ??
    state.fallbackMessageId;

  if (type === "START") {
    const messageId = vercelMessageId;
    state.activeMessageId = messageId;
    const message = ensureMessage(state, messageId);
    if (message.started) return [];
    message.started = true;
    return [
      {
        type: "message-start",
        ...base,
        message: messageFromState(message),
      },
    ];
  }

  if (type === "TEXT_START" || type === "REASONING_START") {
    const messageId = vercelMessageId;
    state.activeMessageId = messageId;
    const message = ensureMessage(state, messageId);
    if (message.started) return [];
    message.started = true;
    return [
      {
        type: "message-start",
        ...base,
        message: messageFromState(message),
      },
    ];
  }

  if (type === "TEXT_DELTA") {
    return appendTextEvents(context, state, {
      messageId: vercelMessageId,
      text: recordText(event, "delta", "text") ?? "",
      partId: recordString(event, "id"),
    });
  }

  if (type === "TEXT_END" || type === "REASONING_END") {
    return [];
  }

  if (type === "REASONING_DELTA") {
    return appendReasoningEvents(context, state, {
      messageId: vercelMessageId,
      text: recordText(event, "delta", "text") ?? "",
      partId: recordString(event, "id"),
    });
  }

  if (type === "TOOL_INPUT_START") {
    return startToolEvents(context, state, {
      id: extractToolId(event),
      name: extractToolName(event),
    });
  }

  if (type === "TOOL_INPUT_DELTA") {
    return appendToolArgsEvents(context, state, {
      id: extractToolId(event),
      name: extractToolName(event),
      delta: recordString(event, "inputTextDelta", "delta", "text"),
    });
  }

  if (type === "TOOL_INPUT_AVAILABLE") {
    return startToolEvents(context, state, {
      id: extractToolId(event),
      name: extractToolName(event),
      input: event.input,
    });
  }

  if (type === "TOOL_OUTPUT_AVAILABLE") {
    return finishToolEvents(context, state, {
      id: extractToolId(event),
      name: extractToolName(event),
      result: event.output,
      resultText:
        recordString(event, "outputText", "resultText", "text") ??
        (event.output === undefined
          ? undefined
          : stringifyToolValue(event.output)),
    });
  }

  if (type === "SOURCE_URL" || type === "SOURCE_DOCUMENT") {
    return [
      {
        type: "artifact",
        ...base,
        artifact: {
          id: recordString(event, "sourceId", "source_id", "id"),
          kind: type === "SOURCE_URL" ? "source-url" : "source-document",
          title: recordString(event, "title"),
          url: recordString(event, "url"),
          data: event,
        },
      },
    ];
  }

  if (type === "FILE") {
    return [
      {
        type: "artifact",
        ...base,
        artifact: {
          id: recordString(event, "id", "fileId", "file_id"),
          kind: "file",
          title: recordString(event, "filename", "title"),
          url: recordString(event, "url"),
          data: event,
        },
      },
    ];
  }

  if (type.startsWith("DATA_")) {
    return [
      {
        type: "message-delta",
        ...base,
        messageId: vercelMessageId,
        delta: {
          type: "data",
          data: event.data ?? event,
          partId: recordString(event, "id"),
        },
      },
    ];
  }

  if (type === "ERROR") {
    return [
      {
        type: "error",
        ...base,
        error:
          recordString(event, "errorText", "message", "error") ??
          "AI SDK stream failed.",
        code: recordString(event, "code"),
      },
      { type: "done", ...base, reason: "error" },
    ];
  }

  if (type === "ABORT") {
    return [
      ...finishMessageEvents(context, state),
      { type: "done", ...base, reason: "cancelled" },
    ];
  }

  if (type === "FINISH") {
    const usage = extractUsage(event);
    return [
      ...(usage ? [{ type: "usage" as const, ...base, usage }] : []),
      ...finishMessageEvents(context, state),
      { type: "done", ...base, reason: "complete" },
    ];
  }

  if (type === "START_STEP" || type === "FINISH_STEP") {
    return [
      {
        type: "status",
        ...base,
        message: type === "START_STEP" ? "Step started" : "Step finished",
      },
    ];
  }

  return [];
}

function mapAgUiEvent(
  raw: unknown,
  context: RuntimeEventContext,
  state: ConnectorTurnState,
): AgentChatRuntimeKnownEvent[] {
  const event = asRecord(raw);
  const type = normalizeEventType(recordString(event, "type"));
  const base = baseEvent(context);
  if (!event || !type) return [];

  if (type === "RUN_STARTED") {
    return [
      {
        type: "status",
        ...base,
        message: "Agent run started",
      },
    ];
  }

  if (type === "RUN_FINISHED") {
    return [
      ...finishMessageEvents(context, state),
      { type: "done", ...base, reason: "complete" },
    ];
  }

  if (type === "RUN_ERROR") {
    return [
      {
        type: "error",
        ...base,
        error:
          recordString(event, "message", "error") ??
          "AG-UI agent stream failed.",
        code: recordString(event, "code"),
      },
      { type: "done", ...base, reason: "error" },
    ];
  }

  if (type === "STEP_STARTED" || type === "STEP_FINISHED") {
    return [
      {
        type: "status",
        ...base,
        message:
          recordString(event, "stepName", "step_name") ??
          (type === "STEP_STARTED" ? "Step started" : "Step finished"),
      },
    ];
  }

  if (type === "TEXT_MESSAGE_START") {
    const messageId = recordString(event, "messageId", "message_id");
    state.activeMessageId = messageId ?? state.activeMessageId;
    const message = ensureMessage(
      state,
      messageId,
      (recordString(event, "role") as MessageState["role"]) ?? "assistant",
    );
    if (message.started) return [];
    message.started = true;
    return [
      {
        type: "message-start",
        ...base,
        message: messageFromState(message),
      },
    ];
  }

  if (type === "TEXT_MESSAGE_CONTENT" || type === "TEXT_MESSAGE_CHUNK") {
    return appendTextEvents(context, state, {
      messageId: recordString(event, "messageId", "message_id"),
      role:
        (recordString(event, "role") as MessageState["role"]) ?? "assistant",
      text: stringValue(event.delta) ?? "",
    });
  }

  if (type === "TEXT_MESSAGE_END") {
    return finishMessageEvents(
      context,
      state,
      recordString(event, "messageId", "message_id"),
    );
  }

  if (type === "TOOL_CALL_START") {
    return startToolEvents(context, state, {
      id: extractToolId(event),
      name: extractToolName(event),
    });
  }

  if (type === "TOOL_CALL_ARGS") {
    return appendToolArgsEvents(context, state, {
      id: extractToolId(event),
      name: extractToolName(event),
      delta: stringValue(event.delta),
    });
  }

  if (type === "TOOL_CALL_END") {
    return finishToolEvents(context, state, {
      id: extractToolId(event),
      name: extractToolName(event),
    });
  }

  if (type === "TOOL_CALL_RESULT") {
    return finishToolEvents(context, state, {
      id: extractToolId(event),
      name: extractToolName(event),
      resultText: recordString(event, "content", "result", "text"),
    });
  }

  if (type === "REASONING_MESSAGE_CONTENT") {
    const messageId =
      recordString(event, "messageId", "message_id") ??
      state.activeReasoningMessageId ??
      state.activeMessageId;
    state.activeReasoningMessageId = messageId;
    return appendReasoningEvents(context, state, {
      messageId,
      text: stringValue(event.delta) ?? "",
      partId: messageId,
    });
  }

  if (type === "REASONING_MESSAGE_START") {
    const messageId = recordString(event, "messageId", "message_id");
    state.activeReasoningMessageId = messageId;
    const message = ensureMessage(state, messageId);
    if (message.started) return [];
    message.started = true;
    return [
      {
        type: "message-start",
        ...base,
        message: messageFromState(message),
      },
    ];
  }

  if (type === "REASONING_MESSAGE_END" || type === "REASONING_END") {
    const messageId =
      recordString(event, "messageId", "message_id") ??
      state.activeReasoningMessageId;
    state.activeReasoningMessageId = undefined;
    return finishMessageEvents(context, state, messageId);
  }

  if (type === "REASONING_MESSAGE_CHUNK") {
    const messageId =
      recordString(event, "messageId", "message_id") ??
      state.activeReasoningMessageId;
    state.activeReasoningMessageId = messageId;
    const delta = stringValue(event.delta) ?? "";
    return delta
      ? appendReasoningEvents(context, state, {
          messageId,
          text: delta,
          partId: messageId,
        })
      : finishMessageEvents(context, state, messageId);
  }

  return [];
}

function createConnectorMapEvent(
  mapper: (
    event: unknown,
    context: RuntimeEventContext,
    state: ConnectorTurnState,
  ) =>
    | AgentChatRuntimeKnownEvent
    | readonly AgentChatRuntimeKnownEvent[]
    | null,
) {
  const states = new Map<string, ConnectorTurnState>();
  return (event: unknown, context: RuntimeEventContext) => {
    const key = turnKey(context);
    let state = states.get(key);
    if (!state) {
      state = {
        fallbackMessageId: runtimeConnectorId("message"),
        messages: new Map(),
        tools: new Map(),
        contentBlocks: new Map(),
      };
      states.set(key, state);
    }
    const mapped = mapper(event, context, state);
    const mappedEvents = Array.isArray(mapped)
      ? mapped
      : mapped
        ? [mapped]
        : [];
    if (
      mappedEvents.some(
        (runtimeEvent) =>
          runtimeEvent.type === "done" || runtimeEvent.type === "error",
      )
    ) {
      states.delete(key);
    }
    return mapped;
  };
}

export function createOpenAIResponsesChatRuntime(
  options: CreateOpenAIResponsesChatRuntimeOptions,
): AgentChatRuntime<AgentChatRuntimeKnownEvent> {
  return createHttpAgentChatRuntime({
    id: "external:openai-responses",
    kind: "external-agent",
    label: "OpenAI Responses",
    ...options,
    mapEvent: createConnectorMapEvent(mapOpenAIResponsesEvent),
  });
}

export function createOpenAIAgentsChatRuntime(
  options: CreateOpenAIAgentsChatRuntimeOptions,
): AgentChatRuntime<AgentChatRuntimeKnownEvent> {
  return createHttpAgentChatRuntime({
    id: "external:openai-agents",
    kind: "external-agent",
    label: "OpenAI Agents",
    ...options,
    mapEvent: createConnectorMapEvent(mapOpenAIAgentsEvent),
  });
}

export function createAgUiChatRuntime(
  options: CreateAgUiChatRuntimeOptions,
): AgentChatRuntime<AgentChatRuntimeKnownEvent> {
  return createHttpAgentChatRuntime({
    id: "external:ag-ui",
    kind: "external-agent",
    label: "AG-UI",
    ...options,
    mapEvent: createConnectorMapEvent(mapAgUiEvent),
  });
}

export function createClaudeAgentChatRuntime(
  options: CreateClaudeAgentChatRuntimeOptions,
): AgentChatRuntime<AgentChatRuntimeKnownEvent> {
  return createHttpAgentChatRuntime({
    id: "external:claude-agent",
    kind: "external-agent",
    label: "Claude Agent SDK",
    ...options,
    mapEvent: createConnectorMapEvent(mapClaudeAgentEvent),
  });
}

export function createVercelAiChatRuntime(
  options: CreateVercelAiChatRuntimeOptions,
): AgentChatRuntime<AgentChatRuntimeKnownEvent> {
  return createHttpAgentChatRuntime({
    id: "external:vercel-ai",
    kind: "external-agent",
    label: "Vercel AI SDK",
    ...options,
    mapEvent: createConnectorMapEvent(mapVercelAiEvent),
  });
}
