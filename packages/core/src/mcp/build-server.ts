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
import { runWithRequestContext } from "../server/request-context.js";
import { toAbsoluteOpenUrl, toDesktopOpenUrl } from "../server/deep-link.js";
import { getBuiltinCrossAppTools } from "./builtin-tools.js";

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
    const webUrl = toAbsoluteOpenUrl(lk.url, meta?.origin);
    const desktopUrl = toDesktopOpenUrl(lk.url);
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
function mergeBuiltinTools(config: MCPConfig): Record<string, ActionEntry> {
  if (config.builtinCrossAppTools === false) return config.actions;
  const builtins = getBuiltinCrossAppTools(config);
  const merged: Record<string, ActionEntry> = { ...builtins };
  // Template / app actions overwrite same-named builtins.
  for (const [name, entry] of Object.entries(config.actions)) {
    merged[name] = entry;
  }
  return merged;
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
  const { ListToolsRequestSchema, CallToolRequestSchema } =
    await import("@modelcontextprotocol/sdk/types.js");

  const server = new Server(
    { name: config.name, version: config.version ?? "1.0.0" },
    { capabilities: { tools: {} } },
  );

  // The action set the request handlers operate on = template actions +
  // generic cross-app builtins (template wins on name collision).
  const actions = mergeBuiltinTools(config);

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
      const tools = Object.entries(actions).map(([name, entry]) => {
        const hasLink = typeof entry.link === "function";
        const baseDescription = entry.tool.description ?? name;
        return {
          name,
          description: hasLink
            ? `${baseDescription} After calling, surface the returned "Open in … →" link to the user.`
            : baseDescription,
          inputSchema: entry.tool.parameters ?? {
            type: "object" as const,
            properties: {},
          },
          ...(hasLink
            ? { annotations: { "agent-native/producesOpenLink": true } }
            : {}),
        };
      });

      if (config.askAgent) {
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

      const entry = actions[name];
      if (!entry) {
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
      }

      try {
        const result = await entry.run((args as Record<string, string>) ?? {});
        const text =
          typeof result === "string" ? result : JSON.stringify(result);
        const content: any[] = [{ type: "text", text }];
        const { block, _meta } = buildLinkArtifacts(
          entry,
          (args as Record<string, any>) ?? {},
          result,
          requestMeta,
        );
        if (block) content.push(block);
        return { content, ...(_meta ? { _meta } : {}) };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    });
  });

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
): Promise<{ authed: boolean; identity?: MCPCallerIdentity }> {
  // No auth configured → allow (dev mode). Still honour an owner hint
  // (env or forwarded header) so the install flow stays tenant-scoped.
  const accessTokens = getAccessTokens();
  const hasA2ASecret = !!process.env.A2A_SECRET;
  if (accessTokens.length === 0 && !hasA2ASecret) {
    return {
      authed: true,
      identity: deriveStaticTokenIdentity(ownerEmailHeader),
    };
  }

  if (!authHeader?.startsWith("Bearer ")) return { authed: false };
  const token = authHeader.slice(7);

  // Try JWT via A2A_SECRET
  if (hasA2ASecret) {
    try {
      const jose = await import("jose");
      const { payload } = await jose.jwtVerify(
        token,
        new TextEncoder().encode(process.env.A2A_SECRET!),
      );
      return {
        authed: true,
        identity: {
          userEmail: typeof payload.sub === "string" ? payload.sub : undefined,
          orgDomain:
            typeof payload.org_domain === "string"
              ? (payload.org_domain as string)
              : undefined,
        },
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
