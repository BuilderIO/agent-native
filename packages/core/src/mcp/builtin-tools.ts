/**
 * Generic cross-app MCP tools — a stable verb set every external agent gets
 * regardless of which template it is talking to.
 *
 * These are merged into the MCP action registry by
 * `createMCPServerForRequest` (see `build-server.ts`). **Precedence: template
 * actions win.** If a template defines an action named `list_apps` /
 * `open_app` / `ask_app` / `create_workspace_app` / `list_templates`, the
 * template's `ActionEntry` overwrites the builtin of the same name. This is
 * the same template-over-framework precedence `autoDiscoverActions` uses.
 *
 * | Tool                  | Side effects | Returns                                  |
 * | --------------------- | ------------ | ---------------------------------------- |
 * | `list_apps`           | none         | `{ apps: [{ id, url, running }] }`       |
 * | `open_app`            | none         | `{ url }` (+ deep-link `link`)           |
 * | `create_embed_session`| ticket mint  | `{ startUrl }` for MCP App iframes       |
 * | `ask_app`             | agent loop   | `{ app, routedVia, response }` or task   |
 * | `ask_app_status`      | none         | poll a durable `ask_app` task            |
 * | `create_workspace_app`| scaffolds    | `{ name, url, port, deepLink }` (+ link) |
 *
 * `open_app` / `create_workspace_app` return an **absolute** URL on the
 * *target* app's origin when it differs from this app (so a workspace link
 * lands in the right app), and a relative path for the same app / standalone.
 * `ask_app` routes to a *different* workspace app over A2A when possible and
 * reports `routedVia: "a2a"`; otherwise it answers locally
 * (`routedVia: "local"`) and never falsely claims cross-app delegation.
 * | `list_templates`      | none         | `{ templates: [...] }` (allow-list only) |
 *
 * Node-only at call time (workspace resolution + scaffolding use `fs`), but
 * the module has no top-level Node imports so it bundles fine alongside
 * `mountMCP` — the Node bits are dynamically imported inside `run()`.
 */

import type { Task } from "../a2a/types.js";
import type { ActionEntry } from "../agent/production-agent.js";
import type { ActionTool } from "../agent/types.js";
import { getConfiguredAppBasePath } from "../server/app-base-path.js";
import { buildDeepLink } from "../server/deep-link.js";
import { MCP_APP_CHAT_BRIDGE_QUERY_PARAM } from "../shared/embed-auth.js";
import type { MCPConfig } from "./build-server.js";
import { embedApp } from "./embed-app.js";
import { fetchOrgApps, type OrgApp } from "./org-directory.js";

/** Flat map of param name → JSON-schema property. */
type Params = Record<
  string,
  { type: string; description?: string; enum?: string[] }
>;

/**
 * Build an `ActionTool`. `parameters` is wrapped in the
 * `{ type:"object", properties, required }` shape `createMCPServerForRequest`
 * forwards verbatim as the MCP tool `inputSchema`.
 */
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

/**
 * The canonical app id this MCP server is mounted for. `MCPConfig.appId` is
 * authoritative; fall back to lowercasing `name` (which is the capitalized
 * app id at every call site) for back-compat with configs that predate the
 * `appId` field.
 */
function currentAppId(config: MCPConfig): string {
  return (config.appId || config.name || "app").toLowerCase();
}

const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]");
const ASK_APP_DEFAULT_INLINE_WAIT_MS = 20_000;
const ASK_APP_MAX_INLINE_WAIT_MS = 25_000;
const ASK_APP_POLL_INTERVAL_MS = 1_500;
const ASK_APP_A2A_REQUEST_TIMEOUT_MS = 10_000;
const ASK_APP_TERMINAL_STATES = new Set<string>([
  "completed",
  "failed",
  "canceled",
]);

type AskAppRequestMeta = { origin?: string; basePath?: string };

interface AskAppRoute {
  app: string;
  origin: string;
  routedVia: "local" | "a2a";
  note?: string;
}

interface AskAppTaskResult {
  app: string;
  routedVia: "local" | "a2a";
  taskId: string;
  status: string;
  response?: string;
  error?: string;
  note?: string;
  poll?: {
    tool: "ask_app_status";
    arguments: { app: string; taskId: string };
  };
  message?: string;
}

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

function viewToAppPath(view: string): string | null {
  const value = view.trim();
  if (!value) return null;
  return safeAppPath(value.startsWith("/") ? value : `/${value}`);
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
    // Fall through and append the conventional Agent Native endpoint.
  }
  return `${value}/_agent-native/a2a`;
}

function selfA2AEndpointUrl(requestMeta?: AskAppRequestMeta): string | null {
  const origin = requestMeta?.origin?.replace(/\/+$/, "");
  if (!origin) return null;
  const basePath = requestMeta?.basePath || getConfiguredAppBasePath();
  return agentNativeA2AEndpoint(`${origin}${basePath}`);
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

function askAppTaskResult(route: AskAppRoute, task: Task): AskAppTaskResult {
  const status = taskState(task);
  const response = taskText(task);
  const base = {
    app: route.app,
    routedVia: route.routedVia,
    taskId: task.id,
    status,
    ...(route.note ? { note: route.note } : {}),
  };

  if (status === "completed") {
    return {
      ...base,
      response: response || "(no response)",
    };
  }

  if (status === "failed" || status === "canceled") {
    return {
      ...base,
      ...(response ? { response } : {}),
      error: response || `ask_app task ${status}.`,
    };
  }

  return {
    ...base,
    poll: {
      tool: "ask_app_status",
      arguments: { app: route.app, taskId: task.id },
    },
    message:
      `ask_app is still ${status}. Call ask_app_status with ` +
      `taskId "${task.id}" to retrieve the final response.`,
  };
}

async function createA2AClientForAskApp(origin: string): Promise<{
  client: import("../a2a/client.js").A2AClient;
  metadata: Record<string, unknown>;
}> {
  const { A2AClient } = await import("../a2a/client.js");
  const { resolveA2ACallerAuth } = await import("../a2a/caller-auth.js");
  const auth = await resolveA2ACallerAuth();
  const metadata: Record<string, unknown> = {};
  if (auth.userEmail) metadata.userEmail = auth.userEmail;
  if (auth.orgDomain) metadata.orgDomain = auth.orgDomain;
  return {
    client: new A2AClient(origin, auth.apiKey, {
      requestTimeoutMs: ASK_APP_A2A_REQUEST_TIMEOUT_MS,
      ...(auth.apiKeyFallbacks
        ? { fallbackApiKeys: auth.apiKeyFallbacks }
        : {}),
    }),
    metadata,
  };
}

async function waitForA2ATask(
  client: import("../a2a/client.js").A2AClient,
  initialTask: Task,
  maxWaitMs: number,
): Promise<Task> {
  if (maxWaitMs <= 0 || isTerminalTask(initialTask)) return initialTask;
  const deadline = Date.now() + maxWaitMs;
  let current = initialTask;

  while (!isTerminalTask(current)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return current;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(ASK_APP_POLL_INTERVAL_MS, remaining)),
    );
    try {
      current = await client.getTask(initialTask.id);
    } catch {
      // Transient status fetch failures should not turn a successfully
      // submitted durable task into a failed MCP call.
      if (Date.now() >= deadline) return current;
      continue;
    }
  }

  return current;
}

async function submitAskAppA2ATask(
  route: AskAppRoute,
  message: string,
  maxWaitMs: number,
): Promise<AskAppTaskResult> {
  const { client, metadata } = await createA2AClientForAskApp(route.origin);
  const task = await client.send(
    {
      role: "user",
      parts: [{ type: "text", text: message }],
    },
    {
      async: true,
      metadata,
    },
  );
  const finalOrRunning = await waitForA2ATask(client, task, maxWaitMs);
  return askAppTaskResult(route, finalOrRunning);
}

async function fetchAskAppA2ATask(
  route: AskAppRoute,
  taskId: string,
): Promise<AskAppTaskResult> {
  const { client } = await createA2AClientForAskApp(route.origin);
  const task = await client.getTask(taskId);
  return askAppTaskResult(route, task);
}

/**
 * Resolve the absolute origin of a *target* workspace app (e.g.
 * `http://127.0.0.1:8101`) so cross-app deep links / A2A calls point at the
 * right app instead of the current request's origin. Reuses the same
 * workspace resolution `list_apps` / the stdio proxy use.
 *
 * Returns `null` when:
 *   - the target is the current app (caller should keep relative behavior),
 *   - there is no workspace info (standalone / single app), or
 *   - the target app is unknown.
 */
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

// ---------------------------------------------------------------------------
// list_apps
// ---------------------------------------------------------------------------

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

      // The MCP request is served BY the current app, so it is provably
      // reachable at the inbound request origin — that beats a guessed
      // `PORT || 5173` probe (which reports the wrong URL + `running:false`
      // whenever the dev server picked a non-default port, e.g. `agent-
      // native dev` on :8080). For the entry that IS this app (the sole
      // entry when single-app, or the id matching `config.appId` in a
      // workspace) prefer the live origin; other workspace apps keep their
      // probed values.
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
      const selfId = (config.appId ?? "").toLowerCase();
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

      const apps: AppEntry[] = ws.apps.map((a) =>
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

      // Merge the org directory's deployed sibling apps. Inactive (no env)
      // or any failure ⇒ fetchOrgApps() returns [] and this is a no-op, so
      // the existing local/workspace behavior is preserved exactly.
      const orgApps = await fetchOrgApps({
        selfId: currentAppId(config),
      }).catch(() => [] as OrgApp[]);
      for (const oa of orgApps) {
        const idKey = oa.id.toLowerCase();
        const originKey = oa.url.replace(/\/+$/, "");
        // Dedupe by id OR origin — a workspace app already listed wins.
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

// ---------------------------------------------------------------------------
// open_app
// ---------------------------------------------------------------------------

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
      // `safeAppPath` rejects anything that isn't a leading-slash same-origin
      // path. When the caller passes nothing, fall back to the app's root so a
      // bare `open_app({app:"dispatch"})` lands on the home page instead of
      // throwing. The model self-corrects on the retry today, but the extra
      // round-trip wastes a turn and looks broken to the user.
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

      const directViewPath = embed && view ? viewToAppPath(view) : null;
      const relUrl = path
        ? appendParamsToPath(path, params)
        : directViewPath
          ? appendParamsToPath(directViewPath, params)
          : buildDeepLink({ app, view, params });
      const sameAppUrl =
        path || directViewPath ? withConfiguredBasePath(relUrl) : relUrl;

      // Cross-app target in a workspace: resolve the TARGET app's origin and
      // return an absolute URL. Otherwise the MCP layer would prefix the
      // relative path with the CURRENT request origin, landing the user in
      // the wrong app (e.g. open_app({app:"calendar"}) served from Mail).
      // Same-app / standalone keeps the relative path (current behavior).
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
        iframeTitle: "Agent Native app",
        openLabel: "Open app",
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// create_embed_session
// ---------------------------------------------------------------------------

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
    // App-only bootstrap helper: the ticket becomes a normal browser session,
    // so keep it write-scoped until embed sessions can enforce MCP scopes.
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

/**
 * Route an `ask_app` message to a *different* app's agent over A2A. Shared by
 * the workspace-resolved path and the org-directory-resolved path so the A2A
 * call logic is not duplicated. `origin` is the target app's A2A base
 * (workspace dev origin or the directory's `a2aUrl`); `id` is reported back.
 *
 * Throws on failure so the caller can be honest — it never falls back to this
 * app's agent and pretends it was the target.
 */
async function routeAskOverA2A(
  origin: string,
  id: string,
  message: string,
  options?: { durable?: boolean; maxWaitMs?: number },
): Promise<
  { app: string; routedVia: "a2a"; response: string } | AskAppTaskResult
> {
  if (options?.durable) {
    return submitAskAppA2ATask(
      { app: id, origin: agentNativeA2AEndpoint(origin), routedVia: "a2a" },
      message,
      options.maxWaitMs ?? ASK_APP_DEFAULT_INLINE_WAIT_MS,
    );
  }
  const { callAgent } = await import("../a2a/client.js");
  const { resolveA2ACallerAuth } = await import("../a2a/caller-auth.js");
  // The MCP handler runs inside `runWithRequestContext`, so this is the
  // verified caller identity and org scope. Reuse the same auth resolver as
  // org-directory discovery so the directory lookup and actual A2A call are
  // scoped the same way.
  const auth = await resolveA2ACallerAuth();
  const response = await callAgent(origin, message, {
    apiKey: auth.apiKey,
    userEmail: auth.userEmail,
    orgDomain: auth.orgDomain,
    orgSecret: auth.orgSecret,
    // Bound the wait — cross-app A2A polls async by default.
    timeoutMs: 5 * 60_000,
  });
  return { app: id, routedVia: "a2a", response };
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
    return { app: selfId, origin: selfEndpointUrl, routedVia: "local" };
  }

  const targetApp = await resolveTargetAppOrigin(config, requestedApp);
  if (targetApp) {
    return {
      app: targetApp.id,
      origin: agentNativeA2AEndpoint(targetApp.origin),
      routedVia: "a2a",
    };
  }

  const orgApps = await fetchOrgApps({ selfId }).catch(() => [] as OrgApp[]);
  const dirMatch = orgApps.find((a) => a.id === normalized);
  if (dirMatch) {
    return {
      app: dirMatch.id,
      origin: agentNativeA2AEndpoint(dirMatch.a2aUrl),
      routedVia: "a2a",
    };
  }

  throw new Error(`No reachable ask_app task route for app "${requestedApp}".`);
}

// ---------------------------------------------------------------------------
// ask_app
// ---------------------------------------------------------------------------

function askAppTool(
  config: MCPConfig,
  requestMeta?: AskAppRequestMeta,
): ActionEntry {
  return {
    tool: tool(
      "Send a natural-language message to an app's AI agent and get its " +
        "response. Use for complex, multi-step tasks needing the agent's " +
        "reasoning and full app context. In a single-app project the 'app' " +
        "param is optional (defaults to this app). When 'app' names a " +
        "different workspace app it is routed there over A2A; the result's " +
        "'routedVia' field reports whether it ran cross-app or locally. " +
        "On hosted MCP, long tasks may return a durable taskId instead of a " +
        "final response; call ask_app_status with that taskId until completed.",
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
            "When true, start a durable task and return immediately with a taskId.",
        },
        maxWaitMs: {
          type: "number",
          description:
            "Maximum time to wait inline before returning a taskId. Hosted MCP clamps this to 25000ms.",
        },
      },
      ["message"],
    ),
    run: async (args: Record<string, any>) => {
      const message = String(args.message ?? "").trim();
      if (!message) throw new Error("ask_app requires a 'message'.");
      const requestedApp = String(args.app ?? "").trim();
      const selfId = currentAppId(config);
      const useDurableA2A = Boolean(requestMeta?.origin);
      const maxWaitMs = isExplicitAsyncAsk(args.async)
        ? 0
        : boundedAskAppWaitMs(args.maxWaitMs);

      // Cross-app: the caller named a *different* workspace app. Route the
      // message to THAT app's agent over A2A (its `/_agent-native/a2a`
      // endpoint runs the real agent loop with JWT identity) rather than
      // silently answering from this app's agent and claiming delegation.
      const targetApp = await resolveTargetAppOrigin(config, requestedApp);
      if (targetApp) {
        try {
          return await routeAskOverA2A(
            targetApp.origin,
            targetApp.id,
            message,
            {
              durable: useDurableA2A,
              maxWaitMs,
            },
          );
        } catch (err: any) {
          // Be honest: routing was attempted and failed — do NOT fall back to
          // this app's agent and pretend it was the target.
          throw new Error(
            `Failed to route ask_app to "${targetApp.id}" via A2A: ` +
              `${err?.message ?? err}`,
          );
        }
      }

      // Not a known local/workspace app — try the org directory. When a
      // directory is configured and the requested app is one of the org's
      // deployed sibling apps, route to it over A2A (same path as above,
      // against its `a2aUrl`). Inactive directory / any failure ⇒ orgApps is
      // [] and this is skipped, preserving the exact local-only behavior.
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
                maxWaitMs,
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

      // Same app (or no workspace / unknown target): answer locally with this
      // app's own ask-agent handler — the same entry point the HTTP MCP mount
      // + A2A use, so there is no second agent runner.
      if (!config.askAgent) {
        throw new Error(
          "This app does not expose an agent (no ask-agent handler).",
        );
      }

      // If the caller named an app we couldn't route to (unknown id, or no
      // workspace), say so honestly instead of claiming we reached it.
      const unresolved =
        !!requestedApp && requestedApp.toLowerCase() !== selfId;
      const note = unresolved
        ? `Requested app "${requestedApp}" is not a reachable workspace ` +
          `app; answered with this app ("${selfId}") instead.`
        : undefined;

      // Hosted MCP cannot safely keep a JSON request/response open for a full
      // agent loop: serverless gateways can return an inactivity 504 before
      // the result body exists. When we know the running app origin, submit the
      // local ask through the app's durable A2A task path and only wait a
      // short bounded window for fast completions.
      const localA2AEndpointUrl = selfA2AEndpointUrl(requestMeta);
      if (localA2AEndpointUrl) {
        return submitAskAppA2ATask(
          {
            app: selfId,
            origin: localA2AEndpointUrl,
            routedVia: "local",
            ...(note ? { note } : {}),
          },
          message,
          maxWaitMs,
        );
      }

      const response = await config.askAgent(message);
      return {
        app: selfId,
        routedVia: "local",
        ...(note ? { note } : {}),
        response,
      };
    },
  };
}

function askAppStatusTool(
  config: MCPConfig,
  requestMeta?: AskAppRequestMeta,
): ActionEntry {
  return {
    tool: tool(
      "Poll a durable ask_app task and return its current status or final response.",
      {
        app: {
          type: "string",
          description:
            "App id returned by ask_app. Optional for same-app local tasks.",
        },
        taskId: {
          type: "string",
          description: "The durable task id returned by ask_app.",
        },
      },
      ["taskId"],
    ),
    readOnly: true,
    parallelSafe: true,
    run: async (args: Record<string, any>) => {
      const taskId = String(args.taskId ?? "").trim();
      if (!taskId) throw new Error("ask_app_status requires 'taskId'.");
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

// ---------------------------------------------------------------------------
// list_templates
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// create_workspace_app
// ---------------------------------------------------------------------------

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

      // Enforce the strict public template allow-list. The authoritative,
      // dependency-free source inside @agent-native/core is cli/templates-meta
      // (kept in sync with packages/shared-app-config/templates.ts; CI guard).
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
        // Reuse the CLI scaffolder directly (no second `agent-native`
        // subprocess). `addAppToWorkspace(name, { template })` takes the
        // non-interactive single-template path when name + one template are
        // given. Run it from the workspace root so detectWorkspace resolves.
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

      // The workspace gateway auto-detects new apps/* dirs (fs.watch +
      // 2s sync) and lazily boots the dev server on first request, so we
      // don't spawn vite ourselves — opening the deep link warms it. Resolve
      // the port the gateway will use so we can report it.
      const ws = await resolveWorkspace(root);
      const appInfo = ws.apps.find((a) => a.id === name);
      const port = appInfo?.port;
      // The scaffolded app is always a *different* app from the host MCP
      // server, so anchor the deep link to the new app's own origin. A
      // relative path would otherwise be prefixed with the current request
      // origin and land on the wrong app. Fall back to the relative path
      // only if the gateway hasn't reported the new app's URL yet.
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

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Build the generic cross-app builtin tool registry. Called by
 * `createMCPServerForRequest`; the result is merged UNDER the config's
 * actions so template actions of the same name win.
 */
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
