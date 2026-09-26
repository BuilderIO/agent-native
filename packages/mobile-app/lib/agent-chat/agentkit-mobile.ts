import {
  createAgentKitClient,
  type AgentKitController,
  type AgentThreadState,
} from "@agent-native/agentkit";
import type {
  AgentActionResult,
  AgentEvent,
  AgentMessage,
  AgentMessagePart,
  FilePart,
} from "@agent-native/agentkit/protocol";
import { createAgentNativeAgentKitTransport } from "@agent-native/core/client/agentkit-chat/transport";
import { formatChatErrorText } from "@agent-native/core/client/chat-errors";
import { fetch as expoFetch } from "expo/fetch";

import {
  AgentChatError,
  callAppAction,
  getMobileAgentChatHeaders,
} from "./api";
import type {
  ChatAttachment,
  ChatContentPart,
  ChatMessage,
  ChatTurnState,
  MobileChatScope,
  WireEvent,
} from "./types";

export const MOBILE_CHAT_METADATA = "x-agent-native-mobile-chat";

export interface MobileAgentKitSettings {
  model?: string;
  engine?: string;
  effort?: string;
  mode?: "act" | "plan";
}

export interface MobileAgentKitSession {
  client: AgentKitController;
  dispose(): Promise<void>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function agentChatTransportFetch(
  input: Parameters<typeof expoFetch>[0],
  init?: Parameters<typeof expoFetch>[1],
): ReturnType<typeof expoFetch> {
  const response = await expoFetch(input, init);
  if (response.ok || response.status === 404) return response;
  const body = await response
    .clone()
    .text()
    .catch(() => ""); // coercion-ok: response.status still identifies the failed HTTP request.
  let message = body.slice(0, 300) || `HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === "string") message = parsed.error;
    else if (typeof parsed.message === "string") message = parsed.message;
  } catch {
    // coercion-ok: the raw error body or HTTP status still identifies the failed request.
    // Keep the response body when it is not JSON.
  }
  throw new AgentChatError(message, response.status);
}

function textContent(message: AgentMessage): string {
  return message.parts
    .filter(
      (part): part is Extract<AgentMessagePart, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
}

function messageHistory(
  messages: readonly AgentMessage[],
  omitMessageId?: string,
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        message.id !== omitMessageId,
    )
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: textContent(message),
    }))
    .filter((message) => message.content.trim().length > 0);
}

function formatAgentKitRunError(error: { code: string; message: string }) {
  return {
    message: formatChatErrorText(error.message, undefined, error.code),
    code:
      error.code === "AGENT_CHAT_AI_SETUP_REQUIRED"
        ? "missing_api_key"
        : error.code,
  };
}

export function mobileAttachmentsToAgentKitFiles(
  attachments: ChatAttachment[] = [],
): FilePart[] {
  return attachments.flatMap((attachment) => {
    const url =
      attachment.url ??
      attachment.data ??
      (attachment.text
        ? `data:text/plain,${encodeURIComponent(attachment.text)}`
        : undefined);
    if (!url) return [];
    return [
      {
        type: "file",
        name: attachment.name,
        ...(attachment.contentType
          ? { mediaType: attachment.contentType }
          : {}),
        url,
      },
    ];
  });
}

function mobilePartToChatParts(part: AgentMessagePart): ChatContentPart[] {
  if (part.type === "text") {
    return part.text ? [{ type: "text", text: part.text }] : [];
  }
  if (part.type === "reasoning") {
    return [{ type: "reasoning", text: part.text }];
  }
  if (part.type === "file") {
    if (part.mediaType?.startsWith("image/") && part.url) {
      return [{ type: "image", dataUrl: part.url, name: part.name }];
    }
    return [];
  }
  if (part.type === "widget") {
    return [{ type: "widget", widget: part.widget }];
  }
  if (part.type !== "data") return [];
  const data = record(part.data);
  if (data?.kind === "agent-native/connection-required") {
    const provider =
      typeof data.provider === "string" ? data.provider : "integration";
    return [
      {
        type: "connection-request",
        id: typeof data.id === "string" ? data.id : provider,
        provider,
        ...(typeof data.reason === "string" ? { reason: data.reason } : {}),
        ...(typeof data.detail === "string" ? { detail: data.detail } : {}),
        ...(typeof data.appId === "string" ? { appId: data.appId } : {}),
        ...(data.status === "requested" ||
        data.status === "connecting" ||
        data.status === "connected" ||
        data.status === "declined" ||
        data.status === "failed"
          ? { status: data.status }
          : {}),
      },
    ];
  }
  if (
    !data ||
    (part.mediaType !== "application/x-agent-native-repository-part" &&
      data.type !== "tool-call")
  ) {
    return [];
  }
  const toolCallId =
    typeof data.toolCallId === "string"
      ? data.toolCallId
      : typeof data.id === "string"
        ? data.id
        : undefined;
  const toolName =
    typeof data.toolName === "string"
      ? data.toolName
      : typeof data.name === "string"
        ? data.name
        : undefined;
  if (!toolCallId || !toolName) return [];
  return [
    {
      type: "tool-call",
      toolCallId,
      toolName,
      inputText:
        typeof data.argsText === "string"
          ? data.argsText
          : typeof data.inputText === "string"
            ? data.inputText
            : JSON.stringify(data.args ?? data.input ?? ""),
      status: "completed",
      ...(data.completedSideEffect === true
        ? { completedSideEffect: true }
        : {}),
      ...(data.mcpApp === undefined ? {} : { mcpApp: data.mcpApp }),
      ...(data.chatUI === undefined ? {} : { chatUI: data.chatUI }),
      ...(typeof data.resultText === "string"
        ? { resultText: data.resultText }
        : typeof data.result === "string"
          ? { resultText: data.result }
          : {}),
    },
  ];
}

function timestamp(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

export function agentKitThreadToMobileMessages(
  thread: AgentThreadState,
): ChatMessage[] {
  return thread.messages.flatMap((message) => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    const parts = message.parts.flatMap(mobilePartToChatParts);
    if (parts.length === 0) return [];
    return [
      {
        id: message.id,
        role: message.role,
        parts,
        createdAt: timestamp(message.createdAt),
        ...(record(message.metadata)
          ? { metadata: record(message.metadata)! }
          : {}),
      },
    ];
  });
}

export function agentKitThreadToMobileHistory(
  thread: AgentThreadState,
): Array<{ role: "user" | "assistant"; content: string }> {
  return messageHistory(thread.messages);
}

export function agentKitThreadToMobileTurnState(
  thread: AgentThreadState,
): ChatTurnState {
  const activeRun = [...thread.activeRunIds]
    .reverse()
    .map((runId) => thread.runs[runId])
    .find(
      (run) =>
        run?.status === "running" ||
        run?.status === "queued" ||
        run?.status === "awaiting_approval" ||
        run?.status === "awaiting_input",
    );
  const activeActivity = Object.values(thread.activities).find(
    (activity) => activity.status === "running",
  );
  const latestError = [...Object.values(thread.runs)]
    .reverse()
    .find((run) => run.status === "failed")?.error;
  const formattedError = latestError
    ? formatAgentKitRunError(latestError)
    : null;
  return {
    messages: agentKitThreadToMobileMessages(thread),
    activity: activeActivity?.label ?? null,
    isStreaming: Boolean(activeRun),
    error: formattedError?.message ?? null,
    errorCode: formattedError?.code ?? null,
    runId: activeRun?.id ?? null,
  };
}

export function createMobileAgentKitSession(input: {
  baseUrl: string;
  settings: MobileAgentKitSettings;
  scope?: MobileChatScope;
  onError?: (error: Error) => void;
}): MobileAgentKitSession {
  const transport = createAgentNativeAgentKitTransport({
    apiUrl: `${input.baseUrl}/_agent-native/agent-chat`,
    fetch: agentChatTransportFetch,
    headers: getMobileAgentChatHeaders,
    ...(input.settings.engine ? { engine: input.settings.engine } : {}),
    ...(input.settings.mode ? { mode: input.settings.mode } : {}),
    ...(input.scope ? { scope: input.scope } : {}),
    operations: {
      invokeAction: async ({ invocation }): Promise<AgentActionResult> => {
        try {
          const payload = record(invocation.payload) ?? {};
          const data = await callAppAction(
            invocation.action,
            payload,
            input.baseUrl,
          );
          return {
            invocationId: invocation.id,
            status: "completed",
            data,
          };
        } catch (error) {
          return {
            invocationId: invocation.id,
            status: "failed",
            error: {
              code: "action_failed",
              message:
                error instanceof Error ? error.message : "Action failed.",
              retryable: true,
            },
          };
        }
      },
    },
  });
  const client = createAgentKitClient({
    transport,
    transportOwnership: "owned",
    reconnect: { attempts: 3 },
    ...(input.onError
      ? {
          onError: (error) => input.onError?.(new Error(error.message)),
        }
      : {}),
  });
  return { client, dispose: () => client.dispose() };
}

export function mobileAgentKitEventToWireEvent(
  event: AgentEvent,
): WireEvent | null {
  switch (event.type) {
    case "message.delta":
      return { type: "text", text: event.text, partId: event.messageId };
    case "reasoning.delta":
      return { type: "reasoning", text: event.text, partId: event.messageId };
    case "activity.started":
    case "activity.updated":
      return {
        type: "activity",
        id: event.activity.id,
        label: event.activity.label,
      };
    case "tool.started":
      return {
        type: "tool_start",
        id: event.toolCall.id,
        tool: event.toolCall.name,
        input: event.toolCall.input,
      };
    case "tool.updated": {
      const metadata = record(event.toolCall.metadata);
      return {
        type: "tool_done",
        id: event.toolCall.id,
        toolCallId: event.toolCall.id,
        tool: event.toolCall.name,
        result: event.toolCall.output,
        error: event.toolCall.error?.message,
        isError: event.toolCall.status === "failed",
        ...(metadata?.completedSideEffect === true
          ? { completedSideEffect: true }
          : {}),
        ...(metadata?.mcpApp === undefined ? {} : { mcpApp: metadata.mcpApp }),
        ...(metadata?.chatUI === undefined ? {} : { chatUI: metadata.chatUI }),
      };
    }
    case "approval.requested": {
      const metadata = record(event.request.metadata);
      return {
        type: "approval_required",
        id: event.request.id,
        approvalKey: event.request.id,
        label: event.request.title,
        ...(typeof metadata?.toolCallId === "string"
          ? { toolCallId: metadata.toolCallId }
          : {}),
        ...(typeof metadata?.toolName === "string"
          ? { tool: metadata.toolName }
          : {}),
        ...(metadata?.input === undefined ? {} : { input: metadata.input }),
      };
    }
    case "connection.requested":
    case "connection.updated":
      return {
        type: "connection_required",
        id: event.request.id,
        provider: event.request.provider,
        reason: event.request.reason,
        status: event.request.status,
        ...(event.request.appId ? { appId: event.request.appId } : {}),
        ...(event.request.detail ? { detail: event.request.detail } : {}),
      };
    case "widget.created":
    case "widget.updated":
      return { type: "widget", id: event.widget.id, widget: event.widget };
    case "run.completed":
    case "run.cancelled":
      return { type: "done" };
    case "run.failed": {
      const formattedError = formatAgentKitRunError(event.error);
      return {
        type: "error",
        error: formattedError.message,
        errorCode: formattedError.code,
        recoverable: event.error.retryable,
      };
    }
    default:
      return null;
  }
}
