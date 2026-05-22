/**
 * Shared MCP server builder.
 *
 * Extracted from `server.ts` so the stateless Streamable-HTTP mount
 * (`mountMCP`) and the stdio transport (`runMCPStdio --standalone`) build the
 * *same* MCP server from the *same* `ActionEntry` registry. Both surfaces:
 *
 *   - expose every action as an MCP tool (+ the `ask-agent` meta-tool),
 *   - append the framework deep-link block / `_meta` to every tool result,
 *   - wrap `run()` / `askAgent()` in `runWithRequestContext` so per-user /
 *     per-org scoping (accessFilter, resolveCredential, MCP visibility) is
 *     honoured.
 *
 * `server.ts` re-exports `createMCPServerForRequest` and the auth helpers so
 * any (future) external importer of `@agent-native/core/mcp` keeps resolving.
 *
 * Node-only at the SDK level, but this module itself has no Node-only imports
 * — it can be bundled into the serverless function alongside `mountMCP`.
 */

import type { ActionEntry } from "../agent/production-agent.js";
import { isMcpActionResult } from "../mcp-client/app-result.js";
import {
  MCP_APP_EXTENSION_ID,
  MCP_APP_MIME_TYPE,
  MCP_APP_RESOURCE_URI_META_KEY,
  type ActionMcpAppCsp,
  type ActionMcpAppResourceConfig,
} from "../action.js";
import { MCP_APP_REQUEST_ORIGIN_CSP_SOURCE } from "./embed-app.js";
import { runWithRequestContext } from "../server/request-context.js";
import { toAbsoluteOpenUrl, toDesktopOpenUrl } from "../server/deep-link.js";
import {
  isAgentNativeOpenDeepLink,
  withCollapsedAgentSidebarParam,
} from "../shared/agent-sidebar-url.js";
import { MCP_APP_CHAT_BRIDGE_QUERY_PARAM } from "../shared/embed-auth.js";
import { getBuiltinCrossAppTools } from "./builtin-tools.js";
import { MCP_CONNECT_SCOPE } from "./connect-store.js";
import {
  MCP_OAUTH_SCOPES,
  hasMcpOAuthScope,
  verifyMcpOAuthAccessToken,
} from "./oauth-token.js";

export interface MCPConfig {
  /** App name shown in MCP server info */
  name: string;
  /**
   * Canonical app id (directory under `apps/`, e.g. `mail`) this MCP server
   * is mounted for. Optional & back-compat: when omitted the builtin
   * cross-app tools fall back to lowercasing `name`. Used by `open_app` /
   * `ask_app` / `create_workspace_app` to tell "this app" from a cross-app
   * target so they resolve the *target* app's origin rather than echoing the
   * current request origin.
   */
  appId?: string;
  /** App description */
  description: string;
  /** Version string (default "1.0.0") */
  version?: string;
  /** Action registry — same as agent chat and A2A */
  actions: Record<string, ActionEntry>;
  /**
   * Full ("production") action surface served to an **authenticated real
   * caller** — a connect-minted token, an `agent-native mcp install` stdio
   * proxy (owner-email header / `AGENT_NATIVE_OWNER_EMAIL`), or a deployed /
   * `AGENT_MODE=production` app. In local dev `actions` is intentionally the
   * sparse, dev-toggled surface (builtins + read-only public-agent actions)
   * so the local agent chat and unauthenticated dev probes don't see every
   * mutating tool; but per the external-agents contract a real caller that
   * connected with a token MUST get the full surface even in dev. When unset
   * (production, where `actions` already IS the full set) the swap is a
   * no-op. See `external-agents` skill, "Dev vs production tool surface".
   */
  productionActions?: Record<string, ActionEntry>;
  /** Handler for the ask-agent meta-tool — runs the full agent loop */
  askAgent?: (message: string) => Promise<string>;
  /**
   * Disable the generic cross-app builtin tools (`list_apps`, `open_app`,
   * `ask_app`, `create_workspace_app`, `list_templates`). They are merged in
   * by default so external agents get a stable verb set; a template action of
   * the same name always wins (template precedence). Set to `false` only for
   * a constrained / locked-down mount.
   */
  builtinCrossAppTools?: boolean;
}

/**
 * Identity extracted from a verified MCP bearer token / JWT. Used to wrap
 * `entry.run()` and `config.askAgent()` calls in `runWithRequestContext`
 * so downstream tools (db-query, accessFilter, resolveCredential) honour
 * per-user / per-org scoping. Without this wrap the MCP endpoint would
 * silently bypass tenant isolation. See finding #6 in
 * /tmp/security-audit/12-mcp-a2a-agent.md.
 */
export interface MCPCallerIdentity {
  userEmail: string | undefined;
  orgDomain: string | undefined;
  /** Present only for standard remote MCP OAuth access tokens. */
  oauthScopes?: string[];
  /** Present only for standard remote MCP OAuth access tokens. */
  oauthClientId?: string;
}

/** Per-request context used to turn an action's relative deep link into the
 *  absolute web URL (and desktop `agentnative://` URL) the external agent
 *  surfaces. Derived from the inbound request headers in `mountMCP`, or from
 *  the resolved local app origin in the stdio standalone path. */
export interface MCPRequestMeta {
  /** Origin of the running app, e.g. `http://localhost:8100`. */
  origin?: string;
  /** Optional client preference for which URL the *markdown* link uses. */
  target?: "browser" | "desktop" | "terminal";
  /**
   * The caller authenticated with a real credential (verified A2A/connect
   * JWT, matching ACCESS_TOKEN, or a forwarded owner-email header from
   * `agent-native mcp install`) — not the unauthenticated local dev-open
   * path. When true, `createMCPServerForRequest` serves
   * `config.productionActions` (the full surface) instead of the sparse dev
   * `config.actions`. Set by `mountMCP` from `verifyAuth`.
   */
  fullSurface?: boolean;
}

type McpOAuthScope = (typeof MCP_OAUTH_SCOPES)[number];

function isActionVisibleForOAuthScope(
  entry: ActionEntry,
  scopes: string[] | undefined,
): boolean {
  if (!scopes) return true;
  const required: McpOAuthScope =
    entry.readOnly === true ? "mcp:read" : "mcp:write";
  return hasMcpOAuthScope(scopes, required);
}

const COMPACT_MCP_APP_CATALOG_BUILTINS = new Set([
  "list_apps",
  "open_app",
  "create_embed_session",
]);

function isDispatchConfig(config: MCPConfig): boolean {
  const id = (config.appId ?? "").toLowerCase();
  const name = (config.name ?? "").toLowerCase();
  return id === "dispatch" || name.includes("dispatch");
}

function isActionAdvertisedInCompactMcpAppCatalog(
  config: MCPConfig,
  name: string,
  entry: ActionEntry,
): boolean {
  if (COMPACT_MCP_APP_CATALOG_BUILTINS.has(name)) return true;
  if (name === "ask_app" && isDispatchConfig(config)) return true;
  return Boolean(entry.mcpApp?.resource);
}

const MCP_APP_OAUTH_CLIENT_RE = /\b(chatgpt|openai|claude|anthropic)\b/i;
const NON_APP_OAUTH_CLIENT_RE =
  /\b(code|desktop|cli|cursor|codex|goose|postman|mcpjam|inspector)\b/i;
const MCP_APP_OAUTH_REDIRECT_HOST_RE =
  /(^|\.)((chatgpt|openai)\.com|claude\.ai|anthropic\.com)$/i;

async function isKnownMcpAppOAuthClient(
  identity: MCPCallerIdentity | undefined,
): Promise<boolean> {
  const clientId = identity?.oauthClientId?.trim();
  if (!clientId) return false;

  function isKnownAppClientName(value: string | undefined | null): boolean {
    if (!value) return false;
    return (
      MCP_APP_OAUTH_CLIENT_RE.test(value) &&
      !NON_APP_OAUTH_CLIENT_RE.test(value)
    );
  }

  function isKnownNonAppClientName(value: string | undefined | null): boolean {
    return Boolean(value && NON_APP_OAUTH_CLIENT_RE.test(value));
  }

  function isKnownMcpAppRedirectUri(uri: string): boolean {
    try {
      const url = new URL(uri);
      return (
        url.protocol === "https:" &&
        MCP_APP_OAUTH_REDIRECT_HOST_RE.test(url.hostname)
      );
    } catch {
      return false;
    }
  }

  if (isKnownAppClientName(clientId)) return true;
  if (isKnownNonAppClientName(clientId)) return false;

  try {
    const { getOAuthClient } = await import("./oauth-store.js");
    const client = await getOAuthClient(clientId);
    // If the token carries an OAuth client id but its registration is missing,
    // keep the model on the compact MCP Apps surface instead of exposing every
    // private action/schema.
    if (!client) return true;
    if (isKnownAppClientName(client.clientName)) return true;
    if (isKnownNonAppClientName(client.clientName)) return false;
    if (client.redirectUris.some(isKnownMcpAppRedirectUri)) return true;
    // Most OAuth hosts are UI-oriented MCP clients. Preserve the full catalog
    // only for known code/CLI clients so unknown browser hosts cannot trigger
    // massive resources/list payloads.
    return true;
  } catch {
    // On metadata lookup errors, fail compact instead of falling back to the
    // full action surface; ChatGPT/Claude old tokens otherwise get huge lists.
    return true;
  }
}

interface ResolvedMcpAppResource {
  uri: string;
  legacyUris?: string[];
  name: string;
  title?: string;
  description?: string;
  html: ActionMcpAppResourceConfig["html"];
  mimeType: typeof MCP_APP_MIME_TYPE;
  _meta?: Record<string, unknown>;
}

interface McpAppResourceContext {
  actionName: string;
  appId?: string;
  requestOrigin?: string;
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function withMcpChatBridgeParam(urlOrPath: string): string {
  try {
    const base = "http://agent-native.invalid";
    const url = urlOrPath.startsWith("/")
      ? new URL(urlOrPath, base)
      : new URL(urlOrPath);
    url.searchParams.set(MCP_APP_CHAT_BRIDGE_QUERY_PARAM, "1");
    return urlOrPath.startsWith("/")
      ? `${url.pathname}${url.search}${url.hash}`
      : url.toString();
  } catch {
    return urlOrPath;
  }
}

function mcpAppEmbedOpenLinkMeta(
  result: unknown,
  resource: ResolvedMcpAppResource,
  meta: MCPRequestMeta | undefined,
): Record<string, unknown> {
  const out = metadataObject(result);
  const embedStartUrl =
    typeof out.embedStartUrl === "string"
      ? out.embedStartUrl
      : out.embed === true &&
          typeof out.url === "string" &&
          out.url.includes("/_agent-native/embed/start")
        ? out.url
        : null;
  if (!embedStartUrl) return {};

  const webUrl = toAbsoluteOpenUrl(
    withMcpChatBridgeParam(embedStartUrl),
    meta?.origin,
  );
  const deepLinkUrl =
    typeof out.deepLinkUrl === "string" ? out.deepLinkUrl : null;
  const fallbackLabel = resource.title ?? resource.name ?? "app";
  const label =
    typeof out.app === "string" && out.app.trim()
      ? `Open ${out.app.trim()}`
      : fallbackLabel;
  const view =
    typeof out.view === "string" && out.view.trim()
      ? out.view.trim()
      : typeof out.path === "string" && out.path.trim()
        ? out.path.trim()
        : undefined;

  return {
    "agent-native/openLink": {
      label,
      ...(view ? { view } : {}),
      webUrl,
      desktopUrl: deepLinkUrl
        ? toAbsoluteOpenUrl(deepLinkUrl, meta?.origin)
        : webUrl,
    },
  };
}

/**
 * Build the deep-link content block + structured `_meta` for a tool result.
 * Best-effort: any throw / nullish link is swallowed so a bad `link` builder
 * never fails the tool call.
 */
export function buildLinkArtifacts(
  entry: ActionEntry,
  args: Record<string, any>,
  result: any,
  meta: MCPRequestMeta | undefined,
): {
  block?: { type: "text"; text: string };
  _meta?: Record<string, unknown>;
} {
  if (typeof entry.link !== "function") return {};
  try {
    const lk = entry.link({ args: args ?? {}, result });
    if (!lk?.url) return {};
    const linkUrl = isAgentNativeOpenDeepLink(lk.url)
      ? withCollapsedAgentSidebarParam(lk.url)
      : lk.url;
    const webUrl = toAbsoluteOpenUrl(linkUrl, meta?.origin);
    const desktopUrl = toDesktopOpenUrl(linkUrl);
    const markdownUrl = meta?.target === "desktop" ? desktopUrl : webUrl;
    return {
      block: { type: "text", text: `\n\n[${lk.label} →](${markdownUrl})` },
      _meta: {
        "agent-native/openLink": {
          label: lk.label,
          view: lk.view,
          webUrl,
          desktopUrl,
        },
      },
    };
  } catch {
    return {};
  }
}

/**
 * Merge the generic cross-app builtin tools into the config's action
 * registry. **Template actions take precedence**: if a template defines an
 * action with the same name as a builtin (e.g. its own `list_apps`), the
 * template entry wins and the builtin is dropped. This mirrors the
 * template-over-workspace-core precedence in `autoDiscoverActions`.
 *
 * The builtins are pure-ish navigators / scaffolders; they call back into the
 * same `config.actions` / `config.askAgent` so there is no second agent loop.
 */
function mergeBuiltinTools(
  config: MCPConfig,
  baseActions: Record<string, ActionEntry>,
  requestMeta?: MCPRequestMeta,
): Record<string, ActionEntry> {
  if (config.builtinCrossAppTools === false) return baseActions;
  const builtins = getBuiltinCrossAppTools(config, requestMeta);
  const merged: Record<string, ActionEntry> = { ...builtins };
  // Template / app actions overwrite same-named builtins.
  for (const [name, entry] of Object.entries(baseActions)) {
    merged[name] = entry;
  }
  return merged;
}

function safeUiSegment(value: string | undefined, fallback: string): string {
  const normalized = (value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

// ChatGPT and Claude cache MCP App resource HTML by `ui://` URI. Bump this
// when the shared shell changes in a way that must invalidate host caches.
const MCP_APP_RESOURCE_SHELL_VERSION = "shell-v25";

function legacyDefaultMcpAppUri(config: MCPConfig, actionName: string): string {
  const app = safeUiSegment(config.appId ?? config.name, "agent-native");
  const action = safeUiSegment(actionName, "tool");
  return `ui://${app}/${action}`;
}

function versionMcpAppResourceUri(
  rawUri: string,
): { uri: string; legacyUris?: string[] } | null {
  const uri = rawUri.trim();
  if (!uri.startsWith("ui://")) return null;
  const versionSuffix = `/${MCP_APP_RESOURCE_SHELL_VERSION}`;
  let versionedUri: string;
  try {
    const parsed = new URL(uri);
    const path = parsed.pathname.replace(/\/+$/g, "");
    parsed.pathname = /\/shell-v\d+$/.test(path)
      ? path.replace(/\/shell-v\d+$/, versionSuffix)
      : `${path}${versionSuffix}`;
    versionedUri = parsed.toString();
  } catch {
    return null;
  }
  return {
    uri: versionedUri,
    ...(versionedUri !== uri ? { legacyUris: [uri] } : {}),
  };
}

function expandRequestOriginSources(
  sources: string[] | undefined,
  requestMeta?: MCPRequestMeta,
): string[] | undefined {
  if (!sources) return undefined;
  const origin = requestMeta?.origin;
  return sources.flatMap((source) =>
    source === MCP_APP_REQUEST_ORIGIN_CSP_SOURCE && origin
      ? [origin]
      : [source],
  );
}

function openAiWidgetCsp(
  cspConfig: ActionMcpAppCsp | undefined,
  requestMeta?: MCPRequestMeta,
): Record<string, string[]> | undefined {
  if (!cspConfig) return undefined;
  const csp: Record<string, string[]> = {};
  const connectDomains = expandRequestOriginSources(
    cspConfig.connectDomains,
    requestMeta,
  );
  const resourceDomains = expandRequestOriginSources(
    cspConfig.resourceDomains,
    requestMeta,
  );
  const frameDomains = expandRequestOriginSources(
    cspConfig.frameDomains,
    requestMeta,
  );
  if (connectDomains?.length) csp.connect_domains = connectDomains;
  if (resourceDomains?.length) csp.resource_domains = resourceDomains;
  if (frameDomains?.length) csp.frame_domains = frameDomains;
  return Object.keys(csp).length > 0 ? csp : undefined;
}

function mcpAppUiMeta(
  resource: ActionMcpAppResourceConfig,
  resolvedCsp: ActionMcpAppCsp | undefined,
  requestMeta?: MCPRequestMeta,
  description?: string,
): Record<string, unknown> | undefined {
  const base =
    resource._meta && typeof resource._meta === "object"
      ? { ...resource._meta }
      : {};
  const existingUi =
    base.ui && typeof base.ui === "object" && !Array.isArray(base.ui)
      ? (base.ui as Record<string, unknown>)
      : {};
  const ui: Record<string, unknown> = { ...existingUi };
  if (resolvedCsp) {
    ui.csp = {
      ...resolvedCsp,
      connectDomains: expandRequestOriginSources(
        resolvedCsp.connectDomains,
        requestMeta,
      ),
      resourceDomains: expandRequestOriginSources(
        resolvedCsp.resourceDomains,
        requestMeta,
      ),
      frameDomains: expandRequestOriginSources(
        resolvedCsp.frameDomains,
        requestMeta,
      ),
      baseUriDomains: expandRequestOriginSources(
        resolvedCsp.baseUriDomains,
        requestMeta,
      ),
    };
  }
  if (resource.permissions) ui.permissions = resource.permissions;
  if (resource.domain) ui.domain = resource.domain;
  if (typeof resource.prefersBorder === "boolean") {
    ui.prefersBorder = resource.prefersBorder;
  }
  if (Object.keys(ui).length > 0) base.ui = ui;
  if (description && base["openai/widgetDescription"] == null) {
    base["openai/widgetDescription"] = description;
  }
  if (
    typeof resource.prefersBorder === "boolean" &&
    base["openai/widgetPrefersBorder"] == null
  ) {
    base["openai/widgetPrefersBorder"] = resource.prefersBorder;
  }
  const openAiCsp = openAiWidgetCsp(resolvedCsp, requestMeta);
  if (openAiCsp && base["openai/widgetCSP"] == null) {
    base["openai/widgetCSP"] = openAiCsp;
  }
  return Object.keys(base).length > 0 ? base : undefined;
}

async function resolveMcpAppCsp(
  resource: ActionMcpAppResourceConfig,
  ctx: McpAppResourceContext,
): Promise<ActionMcpAppCsp | undefined> {
  if (!resource.csp) return undefined;
  return typeof resource.csp === "function"
    ? await resource.csp(ctx)
    : resource.csp;
}

async function resolveMcpAppResource(
  config: MCPConfig,
  actionName: string,
  entry: ActionEntry,
  requestMeta?: MCPRequestMeta,
): Promise<ResolvedMcpAppResource | null> {
  const resource = entry.mcpApp?.resource;
  if (!resource) return null;
  const baseUri =
    resource.uri?.trim() || legacyDefaultMcpAppUri(config, actionName);
  const resolvedUri = versionMcpAppResourceUri(baseUri);
  if (!resolvedUri) return null;
  const description = resource.description ?? entry.tool.description;
  const resolvedCsp = await resolveMcpAppCsp(resource, {
    actionName,
    appId: config.appId,
    requestOrigin: requestMeta?.origin,
  });
  const resourceMeta = mcpAppUiMeta(
    resource,
    resolvedCsp,
    requestMeta,
    description,
  );
  return {
    uri: resolvedUri.uri,
    ...(resolvedUri.legacyUris ? { legacyUris: resolvedUri.legacyUris } : {}),
    name: resource.name?.trim() || actionName,
    ...(resource.title ? { title: resource.title } : {}),
    ...(description ? { description } : {}),
    html: resource.html,
    mimeType: resource.mimeType ?? MCP_APP_MIME_TYPE,
    ...(resourceMeta ? { _meta: resourceMeta } : {}),
  };
}

async function getMcpAppResources(
  config: MCPConfig,
  actions: Record<string, ActionEntry>,
  requestMeta?: MCPRequestMeta,
): Promise<ResolvedMcpAppResource[]> {
  const resources = await Promise.all(
    Object.entries(actions).map(([name, entry]) =>
      resolveMcpAppResource(config, name, entry, requestMeta),
    ),
  );
  return resources.filter((resource): resource is ResolvedMcpAppResource =>
    Boolean(resource),
  );
}

function renderMcpAppHtml(
  resource: ResolvedMcpAppResource,
  actionName: string,
  config: MCPConfig,
  requestMeta?: MCPRequestMeta,
): string {
  if (typeof resource.html === "function") {
    return resource.html({
      actionName,
      appId: config.appId,
      requestOrigin: requestMeta?.origin,
    });
  }
  return resource.html;
}

function openAiToolDescriptorMeta(
  resource: ResolvedMcpAppResource,
): Record<string, unknown> {
  const label = resource.title ?? resource.name;
  const widgetCsp = metadataObject(resource._meta?.["openai/widgetCSP"]);
  return {
    "openai/outputTemplate": resource.uri,
    "openai/toolInvocation/invoking": `Opening ${label}`,
    "openai/toolInvocation/invoked": `${label} ready`,
    "openai/widgetAccessible": true,
    ...(Object.keys(widgetCsp).length > 0
      ? { "openai/widgetCSP": widgetCsp }
      : {}),
  };
}

function openAiToolResultMeta(
  resource: ResolvedMcpAppResource,
): Record<string, unknown> {
  const label = resource.title ?? resource.name;
  const widgetCsp = metadataObject(resource._meta?.["openai/widgetCSP"]);
  return {
    "openai/outputTemplate": resource.uri,
    "openai/toolInvocation/invoking": `Opening ${label}`,
    "openai/toolInvocation/invoked": `${label} ready`,
    "openai/widgetAccessible": true,
    ...(Object.keys(widgetCsp).length > 0
      ? { "openai/widgetCSP": widgetCsp }
      : {}),
  };
}

function mcpAppToolUiMeta(
  resource: ResolvedMcpAppResource,
  visibility: unknown,
): Record<string, unknown> {
  return {
    resourceUri: resource.uri,
    visibility: Array.isArray(visibility) ? visibility : ["model", "app"],
  };
}

function primitiveValue(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function mcpAppStructuredContent(
  result: unknown,
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> =
    result && typeof result === "object" && !Array.isArray(result)
      ? { ...(result as Record<string, unknown>) }
      : primitiveValue(result)
        ? { result }
        : {};
  const openLink = meta?.["agent-native/openLink"];
  if (openLink && typeof openLink === "object" && !Array.isArray(openLink)) {
    out.openLink = openLink;
    const webUrl = (openLink as Record<string, unknown>).webUrl;
    if (typeof webUrl === "string" && !out.url) out.url = webUrl;
  }
  return Object.keys(out).length > 0 ? out : { status: "ok" };
}

function truncateToolText(value: string, max = 2000): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function conciseMcpAppToolText(
  name: string,
  result: unknown,
  structuredContent: Record<string, unknown>,
): string {
  if (typeof result === "string") return truncateToolText(result);
  const message = structuredContent.message;
  if (typeof message === "string" && message.trim()) {
    return truncateToolText(message.trim());
  }
  const title = structuredContent.title ?? structuredContent.name;
  if (typeof title === "string" && title.trim()) {
    return `${title.trim()} is ready.`;
  }
  const id = structuredContent.id;
  if (typeof id === "string" && id.trim()) {
    return `${name} completed for ${id.trim()}.`;
  }
  return `${name} completed.`;
}

// ---------------------------------------------------------------------------
// MCP Server creation — converts ActionEntry registry to MCP tools
// ---------------------------------------------------------------------------

/**
 * Build a fully-wired MCP `Server` for a single request / session.
 *
 * Shared by the stateless Streamable-HTTP mount (`mountMCP`) and the stdio
 * standalone transport. The HTTP mount passes the per-request origin via
 * `requestMeta`; the stdio standalone path passes the resolved local app
 * origin so deep links still become absolute URLs.
 */
export async function createMCPServerForRequest(
  config: MCPConfig,
  identity: MCPCallerIdentity | undefined,
  requestMeta?: MCPRequestMeta,
) {
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const {
    ListToolsRequestSchema,
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
    ListResourceTemplatesRequestSchema,
  } = await import("@modelcontextprotocol/sdk/types.js");

  // Resolve the effective caller identity. JWT / header-derived identity
  // (passed by `mountMCP` via `verifyAuth`) wins. When the caller passed no
  // identity — the stdio **standalone** path — fall back to the
  // `AGENT_NATIVE_OWNER_EMAIL` env the `agent-native mcp install` flow writes
  // into the `agent-native mcp serve` process env, so standalone tool runs are
  // tenant-scoped to the configured owner instead of running unscoped. Stays
  // undefined for true dev-open (no token, no secret, no owner) — behavior
  // there is unchanged.
  const ownerFromEnv = process.env.AGENT_NATIVE_OWNER_EMAIL?.trim();
  const effectiveIdentity: MCPCallerIdentity | undefined =
    identity ??
    (ownerFromEnv
      ? { userEmail: ownerFromEnv, orgDomain: undefined }
      : undefined);

  // The action set the request handlers operate on = base actions + generic
  // cross-app builtins (template wins on name collision). An authenticated
  // real caller (connect-minted token / `mcp install` owner / production —
  // `requestMeta.fullSurface`, or the stdio standalone path identified by
  // `AGENT_NATIVE_OWNER_EMAIL`) gets the full `productionActions` surface
  // even in local dev; the unauthenticated dev-open path keeps the sparse
  // `config.actions`. See `external-agents` skill, "Dev vs production tool
  // surface".
  const useFullSurface = requestMeta?.fullSurface === true || !!ownerFromEnv;
  const baseActions =
    useFullSurface && config.productionActions
      ? config.productionActions
      : config.actions;
  const actions = mergeBuiltinTools(config, baseActions, requestMeta);
  const visibleActions = Object.fromEntries(
    Object.entries(actions).filter(([, entry]) =>
      isActionVisibleForOAuthScope(entry, effectiveIdentity?.oauthScopes),
    ),
  );
  const compactMcpAppCatalog =
    (Array.isArray(effectiveIdentity?.oauthScopes) &&
      hasMcpOAuthScope(effectiveIdentity.oauthScopes, "mcp:apps")) ||
    (await isKnownMcpAppOAuthClient(effectiveIdentity));
  const advertisedActions = compactMcpAppCatalog
    ? Object.fromEntries(
        Object.entries(visibleActions).filter(([name, entry]) =>
          isActionAdvertisedInCompactMcpAppCatalog(config, name, entry),
        ),
      )
    : visibleActions;
  const supportsMcpApps =
    compactMcpAppCatalog &&
    Object.values(advertisedActions).some((entry) =>
      Boolean(entry.mcpApp?.resource),
    );
  const server = new Server(
    { name: config.name, version: config.version ?? "1.0.0" },
    {
      capabilities: {
        tools: {},
        ...(supportsMcpApps
          ? {
              resources: {},
              extensions: {
                [MCP_APP_EXTENSION_ID]: {
                  mimeTypes: [MCP_APP_MIME_TYPE],
                },
              },
            }
          : {}),
      },
    },
  );

  // Resolve orgId once per request (DB lookup) so subsequent wraps are
  // synchronous. The caller identity may be undefined for true dev-open —
  // in that case we run with no userEmail/orgId, which makes downstream
  // tools that require per-user scope return empty results rather than
  // cross-tenant data (the safe default).
  const orgIdPromise = resolveOrgIdFromDomain(effectiveIdentity?.orgDomain);

  /**
   * Wrap a callback in
   * `runWithRequestContext({ userEmail, orgId, requestOrigin }, fn)`.
   * Both the tools/list and tools/call handlers go through this so
   * downstream `accessFilter`, `resolveCredential`, and per-user MCP
   * visibility checks see the verified caller's identity. `requestOrigin`
   * is the live server origin derived from the inbound request (same value
   * used to absolutize deep links) so actions that build fetchable URLs
   * (e.g. design `export-coding-handoff`'s signed raw-code URL) resolve the
   * correct local-workspace origin instead of a prod/localhost fallback.
   */
  async function withCallerContext<T>(fn: () => Promise<T>): Promise<T> {
    const orgId = await orgIdPromise;
    return runWithRequestContext(
      {
        userEmail: effectiveIdentity?.userEmail,
        orgId,
        ...(requestMeta?.origin ? { requestOrigin: requestMeta.origin } : {}),
      },
      fn,
    ) as Promise<T>;
  }

  // tools/list — return all actions + ask-agent meta-tool. Wrapped in the
  // request context so per-user MCP visibility (mcp-client/visibility.ts)
  // applies to the listing too.
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return withCallerContext(async () => {
      const tools = await Promise.all(
        Object.entries(advertisedActions).map(async ([name, entry]) => {
          const hasLink = typeof entry.link === "function";
          const mcpAppResource = await resolveMcpAppResource(
            config,
            name,
            entry,
            requestMeta,
          );
          const rawToolMeta =
            (entry.tool as any)._meta &&
            typeof (entry.tool as any)._meta === "object" &&
            !Array.isArray((entry.tool as any)._meta)
              ? { ...((entry.tool as any)._meta as Record<string, unknown>) }
              : {};
          const toolMeta = {
            ...rawToolMeta,
            ...(mcpAppResource
              ? {
                  ...openAiToolDescriptorMeta(mcpAppResource),
                  [MCP_APP_RESOURCE_URI_META_KEY]: mcpAppResource.uri,
                  ui: mcpAppToolUiMeta(
                    mcpAppResource,
                    entry.mcpApp?.visibility ??
                      metadataObject(rawToolMeta.ui).visibility,
                  ),
                }
              : {}),
          };
          const baseDescription = entry.tool.description ?? name;
          const annotations: Record<string, unknown> = {
            readOnlyHint: entry.readOnly === true,
            destructiveHint: entry.publicAgent?.isConsequential === true,
            openWorldHint: false,
          };
          if (hasLink) annotations["agent-native/producesOpenLink"] = true;
          return {
            name,
            description: hasLink
              ? `${baseDescription} After calling, surface the returned "Open in … →" link to the user.`
              : baseDescription,
            inputSchema: entry.tool.parameters ?? {
              type: "object" as const,
              properties: {},
            },
            ...(Object.keys(toolMeta).length > 0 ? { _meta: toolMeta } : {}),
            annotations,
          };
        }),
      );

      if (
        !compactMcpAppCatalog &&
        config.askAgent &&
        hasMcpOAuthScope(effectiveIdentity?.oauthScopes, "mcp:write")
      ) {
        tools.push({
          name: "ask-agent",
          description:
            "Send a natural-language message to the app's AI agent and get a response. " +
            "Use this for complex, multi-step tasks that require the agent's reasoning " +
            "and full context about the app.",
          inputSchema: {
            type: "object" as const,
            properties: {
              message: {
                type: "string",
                description: "The message to send to the agent",
              },
            },
            required: ["message"],
          },
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: false,
          },
        });
      }

      return { tools };
    });
  });

  // tools/call — dispatch to action registry or ask-agent. Wrapped in the
  // request context so the action's `run(args)` and `askAgent()` execute
  // with the verified caller's identity, not the platform default.
  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    return withCallerContext(async () => {
      const { name, arguments: args } = request.params;

      if (name === "ask-agent" && config.askAgent) {
        if (compactMcpAppCatalog) {
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          };
        }
        if (!hasMcpOAuthScope(effectiveIdentity?.oauthScopes, "mcp:write")) {
          return {
            content: [
              {
                type: "text",
                text: "Forbidden: OAuth scope does not allow ask-agent",
              },
            ],
            isError: true,
          };
        }
        const message = args?.message ?? "";
        try {
          const result = await config.askAgent(message);
          return { content: [{ type: "text", text: result }] };
        } catch (err: any) {
          return {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true,
          };
        }
      }

      const callableActions = compactMcpAppCatalog
        ? advertisedActions
        : actions;
      const entry = callableActions[name];
      if (!entry) {
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
      }
      if (
        !isActionVisibleForOAuthScope(entry, effectiveIdentity?.oauthScopes)
      ) {
        return {
          content: [
            {
              type: "text",
              text: `Forbidden: OAuth scope does not allow tool ${name}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await entry.run((args as Record<string, string>) ?? {});
        const rawResult = isMcpActionResult(result) ? result.raw : result;
        const resultForClient = isMcpActionResult(result)
          ? result.text
          : result;
        const mcpAppResource = await resolveMcpAppResource(
          config,
          name,
          entry,
          requestMeta,
        );
        const { block, _meta } = buildLinkArtifacts(
          entry,
          (args as Record<string, any>) ?? {},
          rawResult,
          requestMeta,
        );
        const responseMeta: Record<string, unknown> = {
          ...(_meta ?? {}),
          ...(mcpAppResource
            ? mcpAppEmbedOpenLinkMeta(rawResult, mcpAppResource, requestMeta)
            : {}),
          ...(mcpAppResource ? openAiToolResultMeta(mcpAppResource) : {}),
        };
        const structuredContent = mcpAppResource
          ? mcpAppStructuredContent(rawResult, responseMeta)
          : undefined;
        const text = mcpAppResource
          ? conciseMcpAppToolText(name, resultForClient, structuredContent!)
          : typeof resultForClient === "string"
            ? resultForClient
            : JSON.stringify(resultForClient);
        const content: any[] = [{ type: "text", text }];
        if (block) content.push(block);
        return {
          content,
          ...(structuredContent ? { structuredContent } : {}),
          ...(Object.keys(responseMeta).length > 0
            ? { _meta: responseMeta }
            : {}),
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    });
  });

  if (supportsMcpApps) {
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return withCallerContext(async () => {
        const mcpAppResources = await getMcpAppResources(
          config,
          advertisedActions,
          requestMeta,
        );
        return {
          resources: mcpAppResources.map((resource) => ({
            uri: resource.uri,
            name: resource.name,
            ...(resource.title ? { title: resource.title } : {}),
            ...(resource.description
              ? { description: resource.description }
              : {}),
            mimeType: resource.mimeType,
            ...(resource._meta ? { _meta: resource._meta } : {}),
          })),
        };
      });
    });

    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      return withCallerContext(async () => {
        const mcpAppResources = await getMcpAppResources(
          config,
          advertisedActions,
          requestMeta,
        );
        return {
          resourceTemplates: mcpAppResources.map((resource) => ({
            uriTemplate: resource.uri,
            name: resource.name,
            ...(resource.title ? { title: resource.title } : {}),
            ...(resource.description
              ? { description: resource.description }
              : {}),
            mimeType: resource.mimeType,
            ...(resource._meta ? { _meta: resource._meta } : {}),
          })),
        };
      });
    });

    server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request: any) => {
        return withCallerContext(async () => {
          const uri = request.params?.uri;
          const candidates = await Promise.all(
            Object.entries(advertisedActions).map(async ([name, entry]) => ({
              actionName: name,
              resource: await resolveMcpAppResource(
                config,
                name,
                entry,
                requestMeta,
              ),
            })),
          );
          const found = candidates.find(
            (candidate) =>
              candidate.resource?.uri === uri ||
              candidate.resource?.legacyUris?.includes(uri),
          );
          if (!found?.resource) {
            throw new Error(`MCP App resource not found: ${uri}`);
          }
          return {
            contents: [
              {
                uri,
                mimeType: found.resource.mimeType,
                text: renderMcpAppHtml(
                  found.resource,
                  found.actionName,
                  config,
                  requestMeta,
                ),
                ...(found.resource._meta
                  ? { _meta: found.resource._meta }
                  : {}),
              },
            ],
          };
        });
      },
    );
  }

  return server;
}

// ---------------------------------------------------------------------------
// Auth — reuses the same pattern as A2A (Bearer token or JWT). Shared so the
// HTTP mount and any stdio-side auth-aware helper resolve identity identically.
// ---------------------------------------------------------------------------

export function getAccessTokens(): string[] {
  const single = process.env.ACCESS_TOKEN;
  const multi = process.env.ACCESS_TOKENS;
  const tokens: string[] = [];
  if (single) tokens.push(single);
  if (multi) {
    tokens.push(
      ...multi
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    );
  }
  return tokens;
}

/**
 * Resolve the caller identity for a static-token (or dev-open) auth path.
 *
 * Static `ACCESS_TOKEN` / `ACCESS_TOKENS` auth carries no per-caller claims,
 * so without this the MCP endpoint would run every tool with
 * `userEmail === undefined` and per-user / per-org scoped actions
 * (`accessFilter`, `resolveAccess`, `resolveCredential`) would return
 * empty / wrong data. The `agent-native mcp install` flow writes
 * `AGENT_NATIVE_OWNER_EMAIL` into the client config env and the stdio proxy
 * forwards it as the `X-Agent-Native-Owner-Email` request header (see
 * `mcp/stdio.ts#authHeaders`). We trust that owner hint *only* on the
 * static-token path — JWT auth already carries a cryptographically verified
 * `sub`, so the header is ignored there and never widens JWT scope.
 *
 * Precedence is server-trusted-first: the server process's
 * `AGENT_NATIVE_OWNER_EMAIL` env (set out-of-band by the operator / deploy)
 * ALWAYS wins, and a client-supplied `X-Agent-Native-Owner-Email` header is
 * honored *only as a fallback when that env is unset*. A static `ACCESS_TOKEN`
 * is a shared bearer secret; letting a request header override a
 * server-configured owner would let anyone holding a leaked token act as any
 * user. The header path remains for the single-tenant local-dev install flow
 * where the app server process has no owner env and the token *is* the
 * workspace secret; multi-tenant deployments must use A2A JWT (verified `sub`),
 * not a static token, for per-user scope.
 *
 * Returns `undefined` when no owner email is available (true dev-open: no
 * token, no secret, no owner) so behavior there stays unchanged.
 */
function deriveStaticTokenIdentity(
  ownerEmailHeader: string | undefined,
): MCPCallerIdentity | undefined {
  const owner =
    process.env.AGENT_NATIVE_OWNER_EMAIL?.trim() ||
    (typeof ownerEmailHeader === "string" && ownerEmailHeader.trim()) ||
    "";
  if (!owner) return undefined;
  return { userEmail: owner, orgDomain: undefined };
}

function addSecretCandidate(
  candidates: string[],
  secret: string | null | undefined,
): void {
  const trimmed = secret?.trim();
  if (!trimmed || candidates.includes(trimmed)) return;
  candidates.push(trimmed);
}

async function verifyA2AJwtForMcp(
  token: string,
): Promise<Record<string, unknown> | null> {
  const jose = await import("jose");
  let unverifiedPayload: Record<string, unknown> | null = null;
  try {
    unverifiedPayload = jose.decodeJwt(token) as Record<string, unknown>;
  } catch {
    return null;
  }

  const candidateSecrets: string[] = [];
  addSecretCandidate(candidateSecrets, process.env.A2A_SECRET);

  const orgDomain =
    typeof unverifiedPayload.org_domain === "string"
      ? unverifiedPayload.org_domain
      : undefined;
  if (orgDomain) {
    try {
      const { getA2ASecretByDomain } = await import("../org/context.js");
      addSecretCandidate(
        candidateSecrets,
        await getA2ASecretByDomain(orgDomain),
      );
    } catch {
      // DB not ready or org lookup unavailable — fall back to other candidates.
    }
  }

  for (const secret of candidateSecrets) {
    try {
      const { payload } = await jose.jwtVerify(
        token,
        new TextEncoder().encode(secret),
      );
      return payload as Record<string, unknown>;
    } catch {
      // Try the next candidate without exposing which secret matched.
    }
  }

  return null;
}

/**
 * Verify the inbound auth header. Returns:
 *   - { authed: true, identity } when verified — `identity` is derived from
 *     the JWT (`sub` / `org_domain`) for JWT auth, or from the
 *     `AGENT_NATIVE_OWNER_EMAIL` env / `X-Agent-Native-Owner-Email` header
 *     for static-token auth (the `agent-native mcp install` flow). `identity`
 *     is undefined only for true dev-open with no owner hint.
 *   - { authed: false } on rejection.
 *
 * When A2A_SECRET is set we extract the JWT's `sub` (caller email) and
 * `org_domain` claims so the MCP endpoint can wrap tool runs in
 * `runWithRequestContext({ userEmail, orgId })`. Without that wrap, the
 * MCP endpoint loses tenant identity and downstream `accessFilter` /
 * `resolveCredential` calls fall back to platform-wide defaults.
 *
 * `ownerEmailHeader` is the forwarded `X-Agent-Native-Owner-Email` value; it
 * is consulted ONLY on the static-token / dev-open path (never to influence
 * verified JWT identity), so the install flow runs tools as the configured
 * owner instead of an unscoped anonymous caller.
 */
export async function verifyAuth(
  authHeader: string | undefined,
  ownerEmailHeader?: string | undefined,
  options: { allowDevOpen?: boolean; resourceUrl?: string } = {},
): Promise<{
  authed: boolean;
  identity?: MCPCallerIdentity;
  /**
   * The caller presented a real credential — a verified A2A/connect JWT, a
   * matching ACCESS_TOKEN, or (on the no-auth-configured path) a forwarded
   * owner-email header from `agent-native mcp install`. Drives the full vs
   * sparse MCP tool surface in local dev. The pure unauthenticated dev-open
   * path (no secret, no token, no owner header) is `false`.
   */
  fullSurface?: boolean;
}> {
  // No auth configured → allow only when the route caller has already
  // established that this is a loopback/local dev request. Still honour an
  // owner hint there so the local install/connect flow stays tenant-scoped.
  const accessTokens = getAccessTokens();
  const hasA2ASecret = !!process.env.A2A_SECRET;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : undefined;
  if (token) {
    const oauthIdentity = await verifyMcpOAuthAccessToken(
      token,
      options.resourceUrl,
    );
    if (oauthIdentity) {
      return {
        authed: true,
        identity: {
          userEmail: oauthIdentity.userEmail,
          orgDomain: oauthIdentity.orgDomain,
          oauthScopes: oauthIdentity.scopes,
          oauthClientId: oauthIdentity.clientId,
        },
        fullSurface: true,
      };
    }
  }
  if (accessTokens.length === 0 && !hasA2ASecret && !token) {
    if (options.allowDevOpen === false) {
      return { authed: false };
    }
    return {
      authed: true,
      identity: deriveStaticTokenIdentity(ownerEmailHeader),
      // `mcp install`'s stdio proxy forwards an owner-email header even when
      // the local app has no secret configured — that is a real, identified
      // caller and gets the full surface. A bare browser/curl dev probe with
      // no owner hint stays on the sparse dev surface.
      fullSurface: !!(ownerEmailHeader && ownerEmailHeader.trim()),
    };
  }

  if (!token) return { authed: false };

  // Try an A2A JWT via the shared A2A_SECRET first, then the caller org's
  // synced A2A secret when the token carries org_domain.
  const payload = await verifyA2AJwtForMcp(token);
  if (payload) {
    const tokenScope =
      typeof payload.scope === "string" ? payload.scope : undefined;
    if (tokenScope && tokenScope !== MCP_CONNECT_SCOPE) {
      return { authed: false };
    }

    // Connect-minted tokens (scope === "mcp-connect") carry a random `jti`
    // and are individually revocable. Only these tokens hit the revoke
    // store — ordinary A2A delegation JWTs skip the DB lookup entirely so
    // the hot path is unchanged. The signature was already
    // cryptographically verified, so failing open here only widens the
    // explicit-revoke gate, never the trust boundary.
    if (tokenScope === MCP_CONNECT_SCOPE) {
      if (typeof payload.jti !== "string" || !payload.jti) {
        return { authed: false };
      }
      const jti = payload.jti;
      try {
        const { isJtiRevoked, touchTokenUsed } =
          await import("./connect-store.js");
        if (await isJtiRevoked(jti)) {
          return { authed: false };
        }
        // Best-effort usage telemetry — never blocks / throws.
        void touchTokenUsed(jti);
      } catch {
        // Store import / lookup failed — fail open (see comment above).
      }
    }

    return {
      authed: true,
      identity: {
        userEmail: typeof payload.sub === "string" ? payload.sub : undefined,
        orgDomain:
          typeof payload.org_domain === "string"
            ? (payload.org_domain as string)
            : undefined,
      },
      // Verified JWT (connect-minted or A2A delegation) — a real caller.
      fullSurface: true,
    };
  }

  if (accessTokens.length === 0 && !hasA2ASecret) {
    if (options.allowDevOpen === false) {
      return { authed: false };
    }
    return {
      authed: true,
      identity: deriveStaticTokenIdentity(ownerEmailHeader),
      fullSurface: !!(ownerEmailHeader && ownerEmailHeader.trim()),
    };
  }

  // Try ACCESS_TOKEN / ACCESS_TOKENS exact match. Static tokens carry no
  // per-caller claims, so derive identity from the forwarded owner-email
  // hint (install flow) — otherwise tools would run unscoped.
  if (accessTokens.length > 0 && accessTokens.includes(token)) {
    return {
      authed: true,
      identity: deriveStaticTokenIdentity(ownerEmailHeader),
      // Matched a configured ACCESS_TOKEN — a real caller.
      fullSurface: true,
    };
  }

  return { authed: false };
}

export async function resolveOrgIdFromDomain(
  orgDomain: string | undefined,
): Promise<string | undefined> {
  if (!orgDomain) return undefined;
  try {
    const { resolveOrgByDomain } = await import("../org/context.js");
    const org = await resolveOrgByDomain(orgDomain);
    return org?.orgId ?? undefined;
  } catch {
    return undefined;
  }
}
