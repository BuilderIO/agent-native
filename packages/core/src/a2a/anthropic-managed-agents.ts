import type { AgentChatRuntimeApprovalRequestEvent } from "../client/chat/runtime.js";
import { ssrfSafeFetch } from "../extensions/url-safety.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import {
  RemoteAgentCredentialRejectedError,
  resolveRemoteAgentToken,
  type RemoteAgentCredentialContext,
} from "./remote-agent-auth.js";
import type {
  A2AHandler,
  A2AHandlerContext,
  A2AHandlerResult,
  Message,
} from "./types.js";

export const ANTHROPIC_MANAGED_AGENTS_BETA_HEADER = "managed-agents-2026-04-01";
export const ANTHROPIC_MANAGED_AGENTS_API_URL = "https://api.anthropic.com";
export const ANTHROPIC_MANAGED_AGENTS_METADATA_KEY =
  "agent-native/anthropic-managed-agents";

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const MAX_ERROR_BODY_CHARS = 500;

export interface AnthropicManagedAgentContinuation {
  sessionId: string;
  pendingToolUseIds?: string[];
}

export interface AnthropicManagedAgentConfirmation {
  toolUseId: string;
  result: "allow" | "deny";
  denyMessage?: string;
}

export interface AnthropicManagedAgentApproval {
  id: string;
  toolName?: string;
  input?: unknown;
}

export type AnthropicManagedAgentRuntimeEvent =
  AgentChatRuntimeApprovalRequestEvent;

export interface AnthropicManagedAgentHandlerOptions {
  agentId: string;
  environmentId: string;
  /** Name of the vault credential containing the Anthropic API key. */
  credentialRef: string;
  /** Injectable endpoint for a local fixture; production defaults to Claude Platform. */
  apiBaseUrl?: string;
  fetch?: typeof fetch;
  resolveApiKey?: (
    credentialRef: string,
    context: RemoteAgentCredentialContext,
  ) => Promise<string | undefined>;
  onRuntimeEvent?: (
    event: AnthropicManagedAgentRuntimeEvent,
  ) => void | Promise<void>;
  requestTimeoutMs?: number;
}

/** Plural alias matching the provider name used in configuration. */
export type AnthropicManagedAgentsHandlerOptions =
  AnthropicManagedAgentHandlerOptions;

export type AnthropicManagedAgentEvent = Record<string, unknown>;

export type AnthropicManagedAgentsErrorCode =
  | "invalid_config"
  | "credential_missing"
  | "api_error"
  | "invalid_response"
  | "stream_error"
  | "approval_required"
  | "unsupported_action";

export class AnthropicManagedAgentsError extends Error {
  readonly code: AnthropicManagedAgentsErrorCode;
  readonly statusCode?: number;

  constructor(options: {
    code: AnthropicManagedAgentsErrorCode;
    message: string;
    statusCode?: number;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "AnthropicManagedAgentsError";
    this.code = options.code;
    this.statusCode = options.statusCode;
  }
}

interface ManagedAgentMetadata extends AnthropicManagedAgentContinuation {
  confirmations?: AnthropicManagedAgentConfirmation[];
}

interface StopReason {
  type?: string;
  event_ids?: unknown;
}

export function createAnthropicManagedAgentsHandler(
  options: AnthropicManagedAgentHandlerOptions,
): A2AHandler {
  validateOptions(options);
  const baseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  const fetchImpl = options.fetch ?? safeManagedAgentFetch;
  if (typeof fetchImpl !== "function") {
    throw new AnthropicManagedAgentsError({
      code: "invalid_config",
      message: "Anthropic Managed Agents requires a fetch implementation.",
    });
  }

  return async function anthropicManagedAgentsHandler(
    message: Message,
    context: A2AHandlerContext,
  ): Promise<A2AHandlerResult> {
    const apiKey = await resolveApiKey(options);
    const metadata = readManagedAgentMetadata(message, context);
    const sessionId =
      metadata?.sessionId ??
      (await createSession({
        baseUrl,
        fetchImpl,
        apiKey,
        options,
      }));

    const outboundEvents = metadata?.confirmations?.length
      ? metadata.confirmations.map(toConfirmationEvent)
      : metadata?.pendingToolUseIds?.length
        ? []
        : [toUserMessageEvent(message)];

    if (!outboundEvents.length) {
      throw new AnthropicManagedAgentsError({
        code: "approval_required",
        message:
          "The Anthropic managed agent is waiting for explicit tool confirmation.",
      });
    }

    const events = await runSessionTurn({
      baseUrl,
      fetchImpl,
      apiKey,
      sessionId,
      events: outboundEvents,
      options,
    });
    return mapSessionEvents(events, sessionId, context, options);
  };
}

function validateOptions(options: AnthropicManagedAgentHandlerOptions): void {
  if (
    !options ||
    typeof options.agentId !== "string" ||
    !options.agentId.trim() ||
    typeof options.environmentId !== "string" ||
    !options.environmentId.trim() ||
    typeof options.credentialRef !== "string" ||
    !options.credentialRef.trim()
  ) {
    throw new AnthropicManagedAgentsError({
      code: "invalid_config",
      message:
        "Anthropic Managed Agents requires an agent ID, environment ID, and credential reference.",
    });
  }
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const candidate = value?.trim() || ANTHROPIC_MANAGED_AGENTS_API_URL;
  try {
    const parsed = new URL(candidate);
    const isLoopback =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]";
    if (
      parsed.protocol !== "https:" &&
      !(parsed.protocol === "http:" && isLoopback)
    ) {
      throw new Error("insecure endpoint");
    }
    if (parsed.username || parsed.password) throw new Error("credentials");
    return parsed.toString().replace(/\/$/, "");
  } catch (cause) {
    throw new AnthropicManagedAgentsError({
      code: "invalid_config",
      message: "Anthropic Managed Agents has an invalid API base URL.",
      cause,
    });
  }
}

async function resolveApiKey(
  options: AnthropicManagedAgentHandlerOptions,
): Promise<string> {
  const credentialContext: RemoteAgentCredentialContext = {
    userEmail: getRequestUserEmail(),
    orgId: getRequestOrgId(),
  };
  const value = options.resolveApiKey
    ? await options.resolveApiKey(
        options.credentialRef.trim(),
        credentialContext,
      )
    : await resolveRemoteAgentToken(
        { type: "bearer", credentialRef: options.credentialRef.trim() },
        credentialContext,
      );
  if (!value?.trim()) {
    throw new AnthropicManagedAgentsError({
      code: "credential_missing",
      message:
        "The configured Anthropic Managed Agents credential is not available.",
    });
  }
  return value.trim();
}

function requestHeaders(apiKey: string, accept = "application/json") {
  return {
    Accept: accept,
    "Content-Type": "application/json",
    "anthropic-beta": ANTHROPIC_MANAGED_AGENTS_BETA_HEADER,
    "anthropic-version": ANTHROPIC_VERSION,
    "x-api-key": apiKey,
  };
}

async function createSession(args: {
  baseUrl: string;
  fetchImpl: typeof fetch;
  apiKey: string;
  options: AnthropicManagedAgentHandlerOptions;
}): Promise<string> {
  const response = await requestJson(
    args.fetchImpl,
    `${args.baseUrl}/v1/sessions`,
    {
      method: "POST",
      headers: requestHeaders(args.apiKey),
      body: JSON.stringify({
        agent: args.options.agentId.trim(),
        environment_id: args.options.environmentId.trim(),
      }),
      signal: AbortSignal.timeout(
        args.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      ),
    },
    args.options,
  );
  const id = response.id;
  if (typeof id !== "string" || !id.trim()) {
    throw new AnthropicManagedAgentsError({
      code: "invalid_response",
      message: "Anthropic Managed Agents returned a session without an ID.",
    });
  }
  return id.trim();
}

function toUserMessageEvent(message: Message): Record<string, unknown> {
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  if (!text) {
    throw new AnthropicManagedAgentsError({
      code: "invalid_config",
      message: "Anthropic Managed Agents requires a text A2A message.",
    });
  }
  return {
    type: "user.message",
    content: [{ type: "text", text }],
  };
}

function toConfirmationEvent(
  confirmation: AnthropicManagedAgentConfirmation,
): Record<string, unknown> {
  return {
    type: "user.tool_confirmation",
    tool_use_id: confirmation.toolUseId,
    result: confirmation.result,
    ...(confirmation.result === "deny" && confirmation.denyMessage
      ? { deny_message: confirmation.denyMessage }
      : {}),
  };
}

async function runSessionTurn(args: {
  baseUrl: string;
  fetchImpl: typeof fetch;
  apiKey: string;
  sessionId: string;
  events: Record<string, unknown>[];
  options: AnthropicManagedAgentHandlerOptions;
}): Promise<AnthropicManagedAgentEvent[]> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    args.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  );
  const streamPromise = openEventStream({ ...args, controller });
  try {
    await sendEvents({ ...args, controller });
    return await streamPromise;
  } catch (cause) {
    controller.abort();
    await streamPromise.catch(() => undefined);
    if (cause instanceof AnthropicManagedAgentsError) throw cause;
    throw new AnthropicManagedAgentsError({
      code: "stream_error",
      message: "Anthropic Managed Agents session streaming failed.",
      cause,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function sendEvents(args: {
  baseUrl: string;
  fetchImpl: typeof fetch;
  apiKey: string;
  sessionId: string;
  events: Record<string, unknown>[];
  options: AnthropicManagedAgentHandlerOptions;
  controller: AbortController;
}): Promise<void> {
  await requestJson(
    args.fetchImpl,
    `${args.baseUrl}/v1/sessions/${encodeURIComponent(args.sessionId)}/events`,
    {
      method: "POST",
      headers: requestHeaders(args.apiKey),
      body: JSON.stringify({ events: args.events }),
      signal: args.controller.signal,
    },
    args.options,
  );
}

async function openEventStream(args: {
  baseUrl: string;
  fetchImpl: typeof fetch;
  apiKey: string;
  sessionId: string;
  options: AnthropicManagedAgentHandlerOptions;
  controller: AbortController;
}): Promise<AnthropicManagedAgentEvent[]> {
  let response: Response;
  try {
    response = await args.fetchImpl(
      `${args.baseUrl}/v1/sessions/${encodeURIComponent(args.sessionId)}/events/stream`,
      {
        method: "GET",
        headers: requestHeaders(args.apiKey, "text/event-stream"),
        signal: args.controller.signal,
      },
    );
  } catch (cause) {
    throw new AnthropicManagedAgentsError({
      code: "stream_error",
      message: "Anthropic Managed Agents stream could not be opened.",
      cause,
    });
  }
  if (!response.ok) throw await responseError(response, args.options, true);
  if (!response.body) {
    throw new AnthropicManagedAgentsError({
      code: "stream_error",
      message: "Anthropic Managed Agents returned an empty event stream.",
    });
  }
  return readEventStream(response.body, args.controller.signal);
}

async function requestJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  options: AnthropicManagedAgentHandlerOptions,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (cause) {
    throw new AnthropicManagedAgentsError({
      code: "api_error",
      message: "Anthropic Managed Agents request could not be sent.",
      cause,
    });
  }
  if (!response.ok) throw await responseError(response, options, false);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new AnthropicManagedAgentsError({
      code: "invalid_response",
      message: "Anthropic Managed Agents returned invalid JSON.",
      cause,
    });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AnthropicManagedAgentsError({
      code: "invalid_response",
      message: "Anthropic Managed Agents returned an invalid response.",
    });
  }
  return payload as Record<string, unknown>;
}

async function responseError(
  response: Response,
  _options: AnthropicManagedAgentHandlerOptions,
  streaming: boolean,
): Promise<Error> {
  if (response.status === 401 || response.status === 403) {
    return new RemoteAgentCredentialRejectedError({
      status: response.status,
      credentialRef: _options.credentialRef,
    });
  }
  let detail = "";
  try {
    detail = (await response.text()).slice(0, MAX_ERROR_BODY_CHARS).trim();
  } catch {
    // Preserve the typed upstream failure when the body is unreadable.
  }
  return new AnthropicManagedAgentsError({
    code: streaming ? "stream_error" : "api_error",
    statusCode: response.status,
    message:
      `Anthropic Managed Agents returned HTTP ${response.status}.` +
      (detail ? ` ${detail}` : ""),
  });
}

async function readEventStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<AnthropicManagedAgentEvent[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events: AnthropicManagedAgentEvent[] = [];
  let buffer = "";
  let dataLines: string[] = [];

  const dispatch = (): boolean => {
    if (!dataLines.length) return false;
    const data = dataLines.join("\n").trim();
    dataLines = [];
    if (!data || data === "[DONE]") return true;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch (cause) {
      throw new AnthropicManagedAgentsError({
        code: "invalid_response",
        message: "Anthropic Managed Agents returned malformed SSE data.",
        cause,
      });
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new AnthropicManagedAgentsError({
        code: "invalid_response",
        message: "Anthropic Managed Agents returned a non-object SSE event.",
      });
    }
    const event = parsed as AnthropicManagedAgentEvent;
    events.push(event);
    return isTerminalEvent(event);
  };

  try {
    while (true) {
      if (signal.aborted) throw new Error("stream aborted");
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) {
          if (dispatch()) {
            await reader.cancel();
            return events;
          }
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
      if (done) {
        if (buffer.startsWith("data:"))
          dataLines.push(buffer.slice(5).trimStart());
        dispatch();
        return events;
      }
    }
  } catch (cause) {
    if (cause instanceof AnthropicManagedAgentsError) throw cause;
    throw new AnthropicManagedAgentsError({
      code: "stream_error",
      message: "Anthropic Managed Agents returned an unreadable event stream.",
      cause,
    });
  } finally {
    reader.releaseLock();
  }
}

function isTerminalEvent(event: AnthropicManagedAgentEvent): boolean {
  const type = event.type;
  return (
    type === "session.status_idle" ||
    type === "session.status_terminated" ||
    type === "session.error"
  );
}

async function mapSessionEvents(
  events: AnthropicManagedAgentEvent[],
  sessionId: string,
  context: A2AHandlerContext,
  options: AnthropicManagedAgentHandlerOptions,
): Promise<A2AHandlerResult> {
  const text = events
    .filter((event) => event.type === "agent.message")
    .flatMap((event) => extractTextBlocks(event.content))
    .join("\n")
    .trim();
  const idle = [...events]
    .reverse()
    .find((event) => event.type === "session.status_idle");
  const stopReason = readStopReason(idle?.stop_reason);
  const pendingToolUseIds =
    stopReason?.type === "requires_action"
      ? readRequiredStringArray(stopReason.event_ids)
      : [];

  if (pendingToolUseIds.length) {
    const approvals = pendingToolUseIds.map((id) => {
      const toolEvent = events.find(
        (event) =>
          event.id === id &&
          (event.type === "agent.tool_use" ||
            event.type === "agent.mcp_tool_use"),
      );
      if (!toolEvent) {
        throw new AnthropicManagedAgentsError({
          code: "unsupported_action",
          message: `Anthropic Managed Agents requested unsupported event "${id}" while waiting for input.`,
        });
      }
      return {
        id,
        toolName: readString(toolEvent?.name),
        input: toolEvent?.input,
      } satisfies AnthropicManagedAgentApproval;
    });
    for (const approval of approvals) {
      if (!options.onRuntimeEvent) continue;
      const toolName = approval.toolName || "the requested tool";
      await options.onRuntimeEvent({
        type: "approval-request",
        id: approval.id,
        approvalId: approval.id,
        sessionId,
        turnId: context.taskId,
        toolCallId: approval.id,
        toolName: approval.toolName,
        message: `The Anthropic managed agent is waiting for approval to use ${toolName}.`,
        input: approval.input,
        allowPersistentApproval: false,
        metadata: {
          provider: "anthropic-managed-agents",
          sessionId,
          toolUseId: approval.id,
        },
      });
    }
    const approvalText = approvals
      .map(
        ({ toolName }) =>
          `Approval required for ${toolName || "a managed agent tool"}.`,
      )
      .join("\n");
    return {
      message: {
        role: "agent",
        parts: [{ type: "text", text: text || approvalText }],
        metadata: {
          agentNativeTaskState: "input-required",
          [ANTHROPIC_MANAGED_AGENTS_METADATA_KEY]: {
            sessionId,
            pendingToolUseIds,
          } satisfies AnthropicManagedAgentContinuation,
        },
      },
      taskState: "input-required",
    };
  }

  const terminalError = events.find((event) => event.type === "session.error");
  if (terminalError) {
    throw new AnthropicManagedAgentsError({
      code: "api_error",
      message:
        readString((terminalError.error as Record<string, unknown>)?.message) ||
        "Anthropic Managed Agents reported a session error.",
    });
  }
  if (!text) {
    throw new AnthropicManagedAgentsError({
      code: "invalid_response",
      message: "Anthropic Managed Agents completed without a text response.",
    });
  }
  return {
    message: {
      role: "agent",
      parts: [{ type: "text", text }],
      metadata: {
        [ANTHROPIC_MANAGED_AGENTS_METADATA_KEY]: { sessionId },
      },
    },
  };
}

function readManagedAgentMetadata(
  message: Message,
  context: A2AHandlerContext,
): ManagedAgentMetadata | undefined {
  const raw =
    message.metadata?.[ANTHROPIC_MANAGED_AGENTS_METADATA_KEY] ??
    context.metadata?.[ANTHROPIC_MANAGED_AGENTS_METADATA_KEY];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new AnthropicManagedAgentsError({
      code: "invalid_response",
      message: "Anthropic Managed Agents continuation metadata is invalid.",
    });
  }
  const value = raw as Record<string, unknown>;
  const sessionId = readString(value.sessionId);
  if (!sessionId) {
    throw new AnthropicManagedAgentsError({
      code: "invalid_response",
      message:
        "Anthropic Managed Agents continuation metadata is missing a session ID.",
    });
  }
  const pendingToolUseIds = readOptionalStringArray(
    value.pendingToolUseIds,
    "pendingToolUseIds",
  );
  const confirmations = readOptionalConfirmations(value.confirmations);
  return {
    sessionId,
    ...(pendingToolUseIds.length ? { pendingToolUseIds } : {}),
    ...(confirmations?.length ? { confirmations } : {}),
  };
}

function safeManagedAgentFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  return ssrfSafeFetch(url, init, {
    maxRedirects: 0,
    followRedirects: false,
  });
}

function parseConfirmation(
  value: unknown,
): AnthropicManagedAgentConfirmation | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const item = value as Record<string, unknown>;
  const toolUseId = readString(item.toolUseId);
  const result = item.result;
  if (!toolUseId || (result !== "allow" && result !== "deny")) return undefined;
  const denyMessage = readString(item.denyMessage);
  return {
    toolUseId,
    result,
    ...(denyMessage ? { denyMessage } : {}),
  };
}

function readStopReason(value: unknown): StopReason | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return value as StopReason;
}

function extractTextBlocks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (block): block is { type: "text"; text: string } =>
        !!block &&
        typeof block === "object" &&
        (block as Record<string, unknown>).type === "text" &&
        typeof (block as Record<string, unknown>).text === "string",
    )
    .map((block) => block.text.trim())
    .filter(Boolean);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readRequiredStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new AnthropicManagedAgentsError({
      code: "invalid_response",
      message:
        "Anthropic Managed Agents requires event IDs when input is required.",
    });
  }
  const values = value.map(readString);
  if (values.some((item) => !item)) {
    throw new AnthropicManagedAgentsError({
      code: "invalid_response",
      message:
        "Anthropic Managed Agents returned an invalid input-required event ID.",
    });
  }
  return values as string[];
}

function readOptionalStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new AnthropicManagedAgentsError({
      code: "invalid_response",
      message: `Anthropic Managed Agents continuation field ${field} is invalid.`,
    });
  }
  const values = value.map(readString);
  if (values.some((item) => !item)) {
    throw new AnthropicManagedAgentsError({
      code: "invalid_response",
      message: `Anthropic Managed Agents continuation field ${field} is invalid.`,
    });
  }
  return values as string[];
}

function readOptionalConfirmations(
  value: unknown,
): AnthropicManagedAgentConfirmation[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new AnthropicManagedAgentsError({
      code: "invalid_response",
      message:
        "Anthropic Managed Agents continuation confirmations are invalid.",
    });
  }
  const confirmations = value.map(parseConfirmation);
  if (confirmations.some((item) => !item)) {
    throw new AnthropicManagedAgentsError({
      code: "invalid_response",
      message:
        "Anthropic Managed Agents continuation confirmations are invalid.",
    });
  }
  return confirmations as AnthropicManagedAgentConfirmation[];
}
