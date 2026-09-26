import type { A2AApprovedAction, Task } from "../a2a/types.js";
import type { ActionEntry } from "../agent/production-agent.js";
import type { ActionTool } from "../agent/types.js";
import { getConfiguredAppBasePath } from "../server/app-base-path.js";
import { buildDeepLink } from "../server/deep-link.js";
import {
  getRequestContext,
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import { MCP_APP_CHAT_BRIDGE_QUERY_PARAM } from "../shared/embed-auth.js";
import {
  signAskAppTaskHandle,
  verifyAskAppTaskHandle,
} from "./ask-app-task-handle.js";
import type { MCPConfig } from "./build-server.js";
import { embedApp } from "./embed-app.js";
import { fetchOrgApps, type OrgApp } from "./org-directory.js";

type Params = Record<
  string,
  { type: string; description?: string; enum?: string[] }
>;

function tool(
  description: string,
  parameters?: Params,
  required?: string[],
): ActionTool {
  if (!parameters) return { description };
  return {
    description,
    parameters: {
      type: "object",
      properties: parameters,
      ...(required && required.length ? { required } : {}),
    },
  };
}

function currentAppId(config: MCPConfig): string {
  return (config.appId || config.name || "app").toLowerCase();
}

const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]");
const ASK_APP_DEFAULT_INLINE_WAIT_MS = 20_000;
const ASK_APP_MAX_INLINE_WAIT_MS = 20_000;
const ASK_APP_POLL_INTERVAL_MS = 1_500;
const ASK_APP_A2A_REQUEST_TIMEOUT_MS = 10_000;
const ASK_APP_STATUS_RETRY_DELAYS_MS = [250, 750, 1_500] as const;
const ASK_APP_TERMINAL_STATES = new Set<string>([
  "completed",
  "failed",
  "canceled",
  "input-required",
]);

class AskAppInlineDeadlineError extends Error {
  constructor() {
    super("ask_app inline wait deadline reached");
    this.name = "AskAppInlineDeadlineError";
  }
}

type AskAppRequestMeta = { origin?: string; basePath?: string };

interface AskAppRoute {
  app: string;
  origin: string;
  routedVia: "local" | "a2a";
  requestOrigin?: string;
  note?: string;
}

interface AskAppTaskResult {
  app: string;
  routedVia: "local" | "a2a";
  taskId: string;
  taskHandle?: string;
  status: string;
  response?: string;
  verification?: "unverified";
  error?: string;
  inputRequired?: string;
  note?: string;
  pollAfterMs?: number;
  poll?: {
    tool: "ask_app_status";
    arguments: { app: string; taskId: string; taskHandle?: string };
  };
  message?: string;
  statusRead?: "unavailable";
  retryable?: true;
  errorCategory?: AskAppStatusErrorCategory;
  attempts?: number;
}

type AskAppStatusErrorCategory =
  | "transport"
  | "timeout"
  | "upstream_5xx"
  | "rate_limited";

function safeAppPath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const value = raw.trim();
  if (CONTROL_CHARS.test(value)) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(value)) return null;
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

function withConfiguredBasePath(path: string): string {
  const base = getConfiguredAppBasePath();
  if (!base || path === base || path.startsWith(`${base}/`)) return path;
  return `${base}${path}`;
}

function withMcpChatBridgeParam(path: string): string {
  try {
    const url = new URL(path, "http://agent-native.invalid");
    url.searchParams.set(MCP_APP_CHAT_BRIDGE_QUERY_PARAM, "1");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return path;
  }
}

function agentNativeA2AEndpoint(urlOrOrigin: string): string {
  const value = urlOrOrigin.replace(/\/+$/, "");
  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (pathname.endsWith("/_agent-native/a2a") || pathname.endsWith("/a2a")) {
      return value;
    }
  } catch {
    // coercion-ok: invalid URL input intentionally uses the conventional endpoint fallback.
    // Fall through and append the conventional Agent-Native endpoint.
  }
  return `${value}/_agent-native/a2a`;
}

function selfA2AEndpointUrl(requestMeta?: AskAppRequestMeta): string | null {
  const origin = requestMeta?.origin?.replace(/\/+$/, "");
  if (!origin) return null;
  const basePath = requestMeta?.basePath || getConfiguredAppBasePath();
  return agentNativeA2AEndpoint(`${origin}${basePath}`);
}

function askAppIssuerAudience(requestMeta?: AskAppRequestMeta): string | null {
  const origin = requestMeta?.origin?.replace(/\/+$/, "");
  if (!origin) return null;
  try {
    const originUrl = new URL(origin);
    if (
      !["http:", "https:"].includes(originUrl.protocol) ||
      originUrl.username ||
      originUrl.password
    ) {
      return null;
    }
    const basePath = requestMeta?.basePath || getConfiguredAppBasePath();
    const audience = new URL(basePath || "/", `${originUrl.origin}/`);
    const pathname = audience.pathname.replace(/\/+$/, "");
    return `${audience.origin}${pathname}`;
  } catch {
    return null;
  }
}

function boundedAskAppWaitMs(raw: unknown): number {
  if (raw == null || raw === "") return ASK_APP_DEFAULT_INLINE_WAIT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return ASK_APP_DEFAULT_INLINE_WAIT_MS;
  return Math.max(0, Math.min(ASK_APP_MAX_INLINE_WAIT_MS, Math.trunc(parsed)));
}

function isExplicitAsyncAsk(raw: unknown): boolean {
  return raw === true || raw === "true" || raw === 1 || raw === "1";
}

function taskState(task: Task): string {
  return String(task.status?.state ?? "unknown");
}

function isTerminalTask(task: Task): boolean {
  return ASK_APP_TERMINAL_STATES.has(taskState(task));
}

function taskText(task: Task): string {
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

function askAppTaskResult(
  route: AskAppRoute,
  task: Task,
  taskHandle?: string,
): AskAppTaskResult {
  const status = taskState(task);
  const response = taskText(task);
  const base = {
    app: route.app,
    routedVia: route.routedVia,
    taskId: task.id,
    ...(taskHandle ? { taskHandle } : {}),
    status,
    ...(route.note ? { note: route.note } : {}),
  };

  if (status === "completed") {
    return {
      ...base,
      response: response || "(no response)",
      verification: "unverified",
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
    pollAfterMs: ASK_APP_POLL_INTERVAL_MS,
    poll: {
      tool: "ask_app_status",
      arguments: {
        app: route.app,
        taskId: task.id,
        ...(taskHandle ? { taskHandle } : {}),
      },
    },
    message:
      `ask_app is still ${status}. Call ask_app_status with ` +
      (taskHandle
        ? "the returned taskHandle to retrieve the final response."
        : `taskId "${task.id}" to retrieve the final response.`),
  };
}

function askAppInlineTaskResult(
  selfId: string,
  taskId: string,
  inline: {
    status: "working" | "completed" | "failed";
    response?: string;
    error?: string;
  },
  note?: string,
): AskAppTaskResult {
  const base = {
    app: selfId,
    routedVia: "local" as const,
    taskId,
    status: inline.status,
    ...(note ? { note } : {}),
  };

  if (inline.status === "completed") {
    return {
      ...base,
      response: inline.response || "(no response)",
      verification: "unverified",
    };
  }

  if (inline.status === "failed") {
    return { ...base, error: inline.error || "ask_app task failed." };
  }

  return {
    ...base,
    pollAfterMs: ASK_APP_POLL_INTERVAL_MS,
    poll: {
      tool: "ask_app_status",
      arguments: { app: selfId, taskId },
    },
    message:
      `ask_app is still ${inline.status}. Call ask_app_status with ` +
      `taskId "${taskId}" to retrieve the final response.`,
  };
}

async function createA2AClientForAskApp(
  origin: string,
  requestOrigin?: string,
  deadline?: number,
): Promise<{
  client: import("../a2a/client.js").A2AClient;
  metadata: Record<string, unknown>;
}> {
  const { A2AClient } = await import("../a2a/client.js");
  const { resolveA2ACallerAuth } = await import("../a2a/caller-auth.js");
  const auth = await resolveA2ACallerAuth();
  const metadata: Record<string, unknown> = {};
  if (auth.userEmail) metadata.userEmail = auth.userEmail;
  if (auth.orgDomain) metadata.orgDomain = auth.orgDomain;
  if (requestOrigin) metadata.requestOrigin = requestOrigin;
  const remainingMs = deadline == null ? null : deadline - Date.now();
  return {
    client: new A2AClient(origin, auth.apiKey, {
      requestTimeoutMs:
        remainingMs == null
          ? ASK_APP_A2A_REQUEST_TIMEOUT_MS
          : Math.max(1, Math.min(ASK_APP_A2A_REQUEST_TIMEOUT_MS, remainingMs)),
      ...(auth.apiKeyFallbacks
        ? { fallbackApiKeys: auth.apiKeyFallbacks }
        : {}),
    }),
    metadata,
  };
}

async function runBeforeAskAppDeadline<T>(
  operation: () => Promise<T>,
  deadline: number,
): Promise<T> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new AskAppInlineDeadlineError();

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new AskAppInlineDeadlineError()),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function waitForA2ATask(
  client: import("../a2a/client.js").A2AClient,
  initialTask: Task,
  deadline: number | undefined,
): Promise<Task> {
  if (deadline == null || isTerminalTask(initialTask)) return initialTask;
  let current = initialTask;

  while (!isTerminalTask(current)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return current;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(ASK_APP_POLL_INTERVAL_MS, remaining)),
    );
    if (Date.now() >= deadline) return current;
    try {
      current = await runBeforeAskAppDeadline(
        () => client.getTask(initialTask.id),
        deadline,
      );
    } catch (err) {
      if (err instanceof AskAppInlineDeadlineError) return current;
      if (!isTransientAskAppStatusError(err)) throw err;
      if (Date.now() >= deadline) return current;
    }
  }

  return current;
}

async function askAppIdempotencyKey(
  route: AskAppRoute,
  issuerApp: string,
  issuerAudience: string,
  message: string,
  approvedActions?: A2AApprovedAction[],
): Promise<string> {
  const requestId = getRequestContext()?.mcpRequestId;
  if (!requestId) return `ask-app:${globalThis.crypto.randomUUID()}`;

  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify({
        requestId,
        route,
        issuerApp,
        issuerAudience,
        message,
        approvedActions: approvedActions ?? [],
      }),
    ),
  );
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `ask-app:v1:${hex}`;
}

async function submitAskAppA2ATask(
  route: AskAppRoute,
  issuerApp: string,
  issuerAudience: string,
  message: string,
  maxWaitMs: number,
  approvedActions?: A2AApprovedAction[],
): Promise<AskAppTaskResult> {
  const deadline = maxWaitMs > 0 ? Date.now() + maxWaitMs : undefined;
  const submissionDeadline =
    deadline ?? Date.now() + ASK_APP_A2A_REQUEST_TIMEOUT_MS;
  const { client, metadata } = await createA2AClientForAskApp(
    route.origin,
    route.requestOrigin,
    submissionDeadline,
  );
  const idempotencyKey = await askAppIdempotencyKey(
    route,
    issuerApp,
    issuerAudience,
    message,
    approvedActions,
  );
  const task = await client.send(
    {
      role: "user",
      parts: [{ type: "text", text: message }],
    },
    {
      async: true,
      metadata,
      idempotencyKey,
      deadlineMs: submissionDeadline,
      ...(approvedActions?.length ? { approvedActions } : {}),
    },
  );
  const finalOrRunning = await waitForA2ATask(client, task, deadline);
  const subject =
    typeof metadata.userEmail === "string" ? metadata.userEmail : "anonymous";
  const taskHandle = await signAskAppTaskHandle({
    issuerApp,
    issuerAudience,
    organization: getRequestOrgId() ?? "",
    subject,
    route,
    taskId: task.id,
  });
  return askAppTaskResult(route, finalOrRunning, taskHandle);
}

async function fetchAskAppA2ATask(
  route: AskAppRoute,
  taskId: string,
  taskHandle?: string,
): Promise<AskAppTaskResult> {
  const { client } = await createA2AClientForAskApp(route.origin);
  const maxAttempts = ASK_APP_STATUS_RETRY_DELAYS_MS.length + 1;
  for (
    let attempt = 0;
    attempt <= ASK_APP_STATUS_RETRY_DELAYS_MS.length;
    attempt++
  ) {
    const startedAt = Date.now();
    try {
      const task = await client.getTask(taskId);
      return askAppTaskResult(route, task, taskHandle);
    } catch (err) {
      const delayMs = ASK_APP_STATUS_RETRY_DELAYS_MS[attempt];
      const errorCategory = askAppStatusErrorCategory(err);
      const retryable = errorCategory != null;
      const willRetry = retryable && delayMs != null;
      if (retryable) {
        console.warn("[ask_app_status] tasks/get attempt failed", {
          app: route.app,
          routedVia: route.routedVia,
          taskId,
          originHost: askAppStatusOriginHost(route.origin),
          attempt: attempt + 1,
          maxAttempts,
          elapsedMs: Date.now() - startedAt,
          errorCategory,
          errorName: err instanceof Error ? err.name : typeof err,
          causeCode: askAppStatusErrorCauseCode(err),
          willRetry,
        });
      }

      if (!retryable) {
        throw err;
      }
      if (delayMs == null) {
        return askAppStatusReadUnavailableResult(
          route,
          taskId,
          errorCategory,
          maxAttempts,
          taskHandle,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("ask_app_status retry loop exited unexpectedly.");
}

function isTransientAskAppStatusError(err: unknown): boolean {
  return askAppStatusErrorCategory(err) != null;
}

function askAppStatusErrorCategory(
  err: unknown,
): AskAppStatusErrorCategory | null {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : (JSON.stringify(err ?? "") ?? "");
  const causeCode = askAppStatusErrorCauseCode(err) ?? "";
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

function askAppStatusErrorCauseCode(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined;
  const directCode = (err as Error & { code?: unknown }).code;
  if (typeof directCode === "string" && directCode.trim()) {
    return directCode.trim();
  }
  if (!err.cause || typeof err.cause !== "object") return undefined;
  const code = (err.cause as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code.trim() : undefined;
}

function askAppStatusOriginHost(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return "unknown";
  }
}

function askAppStatusReadUnavailableResult(
  route: AskAppRoute,
  taskId: string,
  errorCategory: AskAppStatusErrorCategory,
  attempts: number,
  taskHandle?: string,
): AskAppTaskResult {
  return {
    app: route.app,
    routedVia: route.routedVia,
    taskId,
    ...(taskHandle ? { taskHandle } : {}),
    status: "unknown",
    statusRead: "unavailable",
    retryable: true,
    errorCategory,
    attempts,
    pollAfterMs: ASK_APP_POLL_INTERVAL_MS,
    poll: {
      tool: "ask_app_status",
      arguments: {
        app: route.app,
        taskId,
        ...(taskHandle ? { taskHandle } : {}),
      },
    },
    message:
      "The durable ask_app task status could not be read after bounded retries. " +
      "The task may still be running or completed. Retry ask_app_status " +
      (taskHandle
        ? "with the same taskHandle; do not resubmit ask_app."
        : "with the same app and taskId; do not resubmit ask_app."),
  };
}

async function resolveTargetAppOrigin(
  config: MCPConfig,
  targetAppId: string,
): Promise<{ origin: string; id: string } | null> {
  const target = targetAppId.trim().toLowerCase();
  if (!target || target === currentAppId(config)) return null;
  try {
    const { resolveWorkspace } = await import("./workspace-resolve.js");
    const ws = await resolveWorkspace();
    if (!ws.isWorkspace) return null;
    const match = ws.apps.find((a) => a.id.toLowerCase() === target);
    if (!match) return null;
    return { origin: match.url, id: match.id };
  } catch {
    return null;
  }
}

function listAppsTool(
  config: MCPConfig,
  requestMeta?: { origin?: string },
): ActionEntry {
  return {
    tool: tool(
      "List the workspace apps and their URLs. Use this to discover which " +
        "apps exist before opening or asking one. In a single-app project " +
        "this returns just that app. When an org directory is configured " +
        "this also includes the org's deployed sibling apps.",
    ),
    readOnly: true,
    parallelSafe: true,
    run: async () => {
      const { resolveWorkspace } = await import("./workspace-resolve.js");
      const ws = await resolveWorkspace();

      const liveOrigin = requestMeta?.origin?.replace(/\/+$/, "") || "";
      let livePort = 0;
      if (liveOrigin) {
        try {
          const u = new URL(liveOrigin);
          livePort = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
        } catch {
          livePort = 0;
        }
      }
      const selfId = currentAppId(config);
      const isSelf = (id: string) =>
        !!liveOrigin &&
        (!ws.isWorkspace || (!!selfId && id.toLowerCase() === selfId));

      interface AppEntry {
        id: string;
        url: string;
        port: number | undefined;
        running: boolean;
        source: "workspace" | "org-directory";
      }

      const resolvedApps = ws.isWorkspace
        ? ws.apps
        : ws.apps.map((app) => ({ ...app, id: selfId, name: config.name }));
      const apps: AppEntry[] = resolvedApps.map((a) =>
        isSelf(a.id)
          ? {
              id: a.id,
              url: liveOrigin,
              port: (livePort || a.port) as number | undefined,
              running: true,
              source: "workspace" as const,
            }
          : {
              id: a.id,
              url: a.url,
              port: a.port as number | undefined,
              running: a.running,
              source: "workspace" as const,
            },
      );
      const seenIds = new Set(apps.map((a) => a.id.toLowerCase()));
      const seenOrigins = new Set(apps.map((a) => a.url.replace(/\/+$/, "")));

      const orgApps = await fetchOrgApps({
        selfId: currentAppId(config),
      }).catch(() => [] as OrgApp[]);
      for (const oa of orgApps) {
        const idKey = oa.id.toLowerCase();
        const originKey = oa.url.replace(/\/+$/, "");
        if (seenIds.has(idKey) || seenOrigins.has(originKey)) continue;
        seenIds.add(idKey);
        seenOrigins.add(originKey);
        apps.push({
          id: oa.id,
          url: oa.url,
          port: undefined,
          running: true,
          source: "org-directory",
        });
      }

      return {
        workspace: ws.isWorkspace,
        gatewayUrl: ws.gatewayUrl,
        apps,
      };
    },
  };
}

function openAppTool(
  config: MCPConfig,
  requestMeta?: { origin?: string },
): ActionEntry {
  return {
    tool: tool(
      "Build a deep link that opens an app at a specific view/record or " +
        "focused route/component. No side " +
        "effects — returns a URL the user can click to land in the running UI. " +
        "Set embed:true when a UI-capable MCP host should render the live app " +
        "or focused route/component inline. Omit view and path to land on the " +
        "app's home page.",
      {
        app: { type: "string", description: "App id, e.g. 'mail'" },
        view: {
          type: "string",
          description:
            "Target view, e.g. 'inbox' (maps to navigate command). Optional — omit (along with path) to open the app's home page.",
        },
        path: {
          type: "string",
          description:
            "Optional app route to open directly, e.g. '/extensions/abc', '/adhoc/q2', or '/chart?panel=...'. Must be same-origin relative. Omit (along with view) to open the app's home page.",
        },
        params: {
          type: "object",
          description:
            "Optional record-focus / filter params, e.g. { threadId: 'abc' }",
        },
        embed: {
          type: "boolean",
          description:
            "Render the full app or focused route/component inline in MCP Apps when the host supports it.",
        },
        chrome: {
          type: "string",
          enum: ["full", "minimal"],
          description:
            "Embed chrome preference for compatible app routes. Defaults to full.",
        },
      },
      ["app"],
    ),
    readOnly: true,
    parallelSafe: true,
    run: async (args: Record<string, any>) => {
      const app = String(args.app ?? "").trim();
      const view = String(args.view ?? "").trim();
      const path = safeAppPath(args.path) || (view ? null : "/");
      if (!app) {
        throw new Error("open_app requires 'app'.");
      }
      let params: Record<string, string | number | boolean> | undefined;
      const raw = args.params;
      if (raw && typeof raw === "object") {
        params = raw as Record<string, string | number | boolean>;
      } else if (typeof raw === "string" && raw.trim()) {
        try {
          params = JSON.parse(raw);
        } catch {
          params = undefined;
        }
      }
      const embeddedParam = params?.embed;
      const chromeParam = params?.chrome;
      let embed = args.embed === true || args.embed === "true";
      if (
        args.embed == null &&
        (embeddedParam === true || embeddedParam === "true")
      ) {
        embed = true;
      } else if (
        args.embed == null &&
        (embeddedParam === false || embeddedParam === "false")
      ) {
        embed = false;
      }
      if (
        embeddedParam === true ||
        embeddedParam === false ||
        embeddedParam === "true" ||
        embeddedParam === "false"
      ) {
        delete params?.embed;
      }

      const chrome =
        typeof args.chrome === "string"
          ? args.chrome
          : chromeParam === "full" || chromeParam === "minimal"
            ? chromeParam
            : undefined;
      if (chromeParam === "full" || chromeParam === "minimal") {
        delete params?.chrome;
      }
      if (params && Object.keys(params).length === 0) params = undefined;

      const relUrl = path
        ? appendParamsToPath(path, params)
        : buildDeepLink({ app, view, params });
      const sameAppUrl = path ? withConfiguredBasePath(relUrl) : relUrl;

      const targetApp = await resolveTargetAppOrigin(config, app);
      const appUrl = targetApp
        ? `${targetApp.origin.replace(/\/+$/, "")}${relUrl}`
        : sameAppUrl;
      const url = appUrl;
      let embedStartUrl: string | undefined;
      let embedTargetPath: string | undefined;
      let embedExpiresAt: number | undefined;

      if (embed && !targetApp) {
        const { getRequestContext } =
          await import("../server/request-context.js");
        const ctx = getRequestContext();
        const ownerEmail = ctx?.userEmail?.trim();
        if (ownerEmail) {
          const { normalizeEmbedTargetPath, createEmbedSessionTicket } =
            await import("../server/embed-session.js");
          const { buildEmbedStartPath } =
            await import("../server/embed-route.js");
          const targetPath = normalizeEmbedTargetPath(
            withMcpChatBridgeParam(url),
            requestMeta?.origin,
          );
          if (targetPath) {
            const ticket = await createEmbedSessionTicket({
              ownerEmail,
              orgId: ctx?.orgId,
              targetPath,
              scope: chrome ?? null,
            });
            const startPath = buildEmbedStartPath(ticket.ticket);
            embedStartUrl = requestMeta?.origin
              ? new URL(startPath, requestMeta.origin).toString()
              : startPath;
            embedTargetPath = targetPath;
            embedExpiresAt = ticket.expiresAt;
          }
        }
      }

      return {
        app,
        ...(view ? { view } : {}),
        ...(path ? { path } : {}),
        url,
        ...(embedStartUrl ? { embedStartUrl } : {}),
        ...(embedTargetPath ? { embedTargetPath } : {}),
        ...(embedExpiresAt ? { embedExpiresAt } : {}),
        embed,
      };
    },
    link: ({ result }) => {
      if (!result || typeof result !== "object") return null;
      const r = result as {
        url?: string;
        app?: string;
        view?: string;
        embed?: boolean;
      };
      if (r.embed) return null;
      if (!r.url) return null;
      return {
        url: r.url,
        label: `Open ${r.app ?? "app"}`,
        view: r.view,
      };
    },
    mcpApp: {
      resource: embedApp({
        title: "Open app",
        description: "Render the requested app route inline.",
        iframeTitle: "Agent-Native app",
        openLabel: "Open app",
      }),
    },
  };
}

function createEmbedSessionTool(requestMeta?: {
  origin?: string;
}): ActionEntry {
  return {
    tool: {
      ...tool(
        "MCP Apps helper: create a one-time browser embed session for a same-origin app URL. Usually called by an MCP App iframe, not directly by the model.",
        {
          url: {
            type: "string",
            description:
              "Same-origin absolute URL or app-relative path to embed.",
          },
          path: {
            type: "string",
            description: "Same-origin app-relative path to embed.",
          },
          chrome: {
            type: "string",
            enum: ["full", "minimal"],
            description: "Embed chrome preference. Defaults to full.",
          },
        },
      ),
      _meta: { ui: { visibility: ["app"] } },
    } as ActionTool,
    readOnly: false,
    parallelSafe: true,
    run: async (args: Record<string, any>) => {
      const { getRequestContext } =
        await import("../server/request-context.js");
      const ctx = getRequestContext();
      const ownerEmail = ctx?.userEmail?.trim();
      if (!ownerEmail) {
        throw new Error(
          "create_embed_session requires an authenticated MCP caller.",
        );
      }

      const { normalizeEmbedTargetPath, createEmbedSessionTicket } =
        await import("../server/embed-session.js");
      const { buildEmbedStartPath } = await import("../server/embed-route.js");
      const rawTarget =
        typeof args.url === "string" && args.url.trim()
          ? args.url
          : typeof args.path === "string"
            ? args.path
            : "";
      const targetPath = normalizeEmbedTargetPath(
        rawTarget,
        requestMeta?.origin,
      );
      if (!targetPath) {
        throw new Error(
          "create_embed_session can only embed same-origin app-relative URLs.",
        );
      }

      const ticket = await createEmbedSessionTicket({
        ownerEmail,
        orgId: ctx?.orgId,
        targetPath,
        scope: typeof args.chrome === "string" ? args.chrome : null,
      });
      const startPath = buildEmbedStartPath(ticket.ticket);
      const startUrl = requestMeta?.origin
        ? new URL(startPath, requestMeta.origin).toString()
        : startPath;
      return {
        startUrl,
        targetPath,
        expiresAt: ticket.expiresAt,
      };
    },
  };
}

async function routeAskOverA2A(
  origin: string,
  id: string,
  message: string,
  options?: {
    durable?: boolean;
    issuerApp?: string;
    issuerAudience?: string;
    maxWaitMs?: number;
    requestOrigin?: string;
    approvedActions?: A2AApprovedAction[];
  },
): Promise<
  | {
      app: string;
      routedVia: "a2a";
      response: string;
      verification: "unverified";
    }
  | AskAppTaskResult
> {
  if (options?.durable) {
    if (!options.issuerApp || !options.issuerAudience) {
      throw new Error(
        "ask_app durable routing requires an issuer app id and audience.",
      );
    }
    return submitAskAppA2ATask(
      {
        app: id,
        origin: agentNativeA2AEndpoint(origin),
        routedVia: "a2a",
        requestOrigin: options.requestOrigin ?? origin,
      },
      options.issuerApp,
      options.issuerAudience,
      message,
      options.maxWaitMs ?? ASK_APP_DEFAULT_INLINE_WAIT_MS,
      options.approvedActions,
    );
  }
  const { callAgent } = await import("../a2a/client.js");
  const { resolveA2ACallerAuth } = await import("../a2a/caller-auth.js");
  const auth = await resolveA2ACallerAuth();
  const response = await callAgent(origin, message, {
    apiKey: auth.apiKey,
    userEmail: auth.userEmail,
    orgDomain: auth.orgDomain,
    orgSecret: auth.orgSecret,
    requestOrigin: options?.requestOrigin,
    approvedActions: options?.approvedActions,
    timeoutMs: 5 * 60_000,
  });
  return { app: id, routedVia: "a2a", response, verification: "unverified" };
}

async function resolveAskAppStatusRoute(
  config: MCPConfig,
  requestedApp: string,
  requestMeta?: AskAppRequestMeta,
): Promise<AskAppRoute> {
  const selfId = currentAppId(config);
  const normalized = requestedApp.trim().toLowerCase();
  const selfEndpointUrl = selfA2AEndpointUrl(requestMeta);

  if (!normalized || normalized === selfId) {
    if (!selfEndpointUrl) {
      throw new Error(
        "ask_app_status requires a running app origin for local tasks.",
      );
    }
    return {
      app: selfId,
      origin: selfEndpointUrl,
      routedVia: "local",
      requestOrigin: requestMeta?.origin,
    };
  }

  const targetApp = await resolveTargetAppOrigin(config, requestedApp);
  if (targetApp) {
    return {
      app: targetApp.id,
      origin: agentNativeA2AEndpoint(targetApp.origin),
      routedVia: "a2a",
      requestOrigin: targetApp.origin,
    };
  }

  const orgApps = await fetchOrgApps({ selfId }).catch(() => [] as OrgApp[]);
  const dirMatch = orgApps.find((a) => a.id === normalized);
  if (dirMatch) {
    return {
      app: dirMatch.id,
      origin: agentNativeA2AEndpoint(dirMatch.a2aUrl),
      routedVia: "a2a",
      requestOrigin: dirMatch.url,
    };
  }

  throw new Error(`No reachable ask_app task route for app "${requestedApp}".`);
}

function askAppTool(
  config: MCPConfig,
  requestMeta?: AskAppRequestMeta,
): ActionEntry {
  return {
    tool: tool(
      "Send a natural-language message to an app's AI agent and get its " +
        "response. A completed response is an agent claim, not proof of a " +
        "write; it includes verification:'unverified'. Prefer host page WebMCP or cataloged direct action tools for " +
        "known, bounded current-app work. Use this when direct tools are " +
        "unavailable or the task needs the app agent's interpretation, full " +
        "skills, instructions, tools, and context for investigation, diagnosis, " +
        "multi-step work, or changes. In a " +
        "single-app project the 'app' " +
        "param is optional (defaults to this app). When 'app' names a " +
        "different workspace app it is routed there over A2A; the result's " +
        "'routedVia' field reports whether it ran cross-app or locally. " +
        "On hosted MCP, long tasks may return a durable taskHandle instead of " +
        "a final response; pass that handle to ask_app_status until completed.",
      {
        app: {
          type: "string",
          description: "App id to route to (optional in a single-app project)",
        },
        message: {
          type: "string",
          description: "The message to send to the app's agent",
        },
        async: {
          type: "boolean",
          description:
            "When true, start a durable task and return immediately with a taskHandle and legacy taskId.",
        },
        maxWaitMs: {
          type: "number",
          description:
            "Maximum time to wait inline before returning a taskHandle. Hosted MCP clamps this to 20000ms.",
        },
        approvedActions: {
          type: "array",
          description:
            "Exact downstream tool calls the user explicitly authorized in this chat. Never infer authorization or include a different action.",
          items: {
            type: "object",
            properties: {
              tool: { type: "string" },
              input: { type: "object", additionalProperties: true },
            },
            required: ["tool", "input"],
          },
        } as any,
      },
      ["message"],
    ),
    run: async (args: Record<string, any>) => {
      const message = String(args.message ?? "").trim();
      if (!message) throw new Error("ask_app requires a 'message'.");
      const requestedApp = String(args.app ?? "").trim();
      const selfId = currentAppId(config);
      const useDurableA2A = Boolean(requestMeta?.origin);
      const issuerAudience = askAppIssuerAudience(requestMeta);
      if (useDurableA2A && !issuerAudience) {
        throw new Error(
          "ask_app durable routing requires a valid HTTP(S) issuer audience.",
        );
      }
      const maxWaitMs = isExplicitAsyncAsk(args.async)
        ? 0
        : boundedAskAppWaitMs(args.maxWaitMs);
      const approvedActions = Array.isArray(args.approvedActions)
        ? (args.approvedActions as A2AApprovedAction[])
        : undefined;

      const targetApp = await resolveTargetAppOrigin(config, requestedApp);
      if (targetApp) {
        try {
          return await routeAskOverA2A(
            targetApp.origin,
            targetApp.id,
            message,
            {
              durable: useDurableA2A,
              issuerApp: selfId,
              issuerAudience: issuerAudience ?? undefined,
              maxWaitMs,
              requestOrigin: targetApp.origin,
              approvedActions,
            },
          );
        } catch (err: any) {
          throw new Error(
            `Failed to route ask_app to "${targetApp.id}" via A2A: ` +
              `${err?.message ?? err}`,
          );
        }
      }

      if (requestedApp && requestedApp.toLowerCase() !== selfId) {
        const orgApps = await fetchOrgApps({ selfId }).catch(
          () => [] as OrgApp[],
        );
        const dirMatch = orgApps.find(
          (a) => a.id === requestedApp.toLowerCase(),
        );
        if (dirMatch) {
          try {
            return await routeAskOverA2A(
              dirMatch.a2aUrl,
              dirMatch.id,
              message,
              {
                durable: useDurableA2A,
                issuerApp: selfId,
                issuerAudience: issuerAudience ?? undefined,
                maxWaitMs,
                requestOrigin: dirMatch.url,
                approvedActions,
              },
            );
          } catch (err: any) {
            throw new Error(
              `Failed to route ask_app to "${dirMatch.id}" via A2A ` +
                `(org directory): ${err?.message ?? err}`,
            );
          }
        }
      }

      if (requestedApp && requestedApp.toLowerCase() !== selfId) {
        throw new Error(
          `No reachable ask_app route for app "${requestedApp}". ` +
            "Call list_apps and retry with an available app id.",
        );
      }

      if (!config.askAgent) {
        throw new Error(
          "This app does not expose an agent (no ask-agent handler).",
        );
      }

      const localA2AEndpointUrl = selfA2AEndpointUrl(requestMeta);
      if (localA2AEndpointUrl) {
        return submitAskAppA2ATask(
          {
            app: selfId,
            origin: localA2AEndpointUrl,
            routedVia: "local",
            requestOrigin: requestMeta?.origin,
          },
          selfId,
          issuerAudience ?? "",
          message,
          maxWaitMs,
          approvedActions,
        );
      }

      const { startAskAppInlineTask } =
        await import("./ask-app-inline-tasks.js");
      const inline = await startAskAppInlineTask(
        config.askAgent,
        message,
        maxWaitMs,
      );
      if (inline.status === "completed") {
        return {
          app: selfId,
          routedVia: "local",
          response: inline.response || "(no response)",
          verification: "unverified",
        };
      }
      if (inline.status === "failed") {
        throw new Error(inline.error || "ask_app task failed.");
      }
      return askAppInlineTaskResult(selfId, inline.taskId, inline);
    },
  };
}

function askAppStatusTool(
  config: MCPConfig,
  requestMeta?: AskAppRequestMeta,
): ActionEntry {
  return {
    tool: tool(
      "Poll a durable ask_app task and return its current status or final response. " +
        "If a transient status read stays unavailable after bounded retries, the " +
        "result preserves the app and taskId with statusRead 'unavailable' and a " +
        "poll instruction. Retry ask_app_status for that same task; never resubmit " +
        "ask_app as status-read recovery because that can duplicate work.",
      {
        app: {
          type: "string",
          description:
            "App id returned by ask_app. Optional for same-app local tasks.",
        },
        taskId: {
          type: "string",
          description:
            "Legacy durable task id returned by ask_app. Use taskHandle when present.",
        },
        taskHandle: {
          type: "string",
          description:
            "Opaque task handle returned by ask_app. It preserves the original route across cold starts and discovery changes.",
        },
      },
    ),
    readOnly: true,
    parallelSafe: true,
    run: async (args: Record<string, any>) => {
      const suppliedTaskId = String(args.taskId ?? "").trim();
      const taskHandle = String(args.taskHandle ?? "").trim();
      if (!taskHandle && !suppliedTaskId) {
        throw new Error("ask_app_status requires 'taskHandle' or 'taskId'.");
      }

      if (taskHandle) {
        const verified = await verifyAskAppTaskHandle(taskHandle, {
          issuerApp: currentAppId(config),
          issuerAudience: askAppIssuerAudience(requestMeta) ?? "",
          organization: getRequestOrgId() ?? "",
          subject: getRequestUserEmail() ?? "anonymous",
        });
        const suppliedApp = String(args.app ?? "")
          .trim()
          .toLowerCase();
        if (
          (suppliedTaskId && suppliedTaskId !== verified.taskId) ||
          (suppliedApp && suppliedApp !== verified.route.app.toLowerCase())
        ) {
          throw new Error("Invalid or expired ask_app task handle.");
        }
        return fetchAskAppA2ATask(verified.route, verified.taskId, taskHandle);
      }

      const taskId = suppliedTaskId;

      const { getAskAppInlineTask } = await import("./ask-app-inline-tasks.js");
      const inline = getAskAppInlineTask(taskId);
      if (inline) {
        return askAppInlineTaskResult(currentAppId(config), taskId, inline);
      }

      const requestedApp = String(args.app ?? "").trim();
      const route = await resolveAskAppStatusRoute(
        config,
        requestedApp,
        requestMeta,
      );
      return fetchAskAppA2ATask(route, taskId);
    },
  };
}

function listTemplatesTool(): ActionEntry {
  return {
    tool: tool(
      "List the first-party templates that can be scaffolded into a workspace " +
        "(allow-listed templates only).",
    ),
    readOnly: true,
    parallelSafe: true,
    run: async () => {
      const { visibleTemplates } = await import("../cli/templates-meta.js");
      return {
        templates: visibleTemplates().map((t) => ({
          name: t.name,
          label: t.label,
          hint: t.hint,
        })),
      };
    },
  };
}

function createWorkspaceAppTool(): ActionEntry {
  return {
    tool: tool(
      "Scaffold a new app into the current workspace from an allow-listed " +
        "template, then return a deep link to open it. Idempotent: if an app " +
        "with that name already exists it is reused.",
      {
        name: {
          type: "string",
          description: "New app id (directory under apps/), e.g. 'mymail'",
        },
        template: {
          type: "string",
          description:
            "Template to scaffold from — must be allow-listed (see list_templates)",
        },
      },
      ["name", "template"],
    ),
    run: async (args: Record<string, any>) => {
      const name = String(args.name ?? "").trim();
      const template = String(args.template ?? "").trim();
      if (!name || !template) {
        throw new Error(
          "create_workspace_app requires both 'name' and 'template'.",
        );
      }

      const { visibleTemplates } = await import("../cli/templates-meta.js");
      const allowed = new Set(visibleTemplates().map((t) => t.name));
      if (!allowed.has(template)) {
        throw new Error(
          `Template "${template}" is not allow-listed. Allowed: ${[...allowed]
            .sort()
            .join(", ")}`,
        );
      }

      const { findWorkspaceRoot, resolveWorkspace } =
        await import("./workspace-resolve.js");
      const fs = await import("node:fs");
      const path = await import("node:path");

      const root = findWorkspaceRoot(process.cwd());
      if (!root) {
        throw new Error(
          "Not inside a workspace. create_workspace_app only works in a " +
            "multi-app workspace (run from the workspace root).",
        );
      }

      const appDir = path.join(root, "apps", name);
      const alreadyExisted = fs.existsSync(appDir);

      if (!alreadyExisted) {
        const prevCwd = process.cwd();
        try {
          process.chdir(root);
          const { addAppToWorkspace } = await import("../cli/create.js");
          await addAppToWorkspace(name, { template, noInstall: true });
        } finally {
          try {
            process.chdir(prevCwd);
          } catch {
            // best-effort cwd restore
          }
        }
      }

      const ws = await resolveWorkspace(root);
      const appInfo = ws.apps.find((a) => a.id === name);
      const port = appInfo?.port;
      const relDeepLink = buildDeepLink({ app: name, view: "home" });
      const deepLink = appInfo?.url
        ? `${appInfo.url.replace(/\/+$/, "")}${relDeepLink}`
        : relDeepLink;

      return {
        name,
        template,
        created: !alreadyExisted,
        reused: alreadyExisted,
        port,
        url: appInfo?.url,
        gatewayUrl: ws.gatewayUrl,
        deepLink,
      };
    },
    link: ({ result }) => {
      if (!result || typeof result !== "object") return null;
      const r = result as { deepLink?: string; name?: string };
      if (!r.deepLink) return null;
      return {
        url: r.deepLink,
        label: `Open ${r.name ?? "app"}`,
        view: "home",
      };
    },
  };
}

export function getBuiltinCrossAppTools(
  config: MCPConfig,
  requestMeta?: AskAppRequestMeta,
): Record<string, ActionEntry> {
  return {
    list_apps: listAppsTool(config, requestMeta),
    open_app: openAppTool(config, requestMeta),
    create_embed_session: createEmbedSessionTool(requestMeta),
    ask_app: askAppTool(config, requestMeta),
    ask_app_status: askAppStatusTool(config, requestMeta),
    create_workspace_app: createWorkspaceAppTool(),
    list_templates: listTemplatesTool(),
  };
}
