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
  AgentUploadTarget,
  FilePart,
} from "@agent-native/agentkit/protocol";
import { createAgentNativeAgentKitTransport } from "@agent-native/core/client/agentkit-chat/transport";
import { formatChatErrorText } from "@agent-native/core/client/chat-errors";
import { fetch as expoFetch } from "expo/fetch";

import {
  AgentChatError,
  callAppAction,
  getMobileAgentChatHeaders,
  readErrorMessage,
} from "./api";
import { nextLocalId } from "./reducer";
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
  return attachments.map((attachment) => {
    if (
      attachment.data !== undefined ||
      attachment.text !== undefined ||
      !isStoredAttachmentReference(attachment.url)
    ) {
      throw new Error(
        `Attachment ${attachment.name} must be uploaded before it can be sent.`,
      );
    }
    return {
      type: "file",
      name: attachment.name,
      ...(attachment.contentType ? { mediaType: attachment.contentType } : {}),
      url: attachment.url,
    };
  });
}

function isDataUrl(value: string | undefined): value is string {
  return typeof value === "string" && /^data:/i.test(value);
}

function isStoredAttachmentReference(
  value: string | undefined,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !/^(?:data|blob|file):/i.test(value)
  );
}

function attachmentToBlob(attachment: ChatAttachment): {
  body: Blob;
  mediaType: string;
} {
  const dataUrl =
    attachment.data ?? (isDataUrl(attachment.url) ? attachment.url : undefined);
  if (dataUrl) {
    const comma = dataUrl.indexOf(",");
    if (!isDataUrl(dataUrl) || comma < 0) {
      throw new TypeError(
        `Attachment ${attachment.name} has invalid file data.`,
      );
    }
    const metadata = dataUrl.slice(5, comma).split(";");
    const mediaType =
      attachment.contentType || metadata[0] || "application/octet-stream";
    const payload = dataUrl.slice(comma + 1);
    const isBase64 = metadata.some((part) => part.toLowerCase() === "base64");
    let body: Blob;
    if (isBase64) {
      const bytes = Uint8Array.from(atob(payload), (character) =>
        character.charCodeAt(0),
      );
      body = new Blob([bytes], { type: mediaType });
    } else {
      body = new Blob([decodeURIComponent(payload)], { type: mediaType });
    }
    return { body, mediaType };
  }
  if (attachment.text !== undefined) {
    const mediaType = attachment.contentType ?? "text/plain";
    return {
      body: new Blob([attachment.text], { type: mediaType }),
      mediaType,
    };
  }
  throw new TypeError(
    `Attachment ${attachment.name} has no uploadable file content.`,
  );
}

/** Upload staged bytes first, so AgentKit only receives durable file references. */
export async function uploadMobileChatAttachments(
  client: AgentKitController,
  threadId: string,
  attachments: ChatAttachment[] = [],
): Promise<ChatAttachment[]> {
  const pending: Array<{
    attachmentIndex: number;
    body: Blob;
    mediaType: string;
    name: string;
  }> = [];
  const references = new Map<number, string>();

  attachments.forEach((attachment, attachmentIndex) => {
    if (isStoredAttachmentReference(attachment.url)) {
      references.set(attachmentIndex, attachment.url);
      return;
    }
    const { body, mediaType } = attachmentToBlob(attachment);
    pending.push({
      attachmentIndex,
      body,
      mediaType,
      name: attachment.name,
    });
  });

  if (pending.length) {
    const uploaded = await client.uploadFiles(
      threadId,
      pending.map(({ body, mediaType, name }) => ({
        name,
        mediaType,
        size: body.size,
        body,
      })),
    );
    if (uploaded.length !== pending.length) {
      throw new TypeError("File upload did not return every attachment.");
    }
    uploaded.forEach((file, index) => {
      if (!isStoredAttachmentReference(file.url)) {
        throw new TypeError(
          "File upload response did not include a stored URL.",
        );
      }
      references.set(pending[index]!.attachmentIndex, file.url);
    });
  }

  return attachments.map((attachment, index) => {
    const url = references.get(index);
    if (!url) {
      throw new TypeError(`File upload omitted ${attachment.name}.`);
    }
    return {
      type: attachment.type,
      name: attachment.name,
      ...(attachment.contentType
        ? { contentType: attachment.contentType }
        : {}),
      url,
    };
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
  const uploadedFiles = new Map<string, FilePart>();
  const transport = createAgentNativeAgentKitTransport({
    apiUrl: `${input.baseUrl}/_agent-native/agent-chat`,
    fetch: agentChatTransportFetch,
    headers: getMobileAgentChatHeaders,
    ...(input.settings.engine ? { engine: input.settings.engine } : {}),
    ...(input.settings.mode ? { mode: input.settings.mode } : {}),
    ...(input.scope ? { scope: input.scope } : {}),
    operations: {
      createUpload: async () =>
        ({
          uploadId: nextLocalId("upload") as AgentUploadTarget["uploadId"],
          method: "POST",
          url: `${input.baseUrl.replace(/\/+$/, "")}/_agent-native/file-upload`,
          fields: {},
        }) satisfies AgentUploadTarget,
      completeUpload: async ({ uploadId }) => {
        const uploaded = uploadedFiles.get(uploadId);
        if (!uploaded) {
          throw new Error(`Upload ${uploadId} did not complete.`);
        }
        uploadedFiles.delete(uploadId);
        return uploaded;
      },
      cancelUpload: async ({ uploadId }) => {
        uploadedFiles.delete(uploadId);
      },
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
    upload: async (target, file, context) => {
      const form = new FormData();
      for (const [key, value] of Object.entries(target.fields ?? {})) {
        form.append(key, value);
      }
      form.append("file", file.body, file.name);
      const headers = await getMobileAgentChatHeaders();
      delete headers["Content-Type"];
      const response = await expoFetch(target.url, {
        method: target.method,
        headers,
        body: form,
        signal: context?.signal,
      });
      if (!response.ok) {
        throw new AgentChatError(
          await readErrorMessage(response),
          response.status,
        );
      }
      const uploaded: unknown = await response.json();
      const result = record(uploaded);
      if (typeof result?.url !== "string" || !result.url) {
        throw new TypeError("File upload response did not include a URL.");
      }
      uploadedFiles.set(target.uploadId, {
        type: "file",
        name: file.name,
        mediaType: file.mediaType,
        url: result.url,
        ...(typeof result.id === "string" ? { fileId: result.id } : {}),
      });
    },
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
