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
  type ActionMcpAppResourceConfig,
} from "../action.js";
import { MCP_APP_REQUEST_ORIGIN_CSP_SOURCE } from "./embed-app.js";
import { runWithRequestContext } from "../server/request-context.js";
import { toAbsoluteOpenUrl, toDesktopOpenUrl } from "../server/deep-link.js";
import {
  isAgentNativeOpenDeepLink,
  withCollapsedAgentSidebarParam,
} from "../shared/agent-sidebar-url.js";
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

  function isLoopbackHost(hostname: string): boolean {
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname.startsWith("127.")
    );
  }

  function isRemoteRedirectUri(uri: string): boolean {
    try {
      const url = new URL(uri);
      return url.protocol === "https:" && !isLoopbackHost(url.hostname);
    } catch {
      return false;
    }
  }

  if (isKnownAppClientName(clientId)) return true;
  if (isKnownNonAppClientName(clientId)) return false;

  try {
    const { getOAuthClient } = await import("./oauth-store.js");
    const client = await getOAuthClient(clientId);
    if (!client) return true;
    if (isKnownAppClientName(client.clientName)) return true;
    if (isKnownNonAppClientName(client.clientName)) return false;
    return client.redirectUris.some((uri) => {
      try {
        const hostname = new URL(uri).hostname;
        return (
          MCP_APP_OAUTH_REDIRECT_HOST_RE.test(hostname) ||
          isRemoteRedirectUri(uri)
        );
      } catch {
        return false;
      }
    });
  } catch {
    return true;
  }
}

interface ResolvedMcpAppResource {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  html: ActionMcpAppResourceConfig["html"];
  mimeType: typeof MCP_APP_MIME_TYPE;
  _meta?: Record<string, unknown>;
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

function defaultMcpAppUri(config: MCPConfig, actionName: string): string {
  const app = safeUiSegment(config.appId ?? config.name, "agent-native");
  const action = safeUiSegment(actionName, "tool");
  return `ui://${app}/${action}`;
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
  resource: ActionMcpAppResourceConfig,
  requestMeta?: MCPRequestMeta,
): Record<string, string[]> | undefined {
  if (!resource.csp) return undefined;
  const csp: Record<string, string[]> = {};
  const connectDomains = expandRequestOriginSources(
    resource.csp.connectDomains,
    requestMeta,
  );
  const resourceDomains = expandRequestOriginSources(
    resource.csp.resourceDomains,
    requestMeta,
  );
  const frameDomains = expandRequestOriginSources(
    resource.csp.frameDomains,
    requestMeta,
  );
  if (connectDomains?.length) csp.connect_domains = connectDomains;
  if (resourceDomains?.length) csp.resource_domains = resourceDomains;
  if (frameDomains?.length) csp.frame_domains = frameDomains;
  return Object.keys(csp).length > 0 ? csp : undefined;
}

function mcpAppUiMeta(
  resource: ActionMcpAppResourceConfig,
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
  if (resource.csp) {
    ui.csp = {
      ...resource.csp,
      connectDomains: expandRequestOriginSources(
        resource.csp.connectDomains,
        requestMeta,
      ),
      resourceDomains: expandRequestOriginSources(
        resource.csp.resourceDomains,
        requestMeta,
      ),
      frameDomains: expandRequestOriginSources(
        resource.csp.frameDomains,
        requestMeta,
      ),
      baseUriDomains: expandRequestOriginSources(
        resource.csp.baseUriDomains,
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
  const openAiCsp = openAiWidgetCsp(resource, requestMeta);
  if (openAiCsp && base["openai/widgetCSP"] == null) {
    base["openai/widgetCSP"] = openAiCsp;
  }
  return Object.keys(base).length > 0 ? base : undefined;
}

function resolveMcpAppResource(
  config: MCPConfig,
  actionName: string,
  entry: ActionEntry,
  requestMeta?: MCPRequestMeta,
): ResolvedMcpAppResource | null {
  const resource = entry.mcpApp?.resource;
  if (!resource) return null;
  const uri = resource.uri?.trim() || defaultMcpAppUri(config, actionName);
  if (!uri.startsWith("ui://")) return null;
  const description = resource.description ?? entry.tool.description;
  const resourceMeta = mcpAppUiMeta(resource, requestMeta, description);
  return {
    uri,
    name: resource.name?.trim() || actionName,
    ...(resource.title ? { title: resource.title } : {}),
    ...(description ? { description } : {}),
    html: resource.html,
    mimeType: resource.mimeType ?? MCP_APP_MIME_TYPE,
    ...(resourceMeta ? { _meta: resourceMeta } : {}),
  };
}

function getMcpAppResources(
  config: MCPConfig,
  actions: Record<string, ActionEntry>,
  requestMeta?: MCPRequestMeta,
): ResolvedMcpAppResource[] {
  return Object.entries(actions).flatMap(([name, entry]) => {
    const resource = resolveMcpAppResource(config, name, entry, requestMeta);
    return resource ? [resource] : [];
  });
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
  return {
    "openai/outputTemplate": resource.uri,
    "openai/toolInvocation/invoking": `Opening ${label}`,
    "openai/toolInvocation/invoked": `${label} ready`,
    "openai/widgetAccessible": true,
  };
}

function openAiToolResultMeta(
  resource: ResolvedMcpAppResource,
): Record<string, unknown> {
  const label = resource.title ?? resource.name;
  return {
    "openai/outputTemplate": resource.uri,
    "openai/toolInvocation/invoking": `Opening ${label}`,
    "openai/toolInvocation/invoked": `${label} ready`,
    "openai/widgetAccessible": true,
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
  const mcpAppResources = compactMcpAppCatalog
    ? getMcpAppResources(config, advertisedActions, requestMeta)
    : [];
  const supportsMcpApps = mcpAppResources.length > 0;
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
      const tools = Object.entries(advertisedActions).map(([name, entry]) => {
        const hasLink = typeof entry.link === "function";
        const mcpAppResource = resolveMcpAppResource(
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
                ui: {
                  ...(((rawToolMeta.ui as any) &&
                  typeof rawToolMeta.ui === "object" &&
                  !Array.isArray(rawToolMeta.ui)
                    ? rawToolMeta.ui
                    : {}) as Record<string, unknown>),
                  resourceUri: mcpAppResource.uri,
                  visibility: entry.mcpApp?.visibility ?? ["model", "app"],
                },
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
      });

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
        const resultForClient = isMcpActionResult(result)
          ? result.text
          : result;
        const mcpAppResource = resolveMcpAppResource(
          config,
          name,
          entry,
          requestMeta,
        );
        const { block, _meta } = buildLinkArtifacts(
          entry,
          (args as Record<string, any>) ?? {},
          isMcpActionResult(result) ? result.raw : result,
          requestMeta,
        );
        const responseMeta: Record<string, unknown> = {
          ...(_meta ?? {}),
          ...(mcpAppResource ? openAiToolResultMeta(mcpAppResource) : {}),
        };
        const structuredContent = mcpAppResource
          ? mcpAppStructuredContent(
              isMcpActionResult(result) ? result.raw : result,
              responseMeta,
            )
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
      return withCallerContext(async () => ({
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
      }));
    });

    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
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

    server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request: any) => {
        return withCallerContext(async () => {
          const uri = request.params?.uri;
          const found = Object.entries(advertisedActions)
            .map(([name, entry]) => ({
              actionName: name,
              resource: resolveMcpAppResource(config, name, entry, requestMeta),
            }))
            .find((candidate) => candidate.resource?.uri === uri);
          if (!found?.resource) {
            throw new Error(`MCP App resource not found: ${uri}`);
          }
          return {
            contents: [
              {
                uri: found.resource.uri,
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
  if (accessTokens.length === 0 && !hasA2ASecret) {
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

  // Try JWT via A2A_SECRET
  if (hasA2ASecret) {
    try {
      const jose = await import("jose");
      const { payload } = await jose.jwtVerify(
        token,
        new TextEncoder().encode(process.env.A2A_SECRET!),
      );

      const tokenScope =
        typeof payload.scope === "string" ? payload.scope : undefined;
      if (tokenScope && tokenScope !== MCP_CONNECT_SCOPE) {
        return { authed: false };
      }

      // Connect-minted tokens (scope === "mcp-connect") carry a random `jti`
      // and are individually revocable. Only these tokens hit the revoke
      // store — ordinary A2A delegation JWTs skip the DB lookup entirely so
      // the hot path is unchanged. The revoke check FAILS OPEN on any
      // store/DB error: a transient Neon WS drop must never lock every
      // connected agent out. The signature was already cryptographically
      // verified above, so failing open here only widens the explicit-revoke
      // gate, never the trust boundary.
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
    } catch {
      // Not a valid JWT — fall through to token check
    }
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
