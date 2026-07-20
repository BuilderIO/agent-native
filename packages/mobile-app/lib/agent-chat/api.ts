import { TEMPLATE_APPS } from "@agent-native/shared-app-config";
import { fetch as expoFetch } from "expo/fetch";

import { getSessionToken } from "@/lib/session-token-store";

import { nextLocalId } from "./reducer";
import { readJsonEventStream } from "./stream";
import type {
  ActiveRunInfo,
  ChatContentPart,
  ChatMessage,
  ChatModelCatalog,
  ChatModelGroup,
  ChatSendOptions,
  ChatThreadSummary,
  WireEvent,
} from "./types";

const chatApp = TEMPLATE_APPS.find((app) => app.id === "chat");
export const DEFAULT_CHAT_BASE_URL =
  chatApp?.url || "https://chat.agent-native.com";

const CHAT_PATH = "/_agent-native/agent-chat";

export class AgentChatError extends Error {
  readonly status: number;
  readonly authRequired: boolean;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "AgentChatError";
    this.status = status;
    this.authRequired = status === 401 || status === 403;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getSessionToken();
  if (!token) throw new AgentChatError("Sign in to use chat", 401);
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function readErrorMessage(response: {
  text(): Promise<string>;
  status: number;
}): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // keep raw text
  }
  return text.slice(0, 300) || `HTTP ${response.status}`;
}

async function jsonRequest<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<T> {
  const headers = await authHeaders();
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!response.ok) {
    throw new AgentChatError(await readErrorMessage(response), response.status);
  }
  return (await response.json()) as T;
}

export interface ChatTurnHandle {
  turnId: string;
  runId: string | null;
  events: AsyncGenerator<WireEvent>;
  abort: () => void;
}

/**
 * POST the user message and stream wire events back. Uses expo/fetch, whose
 * response body is a real ReadableStream on iOS and Android (RN's built-in
 * fetch buffers the whole body).
 */
export async function sendChatTurn(
  message: string,
  options: ChatSendOptions & {
    approvedToolCalls?: string[];
    signal?: AbortSignal;
  } = {},
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<ChatTurnHandle> {
  const headers = await authHeaders();
  const controller = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", () => controller.abort());
  }
  const turnId = nextLocalId("turn");
  const response = await expoFetch(`${baseUrl}${CHAT_PATH}`, {
    method: "POST",
    headers,
    signal: controller.signal,
    body: JSON.stringify({
      message,
      displayMessage: message,
      history: options.history ?? [],
      turnId,
      ...(options.threadId ? { threadId: options.threadId } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.engine ? { engine: options.engine } : {}),
      ...(options.effort ? { effort: options.effort } : {}),
      ...(options.mode ? { mode: options.mode } : {}),
      ...(options.attachments?.length
        ? { attachments: options.attachments }
        : {}),
      ...(options.approvedToolCalls?.length
        ? { approvedToolCalls: options.approvedToolCalls }
        : {}),
    }),
  });
  if (!response.ok) {
    throw new AgentChatError(await readErrorMessage(response), response.status);
  }
  const runId = response.headers.get("X-Run-Id");
  const body = response.body;
  if (!body) throw new AgentChatError("Empty response stream");

  const events = (async function* () {
    for await (const raw of readJsonEventStream(
      body as ReadableStream<Uint8Array>,
    )) {
      if (raw && typeof raw === "object" && "type" in raw) {
        yield raw as WireEvent;
      }
    }
  })();

  return { turnId, runId, events, abort: () => controller.abort() };
}

/** Server-side cancel — stops the agent run, not just the connection. */
export async function abortRun(
  runId: string,
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<void> {
  await jsonRequest(
    `${CHAT_PATH}/runs/${encodeURIComponent(runId)}/abort`,
    { method: "POST", body: {} },
    baseUrl,
  ).catch(() => {
    // Run may already be finished; the UI treats abort as best-effort.
  });
}

export async function listChatThreads(
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<ChatThreadSummary[]> {
  const data = await jsonRequest<{ threads?: unknown[] }>(
    `${CHAT_PATH}/threads?limit=50`,
    {},
    baseUrl,
  );
  return (data.threads ?? [])
    .map((raw) => toThreadSummary(raw))
    .filter((thread): thread is ChatThreadSummary => thread !== null);
}

export async function deleteChatThread(
  threadId: string,
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<void> {
  await jsonRequest(
    `${CHAT_PATH}/threads/${encodeURIComponent(threadId)}`,
    { method: "DELETE" },
    baseUrl,
  );
}

function toThreadSummary(raw: unknown): ChatThreadSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : null;
  if (!id) return null;
  const updated =
    typeof r.updatedAt === "number"
      ? r.updatedAt
      : typeof r.updatedAt === "string"
        ? Date.parse(r.updatedAt) || 0
        : 0;
  return {
    id,
    title: typeof r.title === "string" && r.title ? r.title : "New chat",
    preview: typeof r.preview === "string" ? r.preview : undefined,
    updatedAt: updated,
  };
}

/**
 * Thread history is stored as the web client's serialized message repository:
 * `{ messages: [{ message: { id, role, content: [...] }, parentId }] }`.
 * Parse defensively — only text/reasoning/tool-call parts render natively.
 */
export async function fetchThreadMessages(
  threadId: string,
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<ChatMessage[]> {
  const data = await jsonRequest<{ threadData?: unknown }>(
    `${CHAT_PATH}/threads/${encodeURIComponent(threadId)}`,
    {},
    baseUrl,
  );
  if (typeof data.threadData !== "string" || !data.threadData) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.threadData);
  } catch {
    return [];
  }
  const rows =
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as any).messages)
      ? ((parsed as { messages: unknown[] }).messages as unknown[])
      : [];
  const messages: ChatMessage[] = [];
  for (const row of rows) {
    const message = parseRepositoryMessage(row);
    if (message) messages.push(message);
  }
  return messages;
}

function parseRepositoryMessage(row: unknown): ChatMessage | null {
  if (!row || typeof row !== "object") return null;
  const wrapped = (row as { message?: unknown }).message;
  const m = (wrapped && typeof wrapped === "object" ? wrapped : row) as Record<
    string,
    unknown
  >;
  const role = m.role === "user" || m.role === "assistant" ? m.role : null;
  if (!role) return null;
  const id = typeof m.id === "string" ? m.id : nextLocalId("hist");
  const createdAt =
    typeof m.createdAt === "number"
      ? m.createdAt
      : typeof m.createdAt === "string"
        ? Date.parse(m.createdAt) || Date.now()
        : Date.now();

  const parts: ChatContentPart[] = [];
  const content = Array.isArray(m.content)
    ? m.content
    : typeof m.content === "string"
      ? [{ type: "text", text: m.content }]
      : [];
  for (const rawPart of content) {
    if (!rawPart || typeof rawPart !== "object") continue;
    const part = rawPart as Record<string, unknown>;
    if (part.type === "text" && typeof part.text === "string" && part.text) {
      parts.push({ type: "text", text: part.text });
    } else if (part.type === "reasoning" && typeof part.text === "string") {
      parts.push({ type: "reasoning", text: part.text });
    } else if (part.type === "tool-call") {
      parts.push({
        type: "tool-call",
        toolCallId:
          typeof part.toolCallId === "string"
            ? part.toolCallId
            : nextLocalId("tool"),
        toolName: typeof part.toolName === "string" ? part.toolName : "tool",
        inputText:
          typeof part.argsText === "string"
            ? part.argsText
            : part.args !== undefined
              ? JSON.stringify(part.args)
              : "",
        status: "completed",
        resultText:
          typeof part.result === "string"
            ? part.result
            : part.result !== undefined
              ? JSON.stringify(part.result)
              : undefined,
      });
    }
  }
  if (parts.length === 0) return null;
  return { id, role, parts, createdAt };
}

export function newThreadId(): string {
  return `thread-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Invoke an app action over the framework's HTTP action surface. */
async function callChatAppAction<T>(
  name: string,
  args: Record<string, unknown>,
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<T> {
  return jsonRequest<T>(
    `/_agent-native/actions/${encodeURIComponent(name)}`,
    { method: "POST", body: args },
    baseUrl,
  );
}

const HIDDEN_ENGINES = new Set([
  "ai-sdk:groq",
  "ai-sdk:mistral",
  "ai-sdk:cohere",
]);

function groupByProviderPrefix(
  engine: string,
  models: readonly string[],
): ChatModelGroup[] {
  const buckets: Array<{ label: string; match: (m: string) => boolean }> = [
    { label: "Claude", match: (m) => m.startsWith("claude-") },
    { label: "OpenAI", match: (m) => m.startsWith("gpt-") },
    { label: "Gemini", match: (m) => m.startsWith("gemini-") },
  ];
  const groups: ChatModelGroup[] = [];
  const other: string[] = [];
  for (const bucket of buckets) {
    const matched = models.filter(bucket.match);
    if (matched.length) {
      groups.push({ engine, label: bucket.label, models: matched });
    }
  }
  for (const model of models) {
    if (!buckets.some((bucket) => bucket.match(model))) other.push(model);
  }
  if (other.length) groups.push({ engine, label: "Other", models: other });
  return groups;
}

/**
 * The web composer's model menu, ported: engines come from the
 * `manage-agent-engine` action; groups are provider-labelled. Engines with
 * unconfigured required keys are dropped (mirrors buildChatModelGroups).
 */
export async function fetchModelCatalog(
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<ChatModelCatalog> {
  const [enginesData, envKeys] = await Promise.all([
    callChatAppAction<{
      engines?: Array<{
        name?: string;
        label?: string;
        supportedModels?: string[];
        requiredEnvVars?: string[];
      }>;
      current?: { engine?: string; model?: string };
    }>("manage-agent-engine", { action: "list" }, baseUrl),
    jsonRequest<Array<{ key?: string; configured?: boolean }>>(
      "/_agent-native/env-status",
      {},
      baseUrl,
    ).catch(() => [] as Array<{ key?: string; configured?: boolean }>),
  ]);

  const configuredKeys = new Set(
    envKeys.filter((k) => k.configured && k.key).map((k) => k.key as string),
  );
  const groups: ChatModelGroup[] = [];
  for (const engine of enginesData.engines ?? []) {
    const name = engine.name ?? "";
    if (!name || HIDDEN_ENGINES.has(name)) continue;
    const models = engine.supportedModels ?? [];
    if (models.length === 0) continue;
    const required = engine.requiredEnvVars ?? [];
    const configured =
      required.length === 0 || required.some((key) => configuredKeys.has(key));
    if (!configured) continue;
    if (models.some((m) => m.includes("-"))) {
      groups.push(...groupByProviderPrefix(name, models));
    } else {
      groups.push({ engine: name, label: engine.label ?? name, models });
    }
  }
  return {
    groups,
    currentEngine: enginesData.current?.engine,
    currentModel: enginesData.current?.model,
  };
}

export async function getActiveRun(
  threadId: string,
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<ActiveRunInfo> {
  const data = await jsonRequest<{
    active?: boolean;
    runId?: string;
    status?: string;
  }>(
    `${CHAT_PATH}/runs/active?threadId=${encodeURIComponent(threadId)}`,
    {},
    baseUrl,
  );
  return {
    active: data.active === true,
    runId: typeof data.runId === "string" ? data.runId : undefined,
    status: typeof data.status === "string" ? data.status : undefined,
  };
}

/** Reconnect to a live run's event stream (SSE) from a seq cursor. */
export async function resumeRunEvents(
  runId: string,
  after = 0,
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<Pick<ChatTurnHandle, "events" | "abort">> {
  const headers = await authHeaders();
  const controller = new AbortController();
  const response = await expoFetch(
    `${baseUrl}${CHAT_PATH}/runs/${encodeURIComponent(runId)}/events?after=${after}`,
    { headers, signal: controller.signal },
  );
  if (!response.ok) {
    throw new AgentChatError(await readErrorMessage(response), response.status);
  }
  const body = response.body;
  if (!body) throw new AgentChatError("Empty resume stream");
  const events = (async function* () {
    for await (const raw of readJsonEventStream(
      body as ReadableStream<Uint8Array>,
    )) {
      if (raw && typeof raw === "object" && "type" in raw) {
        yield raw as WireEvent;
      }
    }
  })();
  return { events, abort: () => controller.abort() };
}

export async function forkChatThread(
  threadId: string,
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<string | null> {
  const forked = await jsonRequest<{ id?: string }>(
    `${CHAT_PATH}/threads/${encodeURIComponent(threadId)}/fork`,
    { method: "POST", body: {} },
    baseUrl,
  );
  return typeof forked.id === "string" ? forked.id : null;
}

export async function createThreadShareLink(
  threadId: string,
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<string | null> {
  const data = await jsonRequest<{ url?: string }>(
    `${CHAT_PATH}/threads/${encodeURIComponent(threadId)}/share`,
    { method: "POST", body: {} },
    baseUrl,
  );
  return typeof data.url === "string" ? data.url : null;
}
