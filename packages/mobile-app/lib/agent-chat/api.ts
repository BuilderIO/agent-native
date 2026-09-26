import { TEMPLATE_APPS } from "@agent-native/shared-app-config";
import { fetch as expoFetch } from "expo/fetch";
import { DeviceEventEmitter } from "react-native";

import { getMobileAnalyticsHeaders } from "@/lib/analytics";
import { getSessionToken } from "@/lib/session-token-store";

import type { NavigateCommand } from "./navigate-command";
import { readJsonEventStream } from "./stream";
import type {
  ChatModelCatalog,
  ChatModelGroup,
  ChatThreadSummary,
  MentionItem,
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
    this.authRequired = status === 401;
  }
}

export async function getMobileAgentChatHeaders(): Promise<
  Record<string, string>
> {
  const token = await getSessionToken();
  if (!token) throw new AgentChatError("Sign in to use chat", 401);
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(await getMobileAnalyticsHeaders()),
  };
}

async function authHeaders(): Promise<Record<string, string>> {
  return getMobileAgentChatHeaders();
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

async function fetchAgentEngineStatus(
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<unknown> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const request = jsonRequest<unknown>(
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
  try {
    return await Promise.race([request, timedOut]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export type MobileChatEligibility =
  | "checking"
  | "eligible"
  | "missing"
  | "unavailable";

export function parseMobileChatEligibility(value: unknown): boolean {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof (value as { chatEligible?: unknown }).chatEligible !== "boolean"
  ) {
    throw new AgentChatError("Chat setup status could not be confirmed.");
  }
  return (value as { chatEligible: boolean }).chatEligible;
}

/** Uses the strict server-owned chat gate; broad engine `configured` is not enough. */
export async function fetchMobileChatEligibility(
  baseUrl = DEFAULT_CHAT_BASE_URL,
): Promise<boolean> {
  return parseMobileChatEligibility(await fetchAgentEngineStatus(baseUrl));
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

export interface AllThreadsResult {
  threads: ChatThreadSummary[];
  failedAppIds: string[];
}

/**
 * Cross-app thread history. Each workspace app is its own deployment with its
 * own thread store, so aggregation means fanning out to every app's `/threads`
 * endpoint and tagging each thread with its origin. A per-app failure is
 * reported separately from an empty result so the UI never presents a partial
 * workspace history as complete.
 */
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

/** Backwards-compatible thread-only view for callers that do not need status. */
export async function listAllThreads(): Promise<ChatThreadSummary[]> {
  return (await listAllThreadsWithStatus()).threads;
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

export interface FetchMentionsOptions {
  signal?: AbortSignal;
  baseUrl?: string;
  /**
   * Called with the accumulated, de-duplicated list every time a batch lands.
   * Lets the UI show fast sources (resources) before slow ones (codebase scans,
   * custom providers) finish.
   */
  onItems?: (items: MentionItem[]) => void;
}

/**
 * `@`-mention candidates (files, workspace pages, skills, agents, …) from an
 * app's unified mentions endpoint. The endpoint streams NDJSON `{ items }`
 * batches as each source completes; this consumes the body incrementally (via
 * expo/fetch's real stream) so already-ready suggestions surface immediately
 * instead of waiting for the slowest provider. Items are de-duplicated by id.
 * Returns an empty list on any failure — mention search must never throw.
 */
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

/** GET variant for actions whose declared HTTP surface is query-based. */
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
    // Every required key must be present — a multi-key engine (e.g. Builder's
    // public+private pair) with only one key set cannot run, so don't offer it.
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
  const result = await fetchAgentEngineStatus(baseUrl);
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new AgentChatError("Agent engine status response was incomplete");
  }
  const configured = (result as { configured?: unknown }).configured;
  if (typeof configured !== "boolean") {
    throw new AgentChatError("Agent engine status response was incomplete");
  }
  return configured ? "configured" : "missing";
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
  DeviceEventEmitter.emit(AGENT_ENGINE_CONFIGURED_CHANGED_EVENT);
}
