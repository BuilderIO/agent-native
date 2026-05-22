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

// Heavy/irrelevant deps mocked so importing build-server.ts is cheap. The
// MCP SDK itself is REAL — that's the whole point of these tests.
vi.mock("./builtin-tools.js", () => ({
  getBuiltinCrossAppTools: () => ({}),
}));
vi.mock("../org/context.js", () => ({
  resolveOrgByDomain: vi.fn(async () => null),
}));

const mockOAuthClients = vi.hoisted(() => new Map<string, any>());

vi.mock("./oauth-store.js", () => ({
  MCP_OAUTH_ACCESS_TOKEN_TTL: "1h",
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
  appId: "mail",
  description: "Mail app",
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

describe("handleMcpRequest — web-standard runtime fallback (no Node req/res)", () => {
  beforeEach(() => {
    // A deployed app has a real token; the default makeWebEvent bearer
    // matches it so these runtime-mechanics tests run as an authenticated
    // caller (header-only dev-open is loopback-only — see security note).
    process.env.ACCESS_TOKEN = "test-access-token";
    delete process.env.ACCESS_TOKENS;
    delete process.env.A2A_SECRET;
    delete process.env.BETTER_AUTH_SECRET;
    mockOAuthClients.clear();
  });
  afterEach(() => {
    delete process.env.ACCESS_TOKEN;
    delete process.env.BETTER_AUTH_SECRET;
    mockOAuthClients.clear();
    vi.clearAllMocks();
  });

  it("handles `initialize` without a 501", async () => {
    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "agent-native-connect", version: "1.0.0" },
        },
      },
      { headers: await mcpAppsAuthHeaders() },
    );
    expect(out.jsonrpc).toBe("2.0");
    expect(out.id).toBe(1);
    expect(out.error).toBeUndefined();
    expect(out.result.serverInfo.name).toBe("agent-native-mail");
    expect(out.result.capabilities).toBeDefined();
    expect(out.result.capabilities.resources).toEqual({});
    expect(
      out.result.capabilities.extensions?.["io.modelcontextprotocol/ui"],
    ).toMatchObject({
      mimeTypes: ["text/html;profile=mcp-app"],
    });
  });

  it("handles `tools/list` and returns the registered action with MCP App metadata", async () => {
    const out = await callWeb({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(out.error).toBeUndefined();
    const names = out.result.tools.map((t: any) => t.name);
    expect(names).toContain("echo-thing");
    const echo = out.result.tools.find((t: any) => t.name === "echo-thing");
    // Actions with a `link` builder advertise the producesOpenLink annotation
    // and a description nudge — identical on both runtimes.
    expect(echo.annotations?.readOnlyHint).toBe(true);
    expect(echo.annotations?.["agent-native/producesOpenLink"]).toBe(true);
    expect(echo.description).toContain("Open in");
    expect(echo._meta?.["ui/resourceUri"]).toBe(
      "ui://mail/echo-thing/shell-v24",
    );
    expect(echo._meta?.["openai/outputTemplate"]).toBe(
      "ui://mail/echo-thing/shell-v24",
    );
    expect(echo._meta?.["openai/widgetAccessible"]).toBe(true);
    expect(echo._meta?.["openai/widgetCSP"]).toEqual({
      connect_domains: ["https://mail.agent-native.com"],
    });
    expect(echo._meta?.ui).toEqual({
      csp: {
        connectDomains: ["https://mail.agent-native.com"],
      },
      prefersBorder: true,
      resourceUri: "ui://mail/echo-thing/shell-v24",
      visibility: ["model", "app"],
    });
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
    expect(names).toEqual(
      expect.arrayContaining(["echo-thing", "review-draft"]),
    );
    expect(names).not.toContain("internal-heavy");
    expect(names).not.toContain("public-search");
    expect(names).not.toContain("ask-agent");
    expect(JSON.stringify(out)).not.toContain("INTERNAL_TOOL_BLOAT_SENTINEL");
    expect(JSON.stringify(out).length).toBeLessThan(12_000);
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
    expect(names).toEqual(
      expect.arrayContaining(["echo-thing", "review-draft"]),
    );
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
    expect(out.result.resources.map((r: any) => r.uri)).toEqual(
      expect.arrayContaining([
        "ui://mail/echo-thing/shell-v24",
        "ui://mail/review-draft/shell-v24",
      ]),
    );
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
    expect(names).toEqual(
      expect.arrayContaining(["echo-thing", "review-draft"]),
    );
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
    expect(names).toEqual(
      expect.arrayContaining(["echo-thing", "review-draft"]),
    );
    expect(names).not.toContain("internal-heavy");
    expect(names).not.toContain("ask-agent");
    expect(JSON.stringify(out)).not.toContain("INTERNAL_TOOL_BLOAT_SENTINEL");
    expect(JSON.stringify(out).length).toBeLessThan(12_000);
  });

  it("keeps the full catalog for code-oriented OAuth clients without mcp:apps", async () => {
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
    expect(names).toEqual(
      expect.arrayContaining(["echo-thing", "internal-heavy", "ask-agent"]),
    );
  });

  it("keeps the full tool catalog for non-OAuth callers without mcp:apps", async () => {
    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 21,
        method: "tools/list",
        params: {},
      },
      { config: compactSurfaceConfig },
    );

    expect(out.error).toBeUndefined();
    const names = out.result.tools.map((t: any) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["echo-thing", "internal-heavy", "ask-agent"]),
    );
  });

  it("handles `resources/list` and advertises MCP App resources", async () => {
    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "resources/list",
        params: {},
      },
      { headers: await mcpAppsAuthHeaders() },
    );
    expect(out.error).toBeUndefined();
    expect(out.result.resources).toEqual([
      expect.objectContaining({
        uri: "ui://mail/echo-thing/shell-v24",
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
          "openai/widgetPrefersBorder": true,
          "openai/widgetCSP": {
            connect_domains: ["https://mail.agent-native.com"],
          },
        }),
      }),
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
      { headers: await mcpAppsAuthHeaders() },
    );
    expect(out.error).toBeUndefined();
    expect(out.result.resourceTemplates).toEqual([
      expect.objectContaining({
        uriTemplate: "ui://mail/echo-thing/shell-v24",
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
        params: { uri: "ui://mail/echo-thing/shell-v24" },
      },
      { headers: await mcpAppsAuthHeaders() },
    );
    expect(out.error).toBeUndefined();
    expect(out.result.contents).toEqual([
      expect.objectContaining({
        uri: "ui://mail/echo-thing/shell-v24",
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
          "openai/widgetPrefersBorder": true,
        }),
      }),
    ]);
    expect(out.result.contents[0].text).toContain(
      'data-origin="https://mail.agent-native.com"',
    );
  });

  it("keeps legacy unversioned MCP App resource reads working", async () => {
    const out = await callWeb(
      {
        jsonrpc: "2.0",
        id: 16,
        method: "resources/read",
        params: { uri: "ui://mail/echo-thing" },
      },
      { headers: await mcpAppsAuthHeaders() },
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
      { headers: await mcpAppsAuthHeaders(), config: customResourceConfig },
    );

    expect(list.error).toBeUndefined();
    expect(list.result.resources).toEqual([
      expect.objectContaining({
        uri: "ui://mail/custom-review/shell-v24",
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
      { headers: await mcpAppsAuthHeaders(), config: customResourceConfig },
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
      { headers: await mcpAppsAuthHeaders(), config: customResourceConfig },
    );

    expect(list.error).toBeUndefined();
    expect(list.result.resources).toEqual([
      expect.objectContaining({
        uri: "ui://mail/custom-review/shell-v24",
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
      { headers: await mcpAppsAuthHeaders(), config: customResourceConfig },
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
      { headers: await mcpAppsAuthHeaders(), config: customResourceConfig },
    );

    expect(list.error).toBeUndefined();
    expect(list.result.resources).toEqual([
      expect.objectContaining({
        uri: "ui://mail/custom-review/shell-v24?mode=compact#preview",
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
      { headers: await mcpAppsAuthHeaders(), config: customResourceConfig },
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
    const out = await callWeb({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "echo-thing", arguments: { value: "hello" } },
    });
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
      "ui://mail/echo-thing/shell-v24",
    );
    expect(out.result._meta["openai/widgetCSP"]).toEqual({
      connect_domains: ["https://mail.agent-native.com"],
    });
    expect(out.result._meta.ui).toMatchObject({
      csp: {
        connectDomains: ["https://mail.agent-native.com"],
      },
      prefersBorder: true,
    });
    expect(out.result.structuredContent).toMatchObject({
      echoed: "hello",
      id: "thing-42",
      openLink: {
        label: "Open in Mail",
      },
    });
    expect(out.result._meta["agent-native/openLink"].desktopUrl).toContain(
      "view=thing&id=thing-42",
    );
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
      { config: embedConfig },
    );

    expect(out.error).toBeUndefined();
    expect(out.result.content).toEqual([
      { type: "text", text: "open-app-embed completed." },
    ]);
    expect(JSON.stringify(out.result.content)).not.toContain("test-ticket");
    expect(out.result._meta["agent-native/openLink"]).toMatchObject({
      label: "Open mail",
      view: "/inbox",
      webUrl:
        "https://mail.agent-native.com/_agent-native/embed/start?ticket=test-ticket&__an_mcp_chat_bridge=1",
      desktopUrl: "https://mail.agent-native.com/inbox",
    });
    expect(out.result.structuredContent).toMatchObject({
      url: "/_agent-native/embed/start?ticket=test-ticket",
      openLink: {
        webUrl:
          "https://mail.agent-native.com/_agent-native/embed/start?ticket=test-ticket&__an_mcp_chat_bridge=1",
      },
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
      'scope="mcp:read mcp:write mcp:apps"',
    );
    expect(res).toEqual({ error: "Unauthorized" });
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

  it("falls through (undefined) for sub-routes so management routes handle them", async () => {
    const event = makeWebEvent({ method: "POST", path: "/connect" });
    const res = await handleMcpRequest(event, config as any);
    expect(res).toBeUndefined();
  });
});

describe("handleMcpRequest — Node fast-path still taken when event.node present", () => {
  beforeEach(() => {
    // Authenticated deployed-app caller (default makeWebEvent bearer matches);
    // header-only dev-open is loopback-only now.
    process.env.ACCESS_TOKEN = "test-access-token";
    delete process.env.ACCESS_TOKENS;
    delete process.env.A2A_SECRET;
    delete process.env.BETTER_AUTH_SECRET;
  });
  afterEach(() => {
    delete process.env.ACCESS_TOKEN;
    delete process.env.BETTER_AUTH_SECRET;
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  /**
   * When a real Node `http` req/res pair is present, the handler MUST take
   * the unchanged Node fast-path: construct the SDK's
   * `StreamableHTTPServerTransport`, delegate to
   * `transport.handleRequest(nodeReq, nodeRes, body)` (which writes directly
   * to the Node response), return `undefined`, and set `_handled` so h3
   * doesn't double-write. We assert the routing + delegation by spying on
   * the SDK Node transport — re-testing the SDK's own Node↔Web bridge here
   * would just be testing the SDK, and that bridge is genuinely unchanged by
   * this fix (the web fallback adds a separate, never-Node code path).
   */
  it("constructs the SDK Node transport and delegates with (nodeReq, nodeRes, body)", async () => {
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
    // The web transport must NOT be touched on the Node path.
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

    // Node path returns undefined and marks the event handled.
    expect(res).toBeUndefined();
    expect(event._handled).toBe(true);

    // The SDK Node transport was constructed + called exactly once with the
    // event's Node req/res and the pre-read JSON-RPC body — the unchanged
    // delegation.
    expect(handleRequestSpy).toHaveBeenCalledTimes(1);
    const delegated = (globalThis as any).__nodeDelegation;
    expect(delegated.nodeReq).toBe(event.node.req);
    expect(delegated.nodeRes).toBe(event.node.res);
    expect(delegated.body).toEqual(rpc);

    // The web fallback transport was never used on the Node path.
    expect(webHandleSpy).not.toHaveBeenCalled();

    delete (globalThis as any).__nodeDelegation;
  });
});
