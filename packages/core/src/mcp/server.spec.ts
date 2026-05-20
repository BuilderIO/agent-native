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

/**
 * Drive a single JSON-RPC call through the web fallback and return the parsed
 * JSON-RPC response object. Proves the web `Response` path works with no Node
 * runtime present.
 */
async function callWeb(rpc: Record<string, unknown>): Promise<any> {
  const event = makeWebEvent({ method: "POST", body: rpc });
  const res = await handleMcpRequest(event, config as any);
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

describe("handleMcpRequest — web-standard runtime fallback (no Node req/res)", () => {
  beforeEach(() => {
    // A deployed app has a real token; the default makeWebEvent bearer
    // matches it so these runtime-mechanics tests run as an authenticated
    // caller (header-only dev-open is loopback-only — see security note).
    process.env.ACCESS_TOKEN = "test-access-token";
    delete process.env.ACCESS_TOKENS;
    delete process.env.A2A_SECRET;
  });
  afterEach(() => {
    delete process.env.ACCESS_TOKEN;
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
    expect(echo._meta?.["ui/resourceUri"]).toBe("ui://mail/echo-thing");
    expect(echo._meta?.ui).toEqual({
      resourceUri: "ui://mail/echo-thing",
      visibility: ["model", "app"],
    });
  });

  it("handles `resources/list` and advertises MCP App resources", async () => {
    const out = await callWeb({
      jsonrpc: "2.0",
      id: 4,
      method: "resources/list",
      params: {},
    });
    expect(out.error).toBeUndefined();
    expect(out.result.resources).toEqual([
      expect.objectContaining({
        uri: "ui://mail/echo-thing",
        name: "echo-thing",
        title: "Mail Review",
        description: "Review the echoed thing in an inline MCP App.",
        mimeType: "text/html;profile=mcp-app",
        _meta: {
          ui: {
            csp: {
              connectDomains: ["https://mail.agent-native.com"],
            },
            prefersBorder: true,
          },
        },
      }),
    ]);
  });

  it("handles `resources/templates/list` with an empty template list", async () => {
    const out = await callWeb({
      jsonrpc: "2.0",
      id: 5,
      method: "resources/templates/list",
      params: {},
    });
    expect(out.error).toBeUndefined();
    expect(out.result.resourceTemplates).toEqual([]);
  });

  it("handles `resources/read` and returns MCP App HTML", async () => {
    const out = await callWeb({
      jsonrpc: "2.0",
      id: 6,
      method: "resources/read",
      params: { uri: "ui://mail/echo-thing" },
    });
    expect(out.error).toBeUndefined();
    expect(out.result.contents).toEqual([
      expect.objectContaining({
        uri: "ui://mail/echo-thing",
        mimeType: "text/html;profile=mcp-app",
        text: expect.stringContaining('data-action="echo-thing"'),
        _meta: {
          ui: {
            csp: {
              connectDomains: ["https://mail.agent-native.com"],
            },
            prefersBorder: true,
          },
        },
      }),
    ]);
    expect(out.result.contents[0].text).toContain(
      'data-origin="https://mail.agent-native.com"',
    );
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
    // First block: the JSON result.
    expect(content[0].type).toBe("text");
    expect(JSON.parse(content[0].text)).toEqual({
      echoed: "hello",
      id: "thing-42",
    });
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
    expect(out.result._meta["agent-native/openLink"].desktopUrl).toContain(
      "view=thing&id=thing-42",
    );
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
  });
  afterEach(() => {
    delete process.env.ACCESS_TOKEN;
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
