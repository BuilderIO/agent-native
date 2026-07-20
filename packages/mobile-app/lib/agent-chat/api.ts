import { TEMPLATE_APPS } from "@agent-native/shared-app-config";
import { fetch as expoFetch } from "expo/fetch";

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
      ...(options.references?.length ? { references: options.references } : {}),
      ...(options.approvedToolCalls?.length
        ? { approvedToolCalls: options.approvedToolCalls }
        : {}),
    }),
  });
  if (!response.ok) {
    throw new AgentChatError(await readErrorMessage(response), response.status);
  }
  // Some proxies/middleware return failures as 200 JSON instead of an event
  // stream — surface them instead of parsing an empty stream as success.
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

export interface ChatCapableApp {
  id: string;
  name: string;
  icon: string;
  url: string;
}

/** Workspace apps that expose an agent chat surface at a known prod URL. */
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

/**
 * Cross-app thread history. Each workspace app is its own deployment with its
 * own thread store, so aggregation means fanning out to every app's `/threads`
 * endpoint and tagging each thread with its origin. Per-app failures (an app
 * that is down, or one the session token can't authenticate against) are
 * swallowed so the rest of the history still renders — never fail the whole
 * list because one app rejected. Results are newest-first across all apps.
 */
export async function listAllThreads(): Promise<ChatThreadSummary[]> {
  const apps = chatCapableApps();
  const perApp = await Promise.all(
    apps.map((app) => listTaggedThreads(app).catch(() => [])),
  );
  return perApp.flat().sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Threads for a single workspace app, newest-first. Unlike listAllThreads this
 * surfaces the error (an unknown app id, or a failed/unauthorized fetch) so the
 * filtered view can offer a retry rather than showing a misleading empty state.
 */
export async function listThreadsForApp(
  appId: string,
): Promise<ChatThreadSummary[]> {
  const app = chatCapableApps().find((candidate) => candidate.id === appId);
  if (!app) throw new AgentChatError(`Unknown app "${appId}"`);
  const threads = await listTaggedThreads(app);
  return threads.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * `@`-mention candidates (files, workspace pages, skills, agents, …) from an
 * app's unified mentions endpoint. The endpoint streams NDJSON batches of
 * `{ items }`; each line is parsed and items are de-duplicated by id. Returns
 * an empty list on any failure — mention search must never surface an error.
 */
export async function fetchMentions(
  query: string,
  signal?: AbortSignal,
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<MentionItem[]> {
  try {
    const headers = await authHeaders();
    const response = await fetch(
      `${baseUrl}${CHAT_PATH}/mentions?q=${encodeURIComponent(query)}`,
      { headers, signal },
    );
    if (!response.ok) return [];
    const body = await response.text();
    const items: MentionItem[] = [];
    const seen = new Set<string>();
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as { items?: MentionItem[] };
        for (const item of parsed.items ?? []) {
          if (item?.id && !seen.has(item.id)) {
            seen.add(item.id);
            items.push(item);
          }
        }
      } catch {
        // Ignore a partial/garbled line; other batches still parse.
      }
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

/**
 * Invoke any registered framework action over the HTTP action surface.
 * Pass another workspace app's base URL to control that app natively —
 * the same `POST /_agent-native/actions/:name` contract every app exposes.
 */
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
  // Env vars satisfiable by an engine whose package is installed — used to hide
  // key inputs (e.g. Gemini) that could never yield a working model here.
  const installableEnvVars = new Set<string>();
  const groups: ChatModelGroup[] = [];
  for (const engine of enginesData.engines ?? []) {
    const name = engine.name ?? "";
    if (!name) continue;
    // An engine whose optional npm package is not installed in this app can be
    // selected but never runs — "set" fails with "requires optional packages".
    // Hide it, matching the web picker's `packageInstalled !== false` filter.
    if (engine.packageInstalled === false) continue;
    // A hidden engine is never offered in the picker, so its key can't yield a
    // selectable model — don't let it mark a provider key configurable either.
    if (HIDDEN_ENGINES.has(name)) continue;
    for (const key of engine.requiredEnvVars ?? []) installableEnvVars.add(key);
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

/** One-shot agent navigation command, or null when none is pending. */
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

/** Acknowledge (consume) the pending navigation command. Best effort. */
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

/** Providers whose API keys can be configured from the app. */
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

/**
 * Persist a provider API key in the server's scoped secrets vault via the
 * framework's `agent-engine/api-key` route — the same named surface the web
 * settings panel uses. The key never touches device storage.
 */
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
}
