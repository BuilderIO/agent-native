import * as jose from "jose";
/**
 * Regression coverage for the production blocker: `/_agent-native/mcp` must
 * work on the web-standard Nitro runtime (Netlify web runtime, Cloudflare,
 * Deno, Bun) where there is NO Node `http` req/res. Before the fix the
 * handler returned `501 {"error":"MCP requires Node runtime"}` on every
 * deployed app, breaking the headline `agent-native connect <hosted-url>`
 * feature.
 *
 * These tests drive the REAL SDK web-standard transport + the REAL
 * `createMCPServerForRequest` so they prove the full JSON-RPC lifecycle
 * (`initialize` → `tools/list` → `tools/call`) — including the deep-link
 * `_meta` / markdown block — works without a Node runtime, and that the
 * Node fast-path is still taken (and unchanged) when `event.node` is present.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MCP_ACTION_RESULT_MARKER } from "../mcp-client/app-result.js";

// Heavy/irrelevant deps mocked so importing build-server.ts is cheap. The
// MCP SDK itself is REAL — that's the whole point of these tests.
vi.mock("./builtin-tools.js", () => ({
  getBuiltinCrossAppTools: () => ({
    list_apps: {
      tool: {
        description: "List workspace apps",
      },
      readOnly: true,
      run: async () => ({ apps: [] }),
    },
    open_app: {
      tool: {
        description: "Open a workspace app",
        parameters: {
          type: "object",
          properties: {
            app: { type: "string" },
            path: { type: "string" },
            embed: { type: "boolean" },
          },
        },
      },
      readOnly: true,
      run: async () => ({ app: "mail", url: "/inbox", embed: true }),
      mcpApp: {
        resource: {
          uri: "ui://mail/open_app",
          title: "Open app",
          description: "Open the app inline.",
          html: "<!doctype html><html><body>Open app</body></html>",
        },
      },
    },
    ask_app: {
      tool: {
        description: "Ask a workspace app",
        parameters: {
          type: "object",
          properties: {
            app: { type: "string" },
            message: { type: "string" },
          },
          required: ["app", "message"],
        },
      },
      run: async () => ({ response: "agent answer" }),
    },
    ask_app_status: {
      tool: {
        description: "Poll an ask_app task",
        parameters: {
          type: "object",
          properties: {
            app: { type: "string" },
            taskId: { type: "string" },
          },
          required: ["taskId"],
        },
      },
      readOnly: true,
      run: async () => ({ status: "completed", response: "agent answer" }),
    },
    create_embed_session: {
      tool: {
        description: "Create an embed session",
        _meta: { ui: { visibility: ["app"] } },
      },
      run: async () => ({ startUrl: "/_agent-native/embed/start/mock" }),
    },
    create_workspace_app: {
      tool: {
        description: "Scaffold a workspace app",
      },
      run: async () => ({ url: "/new-app" }),
    },
    list_templates: {
      tool: {
        description: "List app templates",
      },
      readOnly: true,
      run: async () => ({ templates: [] }),
    },
  }),
}));
const resolveOrgIdForEmailMock = vi.hoisted(() => vi.fn(async () => null));

vi.mock("../org/context.js", () => ({
  resolveOrgByDomain: vi.fn(async () => null),
  resolveOrgIdForEmail: (
    ...args: Parameters<typeof resolveOrgIdForEmailMock>
  ) => resolveOrgIdForEmailMock(...args),
}));

const embedSessionMocks = vi.hoisted(() => ({
  createEmbedSessionTicket: vi.fn(async ({ targetPath }) => ({
    ticket: "minted-picker-ticket",
    ticketHash: "minted-picker-ticket-hash",
    expiresAt: 1735689600000,
    targetPath,
  })),
  normalizeEmbedTargetPath: vi.fn(
    (raw: string | undefined | null, requestOrigin?: string) => {
      const value = String(raw ?? "").trim();
      if (!value) return null;
      try {
        const url = value.startsWith("/")
          ? new URL(value, requestOrigin ?? "https://mail.agent-native.com")
          : new URL(value);
        if (requestOrigin && url.origin !== new URL(requestOrigin).origin) {
          return null;
        }
        return `${url.pathname}${url.search}${url.hash}`;
      } catch {
        return null;
      }
    },
  ),
}));

vi.mock("../server/embed-session.js", () => ({
  createEmbedSessionTicket: embedSessionMocks.createEmbedSessionTicket,
  normalizeEmbedTargetPath: embedSessionMocks.normalizeEmbedTargetPath,
}));

vi.mock("../server/embed-route.js", () => ({
  buildEmbedStartPath: (ticket: string) =>
    `/_agent-native/embed/start?ticket=${encodeURIComponent(ticket)}`,
}));

const mockOAuthClients = vi.hoisted(() => new Map<string, any>());

vi.mock("./oauth-store.js", () => ({
  MCP_OAUTH_ACCESS_TOKEN_TTL: "30d",
  MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS: 30 * 86400,
  getOAuthClient: vi.fn(async (clientId: string) => {
    return mockOAuthClients.get(clientId) ?? null;
  }),
}));

const { handleMcpRequest } = await import("./server.js");

// --- minimal h3 event doubles -------------------------------------------------

interface MakeEventOpts {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** When true, attach a Node req/res pair (Node fast-path). */
  node?: boolean;
  ip?: string;
}

function makeWebEvent(opts: MakeEventOpts): any {
  const headers: Record<string, string> = {
    host: "mail.agent-native.com",
    "x-forwarded-proto": "https",
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    // A deployed app (non-loopback host) is authenticated — header-only
    // dev-open is loopback-only now (security: a public deploy with no
    // secret must not be impersonable via X-Agent-Native-Owner-Email).
    // Tests that exercise the unauthenticated path override this.
    authorization: "Bearer test-access-token",
    ...(opts.headers ?? {}),
  };
  // h3 v2 web runtime: `event.req` IS the web Request. We hand a real one so
  // buildWebRequest's preferred path is exercised.
  const reqUrl = `https://mail.agent-native.com${opts.path ?? "/"}`;
  const webReq = new Request(reqUrl, {
    method: opts.method ?? "POST",
    headers,
  });
  const event: any = {
    method: opts.method ?? "POST",
    url: { pathname: (opts.path ?? "/").split("?")[0] },
    path: opts.path ?? "/",
    req: webReq,
    // Used by readBody mock + getRequestHeader/getMethod h3 mock.
    _headers: headers,
    _body: opts.body,
    _status: 200,
    _ip: opts.ip,
  };
  if (opts.node) {
    // Node fast-path: a fake req + a capturing res. We only assert the
    // handler routes here (and sets `_handled`) — the SDK Node transport's
    // own behavior is its own concern and unchanged by this fix.
    const chunks: any[] = [];
    event.node = {
      req: {
        method: opts.method ?? "POST",
        url: opts.path ?? "/",
        headers,
        // The SDK Node transport pipes the request via @hono/node-server's
        // getRequestListener; an EventEmitter-ish stub is enough for it to
        // resolve the (pre-parsed) body path without hanging.
        on: () => {},
        once: () => {},
        removeListener: () => {},
        resume: () => {},
        pipe: () => {},
      },
      res: {
        statusCode: 200,
        headersSent: false,
        setHeader: () => {},
        getHeader: () => undefined,
        writeHead: () => {},
        write: (c: any) => {
          chunks.push(c);
          return true;
        },
        end: (c?: any) => {
          if (c) chunks.push(c);
          event.node.res.headersSent = true;
        },
        on: () => {},
        once: () => {},
        emit: () => {},
      },
    };
    event._nodeChunks = chunks;
  }
  return event;
}

// h3 helpers used by server.ts — match how sibling specs mock them.
vi.mock("h3", () => ({
  defineEventHandler: (fn: any) => fn,
  getMethod: (event: any) => event.method ?? "GET",
  getHeader: (event: any, name: string) => event._headers?.[name.toLowerCase()],
  getRequestHeader: (event: any, name: string) =>
    event._headers?.[name.toLowerCase()],
  getRequestIP: (event: any) => event._ip,
  getQuery: (event: any) => event._query ?? {},
  setResponseStatus: (event: any, code: number) => {
    event._status = code;
  },
  setResponseHeader: (event: any, name: string, value: string) => {
    event._responseHeaders ??= {};
    event._responseHeaders[name.toLowerCase()] = value;
  },
}));

vi.mock("../server/h3-helpers.js", () => ({
  readBody: vi.fn(async (event: any) => event._body ?? {}),
}));

// getH3App is only used by mountMCP (not handleMcpRequest); stub it so the
// module import never reaches Nitro internals.
vi.mock("../server/framework-request-handler.js", () => ({
  getH3App: () => ({ use: () => {} }),
}));

// --- test config: one action with a deep-link builder ------------------------

const config = {
  name: "agent-native-mail",
  title: "Agent-Native Mail",
  appId: "mail",
  description: "Mail app",
  websiteUrl: "/mail",
  icons: [
    {
      src: "/agent-native-icon-light.svg",
      mimeType: "image/svg+xml",
      sizes: ["135x78"],
      theme: "light" as const,
    },
  ],
  version: "1.0.0",
  builtinCrossAppTools: false as const,
  actions: {
    "echo-thing": {
      tool: {
        description: "Echo a thing back",
        parameters: {
          type: "object" as const,
          properties: { value: { type: "string" } },
          required: ["value"],
        },
      },
      run: async (args: Record<string, string>) => ({
        echoed: args.value,
        id: "thing-42",
      }),
      readOnly: true,
      link: ({ result }: any) => ({
        label: "Open in Mail",
        view: "thing",
        url: `/_agent-native/open?view=thing&id=${result.id}`,
      }),
      mcpApp: {
        resource: {
          title: "Mail Review",
          description: "Review the echoed thing in an inline MCP App.",
          html: ({ actionName, requestOrigin }: any) =>
            `<!doctype html><html><body><main data-action="${actionName}" data-origin="${requestOrigin}">Mail review</main></body></html>`,
          csp: { connectDomains: ["https://mail.agent-native.com"] },
          prefersBorder: true,
        },
      },
    },
  },
};

const veryLongInternalDescription = "INTERNAL_TOOL_BLOAT_SENTINEL ".repeat(
  1_000,
);
const veryLongMcpAppDescription = "MCP_APP_RESOURCE_BLOAT_SENTINEL ".repeat(
  1_000,
);

async function firstPartyMcpAuthHeaders() {
  process.env.A2A_SECRET = "first-party-mcp-secret";
  const token = await new jose.SignJWT({
    sub: "svc-mcp-client@service.org_123",
    scope: "mcp-connect",
    jti: "jti-first-party-assets",
    org_id: "org_123",
    agent_native_first_party_mcp: true,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setAudience("https://mail.agent-native.com/_agent-native/mcp")
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(process.env.A2A_SECRET));
  return {
    authorization: `Bearer ${token}`,
    "x-agent-native-mcp-full-catalog": "1",
    "x-agent-native-mcp-inline-apps": "1",
  };
}

const compactSurfaceConfig = {
  ...config,
  askAgent: async () => "agent answer",
  actions: {
    ...config.actions,
    "internal-heavy": {
      tool: {
        description: veryLongInternalDescription,
        parameters: {
          type: "object" as const,
          properties: {
            hugePayload: {
              type: "string",
              description: veryLongInternalDescription,
            },
          },
        },
      },
      readOnly: true,
      run: async () => ({ ok: true }),
    },
    "public-search": {
      tool: {
        description: "Search public mail data",
      },
      readOnly: true,
      publicAgent: { expose: true, readOnly: true, requiresAuth: true },
      run: async () => ({ results: [] }),
    },
    "review-draft": {
      tool: {
        description: "Review a draft in the real app",
      },
      run: async () => ({ id: "draft-1", message: "Draft ready" }),
      mcpApp: {
        resource: {
          title: "Draft review",
          description: "Open the draft in Mail.",
          html: "<!doctype html><html><body>Draft</body></html>",
        },
      },
    },
  },
};

const compactSurfaceDefaultConfig = {
  ...compactSurfaceConfig,
  builtinCrossAppTools: true as const,
  actions: {
    ...compactSurfaceConfig.actions,
    "bloated-widget": {
      tool: {
        description: veryLongMcpAppDescription,
        parameters: {
          type: "object" as const,
          properties: {
            hugeWidgetPayload: {
              type: "string",
              description: veryLongMcpAppDescription,
            },
          },
        },
      },
      run: async () => ({ id: "widget-1", message: "Widget ready" }),
      mcpApp: {
        resource: {
          title: "Bloated widget",
          description: veryLongMcpAppDescription,
          html: `<!doctype html><html><body>${veryLongMcpAppDescription}</body></html>`,
        },
      },
    },
  },
};

/**
 * Drive a single JSON-RPC call through the web fallback and return the parsed
 * JSON-RPC response object. Proves the web `Response` path works with no Node
 * runtime present.
 */
async function callWeb(
  rpc: Record<string, unknown>,
  opts: {
    headers?: Record<string, string>;
    config?: Record<string, unknown>;
  } = {},
): Promise<any> {
  const event = makeWebEvent({
    method: "POST",
    body: rpc,
    ...(opts.headers ? { headers: opts.headers } : {}),
  });
  const res = await handleMcpRequest(event, (opts.config ?? config) as any);
  expect(res).toBeInstanceOf(Response);
  const response = res as Response;
  // The SDK web transport returns application/json for request/response when
  // it can satisfy the call without streaming (our handlers resolve
  // synchronously), or an SSE stream otherwise. Handle both so the assertion
  // is about the JSON-RPC payload, not the framing.
  const ct = response.headers.get("content-type") || "";
  const text = await response.text();
  if (ct.includes("text/event-stream")) {
    // Parse the first `data:` line of the SSE frame.
    const line = text
      .split("\n")
      .find((l) => l.startsWith("data:"))
      ?.slice(5)
      .trim();
    return JSON.parse(line as string);
  }
  return JSON.parse(text);
}

async function mcpAppsAuthHeaders(
  options: {
    clientId?: string;
    scope?: string;
  } = {},
) {
  process.env.BETTER_AUTH_SECRET = "oauth-secret";
  const { signMcpOAuthAccessToken } = await import("./oauth-token.js");
  const token = await signMcpOAuthAccessToken({
    ownerEmail: "oauth@example.com",
    clientId: options.clientId ?? "client-123",
    scope: options.scope ?? "mcp:read mcp:write mcp:apps",
    resource: "https://mail.agent-native.com/_agent-native/mcp",
    issuer: "https://mail.agent-native.com",
  });
  return { authorization: `Bearer ${token}` };
}

async function mcpAppsFullCatalogHeaders(
  options: {
    clientId?: string;
    scope?: string;
  } = {},
) {
  return {
    ...(await mcpAppsAuthHeaders(options)),
    "x-agent-native-mcp-full-catalog": "1",
  };
}

describe("handleMcpRequest — web-standard runtime fallback (no Node req/res)", () => {
  beforeEach(() => {
    // A deployed app has a real token; the default makeWebEvent bearer
    // matches it so these runtime-mechanics tests run as an authenticated
    // caller (header-only dev-open is loopback-only — see security note).
    process.env.ACCESS_TOKEN = "test-access-token";
    delete process.env.ACCESS_TOKENS;
    delete process.env.A2A_SECRET;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
    // Inline MCP App embeds are off by default; these tests assert the embed
    // surface, so opt in. The dedicated "off" test below clears this.
    process.env.AGENT_NATIVE_MCP_APPS_INLINE = "1";
    delete process.env.AGENT_NATIVE_MCP_APPS_INLINE_ALLOW_EMAILS;
    mockOAuthClients.clear();
    resolveOrgIdForEmailMock.mockReset();
    resolveOrgIdForEmailMock.mockResolvedValue(null);
  });
  afterEach(() => {
    delete process.env.ACCESS_TOKEN;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
    delete process.env.AGENT_NATIVE_MCP_APPS_INLINE;
    delete process.env.AGENT_NATIVE_MCP_APPS_INLINE_ALLOW_EMAILS;
    mockOAuthClients.clear();
    vi.clearAllMocks();
  });

  it("handles `initialize` without a 501", async () => {
    const out = await callWeb({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "agent-native-connect", version: "1.0.0" },
      },
    });
    expect(out.jsonrpc).toBe("2.0");
    expect(out.id).toBe(1);
    expect(out.error).toBeUndefined();
    expect(out.result.serverInfo.name).toBe("agent-native-mail");
    expect(out.result.serverInfo.title).toBe("Agent-Native Mail");
    expect(out.result.serverInfo.description).toBe("Mail app");
    expect(out.result.serverInfo.websiteUrl).toBe(
      "https://mail.agent-native.com/mail",
    );
    expect(out.result.serverInfo.icons).toEqual([
      {
        src: "https://mail.agent-native.com/agent-native-icon-light.svg",
        mimeType: "image/svg+xml",
        sizes: ["135x78"],
        theme: "light",
      },
    ]);
    expect(out.result.capabilities).toBeDefined();
    expect(out.result.capabilities.resources).toEqual({});
    expect(
      out.result.capabilities.extensions?.["io.modelcontextprotocol/ui"],
    ).toMatchObject({
      mimeTypes: ["text/html;profile=mcp-app"],
    });
  });

  it("resolves MCP server branding URLs under APP_BASE_PATH", async () => {
    process.env.APP_BASE_PATH = "/dispatch";
    const out = await callWeb({
      jsonrpc: "2.0",
      id: 10,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "agent-native-connect", version: "1.0.0" },
      },
    });

    expect(out.error).toBeUndefined();
    expect(out.result.serverInfo.websiteUrl).toBe(
      "https://mail.agent-native.com/dispatch/mail",
    );
    expect(out.result.serverInfo.icons).toEqual([
      {
        src: "https://mail.agent-native.com/dispatch/agent-native-icon-light.svg",
        mimeType: "image/svg+xml",
        sizes: ["135x78"],
        theme: "light",
      },
    ]);
  });

  it("handles `tools/list` and returns the registered action with MCP App metadata", async () => {
    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      },
      { headers: { "x-agent-native-mcp-full-catalog": "1" } },
    );
    expect(out.error).toBeUndefined();
    const names = out.result.tools.map((t: any) => t.name);
    expect(names).toContain("echo-thing");
    const echo = out.result.tools.find((t: any) => t.name === "echo-thing");
    // Actions with a `link` builder advertise the producesOpenLink annotation
    // and a description nudge — identical on both runtimes.
    expect(echo.annotations?.readOnlyHint).toBe(true);
    expect(echo.annotations?.["agent-native/producesOpenLink"]).toBe(true);
    expect(echo.description).toContain("Open in");
    // Anthropic MCP-Apps linkage (Claude.ai / Claude Desktop): the tool→`ui://`
    // resource binding lives on the tool DESCRIPTOR, here and in `_meta.ui`
    // below — NOT on the tools/call result. Hosts read
    // `tool._meta.ui.resourceUri ?? tool._meta["ui/resourceUri"]` from the
    // cached tools/list entry and render that resource when the tool is called
    // (see @modelcontextprotocol/ext-apps app.d.ts `RESOURCE_URI_META_KEY` +
    // host-side example, and spec.types.d.ts `McpUiToolMeta`). `outputTemplate`
    // is the OpenAI/ChatGPT equivalent and is the only one that also rides on
    // the result — MCP Apps has no result-level linkage key.
    expect(echo._meta?.["ui/resourceUri"]).toBe(
      "ui://mail/echo-thing/shell-v64",
    );
    expect(echo._meta?.["openai/outputTemplate"]).toBe(
      "ui://mail/echo-thing/shell-v64",
    );
    expect(echo._meta?.["openai/outputTemplate"]).toBe(
      "ui://mail/echo-thing/shell-v64",
    );
    expect(echo._meta?.["openai/widgetAccessible"]).toBe(true);
    expect(echo._meta?.["openai/widgetCSP"]).toEqual({
      connect_domains: ["https://mail.agent-native.com"],
    });
    expect(echo._meta?.ui).toEqual({
      resourceUri: "ui://mail/echo-thing/shell-v64",
      visibility: ["model", "app"],
    });
    expect(echo._meta?.ui?.csp).toBeUndefined();
    expect(echo._meta?.ui?.permissions).toBeUndefined();
  });

  it("uses a compact tool catalog when the OAuth token has mcp:apps", async () => {
    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 20,
        method: "tools/list",
        params: {},
      },
      {
        headers: await mcpAppsAuthHeaders(),
        config: compactSurfaceConfig,
      },
    );

    expect(out.error).toBeUndefined();
    const names = out.result.tools.map((t: any) => t.name);
    expect(names).toEqual(["echo-thing", "review-draft"]);
    expect(names).not.toContain("internal-heavy");
    expect(names).not.toContain("public-search");
    expect(names).not.toContain("ask-agent");
    expect(JSON.stringify(out)).not.toContain("INTERNAL_TOOL_BLOAT_SENTINEL");
    expect(JSON.stringify(out).length).toBeLessThan(12_000);
  });

  it("defaults MCP Apps hosts to a tiny generic catalog instead of browser-freezing action/resource dumps", async () => {
    const toolsOut = await callWeb(
      {
        jsonrpc: "2.0",
        id: 120,
        method: "tools/list",
        params: {},
      },
      {
        headers: await mcpAppsAuthHeaders(),
        config: compactSurfaceDefaultConfig,
      },
    );

    expect(toolsOut.error).toBeUndefined();
    const names = toolsOut.result.tools.map((t: any) => t.name);
    expect(names).toEqual([
      "list_apps",
      "open_app",
      "ask_app",
      "ask_app_status",
      "create_embed_session",
    ]);
    expect(names).not.toContain("echo-thing");
    expect(names).not.toContain("review-draft");
    expect(names).not.toContain("bloated-widget");
    expect(names).not.toContain("internal-heavy");
    expect(names).not.toContain("create_workspace_app");
    expect(names).not.toContain("list_templates");
    expect(JSON.stringify(toolsOut)).not.toContain(
      "INTERNAL_TOOL_BLOAT_SENTINEL",
    );
    expect(JSON.stringify(toolsOut)).not.toContain(
      "MCP_APP_RESOURCE_BLOAT_SENTINEL",
    );
    expect(JSON.stringify(toolsOut).length).toBeLessThan(12_000);

    const resourcesOut = await callWeb(
      {
        jsonrpc: "2.0",
        id: 121,
        method: "resources/list",
        params: {},
      },
      {
        headers: await mcpAppsAuthHeaders(),
        config: compactSurfaceDefaultConfig,
      },
    );

    expect(resourcesOut.error).toBeUndefined();
    expect(resourcesOut.result.resources.map((r: any) => r.uri)).toEqual([
      "ui://mail/open_app/shell-v64",
    ]);
    expect(JSON.stringify(resourcesOut)).not.toContain(
      "INTERNAL_TOOL_BLOAT_SENTINEL",
    );
    expect(JSON.stringify(resourcesOut)).not.toContain(
      "MCP_APP_RESOURCE_BLOAT_SENTINEL",
    );
    expect(JSON.stringify(resourcesOut).length).toBeLessThan(8_000);

    const templatesOut = await callWeb(
      {
        jsonrpc: "2.0",
        id: 122,
        method: "resources/templates/list",
        params: {},
      },
      {
        headers: await mcpAppsAuthHeaders(),
        config: compactSurfaceDefaultConfig,
      },
    );

    expect(templatesOut.error).toBeUndefined();
    expect(
      templatesOut.result.resourceTemplates.map((r: any) => r.uriTemplate),
    ).toEqual(["ui://mail/open_app/shell-v64"]);
    expect(JSON.stringify(templatesOut)).not.toContain(
      "INTERNAL_TOOL_BLOAT_SENTINEL",
    );
    expect(JSON.stringify(templatesOut)).not.toContain(
      "MCP_APP_RESOURCE_BLOAT_SENTINEL",
    );
    expect(JSON.stringify(templatesOut).length).toBeLessThan(8_000);

    const hiddenRead = await callWeb(
      {
        jsonrpc: "2.0",
        id: 123,
        method: "resources/read",
        params: { uri: "ui://mail/review-draft/shell-v64" },
      },
      {
        headers: await mcpAppsAuthHeaders(),
        config: compactSurfaceDefaultConfig,
      },
    );

    expect(hiddenRead.error?.message).toContain("MCP App resource not found");

    const bloatedResourceRead = await callWeb(
      {
        jsonrpc: "2.0",
        id: 126,
        method: "resources/read",
        params: { uri: "ui://mail/bloated-widget/shell-v64" },
      },
      {
        headers: await mcpAppsAuthHeaders(),
        config: compactSurfaceDefaultConfig,
      },
    );

    expect(bloatedResourceRead.error?.message).toContain(
      "MCP App resource not found",
    );
    expect(JSON.stringify(bloatedResourceRead)).not.toContain(
      "MCP_APP_RESOURCE_BLOAT_SENTINEL",
    );
  });

  it("keeps explicitly opted-in actions in the compact MCP Apps catalog", async () => {
    const optInConfig = {
      ...compactSurfaceDefaultConfig,
      actions: {
        ...compactSurfaceDefaultConfig.actions,
        "status-panel": {
          tool: {
            description: "Open a small status panel",
          },
          readOnly: true,
          run: async () => ({ status: "ok" }),
          mcpApp: {
            compactCatalog: true,
            resource: {
              title: "Status panel",
              html: "<!doctype html><html><body>Status</body></html>",
            },
          },
        },
      },
    };

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 124,
        method: "tools/list",
        params: {},
      },
      {
        headers: await mcpAppsAuthHeaders(),
        config: optInConfig,
      },
    );

    expect(out.error).toBeUndefined();
    const names = out.result.tools.map((t: any) => t.name);
    expect(names).toContain("status-panel");
    expect(names).not.toContain("review-draft");

    const resourcesOut = await callWeb(
      {
        jsonrpc: "2.0",
        id: 125,
        method: "resources/list",
        params: {},
      },
      {
        headers: await mcpAppsAuthHeaders(),
        config: optInConfig,
      },
    );

    expect(resourcesOut.error).toBeUndefined();
    expect(resourcesOut.result.resources.map((r: any) => r.uri)).toEqual([
      "ui://mail/open_app/shell-v64",
      "ui://mail/status-panel/shell-v64",
    ]);
  });

  it("keeps app-defined workspace connector verbs compact while hiding bulky app resources", async () => {
    const dispatchLikeConfig = {
      ...compactSurfaceDefaultConfig,
      actions: {
        ...compactSurfaceDefaultConfig.actions,
        list_apps: {
          tool: {
            description: "List granted workspace apps",
          },
          readOnly: true,
          run: async () => ({ apps: [] }),
        },
        open_app: {
          tool: {
            description: "Open a granted workspace app",
          },
          readOnly: true,
          run: async () => ({
            app: "mail",
            path: "/",
            embedStartUrl: "/_agent-native/embed/start?ticket=dispatch-ticket",
          }),
          mcpApp: {
            resource: {
              title: "Open app",
              description: "Open the granted app inline.",
              html: "<!doctype html><html><body>Open app</body></html>",
            },
          },
        },
        ask_app: {
          tool: {
            description: "Ask a granted workspace app",
          },
          run: async () => ({ response: "ok" }),
        },
        ask_app_status: {
          tool: {
            description: "Poll a granted workspace app ask",
          },
          readOnly: true,
          run: async () => ({ status: "completed", response: "ok" }),
        },
        create_embed_session: {
          tool: {
            description: "Create an embed session",
          },
          readOnly: true,
          run: async () => ({ startUrl: "/_agent-native/embed/start/mock" }),
        },
      },
    };

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 129,
        method: "tools/list",
        params: {},
      },
      {
        headers: await mcpAppsAuthHeaders(),
        config: dispatchLikeConfig,
      },
    );

    expect(out.error).toBeUndefined();
    const names = out.result.tools.map((t: any) => t.name);
    expect(names).toEqual([
      "list_apps",
      "open_app",
      "ask_app",
      "ask_app_status",
      "create_embed_session",
    ]);
    expect(names).not.toContain("bloated-widget");
    expect(JSON.stringify(out)).not.toContain(
      "MCP_APP_RESOURCE_BLOAT_SENTINEL",
    );
    expect(JSON.stringify(out).length).toBeLessThan(12_000);

    const resourcesOut = await callWeb(
      {
        jsonrpc: "2.0",
        id: 130,
        method: "resources/list",
        params: {},
      },
      {
        headers: await mcpAppsAuthHeaders(),
        config: dispatchLikeConfig,
      },
    );

    expect(resourcesOut.error).toBeUndefined();
    expect(resourcesOut.result.resources.map((r: any) => r.uri)).toEqual([
      "ui://mail/open_app/shell-v64",
    ]);
    expect(JSON.stringify(resourcesOut)).not.toContain(
      "MCP_APP_RESOURCE_BLOAT_SENTINEL",
    );
    expect(JSON.stringify(resourcesOut).length).toBeLessThan(8_000);
  });

  it("preserves action-specific MCP App resources when builtins are disabled for app hosts", async () => {
    const fallbackConfig = {
      ...compactSurfaceConfig,
      actions: {
        ...compactSurfaceConfig.actions,
        "private-widget": {
          tool: {
            description: "Open a private widget",
          },
          run: async () => ({ status: "ok" }),
          mcpApp: {
            resource: {
              title: "Private widget",
              description: "Open a private widget.",
              html: "<!doctype html><html><body>Private</body></html>",
            },
          },
        },
      },
    };

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 127,
        method: "tools/list",
        params: {},
      },
      {
        headers: await mcpAppsAuthHeaders(),
        config: fallbackConfig,
      },
    );

    expect(out.error).toBeUndefined();
    expect(out.result.tools.map((t: any) => t.name)).toEqual([
      "echo-thing",
      "review-draft",
      "private-widget",
    ]);
    expect(JSON.stringify(out)).not.toContain("INTERNAL_TOOL_BLOAT_SENTINEL");

    const resourcesOut = await callWeb(
      {
        jsonrpc: "2.0",
        id: 128,
        method: "resources/list",
        params: {},
      },
      {
        headers: await mcpAppsAuthHeaders(),
        config: fallbackConfig,
      },
    );

    expect(resourcesOut.error).toBeUndefined();
    expect(resourcesOut.result.resources.map((r: any) => r.uri)).toEqual([
      "ui://mail/echo-thing/shell-v64",
      "ui://mail/review-draft/shell-v64",
      "ui://mail/private-widget/shell-v64",
    ]);

    const templatesOut = await callWeb(
      {
        jsonrpc: "2.0",
        id: 131,
        method: "resources/templates/list",
        params: {},
      },
      {
        headers: await mcpAppsAuthHeaders(),
        config: fallbackConfig,
      },
    );

    expect(templatesOut.error).toBeUndefined();
    expect(
      templatesOut.result.resourceTemplates.map((r: any) => r.uriTemplate),
    ).toEqual([
      "ui://mail/echo-thing/shell-v64",
      "ui://mail/review-draft/shell-v64",
      "ui://mail/private-widget/shell-v64",
    ]);

    const readOut = await callWeb(
      {
        jsonrpc: "2.0",
        id: 132,
        method: "resources/read",
        params: { uri: "ui://mail/private-widget/shell-v64" },
      },
      {
        headers: await mcpAppsAuthHeaders(),
        config: fallbackConfig,
      },
    );

    expect(readOut.error).toBeUndefined();
    expect(readOut.result.contents).toEqual([
      expect.objectContaining({
        uri: "ui://mail/private-widget/shell-v64",
        text: expect.stringContaining("Private"),
      }),
    ]);
  });

  it("blocks compact MCP Apps callers from invoking hidden tools by name", async () => {
    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 26,
        method: "tools/call",
        params: {
          name: "internal-heavy",
          arguments: {},
        },
      },
      {
        headers: await mcpAppsAuthHeaders(),
        config: compactSurfaceConfig,
      },
    );

    expect(out.error).toBeUndefined();
    expect(out.result.isError).toBe(true);
    expect(out.result.content[0].text).toContain("Unknown tool");
  });

  it("uses the compact catalog for known ChatGPT redirect registrations even when an older token lacks mcp:apps", async () => {
    mockOAuthClients.set("agent-native-oauth-client-generated-hosted-app", {
      clientId: "agent-native-oauth-client-generated-hosted-app",
      clientName: "MCP Apps Host",
      redirectUris: ["https://chatgpt.com/aip/mcp/oauth/callback"],
    });

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 22,
        method: "tools/list",
        params: {},
      },
      {
        headers: await mcpAppsAuthHeaders({
          clientId: "agent-native-oauth-client-generated-hosted-app",
          scope: "mcp:read mcp:write",
        }),
        config: compactSurfaceConfig,
      },
    );

    expect(out.error).toBeUndefined();
    const names = out.result.tools.map((t: any) => t.name);
    expect(names).toEqual(["echo-thing", "review-draft"]);
    expect(names).not.toContain("internal-heavy");
    expect(names).not.toContain("public-search");
    expect(names).not.toContain("ask-agent");
    expect(JSON.stringify(out)).not.toContain("INTERNAL_TOOL_BLOAT_SENTINEL");
    expect(JSON.stringify(out).length).toBeLessThan(12_000);
  });

  it("advertises MCP App resources for known ChatGPT/Claude OAuth registrations even when an older token lacks mcp:apps", async () => {
    mockOAuthClients.set("agent-native-oauth-client-generated-claude", {
      clientId: "agent-native-oauth-client-generated-claude",
      clientName: "Anthropic Claude",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    });

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 23,
        method: "resources/list",
        params: {},
      },
      {
        headers: await mcpAppsAuthHeaders({
          clientId: "agent-native-oauth-client-generated-claude",
          scope: "mcp:read mcp:write",
        }),
        config: compactSurfaceConfig,
      },
    );

    expect(out.error).toBeUndefined();
    expect(out.result.resources.map((r: any) => r.uri)).toEqual([
      "ui://mail/echo-thing/shell-v64",
      "ui://mail/review-draft/shell-v64",
    ]);
  });

  it("uses the compact catalog for generic remote web OAuth clients without mcp:apps", async () => {
    mockOAuthClients.set("agent-native-oauth-client-generated-web-host", {
      clientId: "agent-native-oauth-client-generated-web-host",
      clientName: "Acme Web MCP Host",
      redirectUris: ["https://mcp.example.com/oauth/callback"],
    });

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 25,
        method: "tools/list",
        params: {},
      },
      {
        headers: await mcpAppsAuthHeaders({
          clientId: "agent-native-oauth-client-generated-web-host",
          scope: "mcp:read mcp:write",
        }),
        config: compactSurfaceConfig,
      },
    );

    expect(out.error).toBeUndefined();
    const names = out.result.tools.map((t: any) => t.name);
    expect(names).toEqual(["echo-thing", "review-draft"]);
    expect(names).not.toContain("internal-heavy");
    expect(names).not.toContain("ask-agent");
    expect(JSON.stringify(out)).not.toContain("INTERNAL_TOOL_BLOAT_SENTINEL");
    expect(JSON.stringify(out).length).toBeLessThan(12_000);
  });

  it("uses the compact catalog for unknown standard OAuth clients without mcp:apps", async () => {
    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 27,
        method: "tools/list",
        params: {},
      },
      {
        headers: await mcpAppsAuthHeaders({
          clientId: "agent-native-oauth-client-generated-random",
          scope: "mcp:read mcp:write",
        }),
        config: compactSurfaceConfig,
      },
    );

    expect(out.error).toBeUndefined();
    const names = out.result.tools.map((t: any) => t.name);
    expect(names).toEqual(["echo-thing", "review-draft"]);
    expect(names).not.toContain("internal-heavy");
    expect(names).not.toContain("ask-agent");
    expect(JSON.stringify(out)).not.toContain("INTERNAL_TOOL_BLOAT_SENTINEL");
    expect(JSON.stringify(out).length).toBeLessThan(12_000);
  });

  it("does not treat ChatGPT or Claude Desktop user agents as full-catalog developer clients", async () => {
    for (const userAgent of ["ChatGPT Desktop", "Claude Desktop"]) {
      const out = await callWeb(
        {
          jsonrpc: "2.0",
          id: 270,
          method: "tools/list",
          params: {},
        },
        {
          headers: {
            ...(await mcpAppsAuthHeaders({
              clientId: `agent-native-oauth-client-generated-${userAgent.replace(/\s+/g, "-").toLowerCase()}`,
              scope: "mcp:read mcp:write",
            })),
            "user-agent": userAgent,
          },
          config: compactSurfaceConfig,
        },
      );

      expect(out.error).toBeUndefined();
      expect(out.result.tools.map((t: any) => t.name)).toEqual([
        "echo-thing",
        "review-draft",
      ]);
      expect(JSON.stringify(out)).not.toContain("INTERNAL_TOOL_BLOAT_SENTINEL");
    }
  });

  it("uses the compact catalog for code-oriented OAuth clients unless full catalog is explicit", async () => {
    mockOAuthClients.set("agent-native-oauth-client-generated-claude-code", {
      clientId: "agent-native-oauth-client-generated-claude-code",
      clientName: "Claude Code",
      redirectUris: ["http://127.0.0.1:49152/oauth/callback"],
    });

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 24,
        method: "tools/list",
        params: {},
      },
      {
        headers: await mcpAppsAuthHeaders({
          clientId: "agent-native-oauth-client-generated-claude-code",
          scope: "mcp:read mcp:write",
        }),
        config: compactSurfaceConfig,
      },
    );

    expect(out.error).toBeUndefined();
    const names = out.result.tools.map((t: any) => t.name);
    expect(names).toEqual(["echo-thing", "review-draft"]);
    expect(names).not.toContain("internal-heavy");
    expect(names).not.toContain("ask-agent");
    expect(JSON.stringify(out)).not.toContain("INTERNAL_TOOL_BLOAT_SENTINEL");
  });

  it("uses the compact catalog for authenticated non-OAuth callers by default", async () => {
    const toolsOut = await callWeb(
      {
        jsonrpc: "2.0",
        id: 21,
        method: "tools/list",
        params: {},
      },
      { config: compactSurfaceDefaultConfig },
    );

    expect(toolsOut.error).toBeUndefined();
    const names = toolsOut.result.tools.map((t: any) => t.name);
    expect(names).toEqual([
      "list_apps",
      "open_app",
      "ask_app",
      "ask_app_status",
      "create_embed_session",
    ]);
    expect(names).not.toContain("internal-heavy");
    expect(names).not.toContain("bloated-widget");
    expect(JSON.stringify(toolsOut)).not.toContain(
      "INTERNAL_TOOL_BLOAT_SENTINEL",
    );
    expect(JSON.stringify(toolsOut)).not.toContain(
      "MCP_APP_RESOURCE_BLOAT_SENTINEL",
    );
    expect(JSON.stringify(toolsOut).length).toBeLessThan(12_000);

    const resourcesOut = await callWeb(
      {
        jsonrpc: "2.0",
        id: 28,
        method: "resources/list",
        params: {},
      },
      { config: compactSurfaceDefaultConfig },
    );

    expect(resourcesOut.error).toBeUndefined();
    expect(resourcesOut.result.resources.map((r: any) => r.uri)).toEqual([
      "ui://mail/open_app/shell-v64",
    ]);
    expect(JSON.stringify(resourcesOut)).not.toContain(
      "MCP_APP_RESOURCE_BLOAT_SENTINEL",
    );
    expect(JSON.stringify(resourcesOut).length).toBeLessThan(8_000);
  });

  it("advertises `tool-search` in the compact catalog when it is a registered action", async () => {
    // Regression guard: `tool-search` is a COMPACT_MCP_APP_CATALOG_BUILTINS
    // member, so when a template registers a `tool-search` action it must show
    // up in the default/compact catalog (no full-catalog header). That keeps
    // the small-by-default catalog non-opaque — the agent can always discover
    // every other tool on demand via tool-search.
    const toolSearchConfig = {
      ...compactSurfaceDefaultConfig,
      actions: {
        ...compactSurfaceDefaultConfig.actions,
        "tool-search": {
          tool: {
            description: "Search for and load app tools on demand.",
            parameters: {
              type: "object" as const,
              properties: { query: { type: "string" } },
            },
          },
          readOnly: true,
          run: async () => ({ tools: [] }),
        },
      },
    };

    const toolsOut = await callWeb(
      {
        jsonrpc: "2.0",
        id: 220,
        method: "tools/list",
        params: {},
      },
      // Default/compact caller: no full-catalog header.
      { config: toolSearchConfig },
    );

    expect(toolsOut.error).toBeUndefined();
    const names = toolsOut.result.tools.map((t: any) => t.name);
    expect(names).toContain("tool-search");
    // It rides alongside the core compact builtins, and the bulky internal
    // tools are still excluded by the compact catalog.
    expect(names).toEqual(
      expect.arrayContaining([
        "list_apps",
        "open_app",
        "ask_app",
        "ask_app_status",
        "create_embed_session",
        "tool-search",
      ]),
    );
    expect(names).not.toContain("internal-heavy");
    expect(names).not.toContain("bloated-widget");
  });

  it("keeps the full tool catalog only for explicit code/stdio callers", async () => {
    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 29,
        method: "tools/list",
        params: {},
      },
      {
        headers: {
          "x-agent-native-mcp-client": "agent-native-mcp-proxy",
          "x-agent-native-mcp-full-catalog": "1",
        },
        config: compactSurfaceConfig,
      },
    );

    expect(out.error).toBeUndefined();
    const names = out.result.tools.map((t: any) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["echo-thing", "internal-heavy", "ask-agent"]),
    );
    expect(JSON.stringify(out)).toContain("INTERNAL_TOOL_BLOAT_SENTINEL");
  });

  it("handles `resources/list` and advertises MCP App resources", async () => {
    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "resources/list",
        params: {},
      },
      { headers: await mcpAppsFullCatalogHeaders() },
    );
    expect(out.error).toBeUndefined();
    expect(out.result.resources).toEqual([
      expect.objectContaining({
        uri: "ui://mail/echo-thing/shell-v64",
        name: "echo-thing",
        title: "Mail Review",
        description: "Review the echoed thing in an inline MCP App.",
        mimeType: "text/html;profile=mcp-app",
        _meta: expect.objectContaining({
          ui: {
            csp: {
              connectDomains: ["https://mail.agent-native.com"],
            },
            prefersBorder: true,
          },
          "openai/widgetDescription":
            "Review the echoed thing in an inline MCP App.",
          "openai/widgetDomain": "https://mail.agent-native.com",
          "openai/widgetPrefersBorder": true,
          "openai/widgetCSP": {
            connect_domains: ["https://mail.agent-native.com"],
          },
        }),
      }),
    ]);
    expect(out.result.resources[0]._meta.ui.domain).toBeUndefined();
  });

  it("omits MCP App resources when the inline kill switch is off", async () => {
    delete process.env.AGENT_NATIVE_MCP_APPS_INLINE;
    delete process.env.AGENT_NATIVE_MCP_APPS_INLINE_ALLOW_EMAILS;
    const list = await callWeb(
      { jsonrpc: "2.0", id: 41, method: "resources/list", params: {} },
      { headers: await mcpAppsFullCatalogHeaders() },
    );
    expect(list.error).toBeUndefined();
    expect(list.result.resources).toEqual([]);

    // Tool descriptors must carry no inline-embed reference either, so hosts
    // fall back to the deep-link text instead of trying to render an iframe.
    const tools = await callWeb(
      { jsonrpc: "2.0", id: 42, method: "tools/list", params: {} },
      { headers: await mcpAppsFullCatalogHeaders() },
    );
    expect(JSON.stringify(tools)).not.toContain("openai/outputTemplate");
    expect(JSON.stringify(tools)).not.toContain("ui://mail/");

    // A tool *call* result must not carry the render trigger either.
    const call = await callWeb(
      {
        jsonrpc: "2.0",
        id: 44,
        method: "tools/call",
        params: { name: "echo-thing", arguments: {} },
      },
      { headers: await mcpAppsFullCatalogHeaders() },
    );
    expect(call.error).toBeUndefined();
    expect(JSON.stringify(call)).not.toContain("openai/outputTemplate");
  });

  it("serves MCP App resources when an authenticated first-party caller requests inline apps", async () => {
    delete process.env.AGENT_NATIVE_MCP_APPS_INLINE;
    delete process.env.AGENT_NATIVE_MCP_APPS_INLINE_ALLOW_EMAILS;
    const list = await callWeb(
      { jsonrpc: "2.0", id: 45, method: "resources/list", params: {} },
      { headers: await firstPartyMcpAuthHeaders() },
    );
    expect(list.error).toBeUndefined();
    expect(list.result.resources).toEqual([
      expect.objectContaining({ uri: "ui://mail/echo-thing/shell-v64" }),
    ]);

    const call = await callWeb(
      {
        jsonrpc: "2.0",
        id: 46,
        method: "tools/call",
        params: { name: "echo-thing", arguments: {} },
      },
      { headers: await firstPartyMcpAuthHeaders() },
    );
    expect(call.error).toBeUndefined();
    expect(JSON.stringify(call)).toContain("openai/outputTemplate");
  });

  it("serves inline MCP App resources to allow-listed emails while the global switch is off", async () => {
    delete process.env.AGENT_NATIVE_MCP_APPS_INLINE;
    // The signed test token is owned by oauth@example.com — the bypass lets
    // that account keep verifying inline embeds in prod with the global off.
    process.env.AGENT_NATIVE_MCP_APPS_INLINE_ALLOW_EMAILS =
      "someone@else.com, oauth@example.com";
    const list = await callWeb(
      { jsonrpc: "2.0", id: 43, method: "resources/list", params: {} },
      { headers: await mcpAppsFullCatalogHeaders() },
    );
    expect(list.error).toBeUndefined();
    expect(list.result.resources).toEqual([
      expect.objectContaining({ uri: "ui://mail/echo-thing/shell-v64" }),
    ]);
  });

  it("handles `resources/templates/list` with MCP App templates", async () => {
    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "resources/templates/list",
        params: {},
      },
      { headers: await mcpAppsFullCatalogHeaders() },
    );
    expect(out.error).toBeUndefined();
    expect(out.result.resourceTemplates).toEqual([
      expect.objectContaining({
        uriTemplate: "ui://mail/echo-thing/shell-v64",
        name: "echo-thing",
        title: "Mail Review",
        description: "Review the echoed thing in an inline MCP App.",
        mimeType: "text/html;profile=mcp-app",
      }),
    ]);
  });

  it("handles `resources/read` and returns MCP App HTML", async () => {
    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "resources/read",
        params: { uri: "ui://mail/echo-thing/shell-v64" },
      },
      { headers: await mcpAppsFullCatalogHeaders() },
    );
    expect(out.error).toBeUndefined();
    expect(out.result.contents).toEqual([
      expect.objectContaining({
        uri: "ui://mail/echo-thing/shell-v64",
        mimeType: "text/html;profile=mcp-app",
        text: expect.stringContaining('data-action="echo-thing"'),
        _meta: expect.objectContaining({
          ui: {
            csp: {
              connectDomains: ["https://mail.agent-native.com"],
            },
            prefersBorder: true,
          },
          "openai/widgetCSP": {
            connect_domains: ["https://mail.agent-native.com"],
          },
          "openai/widgetDescription":
            "Review the echoed thing in an inline MCP App.",
          "openai/widgetDomain": "https://mail.agent-native.com",
          "openai/widgetPrefersBorder": true,
        }),
      }),
    ]);
    expect(out.result.contents[0].text).toContain(
      'data-origin="https://mail.agent-native.com"',
    );
    expect(out.result.contents[0]._meta.ui.domain).toBeUndefined();
  });

  it("resolves function-valued MCP App CSP across tools and resources", async () => {
    const dynamicCspCalls: any[] = [];
    const dynamicCspConfig = {
      ...config,
      actions: {
        "dynamic-review": {
          tool: {
            description: "Review with dynamic CSP",
          },
          run: async () => ({ ok: true }),
          mcpApp: {
            resource: {
              title: "Dynamic review",
              html: "<!doctype html><html><body>Dynamic</body></html>",
              csp: async (ctx: any) => {
                dynamicCspCalls.push(ctx);
                return {
                  connectDomains: ["$requestOrigin", "https://api.example.com"],
                  resourceDomains: ["https://cdn.example.com"],
                  frameDomains: ["https://frame.example.com"],
                  baseUriDomains: ["https://base.example.com"],
                };
              },
            },
          },
        },
      },
    };

    const tools = await callWeb(
      {
        jsonrpc: "2.0",
        id: 34,
        method: "tools/list",
        params: {},
      },
      { headers: await mcpAppsFullCatalogHeaders(), config: dynamicCspConfig },
    );
    const tool = tools.result.tools.find(
      (t: any) => t.name === "dynamic-review",
    );
    expect(tool._meta["openai/widgetCSP"]).toEqual({
      connect_domains: [
        "https://mail.agent-native.com",
        "https://api.example.com",
      ],
      resource_domains: ["https://cdn.example.com"],
      frame_domains: ["https://frame.example.com"],
    });

    const list = await callWeb(
      {
        jsonrpc: "2.0",
        id: 35,
        method: "resources/list",
        params: {},
      },
      { headers: await mcpAppsFullCatalogHeaders(), config: dynamicCspConfig },
    );
    expect(list.result.resources[0]._meta.ui.csp).toEqual({
      connectDomains: [
        "https://mail.agent-native.com",
        "https://api.example.com",
      ],
      resourceDomains: ["https://cdn.example.com"],
      frameDomains: ["https://frame.example.com"],
      baseUriDomains: ["https://base.example.com"],
    });

    const templates = await callWeb(
      {
        jsonrpc: "2.0",
        id: 36,
        method: "resources/templates/list",
        params: {},
      },
      { headers: await mcpAppsFullCatalogHeaders(), config: dynamicCspConfig },
    );
    expect(templates.result.resourceTemplates[0]._meta.ui.csp).toEqual(
      list.result.resources[0]._meta.ui.csp,
    );

    const read = await callWeb(
      {
        jsonrpc: "2.0",
        id: 37,
        method: "resources/read",
        params: { uri: "ui://mail/dynamic-review/shell-v64" },
      },
      { headers: await mcpAppsFullCatalogHeaders(), config: dynamicCspConfig },
    );
    expect(read.result.contents[0]._meta.ui.csp).toEqual(
      list.result.resources[0]._meta.ui.csp,
    );

    const call = await callWeb(
      {
        jsonrpc: "2.0",
        id: 38,
        method: "tools/call",
        params: { name: "dynamic-review", arguments: {} },
      },
      { headers: await mcpAppsFullCatalogHeaders(), config: dynamicCspConfig },
    );
    expect(call.result._meta["openai/widgetCSP"]).toEqual(
      tool._meta["openai/widgetCSP"],
    );
    expect(dynamicCspCalls).toEqual(
      expect.arrayContaining([
        {
          actionName: "dynamic-review",
          appId: "mail",
          requestOrigin: "https://mail.agent-native.com",
        },
      ]),
    );
  });

  it("isolates MCP App CSP builder failures to the affected resource", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resourceFailure = new Error("csp store offline");
    const failingCspConfig = {
      ...config,
      actions: {
        "broken-review": {
          tool: {
            description: "Broken review",
          },
          run: async () => ({ ok: true }),
          mcpApp: {
            resource: {
              title: "Broken review",
              html: "<!doctype html><html><body>Broken</body></html>",
              csp: async () => {
                throw resourceFailure;
              },
            },
          },
        },
        "healthy-review": {
          tool: {
            description: "Healthy review",
          },
          run: async () => ({ ok: true }),
          mcpApp: {
            resource: {
              title: "Healthy review",
              html: "<!doctype html><html><body>Healthy</body></html>",
              csp: {
                connectDomains: ["https://healthy.example.com"],
              },
            },
          },
        },
        "plain-success": {
          tool: {
            description: "Plain success",
          },
          run: async () => true,
        },
      },
    };

    try {
      const tools = await callWeb(
        {
          jsonrpc: "2.0",
          id: 39,
          method: "tools/list",
          params: {},
        },
        {
          headers: await mcpAppsFullCatalogHeaders(),
          config: failingCspConfig,
        },
      );
      expect(tools.error).toBeUndefined();
      const brokenTool = tools.result.tools.find(
        (tool: any) => tool.name === "broken-review",
      );
      const healthyTool = tools.result.tools.find(
        (tool: any) => tool.name === "healthy-review",
      );
      expect(brokenTool._meta?.["openai/outputTemplate"]).toBeUndefined();
      expect(healthyTool._meta["openai/outputTemplate"]).toBe(
        "ui://mail/healthy-review/shell-v64",
      );

      const brokenCall = await callWeb(
        {
          jsonrpc: "2.0",
          id: 40,
          method: "tools/call",
          params: { name: "broken-review", arguments: {} },
        },
        {
          headers: await mcpAppsFullCatalogHeaders(),
          config: failingCspConfig,
        },
      );
      expect(brokenCall.error).toBeUndefined();
      expect(brokenCall.result.content[0].text).toBe(
        "broken-review completed.",
      );
      expect(
        brokenCall.result._meta?.["openai/outputTemplate"],
      ).toBeUndefined();

      const plainSuccessCall = await callWeb(
        {
          jsonrpc: "2.0",
          id: 401,
          method: "tools/call",
          params: { name: "plain-success", arguments: {} },
        },
        {
          headers: await mcpAppsFullCatalogHeaders(),
          config: failingCspConfig,
        },
      );
      expect(plainSuccessCall.error).toBeUndefined();
      expect(plainSuccessCall.result.content[0].text).toBe(
        "plain-success completed.",
      );

      const resources = await callWeb(
        {
          jsonrpc: "2.0",
          id: 41,
          method: "resources/list",
          params: {},
        },
        {
          headers: await mcpAppsFullCatalogHeaders(),
          config: failingCspConfig,
        },
      );
      expect(resources.error).toBeUndefined();
      expect(
        resources.result.resources.map((resource: any) => resource.uri),
      ).toEqual(["ui://mail/healthy-review/shell-v64"]);

      const templates = await callWeb(
        {
          jsonrpc: "2.0",
          id: 42,
          method: "resources/templates/list",
          params: {},
        },
        {
          headers: await mcpAppsFullCatalogHeaders(),
          config: failingCspConfig,
        },
      );
      expect(templates.error).toBeUndefined();
      expect(
        templates.result.resourceTemplates.map(
          (template: any) => template.uriTemplate,
        ),
      ).toEqual(["ui://mail/healthy-review/shell-v64"]);

      const warnCallsBeforeRead = warn.mock.calls.length;
      const read = await callWeb(
        {
          jsonrpc: "2.0",
          id: 43,
          method: "resources/read",
          params: { uri: "ui://mail/healthy-review/shell-v64" },
        },
        {
          headers: await mcpAppsFullCatalogHeaders(),
          config: failingCspConfig,
        },
      );
      expect(read.error).toBeUndefined();
      expect(read.result.contents[0]).toEqual(
        expect.objectContaining({
          uri: "ui://mail/healthy-review/shell-v64",
          text: expect.stringContaining("Healthy"),
        }),
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('"broken-review"'),
        resourceFailure,
      );
      expect(warn).toHaveBeenCalledTimes(warnCallsBeforeRead);
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps legacy unversioned MCP App resource reads working", async () => {
    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 16,
        method: "resources/read",
        params: { uri: "ui://mail/echo-thing" },
      },
      { headers: await mcpAppsFullCatalogHeaders() },
    );

    expect(out.error).toBeUndefined();
    expect(out.result.contents).toEqual([
      expect.objectContaining({
        uri: "ui://mail/echo-thing",
        mimeType: "text/html;profile=mcp-app",
        text: expect.stringContaining('data-action="echo-thing"'),
      }),
    ]);
  });

  it("keeps older shell-version MCP App resource reads working after cache busts", async () => {
    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 17,
        method: "resources/read",
        params: { uri: "ui://mail/echo-thing/shell-v29" },
      },
      { headers: await mcpAppsFullCatalogHeaders() },
    );

    expect(out.error).toBeUndefined();
    expect(out.result.contents).toEqual([
      expect.objectContaining({
        uri: "ui://mail/echo-thing/shell-v29",
        mimeType: "text/html;profile=mcp-app",
        text: expect.stringContaining('data-action="echo-thing"'),
      }),
    ]);
  });

  it("cache-busts custom MCP App resource URIs and keeps legacy reads working", async () => {
    const customResourceConfig = {
      ...config,
      actions: {
        "custom-review": {
          tool: {
            description: "Review with a custom resource URI",
          },
          run: async () => ({ ok: true }),
          mcpApp: {
            resource: {
              uri: "ui://mail/custom-review",
              title: "Custom review",
              html: "<!doctype html><html><body>Custom review</body></html>",
            },
          },
        },
      },
    };

    const list = await callWeb(
      {
        jsonrpc: "2.0",
        id: 28,
        method: "resources/list",
        params: {},
      },
      {
        headers: await mcpAppsFullCatalogHeaders(),
        config: customResourceConfig,
      },
    );

    expect(list.error).toBeUndefined();
    expect(list.result.resources).toEqual([
      expect.objectContaining({
        uri: "ui://mail/custom-review/shell-v64",
        name: "custom-review",
      }),
    ]);

    const read = await callWeb(
      {
        jsonrpc: "2.0",
        id: 29,
        method: "resources/read",
        params: { uri: "ui://mail/custom-review" },
      },
      {
        headers: await mcpAppsFullCatalogHeaders(),
        config: customResourceConfig,
      },
    );

    expect(read.error).toBeUndefined();
    expect(read.result.contents).toEqual([
      expect.objectContaining({
        uri: "ui://mail/custom-review",
        text: expect.stringContaining("Custom review"),
      }),
    ]);
  });

  it("upgrades older custom MCP App shell-version suffixes", async () => {
    const customResourceConfig = {
      ...config,
      actions: {
        "custom-review": {
          tool: {
            description: "Review with an older custom resource URI",
          },
          run: async () => ({ ok: true }),
          mcpApp: {
            resource: {
              uri: "ui://mail/custom-review/shell-v4",
              title: "Custom review",
              html: "<!doctype html><html><body>Custom review</body></html>",
            },
          },
        },
      },
    };

    const list = await callWeb(
      {
        jsonrpc: "2.0",
        id: 30,
        method: "resources/list",
        params: {},
      },
      {
        headers: await mcpAppsFullCatalogHeaders(),
        config: customResourceConfig,
      },
    );

    expect(list.error).toBeUndefined();
    expect(list.result.resources).toEqual([
      expect.objectContaining({
        uri: "ui://mail/custom-review/shell-v64",
        name: "custom-review",
      }),
    ]);

    const legacyRead = await callWeb(
      {
        jsonrpc: "2.0",
        id: 31,
        method: "resources/read",
        params: { uri: "ui://mail/custom-review/shell-v4" },
      },
      {
        headers: await mcpAppsFullCatalogHeaders(),
        config: customResourceConfig,
      },
    );

    expect(legacyRead.error).toBeUndefined();
    expect(legacyRead.result.contents).toEqual([
      expect.objectContaining({
        uri: "ui://mail/custom-review/shell-v4",
        text: expect.stringContaining("Custom review"),
      }),
    ]);
  });

  it("cache-busts custom MCP App resource URI paths before query strings and fragments", async () => {
    const customResourceConfig = {
      ...config,
      actions: {
        "custom-review": {
          tool: {
            description: "Review with a custom resource URI",
          },
          run: async () => ({ ok: true }),
          mcpApp: {
            resource: {
              uri: "ui://mail/custom-review?mode=compact#preview",
              title: "Custom review",
              html: "<!doctype html><html><body>Custom review</body></html>",
            },
          },
        },
      },
    };

    const list = await callWeb(
      {
        jsonrpc: "2.0",
        id: 32,
        method: "resources/list",
        params: {},
      },
      {
        headers: await mcpAppsFullCatalogHeaders(),
        config: customResourceConfig,
      },
    );

    expect(list.error).toBeUndefined();
    expect(list.result.resources).toEqual([
      expect.objectContaining({
        uri: "ui://mail/custom-review/shell-v64?mode=compact#preview",
        name: "custom-review",
      }),
    ]);

    const legacyRead = await callWeb(
      {
        jsonrpc: "2.0",
        id: 33,
        method: "resources/read",
        params: { uri: "ui://mail/custom-review?mode=compact#preview" },
      },
      {
        headers: await mcpAppsFullCatalogHeaders(),
        config: customResourceConfig,
      },
    );

    expect(legacyRead.error).toBeUndefined();
    expect(legacyRead.result.contents).toEqual([
      expect.objectContaining({
        uri: "ui://mail/custom-review?mode=compact#preview",
        text: expect.stringContaining("Custom review"),
      }),
    ]);
  });

  it("handles `tools/call` and appends the deep-link block + `_meta`", async () => {
    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "echo-thing", arguments: { value: "hello" } },
      },
      { headers: { "x-agent-native-mcp-full-catalog": "1" } },
    );
    expect(out.error).toBeUndefined();
    const content = out.result.content;
    // First block: concise model-visible status; the full app opens through
    // metadata/structuredContent instead of dumping app data into chat.
    expect(content[0].type).toBe("text");
    expect(content[0].text).toBe("echo-thing completed for thing-42.");
    // Second block: the appended markdown deep link, absolutized to the
    // request origin derived from the inbound Host header.
    expect(content[1].text).toContain(
      "[Open in Mail →](https://mail.agent-native.com/_agent-native/open?view=thing&id=thing-42&agentSidebar=closed)",
    );
    // Structured `_meta` so a desktop client can open it natively.
    expect(out.result._meta["agent-native/openLink"]).toMatchObject({
      label: "Open in Mail",
      view: "thing",
      webUrl:
        "https://mail.agent-native.com/_agent-native/open?view=thing&id=thing-42&agentSidebar=closed",
    });
    expect(out.result._meta["openai/outputTemplate"]).toBe(
      "ui://mail/echo-thing/shell-v64",
    );
    expect(out.result._meta["openai/widgetCSP"]).toEqual({
      connect_domains: ["https://mail.agent-native.com"],
    });
    // The tools/call RESULT deliberately carries NO `_meta.ui` resource
    // linkage. MCP Apps (ext-apps 1.7.2) binds the `ui://` window on the tool
    // DESCRIPTOR (`_meta.ui.resourceUri`, asserted in the tools/list test
    // above); `ui/notifications/tool-result` delivers a plain CallToolResult,
    // so Claude.ai / Claude Desktop render inline from the descriptor binding
    // regardless of the result `_meta`. `openai/outputTemplate` above is the
    // ChatGPT-only result key. Do NOT add a result-level `ui` /
    // `io.modelcontextprotocol/ui` key here — no such linkage exists in the
    // spec and hosts ignore it.
    expect(out.result._meta.ui).toBeUndefined();
    expect(out.result.structuredContent).toMatchObject({
      echoed: "hello",
      id: "thing-42",
      openLink: {
        label: "Open in Mail",
      },
    });
    const openLink = out.result._meta["agent-native/openLink"] as Record<
      string,
      string
    >;
    expect(openLink.desktopUrl).toContain("view=thing&id=thing-42");
    expect(new URL(openLink.vscodeUrl).searchParams.get("url")).toBe(
      openLink.webUrl,
    );
  });

  it("runs `tools/call` with org scope resolved from the verified token email", async () => {
    resolveOrgIdForEmailMock.mockResolvedValue("org-from-email");
    const scopedConfig = {
      ...config,
      actions: {
        "whoami-scope": {
          tool: {
            description: "Return the request context visible to the action",
            parameters: { type: "object" as const, properties: {} },
          },
          readOnly: true,
          run: async () => {
            const { getRequestOrgId, getRequestUserEmail } =
              await import("../server/request-context.js");
            return {
              userEmail: getRequestUserEmail(),
              orgId: getRequestOrgId() ?? null,
            };
          },
          mcpApp: {
            resource: {
              title: "Scope probe",
              html: "<!doctype html><html><body>Scope</body></html>",
            },
          },
        },
      },
    };

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 301,
        method: "tools/call",
        params: { name: "whoami-scope", arguments: {} },
      },
      {
        headers: await mcpAppsFullCatalogHeaders(),
        config: scopedConfig,
      },
    );

    expect(out.error).toBeUndefined();
    expect(out.result.structuredContent).toMatchObject({
      userEmail: "oauth@example.com",
      orgId: "org-from-email",
    });
    expect(resolveOrgIdForEmailMock).toHaveBeenCalledWith("oauth@example.com");
  });

  it("preserves MCP action-result errors as errored tools/call responses", async () => {
    const errorConfig = {
      ...config,
      actions: {
        "proxy-fail": {
          tool: {
            description: "Proxy an upstream MCP tool",
            parameters: { type: "object" as const, properties: {} },
          },
          run: async () => ({
            [MCP_ACTION_RESULT_MARKER]: true,
            text: "Error calling MCP tool mcp__x__fail: boom",
            raw: {
              isError: true,
              content: [
                {
                  type: "text",
                  text: "Error calling MCP tool mcp__x__fail: boom",
                },
              ],
            },
            serverId: "x",
            toolName: "mcp__x__fail",
            originalToolName: "fail",
            input: {},
          }),
        },
      },
    };

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 31,
        method: "tools/call",
        params: { name: "proxy-fail", arguments: {} },
      },
      {
        headers: { "x-agent-native-mcp-full-catalog": "1" },
        config: errorConfig,
      },
    );

    expect(out.error).toBeUndefined();
    expect(out.result.isError).toBe(true);
    expect(out.result.content).toEqual([
      {
        type: "text",
        text: "Error calling MCP tool mcp__x__fail: boom",
      },
    ]);
  });

  it("adds hidden open-link metadata for MCP App embed start URLs", async () => {
    const embedConfig = {
      ...config,
      actions: {
        "open-app-embed": {
          tool: {
            description: "Open a full app embed",
          },
          run: async () => ({
            app: "mail",
            path: "/inbox",
            url: "/_agent-native/embed/start?ticket=test-ticket",
            embedStartUrl: "/_agent-native/embed/start?ticket=test-ticket",
            deepLinkUrl: "/inbox",
            embed: true,
          }),
          readOnly: true,
          mcpApp: {
            resource: {
              title: "Open app",
              description: "Open the full app inline.",
              html: "<!doctype html><html><body>Open app</body></html>",
            },
          },
        },
      },
    };

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 34,
        method: "tools/call",
        params: { name: "open-app-embed", arguments: {} },
      },
      {
        headers: { "x-agent-native-mcp-full-catalog": "1" },
        config: embedConfig,
      },
    );

    expect(out.error).toBeUndefined();
    expect(out.result.content).toEqual([
      { type: "text", text: "open-app-embed completed." },
    ]);
    expect(JSON.stringify(out.result.content)).not.toContain("test-ticket");
    expect(out.result._meta["agent-native/openLink"]).toMatchObject({
      label: "Open mail",
      view: "/inbox",
      webUrl: "https://mail.agent-native.com/inbox",
      desktopUrl:
        "agentnative://open?app=mail&view=&to=%2Finbox&agentSidebar=closed",
    });
    expect(
      new URL(
        (out.result._meta["agent-native/openLink"] as Record<string, string>)
          .vscodeUrl,
      ).searchParams.get("url"),
    ).toBe("https://mail.agent-native.com/inbox");
    expect(out.result._meta["agent-native/embedStart"]).toMatchObject({
      startUrl:
        "https://mail.agent-native.com/_agent-native/embed/start?ticket=test-ticket&__an_mcp_chat_bridge=1",
    });
    expect(
      JSON.stringify(out.result._meta["agent-native/openLink"]),
    ).not.toContain("test-ticket");
    expect(out.result.structuredContent).toMatchObject({
      app: "mail",
      path: "/inbox",
      openLink: {
        webUrl: "https://mail.agent-native.com/inbox",
      },
    });
    expect(JSON.stringify(out.result.structuredContent)).not.toContain(
      "test-ticket",
    );
  });

  it("mints hidden embed-session metadata for same-origin MCP App path results", async () => {
    const embedConfig = {
      ...config,
      actions: {
        "open-picker": {
          tool: {
            description: "Open the asset picker inline",
          },
          run: async () => ({
            app: "assets",
            path: "/picker?mediaType=image&prompt=cat",
            url: "/picker?mediaType=image&prompt=cat",
            embed: true,
            message: "Assets picker ready.",
          }),
          readOnly: true,
          mcpApp: {
            resource: {
              title: "Asset picker",
              description: "Choose an image asset inline.",
              html: "<!doctype html><html><body>Picker</body></html>",
            },
          },
        },
      },
    };

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 134,
        method: "tools/call",
        params: { name: "open-picker", arguments: {} },
      },
      {
        headers: await mcpAppsFullCatalogHeaders(),
        config: embedConfig,
      },
    );

    expect(out.error).toBeUndefined();
    expect(embedSessionMocks.normalizeEmbedTargetPath).toHaveBeenCalledWith(
      "/picker?mediaType=image&prompt=cat&__an_mcp_chat_bridge=1",
      "https://mail.agent-native.com",
    );
    expect(embedSessionMocks.createEmbedSessionTicket).toHaveBeenCalledWith({
      ownerEmail: "oauth@example.com",
      orgId: undefined,
      targetPath: "/picker?mediaType=image&prompt=cat&__an_mcp_chat_bridge=1",
      scope: null,
    });
    expect(out.result.content).toEqual([
      { type: "text", text: "Assets picker ready." },
    ]);
    expect(out.result._meta["agent-native/embedStart"]).toMatchObject({
      startUrl:
        "https://mail.agent-native.com/_agent-native/embed/start?ticket=minted-picker-ticket&__an_mcp_chat_bridge=1",
      expiresAt: 1735689600000,
    });
    expect(out.result._meta["agent-native/openLink"]).toMatchObject({
      label: "Open assets",
      view: "/picker?mediaType=image&prompt=cat",
      webUrl: "https://mail.agent-native.com/picker?mediaType=image&prompt=cat",
    });
    expect(out.result.structuredContent).toMatchObject({
      app: "assets",
      path: "/picker?mediaType=image&prompt=cat",
      url: "/picker?mediaType=image&prompt=cat",
      embed: true,
      message: "Assets picker ready.",
    });
    expect(JSON.stringify(out.result.content)).not.toContain(
      "minted-picker-ticket",
    );
    expect(JSON.stringify(out.result.structuredContent)).not.toContain(
      "minted-picker-ticket",
    );
    expect(out.result.structuredContent.embedStartUrl).toBeUndefined();
    expect(out.result.structuredContent.embedTargetPath).toBeUndefined();
    expect(out.result.structuredContent.embedExpiresAt).toBeUndefined();
  });

  it("keeps embed-only start URLs hidden without exposing them as open links", async () => {
    const embedConfig = {
      ...config,
      actions: {
        "open-embed-only": {
          tool: {
            description: "Open an embed-only app",
          },
          run: async () => ({
            app: "mail",
            embedStartUrl: "/_agent-native/embed/start?ticket=only-ticket",
          }),
          readOnly: true,
          mcpApp: {
            resource: {
              title: "Open embed-only app",
              description: "Open the full app inline.",
              html: "<!doctype html><html><body>Open app</body></html>",
            },
          },
        },
      },
    };

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 35,
        method: "tools/call",
        params: { name: "open-embed-only", arguments: {} },
      },
      {
        headers: { "x-agent-native-mcp-full-catalog": "1" },
        config: embedConfig,
      },
    );

    expect(out.error).toBeUndefined();
    expect(out.result._meta["agent-native/openLink"]).toBeUndefined();
    expect(out.result._meta["agent-native/embedStart"]).toMatchObject({
      startUrl:
        "https://mail.agent-native.com/_agent-native/embed/start?ticket=only-ticket&__an_mcp_chat_bridge=1",
    });
    expect(JSON.stringify(out.result.content)).not.toContain("only-ticket");
    expect(JSON.stringify(out.result.structuredContent)).not.toContain(
      "only-ticket",
    );
    expect(out.result.structuredContent.openLink).toBeUndefined();
  });

  it("keeps url-only embed start URLs hidden without exposing them as open links", async () => {
    const embedConfig = {
      ...config,
      actions: {
        "open-url-only-embed": {
          tool: {
            description: "Open an embed-only app through url",
          },
          run: async () => ({
            app: "mail",
            embed: true,
            url: "/_agent-native/embed/start?ticket=url-only-ticket",
          }),
          readOnly: true,
          mcpApp: {
            resource: {
              title: "Open url-only embed app",
              description: "Open the full app inline.",
              html: "<!doctype html><html><body>Open app</body></html>",
            },
          },
        },
      },
    };

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 135,
        method: "tools/call",
        params: { name: "open-url-only-embed", arguments: {} },
      },
      {
        headers: { "x-agent-native-mcp-full-catalog": "1" },
        config: embedConfig,
      },
    );

    expect(out.error).toBeUndefined();
    expect(out.result._meta["agent-native/openLink"]).toBeUndefined();
    expect(out.result._meta["agent-native/embedStart"]).toMatchObject({
      startUrl:
        "https://mail.agent-native.com/_agent-native/embed/start?ticket=url-only-ticket&__an_mcp_chat_bridge=1",
    });
    expect(JSON.stringify(out.result.content)).not.toContain("url-only-ticket");
    expect(JSON.stringify(out.result.structuredContent)).not.toContain(
      "url-only-ticket",
    );
    expect(out.result.structuredContent.openLink).toBeUndefined();
    expect(out.result.structuredContent.url).toBeUndefined();
  });

  it("uses a durable root open link for root-path embed starts", async () => {
    const embedConfig = {
      ...config,
      actions: {
        "open-root-embed": {
          tool: {
            description: "Open a root-path embed-only app",
          },
          run: async () => ({
            app: "dispatch",
            path: "/",
            embed: true,
            embedStartUrl: "/_agent-native/embed/start?ticket=root-ticket",
          }),
          readOnly: true,
          mcpApp: {
            resource: {
              title: "Open root app",
              description: "Open the full app inline.",
              html: "<!doctype html><html><body>Open app</body></html>",
            },
          },
        },
      },
    };

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 36,
        method: "tools/call",
        params: { name: "open-root-embed", arguments: {} },
      },
      {
        headers: { "x-agent-native-mcp-full-catalog": "1" },
        config: embedConfig,
      },
    );

    expect(out.error).toBeUndefined();
    expect(out.result._meta["agent-native/openLink"]).toMatchObject({
      label: "Open dispatch",
      view: "/",
      webUrl: "https://mail.agent-native.com/",
      desktopUrl:
        "agentnative://open?app=dispatch&view=&to=%2F&agentSidebar=closed",
    });
    expect(out.result._meta["agent-native/embedStart"]).toMatchObject({
      startUrl:
        "https://mail.agent-native.com/_agent-native/embed/start?ticket=root-ticket&__an_mcp_chat_bridge=1",
    });
    expect(JSON.stringify(out.result.content)).not.toContain("root-ticket");
    expect(JSON.stringify(out.result.structuredContent)).not.toContain(
      "root-ticket",
    );
    expect(out.result.structuredContent.openLink).toMatchObject({
      webUrl: "https://mail.agent-native.com/",
    });
    expect(out.result.structuredContent.url).toBe(
      "https://mail.agent-native.com/",
    );
  });

  it("redacts embed-ticket URLs from JSON.stringify text for actions without mcpApp.resource", async () => {
    // Regression: even when an action does NOT declare `mcpApp.resource`, a
    // result containing `embedStartUrl` (or any string holding a
    // /_agent-native/embed/start?ticket=… URL) must NEVER leak into the
    // model-visible `content[0].text`. The mcpApp.resource path strips embed
    // fields via mcpAppStructuredContent; the JSON.stringify fallback now
    // applies the same purge as a generic safety net.
    const noResourceConfig = {
      ...config,
      actions: {
        "raw-embed": {
          tool: {
            description: "Return an embed URL without declaring a resource",
          },
          run: async () => ({
            embedStartUrl: "/_agent-native/embed/start?ticket=raw-leak-ticket",
            label: "should still appear",
          }),
          readOnly: true,
        },
      },
    };

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 200,
        method: "tools/call",
        params: { name: "raw-embed", arguments: {} },
      },
      {
        headers: { "x-agent-native-mcp-full-catalog": "1" },
        config: noResourceConfig,
      },
    );

    expect(out.error).toBeUndefined();
    expect(out.result.content).toHaveLength(1);
    const text = out.result.content[0].text;
    expect(text).not.toContain("raw-leak-ticket");
    expect(text).not.toContain("/_agent-native/embed/start");
    expect(text).not.toContain("embedStartUrl");
    // Non-sensitive fields are still visible.
    expect(text).toContain("should still appear");
  });

  it("redacts embed-ticket URLs from string-typed results without mcpApp.resource", async () => {
    // Sibling regression: when the action returns a raw string that happens to
    // include the embed-start URL inline, that substring must be hidden too —
    // the LLM should never receive a usable embed-ticket URL.
    const noResourceConfig = {
      ...config,
      actions: {
        "raw-embed-string": {
          tool: {
            description: "Return an embed URL inside a string",
          },
          run: async () =>
            "Open this: /_agent-native/embed/start?ticket=string-leak",
          readOnly: true,
        },
      },
    };

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 201,
        method: "tools/call",
        params: { name: "raw-embed-string", arguments: {} },
      },
      {
        headers: { "x-agent-native-mcp-full-catalog": "1" },
        config: noResourceConfig,
      },
    );

    expect(out.error).toBeUndefined();
    expect(out.result.content[0].text).not.toContain("string-leak");
    expect(out.result.content[0].text).not.toContain(
      "/_agent-native/embed/start",
    );
    expect(out.result.content[0].text).toContain("[hidden embed URL]");
  });

  it("surfaces app-only-visibility tool results via structuredContent so the embed iframe can read them", async () => {
    // Regression: PR #875's `purgeEmbedStartUrls` strips the embed start URL
    // from non-MCP-App action text — but `create_embed_session` is an
    // **app-only** helper called by the embed iframe, and the iframe needs
    // the `startUrl` to actually mount the app. Without surfacing the raw
    // result through `structuredContent` (which the iframe prefers in
    // `parseToolResult`), the iframe falls back to parsing the purged text
    // and reports "This app can be opened, but not embedded". The
    // `_meta.ui.visibility: ["app"]` hint already tells compliant hosts not
    // to leak the result into LLM context, so the structuredContent path is
    // safe for these tools and unbreaks the embed.
    const embedConfig = {
      ...config,
      actions: {
        create_embed_session: {
          tool: {
            description: "Create an embed session",
            _meta: { ui: { visibility: ["app"] } },
          },
          run: async () => ({
            startUrl: "/_agent-native/embed/start?ticket=embed-session-ticket",
            targetPath: "/inbox",
            expiresAt: 1735689600,
          }),
        },
      },
    };

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 160,
        method: "tools/call",
        params: { name: "create_embed_session", arguments: {} },
      },
      {
        headers: { "x-agent-native-mcp-full-catalog": "1" },
        config: embedConfig,
      },
    );

    expect(out.error).toBeUndefined();
    // Iframe-readable: full raw result preserved on structuredContent so
    // `parseToolResult` (in `embed-app.ts`) returns `startUrl` and the
    // iframe can actually mount the embedded app.
    expect(out.result.structuredContent).toMatchObject({
      startUrl: "/_agent-native/embed/start?ticket=embed-session-ticket",
      targetPath: "/inbox",
      expiresAt: 1735689600,
    });
    // Text content is still purged of the embed-start URL so non-compliant
    // hosts that ignore the `visibility: ["app"]` hint don't leak the
    // ticket via the chat transcript or text fallback.
    expect(out.result.content[0].text).not.toContain("embed-session-ticket");
  });

  it("does NOT surface raw result via structuredContent for model-visible (non-app-only) tools", async () => {
    // Counter-regression: only `visibility: ["app"]` tools get the raw
    // structuredContent escape hatch. Tools the LLM can call must continue
    // to go through the normal text + purge path so embed-start URLs and
    // other internal fields stay hidden from the model.
    const embedConfig = {
      ...config,
      actions: {
        "model-callable-helper": {
          tool: {
            description: "A normal model-visible tool",
            // No `visibility` hint = model + app visible.
          },
          run: async () => ({
            startUrl: "/_agent-native/embed/start?ticket=should-be-hidden",
            payload: "ok",
          }),
        },
      },
    };

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 161,
        method: "tools/call",
        params: { name: "model-callable-helper", arguments: {} },
      },
      {
        headers: { "x-agent-native-mcp-full-catalog": "1" },
        config: embedConfig,
      },
    );

    expect(out.error).toBeUndefined();
    expect(out.result.structuredContent).toBeUndefined();
    expect(out.result.content[0].text).not.toContain("should-be-hidden");
  });

  it("surfaces sanitized structured payloads for model-visible read-only tools", async () => {
    const readConfig = {
      ...config,
      actions: {
        "read-detail": {
          tool: { description: "Read a detail record" },
          http: { method: "GET" as const },
          readOnly: true,
          run: async () => ({
            id: "record-42",
            status: "failed",
            message: "The request failed",
            url: "/_agent-native/embed/start?ticket=must-not-leak",
            ticket: "top-level-ticket-must-not-leak",
            embedTargetPath: "/private/thread/42",
            embedExpiresAt: 1735689600,
            uploadTicket: "nested-upload-ticket-must-not-leak",
            steps: [
              {
                kind: "network",
                status: 404,
                details: {
                  ticket: "nested-ticket-must-not-leak",
                  embedTargetPath: "/private/nested",
                  safe: "keep this detail",
                },
              },
            ],
          }),
        },
      },
    };

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 162,
        method: "tools/call",
        params: { name: "read-detail", arguments: {} },
      },
      {
        headers: { "x-agent-native-mcp-full-catalog": "1" },
        config: readConfig,
      },
    );

    expect(out.error).toBeUndefined();
    expect(out.result.structuredContent).toEqual({
      id: "record-42",
      status: "failed",
      message: "The request failed",
      steps: [
        {
          kind: "network",
          status: 404,
          details: { safe: "keep this detail" },
        },
      ],
    });
    expect(out.result.content[0].text).toContain('"record-42"');
    expect(out.result.content[0].text).not.toContain("must-not-leak");
    expect(out.result.content[0].text).not.toContain("top-level-ticket");
    expect(out.result.content[0].text).not.toContain("nested-ticket");
    expect(out.result.content[0].text).not.toContain("private/thread/42");
  });

  it("preserves ordinary ticket fields on unrelated read-only payloads", async () => {
    const readConfig = {
      ...config,
      actions: {
        "read-business-record": {
          tool: { description: "Read a business record" },
          http: { method: "GET" as const },
          readOnly: true,
          run: async () => ({
            id: "order-42",
            ticket: "customer-support-ticket-42",
            receiptTicket: "receipt-ticket-42",
            nested: { ticket: "nested-business-ticket-42" },
          }),
        },
      },
    };

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 163,
        method: "tools/call",
        params: { name: "read-business-record", arguments: {} },
      },
      {
        headers: { "x-agent-native-mcp-full-catalog": "1" },
        config: readConfig,
      },
    );

    expect(out.error).toBeUndefined();
    expect(out.result.structuredContent).toEqual({
      id: "order-42",
      ticket: "customer-support-ticket-42",
      receiptTicket: "receipt-ticket-42",
      nested: { ticket: "nested-business-ticket-42" },
    });
    expect(out.result.content[0].text).toContain("customer-support-ticket-42");
  });

  it("sanitizes ticket fields across read-only array siblings when one item carries embed routing", async () => {
    const readConfig = {
      ...config,
      actions: {
        "read-array": {
          tool: { description: "Read records" },
          http: { method: "GET" as const },
          readOnly: true,
          run: async () => [
            { id: "business-record", ticket: "sibling-ticket-must-not-leak" },
            {
              embedTargetPath: "/private/thread/42",
              safe: "keep this record",
            },
          ],
        },
      },
    };

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 164,
        method: "tools/call",
        params: { name: "read-array", arguments: {} },
      },
      {
        headers: { "x-agent-native-mcp-full-catalog": "1" },
        config: readConfig,
      },
    );

    expect(out.error).toBeUndefined();
    expect(out.result.structuredContent).toEqual({
      items: [{ id: "business-record" }, { safe: "keep this record" }],
    });
    expect(JSON.stringify(out.result.content)).not.toContain(
      "sibling-ticket-must-not-leak",
    );
  });

  it("preserves top-level read-only arrays in structuredContent", async () => {
    const readConfig = {
      ...config,
      actions: {
        "list-records": {
          tool: { description: "List records" },
          http: { method: "GET" as const },
          readOnly: true,
          run: async () => [
            { id: "record-1", status: "ready" },
            { id: "record-2", status: "failed" },
          ],
        },
      },
    };

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 165,
        method: "tools/call",
        params: { name: "list-records", arguments: {} },
      },
      {
        headers: { "x-agent-native-mcp-full-catalog": "1" },
        config: readConfig,
      },
    );

    expect(out.error).toBeUndefined();
    expect(out.result.structuredContent).toEqual({
      items: [
        { id: "record-1", status: "ready" },
        { id: "record-2", status: "failed" },
      ],
    });
    expect(out.result.content[0].text).toContain('"record-1"');
  });

  it("propagates embed sanitization to credential siblings", async () => {
    const readConfig = {
      ...config,
      actions: {
        "read-nested-embed-record": {
          tool: { description: "Read a nested embed record" },
          http: { method: "GET" as const },
          readOnly: true,
          run: async () => ({
            id: "record-with-nested-embed",
            ticket: "sibling-ticket-must-not-leak",
            details: {
              embedTargetPath: "/private/thread/42",
              safe: "keep this detail",
            },
          }),
        },
      },
    };

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 164,
        method: "tools/call",
        params: { name: "read-nested-embed-record", arguments: {} },
      },
      {
        headers: { "x-agent-native-mcp-full-catalog": "1" },
        config: readConfig,
      },
    );

    expect(out.error).toBeUndefined();
    expect(out.result.structuredContent).toEqual({
      id: "record-with-nested-embed",
      details: { safe: "keep this detail" },
    });
    expect(out.result.content[0].text).not.toContain(
      "sibling-ticket-must-not-leak",
    );
  });

  it("strips embedTargetPath, embedExpiresAt, and ticket fields from structuredContent", async () => {
    // Regression: internal embed-routing fields are carried in
    // `_meta["agent-native/embedStart"]` for the embed runtime. They must NOT
    // double-up in `structuredContent` (read by the LLM), where
    // `embedTargetPath` would reveal the exact route + thread/draft id the
    // user is looking at, `embedExpiresAt` would leak a timestamp, and
    // `ticket`/`*Ticket` would surface single-use credentials.
    const embedConfig = {
      ...config,
      actions: {
        "open-thread": {
          tool: {
            description: "Open a specific mail thread inline",
          },
          run: async () => ({
            app: "mail",
            // `embedTargetPath` carries the exact route + thread id the
            // user is viewing. It belongs in `_meta` (embed runtime) and
            // MUST be stripped from structuredContent / text content.
            embedStartUrl:
              "/_agent-native/embed/start?ticket=open-thread-ticket",
            embedTargetPath: "/inbox?threadId=embedded-thread-id-123",
            embedExpiresAt: 1735689600,
            ticket: "open-thread-ticket",
            embedTicket: "open-thread-ticket",
            uploadTicket: "secret-upload-token",
          }),
          readOnly: true,
          mcpApp: {
            resource: {
              title: "Open thread",
              description: "Open the thread inline.",
              html: "<!doctype html><html><body>Thread</body></html>",
            },
          },
        },
      },
    };

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 202,
        method: "tools/call",
        params: { name: "open-thread", arguments: {} },
      },
      {
        headers: { "x-agent-native-mcp-full-catalog": "1" },
        config: embedConfig,
      },
    );

    expect(out.error).toBeUndefined();
    const sc = out.result.structuredContent;
    expect(sc.embedStartUrl).toBeUndefined();
    expect(sc.embedTargetPath).toBeUndefined();
    expect(sc.embedExpiresAt).toBeUndefined();
    expect(sc.ticket).toBeUndefined();
    expect(sc.embedTicket).toBeUndefined();
    expect(sc.uploadTicket).toBeUndefined();
    // Make sure none of those sensitive strings leak into the JSON
    // representation of structuredContent either.
    const scJson = JSON.stringify(sc);
    expect(scJson).not.toContain("open-thread-ticket");
    expect(scJson).not.toContain("embedded-thread-id-123");
    expect(scJson).not.toContain("1735689600");
    expect(scJson).not.toContain("secret-upload-token");
    // The _meta carrier is the legitimate home for the embed URL.
    expect(out.result._meta["agent-native/embedStart"].startUrl).toContain(
      "open-thread-ticket",
    );
    // The content text payload also stays clean (the embed routing fields
    // would otherwise round-trip through conciseMcpAppToolText).
    expect(JSON.stringify(out.result.content)).not.toContain(
      "open-thread-ticket",
    );
    expect(JSON.stringify(out.result.content)).not.toContain(
      "embedded-thread-id-123",
    );
  });

  it("omits openLink when the only available 'view' is a bare name, not a route path", async () => {
    // Regression: previously `safeViewOpenUrl = view` would turn a view name
    // like "deck" into `${origin}/deck`, which 404s for apps that route
    // `view: "deck"` at `/deck/:id`. The fix omits `openLink` entirely when
    // there's no real path-like URL to open; the embedStart meta still
    // carries the embed reference, so the host can launch the app inline
    // without a bogus open URL.
    const embedConfig = {
      ...config,
      actions: {
        "open-deck-by-name": {
          tool: {
            description: "Open a slides deck via embed only",
          },
          run: async () => ({
            app: "slides",
            view: "deck",
            embedStartUrl: "/_agent-native/embed/start?ticket=deck-name-ticket",
          }),
          readOnly: true,
          mcpApp: {
            resource: {
              title: "Open deck",
              description: "Open the deck inline.",
              html: "<!doctype html><html><body>Deck</body></html>",
            },
          },
        },
      },
    };

    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 203,
        method: "tools/call",
        params: { name: "open-deck-by-name", arguments: {} },
      },
      {
        headers: { "x-agent-native-mcp-full-catalog": "1" },
        config: embedConfig,
      },
    );

    expect(out.error).toBeUndefined();
    // openLink must be absent — there is no real path to open.
    expect(out.result._meta["agent-native/openLink"]).toBeUndefined();
    expect(out.result.structuredContent.openLink).toBeUndefined();
    // The embedStart meta still carries the reference to launch the app.
    expect(out.result._meta["agent-native/embedStart"]).toMatchObject({
      startUrl:
        "https://mail.agent-native.com/_agent-native/embed/start?ticket=deck-name-ticket&__an_mcp_chat_bridge=1",
    });
    // No fabricated origin-relative URL leaks into the response.
    expect(JSON.stringify(out.result.content)).not.toContain(
      "https://mail.agent-native.com/deck",
    );
    expect(JSON.stringify(out.result.structuredContent)).not.toContain(
      "https://mail.agent-native.com/deck",
    );
  });

  it("preserves route query params in embed desktop open links", async () => {
    const embedConfig = {
      ...config,
      actions: {
        "open-thread-route": {
          tool: { description: "Open a thread route inline" },
          run: async () => ({
            app: "mail",
            view: "inbox",
            url: "/inbox?threadId=abc123&filter=unread",
            embed: true,
            embedStartUrl:
              "/_agent-native/embed/start?ticket=thread-route-ticket",
          }),
          readOnly: true,
          mcpApp: {
            resource: {
              title: "Open thread",
              description: "Open the thread inline.",
              html: "<!doctype html><html><body>Thread</body></html>",
            },
          },
        },
        "open-route-with-params": {
          tool: { description: "Open a route with side params" },
          run: async () => ({
            app: "calendar",
            path: "/agenda",
            url: "/agenda",
            params: { eventId: "evt-1", date: "2026-05-23" },
            embed: true,
            embedStartUrl: "/_agent-native/embed/start?ticket=agenda-ticket",
          }),
          readOnly: true,
          mcpApp: {
            resource: {
              title: "Open agenda",
              description: "Open the agenda inline.",
              html: "<!doctype html><html><body>Agenda</body></html>",
            },
          },
        },
      },
    };

    const routeOut = await callWeb(
      {
        jsonrpc: "2.0",
        id: 50,
        method: "tools/call",
        params: { name: "open-thread-route", arguments: {} },
      },
      {
        headers: { "x-agent-native-mcp-full-catalog": "1" },
        config: embedConfig,
      },
    );
    expect(routeOut.result._meta["agent-native/openLink"]).toMatchObject({
      webUrl:
        "https://mail.agent-native.com/inbox?threadId=abc123&filter=unread",
      desktopUrl:
        "agentnative://open?app=mail&view=inbox&to=%2Finbox%3FthreadId%3Dabc123%26filter%3Dunread&agentSidebar=closed",
    });

    const paramsOut = await callWeb(
      {
        jsonrpc: "2.0",
        id: 51,
        method: "tools/call",
        params: { name: "open-route-with-params", arguments: {} },
      },
      {
        headers: { "x-agent-native-mcp-full-catalog": "1" },
        config: embedConfig,
      },
    );
    expect(paramsOut.result._meta["agent-native/openLink"]).toMatchObject({
      webUrl: "https://mail.agent-native.com/agenda",
      desktopUrl:
        "agentnative://open?app=calendar&view=&to=%2Fagenda&eventId=evt-1&date=2026-05-23&agentSidebar=closed",
    });
  });

  it("rejects unauthenticated calls with 401 when auth IS configured (no 501)", async () => {
    process.env.ACCESS_TOKEN = "secret-token";
    const event = makeWebEvent({
      method: "POST",
      body: { jsonrpc: "2.0", id: 9, method: "tools/list", params: {} },
      headers: { authorization: "Bearer wrong" },
    });
    const res = await handleMcpRequest(event, config as any);
    expect(event._status).toBe(401);
    expect(event._responseHeaders?.["www-authenticate"]).toContain(
      'resource_metadata="https://mail.agent-native.com/.well-known/oauth-protected-resource"',
    );
    expect(event._responseHeaders?.["www-authenticate"]).toContain(
      'scope="mcp:read mcp:write mcp:apps offline_access"',
    );
    // The legacy `error` field is preserved, plus an actionable message and the
    // exact remediation (connect command + authorize/metadata/MCP URLs).
    expect(res).toMatchObject({
      error: "Unauthorized",
      authenticate: {
        command:
          "npx -y @agent-native/core@latest reconnect https://mail.agent-native.com",
        firstTimeCommand:
          "npx @agent-native/core@latest connect https://mail.agent-native.com",
        authorizeUrl:
          "https://mail.agent-native.com/_agent-native/mcp/oauth/authorize",
        resourceMetadataUrl:
          "https://mail.agent-native.com/.well-known/oauth-protected-resource",
        mcpUrl: "https://mail.agent-native.com/_agent-native/mcp",
      },
    });
    expect((res as any).message).toContain(
      "npx -y @agent-native/core@latest reconnect https://mail.agent-native.com",
    );
  });

  it("uses forwarded host for tunneled OAuth challenges instead of opening dev mode", async () => {
    delete process.env.ACCESS_TOKEN;
    delete process.env.ACCESS_TOKENS;
    delete process.env.A2A_SECRET;
    process.env.APP_BASE_PATH = "/assets";

    const event = makeWebEvent({
      method: "POST",
      ip: "127.0.0.1",
      body: { jsonrpc: "2.0", id: 10, method: "tools/list", params: {} },
      headers: {
        authorization: "",
        host: "127.0.0.1:8100",
        "x-forwarded-host": "assets-local.trycloudflare.com",
        "x-forwarded-proto": "https",
      },
    });
    const res = await handleMcpRequest(event, config as any);

    expect(event._status).toBe(401);
    expect(event._responseHeaders?.["www-authenticate"]).toContain(
      'resource_metadata="https://assets-local.trycloudflare.com/assets/.well-known/oauth-protected-resource"',
    );
    // The actionable body uses the forwarded host + base path for the connect
    // command and authorize/metadata URLs.
    expect(res).toMatchObject({
      error: "Unauthorized",
      authenticate: {
        command:
          "npx -y @agent-native/core@latest reconnect https://assets-local.trycloudflare.com/assets",
        firstTimeCommand:
          "npx @agent-native/core@latest connect https://assets-local.trycloudflare.com/assets",
        authorizeUrl:
          "https://assets-local.trycloudflare.com/assets/_agent-native/mcp/oauth/authorize",
        resourceMetadataUrl:
          "https://assets-local.trycloudflare.com/assets/.well-known/oauth-protected-resource",
        mcpUrl:
          "https://assets-local.trycloudflare.com/assets/_agent-native/mcp",
      },
    });
  });

  it("returns 204 for DELETE on the web runtime (stateless, unchanged)", async () => {
    process.env.ACCESS_TOKEN = "secret-token";
    const event = makeWebEvent({
      method: "DELETE",
      headers: { authorization: "Bearer secret-token" },
    });
    const res = await handleMcpRequest(event, config as any);
    expect(event._status).toBe(204);
    expect(res).toBe("");
  });

  it("returns 405 for an unsupported method", async () => {
    const event = makeWebEvent({ method: "PUT" });
    const res = await handleMcpRequest(event, config as any);
    expect(event._status).toBe(405);
    expect(res).toEqual({ error: "Method not allowed" });
  });

  it("returns 405 for GET (no standalone SSE stream on a stateless serverless server)", async () => {
    // A stateless, per-request transport on serverless cannot keep the GET
    // server->client SSE stream alive across invocations; offering it makes the
    // client latch onto a stream that dies ("session expired"/"not connected").
    // Answering 405 tells the client to use plain POST request/response.
    const event = makeWebEvent({ method: "GET" });
    const res = await handleMcpRequest(event, config as any);
    expect(event._status).toBe(405);
    expect(res).toEqual({ error: "Method not allowed" });
  });

  it("returns tools/call results as JSON, not an SSE stream (serverless-safe framing)", async () => {
    // enableJsonResponse: true — the result is computed and returned inside the
    // request lifecycle. With the SDK default (SSE), a serverless instance can
    // freeze right after returning the streaming Response, before the result
    // event flushes, so the client never receives it and reports "session
    // expired". JSON framing is what makes tools/call actually complete.
    const event = makeWebEvent({
      method: "POST",
      body: {
        jsonrpc: "2.0",
        id: 314,
        method: "tools/call",
        params: { name: "echo-thing", arguments: { value: "hello" } },
      },
      headers: { "x-agent-native-mcp-full-catalog": "1" },
    });
    const res = await handleMcpRequest(event, config as any);
    expect(res).toBeInstanceOf(Response);
    const response = res as Response;
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-type")).not.toContain(
      "text/event-stream",
    );
    const body = JSON.parse(await response.text());
    expect(body.error).toBeUndefined();
    expect(body.result.content[0].text).toBe(
      "echo-thing completed for thing-42.",
    );
  });

  it("falls through (undefined) for sub-routes so management routes handle them", async () => {
    const event = makeWebEvent({ method: "POST", path: "/connect" });
    const res = await handleMcpRequest(event, config as any);
    expect(res).toBeUndefined();
  });
});

describe("handleMcpRequest — Node request objects use the web transport by default", () => {
  beforeEach(() => {
    // Authenticated deployed-app caller (default makeWebEvent bearer matches);
    // header-only dev-open is loopback-only now.
    process.env.ACCESS_TOKEN = "test-access-token";
    delete process.env.ACCESS_TOKENS;
    delete process.env.A2A_SECRET;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.AGENT_NATIVE_MCP_NODE_FAST_PATH;
  });
  afterEach(() => {
    delete process.env.ACCESS_TOKEN;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.AGENT_NATIVE_MCP_NODE_FAST_PATH;
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("returns a Web Response even when a Node req/res pair is present", async () => {
    const sdkMod =
      await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
    const webMod =
      await import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");
    const handleRequestSpy = vi
      .spyOn(
        sdkMod.StreamableHTTPServerTransport.prototype as any,
        "handleRequest",
      )
      .mockImplementation(async function (
        this: any,
        nodeReq: any,
        nodeRes: any,
        body: any,
      ) {
        // Record what the handler delegated so we can assert on it.
        (globalThis as any).__nodeDelegation = { nodeReq, nodeRes, body };
        nodeRes.end?.('{"jsonrpc":"2.0","id":1,"result":{}}');
      });
    const webHandleSpy = vi.spyOn(
      webMod.WebStandardStreamableHTTPServerTransport.prototype as any,
      "handleRequest",
    );

    const rpc = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "c", version: "1" },
      },
    };
    const event = makeWebEvent({ method: "POST", node: true, body: rpc });
    const res = await handleMcpRequest(event, config as any);

    expect(res).toBeInstanceOf(Response);
    expect(event._handled).toBeUndefined();
    expect(handleRequestSpy).not.toHaveBeenCalled();
    expect(webHandleSpy).toHaveBeenCalledTimes(1);

    delete (globalThis as any).__nodeDelegation;
  });

  it("keeps the SDK Node transport available behind an explicit escape hatch", async () => {
    process.env.AGENT_NATIVE_MCP_NODE_FAST_PATH = "1";
    const sdkMod =
      await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
    const webMod =
      await import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");
    const handleRequestSpy = vi
      .spyOn(
        sdkMod.StreamableHTTPServerTransport.prototype as any,
        "handleRequest",
      )
      .mockImplementation(async function (
        this: any,
        nodeReq: any,
        nodeRes: any,
        body: any,
      ) {
        (globalThis as any).__nodeDelegation = { nodeReq, nodeRes, body };
        nodeRes.end?.('{"jsonrpc":"2.0","id":1,"result":{}}');
      });
    const webHandleSpy = vi.spyOn(
      webMod.WebStandardStreamableHTTPServerTransport.prototype as any,
      "handleRequest",
    );

    const rpc = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "c", version: "1" },
      },
    };
    const event = makeWebEvent({ method: "POST", node: true, body: rpc });
    const res = await handleMcpRequest(event, config as any);

    expect(res).toBeUndefined();
    expect(event._handled).toBe(true);
    expect(handleRequestSpy).toHaveBeenCalledTimes(1);
    const delegated = (globalThis as any).__nodeDelegation;
    expect(delegated.nodeReq).toBe(event.node.req);
    expect(delegated.nodeRes).toBe(event.node.res);
    expect(delegated.body).toEqual(rpc);
    expect(webHandleSpy).not.toHaveBeenCalled();

    delete (globalThis as any).__nodeDelegation;
  });
});
