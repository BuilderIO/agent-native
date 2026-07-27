import { A2AClient, signA2AToken, type Task } from "@agent-native/core/a2a";
import {
  buildMcpToolName,
  McpClientManager,
} from "@agent-native/core/mcp-client";
import { getOrgA2ASecret, getOrgDomain } from "@agent-native/core/org";
import {
  buildDeepLink,
  buildEmbedStartPath,
  createEmbedSessionTicket,
  getRequestContext,
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import {
  discoverAgents,
  type DiscoveredAgent,
} from "@agent-native/core/server/agent-discovery";

import {
  getDispatchMcpAppAccessSettings,
  isAppAllowedByMcpAccess,
  type DispatchMcpAppAccessSettings,
} from "./mcp-access-store.js";

const DISPATCH_APP_ID = "dispatch";
const DISPATCH_NAME = "Agent-Native Dispatch";
const DISPATCH_DESCRIPTION =
  "Workspace control plane for extensions, agents, vault, integrations, approvals, and app routing.";
const DISPATCH_COLOR = "#14B8A6";
const TARGET_EMBED_SESSION_ATTEMPTS = 3;
const TARGET_EMBED_SESSION_RETRY_BASE_MS = 250;
const DISPATCH_ASK_APP_DEFAULT_INLINE_WAIT_MS = 20_000;
const DISPATCH_ASK_APP_MAX_INLINE_WAIT_MS = 25_000;
const DISPATCH_ASK_APP_POLL_INTERVAL_MS = 1_500;
const DISPATCH_A2A_REQUEST_TIMEOUT_MS = 10_000;
const DISPATCH_ASK_APP_STATUS_RETRY_DELAYS_MS = [250, 750, 1_500] as const;
const DISPATCH_ASK_APP_TERMINAL_STATES = new Set([
  "completed",
  "failed",
  "canceled",
  "input-required",
]);

class DispatchAskAppInlineDeadlineError extends Error {
  constructor() {
    super("ask_app inline wait deadline reached");
    this.name = "DispatchAskAppInlineDeadlineError";
  }
}

export interface DispatchMcpAccessibleApp {
  id: string;
  name: string;
  description: string;
  url: string;
  color: string;
  granted: boolean;
}

function normalizeAppId(value: string): string {
  return value.trim().toLowerCase();
}

function boundedDispatchAskAppWaitMs(raw: unknown): number {
  if (raw == null || raw === "") {
    return DISPATCH_ASK_APP_DEFAULT_INLINE_WAIT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DISPATCH_ASK_APP_DEFAULT_INLINE_WAIT_MS;
  return Math.max(
    0,
    Math.min(DISPATCH_ASK_APP_MAX_INLINE_WAIT_MS, Math.trunc(parsed)),
  );
}

function isTerminalDispatchTask(task: Task): boolean {
  return DISPATCH_ASK_APP_TERMINAL_STATES.has(String(task.status.state));
}

function dispatchTaskText(task: Task): string {
  return (
    task.status.message?.parts
      ?.filter(
        (part): part is { type: "text"; text: string } => part.type === "text",
      )
      .map((part) => part.text)
      .join("\n")
      .trim() ?? ""
  );
}

type DispatchAskAppStatusErrorCategory =
  | "transport"
  | "timeout"
  | "upstream_5xx"
  | "rate_limited";

type DispatchAskAppTaskResult = {
  app: string;
  routedVia: "a2a";
  taskId: string;
  status: string;
  response?: string;
  error?: string;
  inputRequired?: string;
  statusRead?: "unavailable";
  retryable?: true;
  errorCategory?: DispatchAskAppStatusErrorCategory;
  attempts?: number;
  pollAfterMs?: number;
  poll?: { tool: "ask_app_status"; arguments: { app: string; taskId: string } };
  message?: string;
};

function dispatchAskAppTaskResult(
  app: string,
  task: Task,
): DispatchAskAppTaskResult {
  const status = String(task.status.state);
  const response = dispatchTaskText(task);
  const base = {
    app,
    routedVia: "a2a" as const,
    taskId: task.id,
    status,
  };

  if (status === "completed") {
    return { ...base, response: response || "(no response)" };
  }
  if (status === "failed" || status === "canceled") {
    return {
      ...base,
      ...(response ? { response } : {}),
      error: response || `ask_app task ${status}.`,
    };
  }
  if (status === "input-required") {
    const inputRequired =
      response || "The agent needs additional input before it can continue.";
    return {
      ...base,
      response: inputRequired,
      inputRequired,
      message: inputRequired,
    };
  }
  return {
    ...base,
    pollAfterMs: DISPATCH_ASK_APP_POLL_INTERVAL_MS,
    poll: {
      tool: "ask_app_status",
      arguments: { app, taskId: task.id },
    },
    message:
      `ask_app is still ${status}. Call ask_app_status with ` +
      `taskId "${task.id}" to retrieve the final response.`,
  };
}

async function createDispatchA2AClient(input: {
  targetUrl: string;
  userEmail: string;
  orgDomain?: string;
  orgSecret?: string;
  deadline?: number;
}): Promise<{
  client: A2AClient;
  metadata: Record<string, unknown>;
}> {
  const apiKeys: string[] = [];
  const addSignedToken = async (preferGlobalSecret: boolean) => {
    try {
      const token = await signA2AToken(
        input.userEmail,
        input.orgDomain,
        input.orgSecret,
        { preferGlobalSecret },
      );
      if (token && !apiKeys.includes(token)) apiKeys.push(token);
    } catch {
      // A2A can still be configured for local/dev unauthenticated calls. If
      // signing is unavailable, let the target return its own auth error.
    }
  };

  if (process.env.A2A_SECRET?.trim()) await addSignedToken(true);
  if (input.orgSecret) await addSignedToken(false);

  const metadata: Record<string, unknown> = {
    userEmail: input.userEmail,
    ...(input.orgDomain ? { orgDomain: input.orgDomain } : {}),
    ...(getRequestContext()?.requestOrigin
      ? { requestOrigin: getRequestContext()?.requestOrigin }
      : {}),
  };
  const remainingMs =
    input.deadline == null ? null : input.deadline - Date.now();
  return {
    client: new A2AClient(input.targetUrl, apiKeys[0], {
      requestTimeoutMs:
        remainingMs == null
          ? DISPATCH_A2A_REQUEST_TIMEOUT_MS
          : Math.max(1, Math.min(DISPATCH_A2A_REQUEST_TIMEOUT_MS, remainingMs)),
      ...(apiKeys.length > 1 ? { fallbackApiKeys: apiKeys.slice(1) } : {}),
    }),
    metadata,
  };
}

function isTransientDispatchAskAppStatusError(err: unknown): boolean {
  return dispatchAskAppStatusErrorCategory(err) != null;
}

function dispatchAskAppStatusErrorCategory(
  err: unknown,
): DispatchAskAppStatusErrorCategory | null {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const causeCode = dispatchAskAppStatusErrorCauseCode(err) ?? "";
  const diagnostic = `${message} ${causeCode}`;
  if (/A2A request failed \(429\)/i.test(message)) return "rate_limited";
  if (/A2A request failed \((?:500|502|503|504)\)/i.test(message)) {
    return "upstream_5xx";
  }
  if (/etimedout|timeout|aborted|aborterror/i.test(diagnostic)) {
    return "timeout";
  }
  if (
    /\bfetch failed\b|failed to fetch|networkerror|socket hang up|econnreset/i.test(
      diagnostic,
    )
  ) {
    return "transport";
  }
  return null;
}

function dispatchAskAppStatusErrorCauseCode(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined;
  const directCode = (err as Error & { code?: unknown }).code;
  if (typeof directCode === "string" && directCode.trim()) {
    return directCode.trim();
  }
  if (!err.cause || typeof err.cause !== "object") return undefined;
  const code = (err.cause as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code.trim() : undefined;
}

function dispatchAskAppStatusOriginHost(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return "unknown";
  }
}

function dispatchAskAppStatusReadUnavailableResult(
  app: string,
  taskId: string,
  errorCategory: DispatchAskAppStatusErrorCategory,
  attempts: number,
): DispatchAskAppTaskResult {
  return {
    app,
    routedVia: "a2a",
    taskId,
    status: "unknown",
    statusRead: "unavailable",
    retryable: true,
    errorCategory,
    attempts,
    pollAfterMs: DISPATCH_ASK_APP_POLL_INTERVAL_MS,
    poll: {
      tool: "ask_app_status",
      arguments: { app, taskId },
    },
    message:
      "The durable ask_app task status could not be read after bounded retries. " +
      "The task may still be running or completed. Retry ask_app_status " +
      "with the same app and taskId; do not resubmit ask_app.",
  };
}

async function runBeforeDispatchAskAppDeadline<T>(
  operation: () => Promise<T>,
  deadline: number,
): Promise<T> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new DispatchAskAppInlineDeadlineError();

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new DispatchAskAppInlineDeadlineError()),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function waitForDispatchA2ATask(
  client: A2AClient,
  task: Task,
  deadline: number | undefined,
): Promise<Task> {
  if (deadline == null || isTerminalDispatchTask(task)) return task;
  let current = task;
  while (!isTerminalDispatchTask(current)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return current;
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.min(DISPATCH_ASK_APP_POLL_INTERVAL_MS, remaining),
      ),
    );
    if (Date.now() >= deadline) return current;
    try {
      current = await runBeforeDispatchAskAppDeadline(
        () => client.getTask(task.id),
        deadline,
      );
    } catch (err) {
      if (err instanceof DispatchAskAppInlineDeadlineError) return current;
      if (!isTransientDispatchAskAppStatusError(err)) throw err;
      if (Date.now() >= deadline) return current;
    }
  }
  return current;
}

function normalizeBaseUrl(raw: string | undefined | null): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function normalizeBasePath(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "/") return "";
  const normalized = trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized ? `/${normalized}` : "";
}

function withConfiguredBasePath(baseUrl: string): string {
  const basePath = normalizeBasePath(
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH,
  );
  if (!basePath) return baseUrl;
  try {
    const url = new URL(baseUrl);
    const path = normalizeBasePath(url.pathname);
    if (path === basePath || path.startsWith(`${basePath}/`)) {
      return baseUrl;
    }
    url.pathname = path && path !== "/" ? `${basePath}${path}` : `${basePath}/`;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return baseUrl;
  }
}

function dispatchSelfBaseUrl(): string {
  const requestOrigin = normalizeBaseUrl(getRequestContext()?.requestOrigin);
  if (requestOrigin) return withConfiguredBasePath(requestOrigin);

  const configured =
    normalizeBaseUrl(process.env.WORKSPACE_GATEWAY_URL) ??
    normalizeBaseUrl(process.env.APP_URL) ??
    normalizeBaseUrl(process.env.URL) ??
    normalizeBaseUrl(process.env.DEPLOY_URL) ??
    normalizeBaseUrl(process.env.BETTER_AUTH_URL);
  if (configured) return withConfiguredBasePath(configured);

  return process.env.NODE_ENV === "production"
    ? "https://dispatch.agent-native.com"
    : "http://localhost:8092";
}

function dispatchSelfApp(
  settings: DispatchMcpAppAccessSettings,
): DispatchMcpAccessibleApp {
  return {
    id: DISPATCH_APP_ID,
    name: DISPATCH_NAME,
    description: DISPATCH_DESCRIPTION,
    url: dispatchSelfBaseUrl(),
    color: DISPATCH_COLOR,
    granted: isAppAllowedByMcpAccess(DISPATCH_APP_ID, settings),
  };
}

const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]");

function safeAppPath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const value = raw.trim();
  if (CONTROL_CHARS.test(value)) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  if (/%(?:2f|5c)/i.test(value)) return null;
  const rawPath = value.split(/[?#]/, 1)[0] ?? value;
  let parsed: URL;
  try {
    parsed = new URL(value, "http://agent-native.invalid");
  } catch {
    return null;
  }
  if (parsed.pathname !== rawPath) return null;
  return value;
}

function appendParamsToPath(
  path: string,
  params: Record<string, string | number | boolean> | undefined,
): string {
  if (!params || Object.keys(params).length === 0) return path;
  const url = new URL(path, "http://agent-native.invalid");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function safeAppOrigin(app: DispatchMcpAccessibleApp): string | null {
  try {
    const url = new URL(app.url);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function appBaseUrl(app: DispatchMcpAccessibleApp): string {
  return app.url.replace(/\/+$/, "");
}

function appBasePath(app: DispatchMcpAccessibleApp): string {
  const pathname = new URL(appBaseUrl(app)).pathname.replace(/\/+$/, "");
  return pathname === "/" ? "" : pathname;
}

function appMatchesUrlPath(app: DispatchMcpAccessibleApp, url: URL): boolean {
  const origin = safeAppOrigin(app);
  if (!origin || url.origin !== origin) return false;
  const basePath = appBasePath(app);
  if (!basePath) return true;
  return url.pathname === basePath || url.pathname.startsWith(`${basePath}/`);
}

function appPathSpecificity(app: DispatchMcpAccessibleApp): number {
  return appBasePath(app).length;
}

function appRelativePath(app: DispatchMcpAccessibleApp, url: URL): string {
  const basePath = appBasePath(app);
  const path = basePath
    ? url.pathname === basePath
      ? "/"
      : url.pathname.slice(basePath.length)
    : url.pathname;
  return `${path || "/"}${url.search}${url.hash}`;
}

function isDispatchControlPath(path: string | null): boolean {
  if (!path) return false;
  const route = path.split(/[?#]/, 1)[0] ?? path;
  return (
    route === "/extensions" ||
    route.startsWith("/extensions/") ||
    route === "/tools" ||
    route.startsWith("/tools/")
  );
}

function assertAppCanOpenPath(app: DispatchMcpAccessibleApp, path: string) {
  if (app.id !== DISPATCH_APP_ID && isDispatchControlPath(path)) {
    throw new Error(
      `Path "${path}" belongs to Dispatch. Use app: "dispatch" for Dispatch extension and tool routes.`,
    );
  }
}

function toAccessibleApp(
  agent: DiscoveredAgent,
  settings: DispatchMcpAppAccessSettings,
): DispatchMcpAccessibleApp {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    url: agent.url,
    color: agent.color,
    granted: isAppAllowedByMcpAccess(agent.id, settings),
  };
}

export async function listDispatchMcpApps(): Promise<{
  settings: DispatchMcpAppAccessSettings;
  apps: DispatchMcpAccessibleApp[];
}> {
  const [settings, agents] = await Promise.all([
    getDispatchMcpAppAccessSettings(),
    discoverAgents("dispatch"),
  ]);
  return {
    settings,
    apps: [
      dispatchSelfApp(settings),
      ...agents
        .filter((agent) => normalizeAppId(agent.id) !== DISPATCH_APP_ID)
        .map((agent) => toAccessibleApp(agent, settings)),
    ],
  };
}

export async function listGrantedDispatchMcpApps(): Promise<
  DispatchMcpAccessibleApp[]
> {
  const { apps } = await listDispatchMcpApps();
  return apps.filter((app) => app.granted && safeAppOrigin(app));
}

export async function listGrantedDispatchMcpAppOrigins(): Promise<string[]> {
  const apps = await listGrantedDispatchMcpApps();
  return Array.from(new Set(apps.flatMap((app) => safeAppOrigin(app) ?? [])));
}

export async function resolveGrantedDispatchMcpApp(
  app: string,
): Promise<DispatchMcpAccessibleApp> {
  const target = normalizeAppId(app);
  if (!target) throw new Error("app is required");
  const { apps } = await listDispatchMcpApps();
  const match = apps.find(
    (candidate) =>
      candidate.id === target || candidate.name.toLowerCase() === target,
  );
  if (!match) {
    throw new Error(
      `Unknown app "${app}". Call list_apps to see apps available through Dispatch MCP.`,
    );
  }
  if (!match.granted) {
    throw new Error(
      `Dispatch MCP access to "${match.id}" is not granted. Open Dispatch > Agents to change MCP app access.`,
    );
  }
  if (!safeAppOrigin(match)) {
    throw new Error(
      `Dispatch MCP app "${match.id}" has an invalid URL and cannot be opened through MCP.`,
    );
  }
  return match;
}

export async function askGrantedDispatchMcpApp(
  app: string,
  message: string,
  options?: { async?: boolean; maxWaitMs?: number },
): Promise<ReturnType<typeof dispatchAskAppTaskResult>> {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) throw new Error("message is required");
  const target = await resolveGrantedDispatchMcpApp(app);
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");

  const orgId = getRequestOrgId();
  const [orgDomain, orgSecret] = orgId
    ? await Promise.all([
        getOrgDomain(orgId).catch(() => null),
        getOrgA2ASecret(orgId).catch(() => null),
      ])
    : [null, null];

  const inlineWaitMs =
    options?.async === true
      ? 0
      : boundedDispatchAskAppWaitMs(options?.maxWaitMs);
  const deadline = inlineWaitMs > 0 ? Date.now() + inlineWaitMs : undefined;

  const { client, metadata } = await createDispatchA2AClient({
    targetUrl: target.url,
    userEmail,
    orgDomain: orgDomain ?? undefined,
    orgSecret: orgSecret ?? undefined,
    deadline,
  });
  const task = await client.send(
    {
      role: "user",
      parts: [{ type: "text", text: trimmedMessage }],
    },
    { async: true, metadata },
  );
  const finalOrRunning = await waitForDispatchA2ATask(client, task, deadline);
  return dispatchAskAppTaskResult(target.id, finalOrRunning);
}

export async function getGrantedDispatchMcpAppTask(
  app: string,
  taskId: string,
): Promise<DispatchAskAppTaskResult> {
  const trimmedTaskId = taskId.trim();
  if (!trimmedTaskId) throw new Error("taskId is required");
  const target = await resolveGrantedDispatchMcpApp(app);
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");

  const orgId = getRequestOrgId();
  const [orgDomain, orgSecret] = orgId
    ? await Promise.all([
        getOrgDomain(orgId).catch(() => null),
        getOrgA2ASecret(orgId).catch(() => null),
      ])
    : [null, null];
  const { client } = await createDispatchA2AClient({
    targetUrl: target.url,
    userEmail,
    orgDomain: orgDomain ?? undefined,
    orgSecret: orgSecret ?? undefined,
  });
  const maxAttempts = DISPATCH_ASK_APP_STATUS_RETRY_DELAYS_MS.length + 1;
  for (
    let attempt = 0;
    attempt <= DISPATCH_ASK_APP_STATUS_RETRY_DELAYS_MS.length;
    attempt++
  ) {
    const startedAt = Date.now();
    try {
      const task = await client.getTask(trimmedTaskId);
      return dispatchAskAppTaskResult(target.id, task);
    } catch (err) {
      const delayMs = DISPATCH_ASK_APP_STATUS_RETRY_DELAYS_MS[attempt];
      const errorCategory = dispatchAskAppStatusErrorCategory(err);
      const retryable = errorCategory != null;
      const willRetry = retryable && delayMs != null;
      if (retryable) {
        console.warn("[ask_app_status] tasks/get attempt failed", {
          app: target.id,
          routedVia: "a2a",
          taskId: trimmedTaskId,
          originHost: dispatchAskAppStatusOriginHost(target.url),
          attempt: attempt + 1,
          maxAttempts,
          elapsedMs: Date.now() - startedAt,
          errorCategory,
          errorName: err instanceof Error ? err.name : typeof err,
          causeCode: dispatchAskAppStatusErrorCauseCode(err),
          willRetry,
        });
      }
      if (!retryable) throw err;
      if (delayMs == null) {
        return dispatchAskAppStatusReadUnavailableResult(
          target.id,
          trimmedTaskId,
          errorCategory,
          maxAttempts,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("ask_app_status retry loop exited unexpectedly.");
}

export async function openGrantedDispatchMcpApp(input: {
  app: string;
  view?: string;
  path?: string;
  params?: Record<string, string | number | boolean>;
  embed?: boolean;
  chrome?: "full" | "minimal";
}): Promise<{
  app: string;
  view?: string;
  path?: string;
  url: string;
  embed?: boolean;
  chrome?: "full" | "minimal";
  embedStartUrl?: string;
  embedTargetPath?: string;
  embedExpiresAt?: number;
}> {
  const view = input.view?.trim() ?? "";
  const hasPathInput = input.path != null;
  const path = safeAppPath(input.path);
  if (hasPathInput && !path) {
    throw new Error("path must be a safe app-relative route");
  }
  if (!view && !path) throw new Error("open_app requires view or path");
  const target = await resolveGrantedDispatchMcpApp(input.app);
  if (path) assertAppCanOpenPath(target, path);
  const relUrl = path
    ? appendParamsToPath(path, input.params)
    : buildDeepLink({
        app: target.id,
        view,
        params: input.params,
      });
  const url = `${appBaseUrl(target)}${relUrl}`;
  let embedSession: Awaited<
    ReturnType<typeof createGrantedDispatchMcpEmbedSession>
  > | null = null;
  if (input.embed) {
    try {
      embedSession = await createGrantedDispatchMcpEmbedSession({
        app: target.id,
        url,
        chrome: input.chrome,
      });
    } catch (error) {
      console.warn(
        `[dispatch] Could not pre-mint MCP embed session for ${target.id}:`,
        error,
      );
    }
  }
  return {
    app: target.id,
    ...(view ? { view } : {}),
    ...(path ? { path } : {}),
    url,
    ...(input.embed === true ? { embed: true } : {}),
    ...(input.chrome ? { chrome: input.chrome } : {}),
    ...(embedSession?.startUrl ? { embedStartUrl: embedSession.startUrl } : {}),
    ...(embedSession?.targetPath
      ? { embedTargetPath: embedSession.targetPath }
      : {}),
    ...(typeof embedSession?.expiresAt === "number"
      ? { embedExpiresAt: embedSession.expiresAt }
      : {}),
  };
}

function parseMcpToolTextResult(result: unknown): Record<string, unknown> {
  if (result && typeof result === "object") {
    const structured = (result as any).structuredContent;
    if (structured && typeof structured === "object") return structured;
    const parts = Array.isArray((result as any).content)
      ? ((result as any).content as Array<Record<string, unknown>>)
      : [];
    const text = parts.find(
      (part) => part?.type === "text" && typeof part.text === "string",
    )?.text;
    if (typeof text === "string" && text.trim()) {
      if ((result as any).isError) throw new Error(text.trim());
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") return parsed;
    }
  }
  throw new Error("Target app did not return an embed session.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableTargetMcpError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error ?? "");
  if (
    /rejected the request|unauthorized|forbidden|401|403|404|405|html/i.test(
      message,
    )
  ) {
    return false;
  }
  return /streamable http|handshake|failed to fetch|fetch failed|networkerror|econnrefused|enotfound|timed out|timeout|502|503|504/i.test(
    message,
  );
}

function targetMcpRetryDelay(attempt: number): number {
  const base =
    TARGET_EMBED_SESSION_RETRY_BASE_MS * Math.pow(2, Math.max(0, attempt - 1));
  return base + Math.floor(Math.random() * 100);
}

async function callTargetCreateEmbedSession(input: {
  app: DispatchMcpAccessibleApp;
  token: string;
  url: string;
  chrome?: "full" | "minimal";
}): Promise<unknown> {
  const serverId = "target";
  for (let attempt = 1; ; attempt += 1) {
    const manager = new McpClientManager({
      servers: {
        [serverId]: {
          type: "http",
          url: `${appBaseUrl(input.app)}/mcp`,
          headers: {
            Authorization: `Bearer ${input.token}`,
          },
        },
      },
    });
    try {
      await manager.start();
      return await manager.callTool(
        buildMcpToolName(serverId, "create_embed_session"),
        {
          url: input.url,
          chrome: input.chrome ?? "full",
        },
      );
    } catch (error) {
      if (
        attempt >= TARGET_EMBED_SESSION_ATTEMPTS ||
        !isRetryableTargetMcpError(error)
      ) {
        throw error;
      }
      await sleep(targetMcpRetryDelay(attempt));
    } finally {
      await manager.stop().catch((stopError) => {
        console.warn("[dispatch] Failed to stop target MCP client:", stopError);
      });
    }
  }
}

async function resolveDispatchEmbedTarget(input: {
  app?: string;
  url?: string;
  path?: string;
}): Promise<{ app: DispatchMcpAccessibleApp; path: string; url: string }> {
  const explicitApp = input.app?.trim()
    ? await resolveGrantedDispatchMcpApp(input.app)
    : null;
  if (explicitApp && input.path) {
    const path = safeAppPath(input.path);
    if (!path) throw new Error("path must be a safe app-relative route");
    assertAppCanOpenPath(explicitApp, path);
    return {
      app: explicitApp,
      path,
      url: `${appBaseUrl(explicitApp)}${path}`,
    };
  }

  if (!input.url) {
    throw new Error("create_embed_session requires a url or app + path.");
  }

  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    if (!explicitApp) {
      throw new Error("Relative embed paths require an app id.");
    }
    const path = safeAppPath(input.url);
    if (!path) throw new Error("url must be a safe app route.");
    return {
      app: explicitApp,
      path,
      url: `${appBaseUrl(explicitApp)}${path}`,
    };
  }

  const apps = explicitApp ? [explicitApp] : await listGrantedDispatchMcpApps();
  const target = apps
    .filter((app) => appMatchesUrlPath(app, parsed))
    .sort((a, b) => appPathSpecificity(b) - appPathSpecificity(a))[0];
  if (!target) {
    throw new Error(
      "Embed URL must belong to an app granted through Dispatch.",
    );
  }
  const path = safeAppPath(appRelativePath(target, parsed));
  if (!path) throw new Error("Embed URL path is not safe.");
  assertAppCanOpenPath(target, path);
  return { app: target, path, url: `${appBaseUrl(target)}${path}` };
}

async function createDispatchSelfEmbedSession(input: {
  ownerEmail: string;
  orgId?: string;
  path: string;
  baseUrl: string;
  chrome?: "full" | "minimal";
}): Promise<{
  startUrl: string;
  targetPath?: string;
  expiresAt?: number;
  app: string;
}> {
  const ticket = await createEmbedSessionTicket({
    ownerEmail: input.ownerEmail,
    orgId: input.orgId,
    targetPath: input.path,
    scope: input.chrome ?? null,
  });
  const startPath = buildEmbedStartPath(ticket.ticket);
  return {
    startUrl: new URL(startPath, input.baseUrl).toString(),
    targetPath: input.path,
    expiresAt: ticket.expiresAt,
    app: DISPATCH_APP_ID,
  };
}

export async function createGrantedDispatchMcpEmbedSession(input: {
  app?: string;
  url?: string;
  path?: string;
  chrome?: "full" | "minimal";
}): Promise<{
  startUrl: string;
  targetPath?: string;
  expiresAt?: number;
  app: string;
}> {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  const target = await resolveDispatchEmbedTarget(input);

  const orgId = getRequestOrgId();
  if (target.app.id === DISPATCH_APP_ID) {
    return createDispatchSelfEmbedSession({
      ownerEmail: userEmail,
      orgId,
      path: target.path,
      baseUrl: appBaseUrl(target.app),
      chrome: input.chrome,
    });
  }

  const [orgDomain, orgSecret] = orgId
    ? await Promise.all([
        getOrgDomain(orgId).catch(() => null),
        getOrgA2ASecret(orgId).catch(() => null),
      ])
    : [null, null];
  const usableOrgSecret =
    typeof orgSecret === "string" && orgSecret.trim().length > 0;
  const usableOrgDomain =
    typeof orgDomain === "string" && orgDomain.trim().length > 0;
  const useOrgSigning = usableOrgDomain && usableOrgSecret;
  const signedOrgDomain = usableOrgDomain ? orgDomain.trim() : undefined;
  const token = await signA2AToken(
    userEmail,
    signedOrgDomain,
    useOrgSigning ? orgSecret.trim() : undefined,
    {
      expiresIn: "5m",
      // Prefer the synced org A2A secret when present because first-party
      // production apps do not have to share the same deployment env secret.
      // Fall back to the global A2A_SECRET for orgs that have not synced yet.
      preferGlobalSecret: !useOrgSigning,
    },
  );

  const result = await callTargetCreateEmbedSession({
    app: target.app,
    token,
    url: target.url,
    chrome: input.chrome,
  });
  const parsed = parseMcpToolTextResult(result) as {
    startUrl?: string;
    targetPath?: string;
    expiresAt?: number;
  };
  if (!parsed.startUrl) {
    throw new Error("Target app did not return an embed start URL.");
  }
  const output: {
    startUrl: string;
    targetPath?: string;
    expiresAt?: number;
    app: string;
  } = {
    startUrl: parsed.startUrl,
    app: target.app.id,
  };
  if (parsed.targetPath) output.targetPath = parsed.targetPath;
  if (typeof parsed.expiresAt === "number") output.expiresAt = parsed.expiresAt;
  return output;
}
