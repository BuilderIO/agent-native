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
import {
  getRequestContext,
  getRequestOrgId,
  getRequestUserEmail,
  runWithRequestContext,
} from "../server/request-context.js";
import {
  buildDeepLink,
  toAbsoluteOpenUrl,
  toDesktopOpenUrl,
} from "../server/deep-link.js";
import {
  isAgentNativeOpenDeepLink,
  withCollapsedAgentSidebarParam,
} from "../shared/agent-sidebar-url.js";
import { MCP_APP_CHAT_BRIDGE_QUERY_PARAM } from "../shared/embed-auth.js";
import { getBuiltinCrossAppTools } from "./builtin-tools.js";
import {
  MCP_CONNECT_OAUTH_CLIENT_ID,
  MCP_CONNECT_SCOPE,
} from "./connect-store.js";
import { getConfiguredAppBasePath } from "../server/app-base-path.js";
import {
  MCP_OAUTH_SCOPES,
  hasMcpOAuthScope,
  verifyMcpOAuthAccessToken,
} from "./oauth-token.js";

export interface MCPConfig {
  /** App name shown in MCP server info */
  name: string;
  /** Optional human-facing app title shown by MCP hosts that support titles. */
  title?: string;
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
  /** Optional canonical website URL for hosts that surface MCP app details. */
  websiteUrl?: string;
  /** Optional app icons for MCP hosts that render server branding. */
  icons?: Array<{
    src: string;
    mimeType?: string;
    sizes?: string[];
    theme?: "light" | "dark";
  }>;
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
  /**
   * Curated allow-list of action names served to **external connector** clients
   * on a hosted multi-tenant deployment.
   *
   * When `AGENT_NATIVE_CONNECTOR_CATALOG=1` is set and this list is non-empty,
   * the MCP server trims both the advertised tool list *and* the callable
   * surface to exactly these names (plus any builtin cross-app tools such as
   * `list_apps` / `open_app`). Any tool call for a name **not** in the list is
   * rejected — it is not merely hidden. This prevents the ~105-tool full
   * catalog from landing in every external agent's context window and removes
   * footguns (db-exec, seed-*, extension tools, browser-session tools, etc.)
   * from multi-tenant hosted connectors.
   *
   * Callers who need the full surface can opt up with
   * `agent-native connect --full-catalog`, which embeds a `catalog_scope: "full"`
   * claim in their connect-minted JWT. Local/dev deployments without
   * `AGENT_NATIVE_CONNECTOR_CATALOG=1` are unaffected — they always see the
   * full surface.
   *
   * Declare this in your template's `createAgentChatPlugin` options rather than
   * setting it on `MCPConfig` directly; the plugin copies it through.
   */
  connectorCatalog?: string[];
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
  orgId?: string | undefined;
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
  /** Optional mount prefix for path-mounted apps, e.g. `/mail`. */
  basePath?: string;
  /** Optional client preference for which URL the *markdown* link uses. */
  target?: "browser" | "desktop" | "terminal";
  /**
   * Best-effort caller label derived from MCP transport headers. Chat-style
   * remote hosts should stay on the compact catalog; code/stdio clients can
   * explicitly identify themselves to keep the full action surface.
   */
  clientName?: string;
  /** Explicit framework client hint from `x-agent-native-mcp-client`. */
  clientHint?: string;
  /** Explicit opt-in to the full tool catalog for code/stdio style clients. */
  fullCatalog?: boolean;
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
  "ask_app",
  "create_embed_session",
]);

function isActionAdvertisedInCompactMcpAppCatalog(
  name: string,
  entry: ActionEntry,
  config: MCPConfig,
): boolean {
  if (COMPACT_MCP_APP_CATALOG_BUILTINS.has(name)) return true;
  if (
    (entry.mcpApp as { compactCatalog?: unknown } | undefined)
      ?.compactCatalog === true
  ) {
    return true;
  }
  if (config.builtinCrossAppTools === false && entry.mcpApp?.resource) {
    return true;
  }
  return false;
}

const MCP_APP_OAUTH_CLIENT_RE = /\b(chatgpt|openai|claude|anthropic)\b/i;
const NON_APP_OAUTH_CLIENT_RE =
  /\b(code|cli|cursor|codex|goose|postman|mcpjam|inspector)\b/i;
const MCP_APP_OAUTH_REDIRECT_HOST_RE =
  /(^|\.)((chatgpt|openai)\.com|claude\.ai|anthropic\.com)$/i;
const FULL_CATALOG_CLIENT_RE =
  /\b(agent-native-mcp-(proxy|stdio|standalone)|code|cli|cursor|codex|goose|postman|mcpjam|inspector)\b/i;

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

function explicitlyRequestsFullMcpCatalog(
  requestMeta: MCPRequestMeta | undefined,
): boolean {
  if (process.env.AGENT_NATIVE_MCP_FULL_CATALOG === "1") return true;
  if (requestMeta?.fullCatalog === true) return true;
  if (requestMeta?.clientHint) {
    return FULL_CATALOG_CLIENT_RE.test(requestMeta.clientHint);
  }
  return FULL_CATALOG_CLIENT_RE.test(requestMeta?.clientName ?? "");
}

/**
 * Returns true when the given action name is in the template's connector
 * catalog, OR is a builtin cross-app tool that is always included for
 * external connector clients. Builtin tool names from
 * `COMPACT_MCP_APP_CATALOG_BUILTINS` are always allowed since they are the
 * stable external-agent verb set.
 */
function isActionInConnectorCatalog(name: string, config: MCPConfig): boolean {
  if (COMPACT_MCP_APP_CATALOG_BUILTINS.has(name)) return true;
  if (!Array.isArray(config.connectorCatalog)) return false;
  return config.connectorCatalog.includes(name);
}

function shouldUseCompactMcpCatalogByDefault(
  identity: MCPCallerIdentity | undefined,
  requestMeta: MCPRequestMeta | undefined,
): boolean {
  if (explicitlyRequestsFullMcpCatalog(requestMeta)) return false;
  // OAuth callers are classified through `isKnownMcpAppOAuthClient`: unknown
  // OAuth clients compact by default, while known code/CLI clients stay full.
  if (identity?.oauthClientId) return false;
  // A real authenticated remote HTTP caller with no OAuth client metadata is
  // usually a chat-host static-token connector. Keep it on the app-facing
  // verbs so a host cannot dump every action schema into a giant tool card.
  return requestMeta?.fullSurface === true;
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

interface VersionedMcpAppResourceUri {
  uri: string;
  legacyUris?: string[];
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function originString(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function hostSpecificDomainString(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const trimmed = value.trim();
  try {
    new URL(trimmed);
    return undefined;
  } catch {
    return trimmed;
  }
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

function isEmbedStartUrl(value: string): boolean {
  try {
    const base = "http://agent-native.invalid";
    const url = value.startsWith("/") ? new URL(value, base) : new URL(value);
    return url.pathname.includes("/_agent-native/embed/start");
  } catch {
    return value.includes("/_agent-native/embed/start");
  }
}

function routePathFromOpenUrl(value: string): string | null {
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
    const url = hasScheme
      ? new URL(value)
      : new URL(value, "http://agent-native.invalid");
    const route = `${url.pathname}${url.search}${url.hash}`;
    if (!route.startsWith("/") || route.startsWith("//")) return null;
    if (route.startsWith("/\\")) return null;
    if (/^\/[a-z][a-z0-9+.-]*:/i.test(route)) return null;
    return route;
  } catch {
    return null;
  }
}

/**
 * Recursively redact embed-ticket-bearing URLs from any value before it gets
 * serialized into a model-visible text payload. Embed start URLs carry a
 * single-use ticket that grants iframe access to the user's session — they
 * MUST stay in `_meta` (where the embed runtime can consume them) and never
 * appear in `content[].text` for the LLM. This is the generic safety net for
 * actions that return `{ embedStartUrl, ... }` without declaring
 * `mcpApp.resource` (the resource path already strips them via
 * `mcpAppStructuredContent`).
 *
 * Depth-capped to avoid pathological / circular structures. Strings that
 * embed an `isEmbedStartUrl` substring (e.g. a longer message that includes
 * the URL) are replaced with `[hidden embed URL]`.
 */
function purgeEmbedStartUrls(value: unknown, depth = 0): unknown {
  if (depth > 5) return value;
  if (typeof value === "string") {
    return isEmbedStartUrl(value) ? "[hidden embed URL]" : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => purgeEmbedStartUrls(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (typeof val === "string" && isEmbedStartUrl(val)) {
        // Drop the key entirely for object-typed inputs so a tool result like
        // `{ embedStartUrl: "..." }` does not appear at all in the LLM text.
        continue;
      }
      out[key] = purgeEmbedStartUrls(val, depth + 1);
    }
    return out;
  }
  return value;
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
  // Only fabricate an open URL when there is a real path-like value: an
  // explicit deepLinkUrl, or a non-embed `out.url`, or a leading-slash
  // `view`/`path` that's already a route. Bare view-name strings like
  // "inbox" or "deck" must NOT be turned into `${origin}/inbox` — apps
  // route views at app-specific paths (e.g. slides routes `view: "deck"`
  // at `/deck/:id`), so a synthesized origin-relative URL is just a 404.
  // In that case omit `openLink` entirely; the embedStart meta carries
  // the actual launch reference.
  const pathFromRouteLike =
    view && view.startsWith("/")
      ? view
      : typeof out.path === "string" && out.path.trim().startsWith("/")
        ? out.path.trim()
        : undefined;
  const explicitOpenUrl = deepLinkUrl
    ? deepLinkUrl
    : typeof out.url === "string" && !isEmbedStartUrl(out.url)
      ? out.url
      : pathFromRouteLike;
  const safeOpenUrl = explicitOpenUrl
    ? toAbsoluteOpenUrl(explicitOpenUrl, meta?.origin)
    : null;
  // Embed open links expose the safe browser target in `webUrl`, but the
  // desktop URL must enter the app through the registered scheme so Electron
  // can focus the right webview. Preserve the full route/query in the `to`
  // param; focus ids are often only present on `url`, not `out.params`.
  const desktopDeepLinkUrl = (() => {
    if (!safeOpenUrl) return null;
    const app =
      typeof out.app === "string" && out.app.trim()
        ? out.app.trim()
        : undefined;
    if (!app) return safeOpenUrl;
    if (isAgentNativeOpenDeepLink(safeOpenUrl)) {
      return toDesktopOpenUrl(safeOpenUrl);
    }
    const targetRoute = routePathFromOpenUrl(safeOpenUrl);
    if (!targetRoute) return safeOpenUrl;
    const viewParam =
      typeof out.view === "string" && out.view.trim() ? out.view.trim() : "";
    const params =
      out.params && typeof out.params === "object" && !Array.isArray(out.params)
        ? (out.params as Record<
            string,
            string | number | boolean | null | undefined
          >)
        : undefined;
    return toDesktopOpenUrl(
      buildDeepLink({
        app,
        view: viewParam,
        to: targetRoute,
        ...(params ? { params } : {}),
      }),
    );
  })();

  return {
    "agent-native/embedStart": {
      startUrl: webUrl,
      ...(typeof out.embedExpiresAt === "number"
        ? { expiresAt: out.embedExpiresAt }
        : {}),
    },
    ...(safeOpenUrl
      ? {
          "agent-native/openLink": {
            label,
            ...(view ? { view } : {}),
            webUrl: safeOpenUrl,
            desktopUrl: desktopDeepLinkUrl ?? safeOpenUrl,
          },
        }
      : {}),
  };
}

async function withServerMintedMcpAppEmbedStart(
  result: unknown,
  meta: MCPRequestMeta | undefined,
): Promise<unknown> {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }

  const out = result as Record<string, unknown>;
  if (out.embed !== true) return result;
  if (typeof out.embedStartUrl === "string" && out.embedStartUrl.trim()) {
    return result;
  }
  if (
    typeof out.url === "string" &&
    out.url.trim() &&
    isEmbedStartUrl(out.url)
  ) {
    return result;
  }

  const candidate = [out.url, out.path, out.deepLinkUrl].find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
  if (!candidate) return result;

  const trimmed = candidate.trim();
  const isPath = trimmed.startsWith("/") && !trimmed.startsWith("//");
  const isAbsoluteHttp = /^https?:\/\//i.test(trimmed);
  if (!isPath && !isAbsoluteHttp) return result;
  if (isAbsoluteHttp && !meta?.origin) return result;

  const ctx = getRequestContext();
  const ownerEmail = ctx?.userEmail?.trim();
  if (!ownerEmail) return result;

  const { normalizeEmbedTargetPath, createEmbedSessionTicket } =
    await import("../server/embed-session.js");
  const { buildEmbedStartPath } = await import("../server/embed-route.js");
  const targetPath = normalizeEmbedTargetPath(
    withMcpChatBridgeParam(trimmed),
    meta?.origin,
  );
  if (!targetPath) return result;

  const ticket = await createEmbedSessionTicket({
    ownerEmail,
    orgId: ctx?.orgId,
    targetPath,
    scope: typeof out.chrome === "string" ? out.chrome : null,
  });
  const startPath = buildEmbedStartPath(ticket.ticket);
  const embedStartUrl = meta?.origin
    ? new URL(startPath, meta.origin).toString()
    : startPath;

  return {
    ...out,
    embedStartUrl,
    embedTargetPath: targetPath,
    embedExpiresAt: ticket.expiresAt,
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

function absoluteMetadataUrl(
  value: string | undefined,
  requestMeta?: MCPRequestMeta,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    if (requestMeta?.origin) {
      const basePath = requestMeta.basePath ?? getConfiguredAppBasePath();
      const appBase = `${requestMeta.origin.replace(/\/+$/, "")}${basePath}/`;
      const appLocalValue =
        trimmed.startsWith("/") && !trimmed.startsWith("//")
          ? trimmed.replace(/^\/+/, "")
          : trimmed;
      return new URL(appLocalValue, appBase).href;
    }
    return new URL(trimmed).href;
  } catch {
    return trimmed;
  }
}

function mcpServerInfo(config: MCPConfig, requestMeta?: MCPRequestMeta) {
  const websiteUrl = absoluteMetadataUrl(config.websiteUrl, requestMeta);
  const icons = config.icons
    ?.map((icon) => {
      const src = absoluteMetadataUrl(icon.src, requestMeta);
      if (!src) return null;
      return {
        src,
        ...(icon.mimeType ? { mimeType: icon.mimeType } : {}),
        ...(icon.sizes?.length ? { sizes: icon.sizes } : {}),
        ...(icon.theme ? { theme: icon.theme } : {}),
      };
    })
    .filter((icon): icon is NonNullable<typeof icon> => Boolean(icon));
  return {
    name: config.name,
    version: config.version ?? "1.0.0",
    ...(config.title?.trim() ? { title: config.title.trim() } : {}),
    ...(config.description?.trim()
      ? { description: config.description.trim() }
      : {}),
    ...(websiteUrl ? { websiteUrl } : {}),
    ...(icons?.length ? { icons } : {}),
  };
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
const MCP_APP_RESOURCE_SHELL_VERSION = "shell-v43";

function legacyDefaultMcpAppUri(config: MCPConfig, actionName: string): string {
  const app = safeUiSegment(config.appId ?? config.name, "agent-native");
  const action = safeUiSegment(actionName, "tool");
  return `ui://${app}/${action}`;
}

function versionMcpAppResourceUri(
  rawUri: string,
): VersionedMcpAppResourceUri | null {
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

function unversionMcpAppResourceUri(uri: string): string | null {
  if (!uri.startsWith("ui://")) return null;
  try {
    const parsed = new URL(uri);
    parsed.pathname = parsed.pathname
      .replace(/\/+$/g, "")
      .replace(/\/shell-v\d+$/g, "");
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeMcpAppResourceUriForMatch(uri: unknown): string | null {
  if (typeof uri !== "string") return null;
  const trimmed = uri.trim();
  if (!trimmed.startsWith("ui://")) return null;
  return (
    unversionMcpAppResourceUri(trimmed) ??
    trimmed.replace(/\/+$/g, "").replace(/\/shell-v\d+(?=([?#]|$))/g, "")
  );
}

function matchesMcpAppResourceUri(
  resourceUri: VersionedMcpAppResourceUri,
  requestedUri: unknown,
): boolean {
  if (typeof requestedUri !== "string") return false;
  const requested = requestedUri.trim();
  if (resourceUri.uri === requested) return true;
  if (resourceUri.legacyUris?.includes(requested)) return true;
  const requestedBase = normalizeMcpAppResourceUriForMatch(requested);
  const currentBase = normalizeMcpAppResourceUriForMatch(resourceUri.uri);
  return Boolean(requestedBase && currentBase && requestedBase === currentBase);
}

function getMcpAppResourceUri(
  config: MCPConfig,
  actionName: string,
  entry: ActionEntry,
): VersionedMcpAppResourceUri | null {
  const resource = entry.mcpApp?.resource;
  if (!resource) return null;
  const baseUri =
    resource.uri?.trim() || legacyDefaultMcpAppUri(config, actionName);
  return versionMcpAppResourceUri(baseUri);
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
  delete ui.domain;
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
  const hostSpecificDomain =
    hostSpecificDomainString(resource.domain) ??
    hostSpecificDomainString(existingUi.domain);
  if (hostSpecificDomain) ui.domain = hostSpecificDomain;
  const openAiWidgetDomain =
    originString(resource.domain) ??
    originString(ui.domain) ??
    originString(existingUi.domain) ??
    originString(requestMeta?.origin);
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
  if (openAiWidgetDomain && base["openai/widgetDomain"] == null) {
    base["openai/widgetDomain"] = openAiWidgetDomain;
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
  const resolvedUri = getMcpAppResourceUri(config, actionName, entry);
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

async function resolveMcpAppResourceSafely(
  config: MCPConfig,
  actionName: string,
  entry: ActionEntry,
  requestMeta?: MCPRequestMeta,
): Promise<ResolvedMcpAppResource | null> {
  try {
    return await resolveMcpAppResource(config, actionName, entry, requestMeta);
  } catch (error) {
    console.warn(
      `[mcp] Skipping MCP App resource for action "${actionName}" because its metadata could not be resolved.`,
      error,
    );
    return null;
  }
}

async function getMcpAppResources(
  config: MCPConfig,
  actions: Record<string, ActionEntry>,
  requestMeta?: MCPRequestMeta,
): Promise<ResolvedMcpAppResource[]> {
  const resources = await Promise.all(
    Object.entries(actions).map(([name, entry]) =>
      resolveMcpAppResourceSafely(config, name, entry, requestMeta),
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
  for (const key of ["embedStartUrl", "startUrl"]) {
    const value = out[key];
    if (typeof value === "string" && isEmbedStartUrl(value)) delete out[key];
  }
  if (typeof out.url === "string" && isEmbedStartUrl(out.url)) {
    delete out.url;
  }
  // Internal embed-routing fields belong in `_meta["agent-native/embedStart"]`
  // (consumed by the embed runtime), not in `structuredContent` (read by the
  // LLM). `embedTargetPath` reveals the exact route + thread/draft id the user
  // is looking at; `embedExpiresAt` is an unintended timestamp; ticket-bearing
  // fields are single-use credentials. Drop all of them unconditionally.
  for (const key of [
    "embedTargetPath",
    "embedExpiresAt",
    "ticket",
    "embedTicket",
  ]) {
    delete out[key];
  }
  for (const key of Object.keys(out)) {
    if (/Ticket$/.test(key)) delete out[key];
  }
  const openLink = meta?.["agent-native/openLink"];
  if (openLink && typeof openLink === "object" && !Array.isArray(openLink)) {
    const webUrl = (openLink as Record<string, unknown>).webUrl;
    if (typeof webUrl === "string" && isEmbedStartUrl(webUrl)) {
      return Object.keys(out).length > 0 ? out : { status: "ok" };
    }
    out.openLink = openLink;
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
  const compactMcpAppCatalog = explicitlyRequestsFullMcpCatalog(requestMeta)
    ? false
    : (Array.isArray(effectiveIdentity?.oauthScopes) &&
        hasMcpOAuthScope(effectiveIdentity.oauthScopes, "mcp:apps")) ||
      (await isKnownMcpAppOAuthClient(effectiveIdentity)) ||
      shouldUseCompactMcpCatalogByDefault(effectiveIdentity, requestMeta);
  const advertisedActionsBeforeConnector = compactMcpAppCatalog
    ? Object.fromEntries(
        Object.entries(visibleActions).filter(([name, entry]) =>
          isActionAdvertisedInCompactMcpAppCatalog(name, entry, config),
        ),
      )
    : visibleActions;
  // Connector-catalog tier: on hosted multi-tenant deployments (signalled by
  // AGENT_NATIVE_CONNECTOR_CATALOG=1) restrict external callers to the
  // template-declared allow-list unless the token was minted with
  // --full-catalog (catalog_scope: "full"). This prevents the ~105-tool full
  // catalog from bloating every external agent's context window and removes
  // db-exec / seed-* / extension / browser-session footguns.
  const connectorCatalogActive =
    process.env.AGENT_NATIVE_CONNECTOR_CATALOG === "1" &&
    Array.isArray(config.connectorCatalog) &&
    config.connectorCatalog.length > 0 &&
    !explicitlyRequestsFullMcpCatalog(requestMeta);
  // When the connector catalog is active, filter directly from visibleActions
  // rather than advertisedActionsBeforeConnector. This ensures the connector
  // tier is an independent, template-declared surface that doesn't accidentally
  // narrow to just the compact-catalog builtins when shouldUseCompactMcpCatalogByDefault
  // would have activated the compact catalog for the same caller.
  const advertisedActions = connectorCatalogActive
    ? Object.fromEntries(
        Object.entries(visibleActions).filter(([name]) =>
          isActionInConnectorCatalog(name, config),
        ),
      )
    : advertisedActionsBeforeConnector;
  const supportsMcpApps =
    compactMcpAppCatalog ||
    Object.values(advertisedActions).some((entry) =>
      Boolean(entry.mcpApp?.resource),
    );
  const server = new Server(mcpServerInfo(config, requestMeta), {
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
  });

  // Resolve orgId once per request (DB lookup) so subsequent wraps are
  // synchronous. The caller identity may be undefined for true dev-open —
  // in that case we run with no userEmail/orgId, which makes downstream
  // tools that require per-user scope return empty results rather than
  // cross-tenant data (the safe default).
  const orgIdPromise = effectiveIdentity?.orgId
    ? Promise.resolve(effectiveIdentity.orgId)
    : resolveOrgIdFromDomain(effectiveIdentity?.orgDomain);

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
          const mcpAppResource = await resolveMcpAppResourceSafely(
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
        !connectorCatalogActive &&
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
        if (compactMcpAppCatalog || connectorCatalogActive) {
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

      // Connector-catalog tier: when active, callableActions === advertisedActions
      // (the filtered set). Non-listed tools are not callable — mirroring how
      // compactMcpAppCatalog gates calls on advertisedActions.
      const callableActions =
        compactMcpAppCatalog || connectorCatalogActive
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
        // We're inside `withCallerContext`, so the request-context getters
        // resolve the verified MCP caller's identity (do NOT inject a dev
        // fallback). Tag the call as an external-agent MCP dispatch.
        const result = await entry.run((args as Record<string, string>) ?? {}, {
          userEmail: getRequestUserEmail(),
          orgId: getRequestOrgId() ?? null,
          caller: "mcp",
        });
        const mcpResult = isMcpActionResult(result) ? result : null;
        const rawResult = mcpResult ? mcpResult.raw : result;
        const resultForClient = mcpResult ? mcpResult.text : result;
        const mcpResultIsError =
          !!mcpResult &&
          !!mcpResult.raw &&
          typeof mcpResult.raw === "object" &&
          (mcpResult.raw as Record<string, unknown>).isError === true;
        const mcpAppResource = await resolveMcpAppResourceSafely(
          config,
          name,
          entry,
          requestMeta,
        );
        const rawResultForClient = mcpAppResource
          ? await withServerMintedMcpAppEmbedStart(rawResult, requestMeta)
          : rawResult;
        const { block, _meta } = buildLinkArtifacts(
          entry,
          (args as Record<string, any>) ?? {},
          rawResultForClient,
          requestMeta,
        );
        const responseMeta: Record<string, unknown> = {
          ...(_meta ?? {}),
          ...(mcpAppResource
            ? mcpAppEmbedOpenLinkMeta(
                rawResultForClient,
                mcpAppResource,
                requestMeta,
              )
            : {}),
          ...(mcpAppResource ? openAiToolResultMeta(mcpAppResource) : {}),
        };
        const toolUiMeta = metadataObject((entry.tool as any)._meta?.ui);
        const toolVisibility = toolUiMeta.visibility;
        const isAppOnlyVisibility =
          Array.isArray(toolVisibility) &&
          toolVisibility.length > 0 &&
          toolVisibility.every((v) => v === "app");
        const structuredContent = mcpAppResource
          ? mcpAppStructuredContent(rawResultForClient, responseMeta)
          : isAppOnlyVisibility &&
              rawResult &&
              typeof rawResult === "object" &&
              !Array.isArray(rawResult)
            ? (rawResult as Record<string, unknown>)
            : undefined;
        const text = mcpAppResource
          ? conciseMcpAppToolText(name, resultForClient, structuredContent!)
          : typeof resultForClient === "string"
            ? (purgeEmbedStartUrls(resultForClient) as string)
            : JSON.stringify(purgeEmbedStartUrls(resultForClient));
        const content: any[] = [{ type: "text", text }];
        if (block) content.push(block);
        return {
          content,
          ...(mcpResultIsError ? { isError: true } : {}),
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
          let found: {
            actionName: string;
            resource: ResolvedMcpAppResource;
          } | null = null;
          for (const [name, entry] of Object.entries(advertisedActions)) {
            const resourceUri = getMcpAppResourceUri(config, name, entry);
            if (!resourceUri || !matchesMcpAppResourceUri(resourceUri, uri)) {
              continue;
            }
            const resource = await resolveMcpAppResourceSafely(
              config,
              name,
              entry,
              requestMeta,
            );
            if (resource) {
              found = { actionName: name, resource };
              break;
            }
            // resolveMcpAppResourceSafely returned null (e.g. an async resolver
            // threw) — keep scanning the remaining candidates rather than
            // aborting and reporting the resource as missing.
          }
          if (!found) {
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

export function getBearerToken(
  authHeader: string | undefined,
): string | undefined {
  if (!authHeader) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match?.[1]?.trim() || undefined;
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

async function isConnectTokenAllowed(
  jti: string | undefined,
): Promise<boolean> {
  if (!jti) return false;
  try {
    const { isJtiRevoked, touchTokenUsed } = await import("./connect-store.js");
    if (await isJtiRevoked(jti)) return false;
    // Best-effort usage telemetry — never blocks / throws.
    void touchTokenUsed(jti);
  } catch {
    // Store import / lookup failed — fail open. Signature verification already
    // passed; this only gates explicit revokes.
  }
  return true;
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
  /**
   * The caller explicitly opted up to the full connector catalog by minting
   * their token with `--full-catalog` (or equivalent). When `true`, the
   * connector-catalog tier filter is bypassed even when
   * `AGENT_NATIVE_CONNECTOR_CATALOG=1` is set. Derived from a
   * `catalog_scope: "full"` claim in the verified A2A/connect JWT.
   */
  fullCatalog?: boolean;
}> {
  // No auth configured → allow only when the route caller has already
  // established that this is a loopback/local dev request. Still honour an
  // owner hint there so the local install/connect flow stays tenant-scoped.
  const accessTokens = getAccessTokens();
  const hasA2ASecret = !!process.env.A2A_SECRET?.trim();
  const token = getBearerToken(authHeader);
  if (token) {
    const oauthIdentity = await verifyMcpOAuthAccessToken(
      token,
      options.resourceUrl,
    );
    if (oauthIdentity) {
      if (
        oauthIdentity.clientId === MCP_CONNECT_OAUTH_CLIENT_ID &&
        !(await isConnectTokenAllowed(oauthIdentity.jti))
      ) {
        return { authed: false };
      }
      return {
        authed: true,
        identity: {
          userEmail: oauthIdentity.userEmail,
          ...(oauthIdentity.orgId ? { orgId: oauthIdentity.orgId } : {}),
          orgDomain: oauthIdentity.orgDomain,
          oauthScopes: oauthIdentity.scopes,
          oauthClientId: oauthIdentity.clientId,
        },
        fullSurface: true,
        // Per-token opt-up: `catalog_scope: "full"` in the OAuth token
        // bypasses the connector-catalog tier filter on hosted deployments.
        fullCatalog: oauthIdentity.catalogScope === "full",
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
      if (!(await isConnectTokenAllowed(payload.jti as string | undefined))) {
        return { authed: false };
      }
    }

    return {
      authed: true,
      identity: {
        userEmail: typeof payload.sub === "string" ? payload.sub : undefined,
        // Org SERVICE tokens (connect-minted, synthetic `svc-*@service.<org>`
        // subject) carry the org id directly as an `org_id` claim so the
        // resolved identity is org-scoped even when the org has no domain
        // mapping. Personal/delegation JWTs don't set the claim — unchanged.
        ...(typeof payload.org_id === "string" && payload.org_id
          ? { orgId: payload.org_id as string }
          : {}),
        orgDomain:
          typeof payload.org_domain === "string"
            ? (payload.org_domain as string)
            : undefined,
      },
      // Verified JWT (connect-minted or A2A delegation) — a real caller.
      fullSurface: true,
      // Per-token opt-up: `catalog_scope: "full"` embedded at mint time via
      // `agent-native connect --full-catalog` bypasses the connector-catalog
      // tier filter on hosted multi-tenant deployments.
      fullCatalog: payload.catalog_scope === "full",
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
  // hint (install flow) — otherwise tools would run unscoped. Compare in
  // constant time (matching the rest of this subsystem's secret-comparison
  // discipline); node:crypto is imported dynamically because this module is
  // bundled into the serverless function and avoids static Node-only imports.
  if (accessTokens.length > 0) {
    const { timingSafeEqual } = await import("node:crypto");
    const candidate = Buffer.from(token, "utf8");
    const matched = accessTokens.some((configured) => {
      const expected = Buffer.from(configured, "utf8");
      return (
        expected.length === candidate.length &&
        timingSafeEqual(expected, candidate)
      );
    });
    if (matched) {
      return {
        authed: true,
        identity: deriveStaticTokenIdentity(ownerEmailHeader),
        // Matched a configured ACCESS_TOKEN — a real caller.
        fullSurface: true,
      };
    }
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
