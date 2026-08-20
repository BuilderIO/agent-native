import {
  A2AClient,
  canonicalA2AAudience,
  extractA2APersistedMutationReceipts,
  signA2AToken,
  stripA2APersistedArtifactMarkers,
  type A2APersistedMutationReceipt,
  type Task,
} from "@agent-native/core/a2a";
import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";
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
  getBuiltinAgents,
  type DiscoveredAgent,
} from "@agent-native/core/server/agent-discovery";

import {
  DISPATCH_WORKSPACE_SSO_FLAG,
  isWorkspaceSsoAppUrl,
} from "../../shared/workspace-sso.js";
import {
  listWorkspaceApps,
  type WorkspaceAppSummary,
} from "./app-creation-store.js";
import {
  getDispatchMcpAppAccessSettings,
  isAppAllowedByMcpAccess,
  type DispatchMcpAppAccessSettings,
} from "./mcp-access-store.js";

const DISPATCH_APP_ID = "dispatch";
const DISPATCH_NAME = "Dispatch";
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
  /** Server-validated workspace inventory projection for mounted apps. */
  workspaceSso?: boolean;
  /** Canonical browser entry point when `url` is a deep A2A/agent link. */
  homeUrl?: string;
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

type DispatchMutationReceipt = A2APersistedMutationReceipt;

function dispatchTaskMutationReceipts(
  task: Task,
  app: string,
  identity: {
    userEmail: string;
    orgId: string | null;
    orgSecret: string | null;
  },
): DispatchMutationReceipt[] {
  if (app !== "content" || !identity.orgSecret) return [];
  const text = dispatchTaskText(task);
  if (!text) return [];
  const result = [{ tool: "call-agent", result: text }];
  const receipts = extractA2APersistedMutationReceipts(result, {
    persistedArtifactSecrets: [identity.orgSecret],
    expectedDelegatedTaskId: task.id,
  });
  return receipts.filter((receipt) => {
    if (receipt.target.authorityScopeKind === "personal") {
      return (
        receipt.target.authorityScopeId.toLowerCase() ===
        identity.userEmail.toLowerCase()
      );
    }
    return (
      identity.orgId !== null &&
      receipt.target.authorityScopeId === identity.orgId
    );
  });
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
  receipts?: DispatchMutationReceipt[];
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
  identity: {
    userEmail: string;
    orgId: string | null;
    orgSecret: string | null;
  },
): DispatchAskAppTaskResult {
  const status = String(task.status.state);
  const response = stripA2APersistedArtifactMarkers(dispatchTaskText(task));
  const receipts = dispatchTaskMutationReceipts(task, app, identity);
  const base = {
    app,
    routedVia: "a2a" as const,
    taskId: task.id,
    status,
  };

  if (status === "completed") {
    return {
      ...base,
      response: response || "(no response)",
      ...(receipts.length > 0 ? { receipts } : {}),
    };
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

function appHomeBaseUrl(app: DispatchMcpAccessibleApp): string {
  const configured = app.homeUrl?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.toString().replace(/\/+$/, "");
      }
    } catch {
      // coercion-ok: invalid optional home URL falls back to endpoint.
      // Fall back to the registered endpoint below. The endpoint has already
      // passed the app-origin validation before this helper is reached.
    }
  }
  return appBaseUrl(app);
}

function resolveGrantedAppEmbedStartUrl(
  app: DispatchMcpAccessibleApp,
  startUrl: string,
): string {
  try {
    const baseUrl = appHomeBaseUrl(app);
    const resolved = new URL(startUrl, `${baseUrl}/`);
    if (!appMatchesUrlPath(app, resolved)) {
      throw new Error(
        "Target app returned an embed start URL outside the granted app.",
      );
    }
    return resolved.toString();
  } catch {
    throw new Error("Target app returned an invalid embed start URL.");
  }
}

function appBasePath(app: DispatchMcpAccessibleApp): string {
  const pathname = new URL(appHomeBaseUrl(app)).pathname.replace(/\/+$/, "");
  return pathname === "/" ? "" : pathname;
}

function appMatchesUrlPath(app: DispatchMcpAccessibleApp, url: URL): boolean {
  const origin = new URL(appHomeBaseUrl(app)).origin;
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

function defaultWorkspaceSsoHomeUrl(
  app: DispatchMcpAccessibleApp,
  builtinHomeUrls: ReadonlyMap<string, string>,
): string | undefined {
  const builtinHomeUrl = builtinHomeUrls.get(app.id);
  if (builtinHomeUrl) return builtinHomeUrl;
  return safeAppOrigin(app) ?? undefined;
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

async function isEligibleWorkspaceSsoApp(
  candidate: DispatchMcpAccessibleApp,
): Promise<boolean> {
  return isWorkspaceSsoAppUrl(candidate, {
    nodeEnv: process.env.NODE_ENV,
    registryRaw: process.env.IDENTITY_SSO_APP_REGISTRY_JSON,
  });
}

async function listWorkspaceSsoApps(): Promise<DispatchMcpAccessibleApp[]> {
  const [agents, mountedApps] = await Promise.all([
    discoverAgents("dispatch"),
    listWorkspaceApps({ includeAgentCards: false }),
  ]);
  const builtinHomeUrls = new Map(
    getBuiltinAgents("dispatch").map((agent) => [agent.id, agent.url]),
  );
  const candidatesById = new Map<string, DispatchMcpAccessibleApp>();
  for (const agent of agents) {
    if (normalizeAppId(agent.id) === DISPATCH_APP_ID) continue;
    const accessible = toAccessibleApp(agent, {
      mode: "all-apps",
      selectedAppIds: [],
    });
    candidatesById.set(agent.id, {
      ...accessible,
      homeUrl: defaultWorkspaceSsoHomeUrl(accessible, builtinHomeUrls),
      granted: true,
    });
  }
  // The hosted Dispatch database is separate from the shared Workspace
  // database. Overlay the live mounted registry so custom apps remain
  // discoverable without copying a stale app list into Dispatch configuration.
  for (const app of mountedApps) {
    if (app.isDispatch || !app.url) continue;
    candidatesById.set(app.id, {
      id: app.id,
      name: app.name,
      description: app.description,
      url: app.url,
      ...(app.workspaceSso === true ? { workspaceSso: true } : {}),
      color: DISPATCH_COLOR,
      granted: true,
    });
  }
  const candidates = [...candidatesById.values()];
  const eligible = [] as DispatchMcpAccessibleApp[];
  for (const candidate of candidates) {
    if (await isEligibleWorkspaceSsoApp(candidate)) {
      eligible.push(candidate);
    }
  }
  return [
    {
      id: DISPATCH_APP_ID,
      name: DISPATCH_NAME,
      description: DISPATCH_DESCRIPTION,
      url: dispatchSelfBaseUrl(),
      color: DISPATCH_COLOR,
      granted: true,
    },
    ...eligible,
  ];
}

async function resolveWorkspaceSsoApp(
  app: string,
): Promise<DispatchMcpAccessibleApp> {
  const target = normalizeAppId(app);
  if (!target) throw new Error("app is required");
  const apps = await listWorkspaceSsoApps();
  const match = apps.find(
    (candidate) =>
      candidate.id === target || candidate.name.toLowerCase() === target,
  );
  if (!match) {
    throw new Error(
      `Workspace app "${app}" is not registered for workspace sign-in.`,
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
  return dispatchAskAppTaskResult(target.id, finalOrRunning, {
    userEmail,
    orgId: orgId ?? null,
    orgSecret: orgSecret ?? null,
  });
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
      return dispatchAskAppTaskResult(target.id, task, {
        userEmail,
        orgId: orgId ?? null,
        orgSecret: orgSecret ?? null,
      });
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

function isTargetMcpAuthError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error ?? "");
  return /\b401\b|\b403\b|unauthorized|forbidden|invalid(?: or expired)? (?:a2a )?token|authentication required/i.test(
    message,
  );
}

function targetMcpErrorStatus(error: unknown): number | undefined {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error ?? "");
  const status = message.match(/\b([45]\d{2})\b/)?.[1];
  return status ? Number(status) : undefined;
}

type TargetMcpTokenAttempt = {
  token: string;
  strategy: "org" | "global";
};

function targetMcpRequestDetails(input: {
  app: DispatchMcpAccessibleApp;
  url: string;
}): { app: string; targetOrigin: string; targetPath: string } {
  const targetUrl = new URL(input.url);
  return {
    app: input.app.id,
    targetOrigin: targetUrl.origin,
    targetPath: targetUrl.pathname,
  };
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

async function createTargetMcpTokenAttempts(input: {
  ownerEmail: string;
  orgDomain?: string;
  orgSecret?: string;
  target: DispatchMcpAccessibleApp;
}): Promise<TargetMcpTokenAttempt[]> {
  const attempts: TargetMcpTokenAttempt[] = [];
  const addAttempt = async (tokenInput: {
    strategy: TargetMcpTokenAttempt["strategy"];
    secret?: string;
    preferGlobalSecret: boolean;
  }) => {
    const token = await signA2AToken(
      input.ownerEmail,
      input.orgDomain,
      tokenInput.secret,
      {
        expiresIn: "5m",
        audience: canonicalA2AAudience(appBaseUrl(input.target)),
        preferGlobalSecret: tokenInput.preferGlobalSecret,
      },
    );
    if (!attempts.some((attempt) => attempt.token === token)) {
      attempts.push({ token, strategy: tokenInput.strategy });
    }
  };

  if (input.orgDomain && input.orgSecret) {
    await addAttempt({
      strategy: "org",
      secret: input.orgSecret,
      preferGlobalSecret: false,
    });
    // A target app may not have the org secret synced yet. The shared secret
    // is a bounded compatibility fallback, used only after the target rejects
    // the org-signed request and never after a non-authentication failure.
    if (process.env.A2A_SECRET?.trim()) {
      await addAttempt({
        strategy: "global",
        preferGlobalSecret: true,
      });
    }
  } else {
    await addAttempt({
      strategy: "global",
      preferGlobalSecret: true,
    });
  }

  return attempts;
}

async function resolveEmbedTarget(
  input: {
    app?: string;
    url?: string;
    path?: string;
  },
  options: {
    resolveApp: (app: string) => Promise<DispatchMcpAccessibleApp>;
    listApps: () => Promise<DispatchMcpAccessibleApp[]>;
    urlError: string;
  },
): Promise<{ app: DispatchMcpAccessibleApp; path: string; url: string }> {
  const explicitApp = input.app?.trim()
    ? await options.resolveApp(input.app)
    : null;
  if (explicitApp && input.path) {
    const path = safeAppPath(input.path);
    if (!path) throw new Error("path must be a safe app-relative route");
    assertAppCanOpenPath(explicitApp, path);
    return {
      app: explicitApp,
      path,
      url: `${appHomeBaseUrl(explicitApp)}${path}`,
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
      url: `${appHomeBaseUrl(explicitApp)}${path}`,
    };
  }

  const apps = explicitApp ? [explicitApp] : await options.listApps();
  const target = apps
    .filter((app) => appMatchesUrlPath(app, parsed))
    .sort((a, b) => appPathSpecificity(b) - appPathSpecificity(a))[0];
  if (!target) {
    throw new Error(options.urlError);
  }
  const path = safeAppPath(appRelativePath(target, parsed));
  if (!path) throw new Error("Embed URL path is not safe.");
  assertAppCanOpenPath(target, path);
  return { app: target, path, url: `${appHomeBaseUrl(target)}${path}` };
}

async function resolveDispatchEmbedTarget(input: {
  app?: string;
  url?: string;
  path?: string;
}): Promise<{ app: DispatchMcpAccessibleApp; path: string; url: string }> {
  return resolveEmbedTarget(input, {
    resolveApp: resolveGrantedDispatchMcpApp,
    listApps: listGrantedDispatchMcpApps,
    urlError: "Embed URL must belong to an app granted through Dispatch.",
  });
}

async function resolveWorkspaceSsoEmbedTarget(input: {
  app?: string;
  url?: string;
  path?: string;
}): Promise<{ app: DispatchMcpAccessibleApp; path: string; url: string }> {
  return resolveEmbedTarget(input, {
    resolveApp: resolveWorkspaceSsoApp,
    listApps: listWorkspaceSsoApps,
    urlError:
      "Embed URL must belong to an app registered for Dispatch workspace sign-in.",
  });
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

  return createEmbedSessionForResolvedApp({
    ownerEmail: userEmail,
    orgId: getRequestOrgId(),
    target,
    chrome: input.chrome,
  });
}

async function createEmbedSessionForResolvedApp(input: {
  ownerEmail: string;
  orgId?: string;
  target: { app: DispatchMcpAccessibleApp; path: string; url: string };
  chrome?: "full" | "minimal";
}): Promise<{
  startUrl: string;
  targetPath?: string;
  expiresAt?: number;
  app: string;
}> {
  const { ownerEmail, orgId, target, chrome } = input;

  if (target.app.id === DISPATCH_APP_ID) {
    return createDispatchSelfEmbedSession({
      ownerEmail,
      orgId,
      path: target.path,
      baseUrl: appBaseUrl(target.app),
      chrome,
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
  const signedOrgDomain = usableOrgDomain ? orgDomain.trim() : undefined;
  const tokenAttempts = await createTargetMcpTokenAttempts({
    ownerEmail,
    orgDomain: signedOrgDomain,
    orgSecret: usableOrgSecret ? orgSecret.trim() : undefined,
    target: target.app,
  });
  const targetDetails = targetMcpRequestDetails({
    app: target.app,
    url: target.url,
  });
  let parsed: {
    startUrl?: string;
    targetPath?: string;
    expiresAt?: number;
  } | null = null;
  let lastError: unknown;
  for (
    let attemptIndex = 0;
    attemptIndex < tokenAttempts.length;
    attemptIndex++
  ) {
    const tokenAttempt = tokenAttempts[attemptIndex];
    console.info("[dispatch] workspace embed target request", {
      ...targetDetails,
      authStrategy: tokenAttempt.strategy,
      attempt: attemptIndex + 1,
      attempts: tokenAttempts.length,
    });
    try {
      const result = await callTargetCreateEmbedSession({
        app: target.app,
        token: tokenAttempt.token,
        url: target.url,
        chrome,
      });
      parsed = parseMcpToolTextResult(result) as {
        startUrl?: string;
        targetPath?: string;
        expiresAt?: number;
      };
      break;
    } catch (error) {
      lastError = error;
      console.warn("[dispatch] workspace embed target response", {
        ...targetDetails,
        authStrategy: tokenAttempt.strategy,
        attempt: attemptIndex + 1,
        status: targetMcpErrorStatus(error),
        category: isTargetMcpAuthError(error)
          ? "authentication"
          : isRetryableTargetMcpError(error)
            ? "transient"
            : "permanent",
      });
      if (
        !isTargetMcpAuthError(error) ||
        attemptIndex >= tokenAttempts.length - 1
      ) {
        throw error;
      }
    }
  }
  if (!parsed) {
    throw lastError instanceof Error
      ? lastError
      : new Error("Target app did not return an embed session.");
  }
  if (!parsed.startUrl) {
    throw new Error("Target app did not return an embed start URL.");
  }
  const startUrl = resolveGrantedAppEmbedStartUrl(target.app, parsed.startUrl);
  const startUrlDetails = new URL(startUrl);
  console.info("[dispatch] workspace embed target minted session", {
    ...targetDetails,
    startPath: startUrlDetails.pathname,
    returnedTicket: startUrlDetails.searchParams.has("ticket"),
    returnedTargetPath: typeof parsed.targetPath === "string",
    returnedExpiry: typeof parsed.expiresAt === "number",
  });
  const output: {
    startUrl: string;
    targetPath?: string;
    expiresAt?: number;
    app: string;
  } = {
    startUrl,
    app: target.app.id,
  };
  if (parsed.targetPath) output.targetPath = parsed.targetPath;
  if (typeof parsed.expiresAt === "number") output.expiresAt = parsed.expiresAt;
  return output;
}

export async function createWorkspaceSsoEmbedSession(input: {
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
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) {
    console.warn("[dispatch] workspace embed mint rejected", {
      phase: "dispatch-auth",
      requestedApp: input.app ?? null,
      hasPath: typeof input.path === "string",
      hasUrl: typeof input.url === "string",
      ownerResolved: false,
      orgResolved: Boolean(getRequestOrgId()),
    });
    throw new Error("no authenticated user");
  }
  const enabled = await isFeatureFlagEnabled(DISPATCH_WORKSPACE_SSO_FLAG, {
    userEmail: ownerEmail,
    userKey: ownerEmail,
    orgId: getRequestOrgId(),
  });
  if (!enabled) {
    console.warn("[dispatch] workspace embed mint rejected", {
      phase: "feature-flag",
      requestedApp: input.app ?? null,
      hasPath: typeof input.path === "string",
      hasUrl: typeof input.url === "string",
      ownerResolved: true,
      orgResolved: Boolean(getRequestOrgId()),
    });
    throw new Error("Dispatch workspace sign-in is not enabled.");
  }

  const target = await resolveWorkspaceSsoEmbedTarget(input);
  return createEmbedSessionForResolvedApp({
    ownerEmail,
    orgId: getRequestOrgId(),
    target,
    chrome: input.chrome,
  });
}
