/**
 * Connector-catalog tier tests.
 *
 * Verifies that when AGENT_NATIVE_CONNECTOR_CATALOG=1 is set and a template
 * declares a `connectorCatalog`, the MCP server:
 *
 *   1. Only advertises the declared tools (+ builtin cross-app tools) in tools/list.
 *   2. Rejects tools/call for any tool NOT in the catalog.
 *   3. Serves the full surface when the caller opted up with catalog_scope: "full"
 *      (both A2A JWT and OAuth token paths).
 *   4. Is unaffected (full surface) when AGENT_NATIVE_CONNECTOR_CATALOG is not set.
 *   5. ask-agent is excluded from the connector tier.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as jose from "jose";

// ---------------------------------------------------------------------------
// Mocks (same pattern as server.spec.ts)
// ---------------------------------------------------------------------------

vi.mock("./builtin-tools.js", () => ({
  getBuiltinCrossAppTools: () => ({
    list_apps: {
      tool: { description: "List workspace apps" },
      readOnly: true,
      run: async () => ({ apps: [] }),
    },
    open_app: {
      tool: {
        description: "Open a workspace app",
        parameters: {
          type: "object",
          properties: { app: { type: "string" } },
        },
      },
      readOnly: true,
      run: async () => ({ url: "/" }),
    },
    ask_app: {
      tool: {
        description: "Ask a workspace app",
        parameters: {
          type: "object",
          properties: { app: { type: "string" }, message: { type: "string" } },
          required: ["app", "message"],
        },
      },
      run: async () => ({ response: "ok" }),
    },
    create_embed_session: {
      tool: {
        description: "Create an embed session",
        _meta: { ui: { visibility: ["app"] } },
      },
      run: async () => ({ startUrl: "/_agent-native/embed/start/mock" }),
    },
    create_workspace_app: {
      tool: { description: "Scaffold a workspace app" },
      run: async () => ({ url: "/new-app" }),
    },
    list_templates: {
      tool: { description: "List app templates" },
      readOnly: true,
      run: async () => ({ templates: [] }),
    },
  }),
}));

vi.mock("../org/context.js", () => ({
  resolveOrgByDomain: vi.fn(async () => null),
  getA2ASecretByDomain: vi.fn(async () => null),
}));

vi.mock("./connect-store.js", () => ({
  MCP_CONNECT_SCOPE: "mcp-connect",
  MCP_CONNECT_OAUTH_CLIENT_ID: "agent-native-connect",
  isJtiRevoked: vi.fn(async () => false),
  touchTokenUsed: vi.fn(async () => {}),
}));

vi.mock("../server/embed-session.js", () => ({
  createEmbedSessionTicket: vi.fn(async ({ targetPath }: any) => ({
    ticket: "mock-ticket",
    ticketHash: "mock-hash",
    expiresAt: 9999999999000,
    targetPath,
  })),
  normalizeEmbedTargetPath: vi.fn((raw: string) => raw || null),
}));

vi.mock("../server/embed-route.js", () => ({
  buildEmbedStartPath: (ticket: string) =>
    `/_agent-native/embed/start?ticket=${encodeURIComponent(ticket)}`,
}));

vi.mock("./oauth-store.js", () => ({
  MCP_OAUTH_ACCESS_TOKEN_TTL: "30d",
  MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS: 30 * 86400,
  getOAuthClient: vi.fn(async () => null),
}));

const { handleMcpRequest } = await import("./server.js");
const { signMcpOAuthAccessToken } = await import("./oauth-token.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const A2A_SECRET = "connector-catalog-a2a-secret";
const OAUTH_SECRET = "connector-catalog-oauth-secret";

function makeEvent(opts: {
  headers?: Record<string, string>;
  body?: unknown;
  ip?: string;
}): any {
  const headers: Record<string, string> = {
    host: "plan.agent-native.com",
    "x-forwarded-proto": "https",
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    ...opts.headers,
  };
  const reqUrl = "https://plan.agent-native.com/";
  const webReq = new Request(reqUrl, { method: "POST", headers });
  return {
    method: "POST",
    url: { pathname: "/" },
    path: "/",
    req: webReq,
    _headers: headers,
    _body: opts.body ?? {},
    _status: 200,
    _ip: opts.ip ?? "93.184.216.34", // non-loopback
  };
}

async function signA2AToken(
  sub: string,
  extraClaims: Record<string, unknown> = {},
): Promise<string> {
  return new jose.SignJWT({
    sub,
    scope: "mcp-connect",
    jti: `test-jti-${Math.random().toString(36).slice(2)}`,
    ...extraClaims,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(A2A_SECRET));
}

async function signOAuthToken(
  extra: Record<string, unknown> = {},
): Promise<string> {
  return signMcpOAuthAccessToken({
    ownerEmail: "alice@example.com",
    clientId: "agent-native-connect",
    scope: "mcp:read mcp:write",
    resource: "https://plan.agent-native.com/_agent-native/mcp",
    issuer: "https://plan.agent-native.com",
    ...extra,
  });
}

async function call(
  rpc: Record<string, unknown>,
  opts: {
    headers?: Record<string, string>;
    mcpConfig?: Record<string, unknown>;
  } = {},
): Promise<any> {
  const event = makeEvent({ body: rpc, headers: opts.headers });
  const cfg = opts.mcpConfig ?? connectorConfig;
  const res = await handleMcpRequest(event, cfg as any);
  expect(res).toBeInstanceOf(Response);
  const text = await (res as Response).text();
  const ct = (res as Response).headers.get("content-type") || "";
  if (ct.includes("text/event-stream")) {
    const line = text
      .split("\n")
      .find((l) => l.startsWith("data:"))
      ?.slice(5)
      .trim();
    return JSON.parse(line as string);
  }
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Test configuration
// ---------------------------------------------------------------------------

/** Catalog declared by the template — covers the "included" tools only. */
const CONNECTOR_CATALOG = ["create-plan", "get-plan", "navigate"];

/** Full action surface (includes excluded tools). */
const fullActions: Record<string, unknown> = {
  "create-plan": {
    tool: { description: "Create a plan" },
    run: async () => ({ id: "plan-1" }),
  },
  "get-plan": {
    tool: {
      description: "Get a plan",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    readOnly: true,
    run: async () => ({ id: "plan-1", title: "My plan" }),
  },
  navigate: {
    tool: {
      description: "Navigate to a view",
      parameters: {
        type: "object",
        properties: { view: { type: "string" } },
        required: ["view"],
      },
    },
    run: async () => ({ ok: true }),
  },
  // Tools that should be excluded from the connector tier:
  "db-exec": {
    tool: { description: "Execute SQL" },
    run: async () => ({ ok: true }),
  },
  "seed-kitchen-sink": {
    tool: { description: "Seed demo data" },
    run: async () => ({ ok: true }),
  },
  "manage-extensions": {
    tool: { description: "Manage extensions" },
    run: async () => ({ ok: true }),
  },
};

const connectorConfig = {
  name: "Plan",
  appId: "plan",
  description: "Plan agent",
  builtinCrossAppTools: true,
  actions: fullActions,
  productionActions: fullActions,
  askAgent: async () => "agent answer",
  connectorCatalog: CONNECTOR_CATALOG,
};

// h3 mock (same as server.spec.ts)
vi.mock("h3", () => ({
  defineEventHandler: (fn: any) => fn,
  getMethod: (event: any) => event.method ?? "GET",
  getHeader: (event: any, name: string) => event._headers?.[name.toLowerCase()],
  getRequestHeader: (event: any, name: string) =>
    event._headers?.[name.toLowerCase()],
  getRequestIP: (event: any) => event._ip,
  getQuery: () => ({}),
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

vi.mock("../server/framework-request-handler.js", () => ({
  getH3App: () => ({ use: () => {} }),
}));

vi.mock("../server/app-base-path.js", () => ({
  getConfiguredAppBasePath: () => "",
}));

vi.mock("../server/auth.js", () => ({
  isLoopbackRequest: (event: any) =>
    event._ip === "127.0.0.1" || event._ip === "::1",
}));

vi.mock("../mcp/oauth-route.js", () => ({
  getMcpOAuthResource: () => "https://plan.agent-native.com/_agent-native/mcp",
  getMcpOAuthAudiences: () => [
    "https://plan.agent-native.com/_agent-native/mcp",
  ],
  getMcpOAuthIssuer: () => "https://plan.agent-native.com",
  getMcpOAuthProtectedResourceMetadataUrl: () =>
    "https://plan.agent-native.com/.well-known/oauth-protected-resource",
  buildMcpOAuthChallenge: () => 'Bearer realm="plan"',
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("connector-catalog tier", () => {
  beforeEach(() => {
    process.env.A2A_SECRET = A2A_SECRET;
    process.env.AGENT_NATIVE_CONNECTOR_CATALOG = "1";
    delete process.env.ACCESS_TOKEN;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.AGENT_NATIVE_MCP_FULL_CATALOG;
  });

  afterEach(() => {
    delete process.env.A2A_SECRET;
    delete process.env.AGENT_NATIVE_CONNECTOR_CATALOG;
    delete process.env.ACCESS_TOKEN;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.AGENT_NATIVE_MCP_FULL_CATALOG;
    vi.clearAllMocks();
  });

  describe("tools/list — connector tier", () => {
    it("only advertises catalog tools + builtin cross-app tools", async () => {
      const token = await signA2AToken("alice@example.com");
      const rpc = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      };
      const out = await call(rpc, {
        headers: { authorization: `Bearer ${token}` },
      });
      const names: string[] = out.result.tools.map((t: any) => t.name);

      // Catalog tools are present
      expect(names).toContain("create-plan");
      expect(names).toContain("get-plan");
      expect(names).toContain("navigate");

      // Builtin cross-app tools are always included
      expect(names).toContain("list_apps");
      expect(names).toContain("open_app");

      // Excluded tools are absent
      expect(names).not.toContain("db-exec");
      expect(names).not.toContain("seed-kitchen-sink");
      expect(names).not.toContain("manage-extensions");

      // ask-agent is excluded from connector tier
      expect(names).not.toContain("ask-agent");
    });

    it("snapshot: exact tool set in connector tier matches declared catalog + builtins", async () => {
      const token = await signA2AToken("alice@example.com");
      const rpc = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
      const out = await call(rpc, {
        headers: { authorization: `Bearer ${token}` },
      });
      const names: string[] = out.result.tools.map((t: any) => t.name).sort();

      // The exact set: catalog tools + the 4 core builtin cross-app tools.
      // create_workspace_app and list_templates are NOT in COMPACT_MCP_APP_CATALOG_BUILTINS
      // so they are excluded by isActionInConnectorCatalog unless explicitly listed in the
      // connectorCatalog. Only the 4 core cross-app builtins are always included.
      const expected = [
        ...CONNECTOR_CATALOG,
        "list_apps",
        "open_app",
        "ask_app",
        "create_embed_session",
      ].sort();

      expect(names).toEqual(expected);
    });
  });

  describe("tools/call — non-catalog tool is rejected", () => {
    it("rejects db-exec (not in catalog)", async () => {
      const token = await signA2AToken("alice@example.com");
      const rpc = {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "db-exec", arguments: { sql: "SELECT 1" } },
      };
      const out = await call(rpc, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(out.result.isError).toBe(true);
      expect(out.result.content[0].text).toMatch(/Unknown tool/);
    });

    it("rejects seed-kitchen-sink (not in catalog)", async () => {
      const token = await signA2AToken("alice@example.com");
      const rpc = {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "seed-kitchen-sink", arguments: {} },
      };
      const out = await call(rpc, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(out.result.isError).toBe(true);
      expect(out.result.content[0].text).toMatch(/Unknown tool/);
    });

    it("rejects ask-agent (excluded from connector tier)", async () => {
      const token = await signA2AToken("alice@example.com");
      const rpc = {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "ask-agent", arguments: { message: "hello" } },
      };
      const out = await call(rpc, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(out.result.isError).toBe(true);
    });

    it("allows catalog tools to be called", async () => {
      const token = await signA2AToken("alice@example.com");
      const rpc = {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "get-plan", arguments: { id: "plan-1" } },
      };
      const out = await call(rpc, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(out.result.isError).toBeFalsy();
      const resultText = out.result.content.map((c: any) => c.text).join(" ");
      expect(resultText).toContain("plan-1");
    });
  });

  describe("per-token opt-up: catalog_scope: 'full' in A2A JWT", () => {
    it("serves full catalog when catalog_scope: 'full' is in the A2A token", async () => {
      const token = await signA2AToken("alice@example.com", {
        catalog_scope: "full",
      });
      const rpc = { jsonrpc: "2.0", id: 6, method: "tools/list", params: {} };
      const out = await call(rpc, {
        headers: { authorization: `Bearer ${token}` },
      });
      const names: string[] = out.result.tools.map((t: any) => t.name);

      // All catalog tools are present
      expect(names).toContain("create-plan");
      // Excluded tools are also present (full catalog)
      expect(names).toContain("db-exec");
      expect(names).toContain("seed-kitchen-sink");
    });

    it("allows non-catalog tool call when catalog_scope: 'full'", async () => {
      const token = await signA2AToken("alice@example.com", {
        catalog_scope: "full",
      });
      const rpc = {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "db-exec", arguments: {} },
      };
      const out = await call(rpc, {
        headers: { authorization: `Bearer ${token}` },
      });
      // Should succeed (not an "Unknown tool" error)
      expect(out.result?.content?.[0]?.text ?? "").not.toMatch(/Unknown tool/);
    });
  });

  describe("per-token opt-up: catalog_scope: 'full' in OAuth token", () => {
    it("serves full catalog when OAuth token has catalog_scope: 'full'", async () => {
      process.env.BETTER_AUTH_SECRET = OAUTH_SECRET;
      try {
        const token = await signOAuthToken({ catalogScope: "full" } as any);
        const rpc = { jsonrpc: "2.0", id: 8, method: "tools/list", params: {} };
        const out = await call(rpc, {
          headers: { authorization: `Bearer ${token}` },
          mcpConfig: {
            ...connectorConfig,
            actions: connectorConfig.actions,
            productionActions: connectorConfig.productionActions,
          },
        });
        const names: string[] = out.result.tools.map((t: any) => t.name);
        expect(names).toContain("db-exec");
        expect(names).toContain("seed-kitchen-sink");
      } finally {
        delete process.env.BETTER_AUTH_SECRET;
      }
    });
  });

  describe("AGENT_NATIVE_MCP_FULL_CATALOG=1 overrides connector tier", () => {
    it("serves full catalog when AGENT_NATIVE_MCP_FULL_CATALOG=1", async () => {
      process.env.AGENT_NATIVE_MCP_FULL_CATALOG = "1";
      const token = await signA2AToken("alice@example.com");
      const rpc = { jsonrpc: "2.0", id: 9, method: "tools/list", params: {} };
      const out = await call(rpc, {
        headers: { authorization: `Bearer ${token}` },
      });
      const names: string[] = out.result.tools.map((t: any) => t.name);
      expect(names).toContain("db-exec");
      expect(names).toContain("seed-kitchen-sink");
    });
  });
});

describe("connector-catalog tier — env flag NOT set", () => {
  beforeEach(() => {
    process.env.A2A_SECRET = A2A_SECRET;
    delete process.env.AGENT_NATIVE_CONNECTOR_CATALOG;
    delete process.env.ACCESS_TOKEN;
    delete process.env.BETTER_AUTH_SECRET;
    // Force full catalog so compact-catalog default for A2A callers doesn't
    // hide template actions — we only want to verify the connector-catalog
    // restriction is absent, not test compact-catalog behavior here.
    process.env.AGENT_NATIVE_MCP_FULL_CATALOG = "1";
  });

  afterEach(() => {
    delete process.env.A2A_SECRET;
    delete process.env.AGENT_NATIVE_CONNECTOR_CATALOG;
    delete process.env.ACCESS_TOKEN;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.AGENT_NATIVE_MCP_FULL_CATALOG;
    vi.clearAllMocks();
  });

  it("serves full catalog when env flag is absent (local/dev unchanged)", async () => {
    const token = await signA2AToken("alice@example.com");
    const rpc = { jsonrpc: "2.0", id: 10, method: "tools/list", params: {} };
    const out = await call(rpc, {
      headers: { authorization: `Bearer ${token}` },
    });
    const names: string[] = out.result.tools.map((t: any) => t.name);

    // All actions including excluded ones are present
    expect(names).toContain("create-plan");
    expect(names).toContain("db-exec");
    expect(names).toContain("seed-kitchen-sink");
  });

  it("allows calling non-catalog tools when env flag is absent", async () => {
    const token = await signA2AToken("alice@example.com");
    const rpc = {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { name: "db-exec", arguments: {} },
    };
    const out = await call(rpc, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(out.result?.content?.[0]?.text ?? "").not.toMatch(/Unknown tool/);
  });
});

describe("connector-catalog tier — no connectorCatalog declared", () => {
  beforeEach(() => {
    process.env.A2A_SECRET = A2A_SECRET;
    process.env.AGENT_NATIVE_CONNECTOR_CATALOG = "1";
    delete process.env.ACCESS_TOKEN;
    delete process.env.BETTER_AUTH_SECRET;
    // Force full catalog so compact-catalog default for A2A callers doesn't
    // hide template actions — we only want to verify the connector-catalog
    // restriction is absent when connectorCatalog is undeclared.
    process.env.AGENT_NATIVE_MCP_FULL_CATALOG = "1";
  });

  afterEach(() => {
    delete process.env.A2A_SECRET;
    delete process.env.AGENT_NATIVE_CONNECTOR_CATALOG;
    delete process.env.ACCESS_TOKEN;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.AGENT_NATIVE_MCP_FULL_CATALOG;
    vi.clearAllMocks();
  });

  it("falls back to full surface when connectorCatalog is not declared", async () => {
    const configWithoutCatalog = {
      ...connectorConfig,
      connectorCatalog: undefined,
    };
    const token = await signA2AToken("alice@example.com");
    const rpc = { jsonrpc: "2.0", id: 12, method: "tools/list", params: {} };
    const out = await call(rpc, {
      headers: { authorization: `Bearer ${token}` },
      mcpConfig: configWithoutCatalog,
    });
    const names: string[] = out.result.tools.map((t: any) => t.name);
    expect(names).toContain("db-exec");
    expect(names).toContain("seed-kitchen-sink");
  });
});
