import { TEMPLATE_APPS } from "@agent-native/shared-app-config";
import { fetch as expoFetch } from "expo/fetch";
import { DeviceEventEmitter } from "react-native";

import { getMobileAnalyticsHeaders } from "@/lib/analytics";
import { getSessionToken } from "@/lib/session-token-store";

import type { NavigateCommand } from "./navigate-command";
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
  MentionItem,
  WireEvent,
} from "./types";

const chatApp = TEMPLATE_APPS.find((app) => app.id === "chat");
export const DEFAULT_CHAT_BASE_URL =
  chatApp?.url || "https://chat.agent-native.com";

const CHAT_PATH = "/_agent-native/agent-chat";
export const AGENT_ENGINE_CONFIGURED_CHANGED_EVENT =
  "agent-engine:configured-changed";

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
    ...(await getMobileAnalyticsHeaders()),
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
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<T> {
  const headers = await authHeaders();
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.signal ? { signal: init.signal } : {}),
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
  const turnId = options.turnId ?? nextLocalId("turn");
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
      ...(options.references?.length ? { references: options.references } : {}),
      ...(options.approvedToolCalls?.length
        ? { approvedToolCalls: options.approvedToolCalls }
        : {}),
    }),
  });
  if (!response.ok) {
    throw new AgentChatError(await readErrorMessage(response), response.status);
  }
  const contentType = response.headers.get("Content-Type") ?? "";
  if (
    contentType.includes("application/json") &&
    !contentType.includes("text/event-stream")
  ) {
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

export interface ChatCapableApp {
  id: string;
  name: string;
  icon: string;
  url: string;
}

export function chatCapableApps(): ChatCapableApp[] {
  return TEMPLATE_APPS.filter((app) => Boolean(app.url)).map((app) => ({
    id: app.id,
    name: app.name,
    icon: app.icon,
    url: app.url,
  }));
}

async function listTaggedThreads(
  app: ChatCapableApp,
): Promise<ChatThreadSummary[]> {
  const threads = await listChatThreads(app.url);
  return threads.map((thread) => ({
    ...thread,
    appId: app.id,
    appName: app.name,
    appIcon: app.icon,
    baseUrl: app.url,
  }));
}

export interface AllThreadsResult {
  threads: ChatThreadSummary[];
  failedAppIds: string[];
}

export async function listAllThreadsWithStatus(): Promise<AllThreadsResult> {
  const apps = chatCapableApps();
  const perApp = await Promise.all(
    apps.map(async (app) => {
      try {
        return { appId: app.id, threads: await listTaggedThreads(app) };
      } catch {
        return { appId: app.id, threads: null };
      }
    }),
  );
  return {
    threads: perApp
      .flatMap((result) => result.threads ?? [])
      .sort((a, b) => b.updatedAt - a.updatedAt),
    failedAppIds: perApp
      .filter((result) => result.threads === null)
      .map((result) => result.appId),
  };
}

export async function listAllThreads(): Promise<ChatThreadSummary[]> {
  return (await listAllThreadsWithStatus()).threads;
}

export async function listThreadsForApp(
  appId: string,
): Promise<ChatThreadSummary[]> {
  const app = chatCapableApps().find((candidate) => candidate.id === appId);
  if (!app) throw new AgentChatError(`Unknown app "${appId}"`);
  const threads = await listTaggedThreads(app);
  return threads.sort((a, b) => b.updatedAt - a.updatedAt);
}

export interface FetchMentionsOptions {
  signal?: AbortSignal;
  baseUrl?: string;
  onItems?: (items: MentionItem[]) => void;
}

export async function fetchMentions(
  query: string,
  options: FetchMentionsOptions = {},
): Promise<MentionItem[]> {
  const { signal, baseUrl = DEFAULT_CHAT_BASE_URL, onItems } = options;
  try {
    const headers = await authHeaders();
    const response = await expoFetch(
      `${baseUrl}${CHAT_PATH}/mentions?q=${encodeURIComponent(query)}`,
      { headers, signal },
    );
    if (!response.ok || !response.body) return [];
    const items: MentionItem[] = [];
    const seen = new Set<string>();
    for await (const raw of readJsonEventStream(
      response.body as ReadableStream<Uint8Array>,
    )) {
      if (signal?.aborted) break;
      const batch = (raw as { items?: MentionItem[] })?.items;
      if (!Array.isArray(batch)) continue;
      let added = false;
      for (const item of batch) {
        if (item?.id && !seen.has(item.id)) {
          seen.add(item.id);
          items.push(item);
          added = true;
        }
      }
      if (added) onItems?.([...items]);
    }
    return items;
  } catch {
    return [];
  }
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

export async function callAppAction<T>(
  name: string,
  args: Record<string, unknown> = {},
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<T> {
  return jsonRequest<T>(
    `/_agent-native/actions/${encodeURIComponent(name)}`,
    { method: "POST", body: args },
    baseUrl,
  );
}

export async function callAppActionGet<T>(
  name: string,
  args: Record<string, string | number | boolean> = {},
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) {
    query.set(key, String(value));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return jsonRequest<T>(
    `/_agent-native/actions/${encodeURIComponent(name)}${suffix}`,
    { method: "GET" },
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

export async function fetchModelCatalog(
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<ChatModelCatalog> {
  const [enginesData, envKeys] = await Promise.all([
    callAppAction<{
      engines?: Array<{
        name?: string;
        label?: string;
        supportedModels?: string[];
        requiredEnvVars?: string[];
        packageInstalled?: boolean;
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
  const installableEnvVars = new Set<string>();
  const groups: ChatModelGroup[] = [];
  for (const engine of enginesData.engines ?? []) {
    const name = engine.name ?? "";
    if (!name) continue;
    if (engine.packageInstalled === false) continue;
    if (HIDDEN_ENGINES.has(name)) continue;
    for (const key of engine.requiredEnvVars ?? []) installableEnvVars.add(key);
    const models = engine.supportedModels ?? [];
    if (models.length === 0) continue;
    const required = engine.requiredEnvVars ?? [];
    const configured =
      required.length === 0 || required.every((key) => configuredKeys.has(key));
    if (!configured) continue;
    if (models.some((m) => m.includes("-"))) {
      groups.push(...groupByProviderPrefix(name, models));
    } else {
      groups.push({ engine: name, label: engine.label ?? name, models });
    }
  }
  const configurableProviders = PROVIDER_KEY_OPTIONS.filter((option) =>
    installableEnvVars.has(option.envVar),
  ).map((option) => option.provider);
  return {
    groups,
    currentEngine: enginesData.current?.engine,
    currentModel: enginesData.current?.model,
    configurableProviders,
  };
}

export async function getAgentEngineStatus(
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<"configured" | "missing"> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const request = jsonRequest<{ configured?: unknown }>(
    "/_agent-native/agent-engine/status",
    { signal: controller.signal },
    baseUrl,
  );
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new AgentChatError("Agent engine status request timed out"));
    }, 10_000);
  });
  let result: { configured?: unknown };
  try {
    result = await Promise.race([request, timedOut]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  if (typeof result.configured !== "boolean") {
    throw new AgentChatError("Agent engine status response was incomplete");
  }
  return result.configured ? "configured" : "missing";
}

export async function getFileUploadStatus(
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<"configured" | "missing"> {
  const result = await jsonRequest<{ configured?: unknown }>(
    "/_agent-native/file-upload/status",
    {},
    baseUrl,
  );
  if (typeof result.configured !== "boolean") {
    throw new AgentChatError("File storage status response was incomplete");
  }
  return result.configured ? "configured" : "missing";
}

export async function getActiveRun(
  threadId: string,
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<ActiveRunInfo> {
  const data = await jsonRequest<{
    active?: boolean;
    runId?: string;
    turnId?: string;
    status?: string;
  }>(
    `${CHAT_PATH}/runs/active?threadId=${encodeURIComponent(threadId)}`,
    {},
    baseUrl,
  );
  return {
    active: data.active === true,
    runId: typeof data.runId === "string" ? data.runId : undefined,
    turnId: typeof data.turnId === "string" ? data.turnId : undefined,
    status: typeof data.status === "string" ? data.status : undefined,
  };
}

export async function resumeRunEvents(
  runId: string,
  after = 0,
  signal?: AbortSignal,
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<Pick<ChatTurnHandle, "events" | "abort">> {
  const headers = await authHeaders();
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort());
  }
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

export async function fetchNavigateCommand(
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<NavigateCommand | null> {
  try {
    const data = await jsonRequest<unknown>(
      "/_agent-native/application-state/navigate",
      {},
      baseUrl,
    );
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as NavigateCommand)
      : null;
  } catch {
    return null;
  }
}

export async function deleteNavigateCommand(
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<void> {
  try {
    const headers = await authHeaders();
    await fetch(`${baseUrl}/_agent-native/application-state/navigate`, {
      method: "DELETE",
      headers,
    });
  } catch {
    // Consuming again on the next poll is harmless.
  }
}

export const PROVIDER_KEY_OPTIONS = [
  {
    provider: "anthropic",
    label: "Anthropic",
    placeholder: "sk-ant-...",
    envVar: "ANTHROPIC_API_KEY",
  },
  {
    provider: "openai",
    label: "OpenAI",
    placeholder: "sk-...",
    envVar: "OPENAI_API_KEY",
  },
  {
    provider: "google",
    label: "Google Gemini",
    placeholder: "AI...",
    envVar: "GOOGLE_GENERATIVE_AI_API_KEY",
  },
] as const;

export type ProviderKeyOption = (typeof PROVIDER_KEY_OPTIONS)[number];

export async function saveProviderApiKey(
  provider: string,
  apiKey: string,
  options: { scope?: "user" | "org"; baseUrl?: string } = {},
): Promise<void> {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new AgentChatError("Enter an API key first.");
  const headers = await authHeaders();
  const response = await fetch(
    `${options.baseUrl ?? DEFAULT_CHAT_BASE_URL}/_agent-native/agent-engine/api-key`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider,
        value: trimmed,
        ...(options.scope ? { scope: options.scope } : {}),
      }),
    },
  );
  if (!response.ok) {
    throw new AgentChatError(await readErrorMessage(response), response.status);
  }
  DeviceEventEmitter.emit(AGENT_ENGINE_CONFIGURED_CHANGED_EVENT);
}
