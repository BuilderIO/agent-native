import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { MCP_APP_EXTENSION_ID, MCP_APP_MIME_TYPE } from "../action.js";
import { runWithRequestContext } from "../server/request-context.js";
import {
  McpClientManager,
  parseMcpToolName,
  MCP_TOOL_PREFIX,
} from "./manager.js";

// Fake MCP Client + StdioClientTransport. These stand in for the real
// @modelcontextprotocol/sdk exports via vi.mock below.

type FakeTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

const serverFixtures: Record<
  string,
  {
    tools: FakeTool[];
    callImpl: (name: string, args: any) => any;
    readResourceImpl?: (uri: string) => any;
  }
> = {};
const fakeClients: FakeClient[] = [];
const httpCallHeaders: Array<Record<string, string>> = [];
const originalFetch = globalThis.fetch;
const originalOrgDirectoryUrl = process.env.AGENT_NATIVE_ORG_DIRECTORY_URL;
const originalConnectTimeout =
  process.env.AGENT_NATIVE_MCP_CLIENT_CONNECT_TIMEOUT_MS;
// This is the first path that lazily loads the A2A/JWT signing modules. Under
// root prep's parallel load that one-time work can exceed Vitest's default 5s,
// then continue after timeout and pollute the next test.
const FIRST_A2A_SIGNING_TIMEOUT_MS = 15_000;

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function headersFromUnknown(value: unknown): Record<string, string> {
  if (!value) return {};
  if (typeof Headers !== "undefined" && value instanceof Headers) {
    return Object.fromEntries(value.entries());
  }
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value
        .filter((entry) => Array.isArray(entry) && entry.length >= 2)
        .map(([key, headerValue]) => [String(key), String(headerValue)]),
    );
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(
        ([key, headerValue]) => [key, String(headerValue)],
      ),
    );
  }
  return {};
}

class FakeClient {
  onerror?: (error: unknown) => void;
  private transport: FakeTransport | null = null;
  constructor(
    public info: any,
    public capabilities: any,
  ) {
    fakeClients.push(this);
  }
  async connect(transport: FakeTransport) {
    this.transport = transport;
  }
  getTransport() {
    return this.transport;
  }
  async listTools() {
    const spec = serverFixtures[this.transport!.key];
    return { tools: spec?.tools ?? [] };
  }
  async callTool({ name, arguments: args }: { name: string; arguments: any }) {
    const spec = serverFixtures[this.transport!.key];
    if (!spec) throw new Error(`No fixture for ${this.transport!.key}`);
    if (this.transport instanceof FakeHttp) {
      await this.transport.recordRequestHeaders();
    }
    return spec.callImpl(name, args);
  }
  async readResource({ uri }: { uri: string }) {
    const spec = serverFixtures[this.transport!.key];
    if (!spec?.readResourceImpl) throw new Error("resources/read unsupported");
    if (this.transport instanceof FakeHttp) {
      await this.transport.recordRequestHeaders();
    }
    return spec.readResourceImpl(uri);
  }
  async close() {
    this.transport?.close();
  }
}

type FakeTransport = FakeStdio | FakeHttp;

class FakeStdio {
  key: string;
  constructor(opts: { command: string; args?: string[] }) {
    this.key = `${opts.command} ${(opts.args ?? []).join(" ")}`.trim();
  }
  closed = false;
  close() {
    this.closed = true;
  }
}

class FakeHttp {
  key: string;
  onerror?: (error: unknown) => void;
  requestInit?: Record<string, unknown>;
  fetchImpl?: (input: unknown, init?: unknown) => Promise<unknown>;
  constructor(
    private url: URL,
    opts?: {
      requestInit?: Record<string, unknown>;
      fetch?: (input: unknown, init?: unknown) => Promise<unknown>;
    },
  ) {
    this.key = `http ${url.toString()}`;
    this.requestInit = opts?.requestInit;
    this.fetchImpl = opts?.fetch;
  }
  async recordRequestHeaders() {
    if (this.fetchImpl) {
      await this.fetchImpl(this.url, {
        headers: this.requestInit?.headers,
      });
      return;
    }
    httpCallHeaders.push(headersFromUnknown(this.requestInit?.headers));
  }
  closed = false;
  close() {
    this.closed = true;
  }
}

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: FakeClient,
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: FakeStdio,
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: FakeHttp,
}));

describe("parseMcpToolName", () => {
  it("splits on the double underscore after the prefix", () => {
    expect(parseMcpToolName("mcp__chrome__navigate")).toEqual({
      serverId: "chrome",
      toolName: "navigate",
    });
  });

  it("returns null for non-MCP names", () => {
    expect(parseMcpToolName("edit-document")).toBeNull();
  });

  it("returns null when the server segment is missing", () => {
    expect(parseMcpToolName(`${MCP_TOOL_PREFIX}navigate`)).toBeNull();
  });
});

describe("McpClientManager", () => {
  beforeEach(() => {
    for (const k of Object.keys(serverFixtures)) delete serverFixtures[k];
    fakeClients.length = 0;
    httpCallHeaders.length = 0;
    delete process.env.A2A_SECRET;
    delete process.env.AGENT_NATIVE_MCP_CLIENT_CONNECT_TIMEOUT_MS;
    process.env.AGENT_NATIVE_ORG_DIRECTORY_URL =
      "https://directory.example.com";
    globalThis.fetch = vi.fn(async (_input, init) => {
      if (String(_input).includes("/_agent-native/org/apps")) {
        return new Response(
          JSON.stringify({
            apps: [
              {
                id: "assets",
                name: "Assets",
                url: "https://assets.example.com",
                a2aUrl: "https://assets.example.com",
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      httpCallHeaders.push(
        headersFromUnknown((init as { headers?: unknown })?.headers),
      );
      return new Response(null, { status: 204 });
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalOrgDirectoryUrl === undefined) {
      delete process.env.AGENT_NATIVE_ORG_DIRECTORY_URL;
    } else {
      process.env.AGENT_NATIVE_ORG_DIRECTORY_URL = originalOrgDirectoryUrl;
    }
    if (originalConnectTimeout === undefined) {
      delete process.env.AGENT_NATIVE_MCP_CLIENT_CONNECT_TIMEOUT_MS;
    } else {
      process.env.AGENT_NATIVE_MCP_CLIENT_CONNECT_TIMEOUT_MS =
        originalConnectTimeout;
    }
  });

  it("is disabled when config is null", async () => {
    const mgr = new McpClientManager(null);
    await mgr.start();
    expect(mgr.enabled).toBe(false);
    expect(mgr.getTools()).toEqual([]);
  });

  it("connects to each configured server and enumerates tools with prefixes", async () => {
    serverFixtures["chrome-bin"] = {
      tools: [
        {
          name: "navigate",
          description: "Go to URL",
          inputSchema: { type: "object" },
        },
        {
          name: "click",
          description: "Click",
          inputSchema: { type: "object" },
        },
      ],
      callImpl: () => ({ content: [{ type: "text", text: "ok" }] }),
    };
    serverFixtures["fs-bin --root /tmp"] = {
      tools: [{ name: "read", description: "Read file" }],
      callImpl: () => ({ content: [{ type: "text", text: "file-content" }] }),
    };

    const mgr = new McpClientManager({
      servers: {
        chrome: { command: "chrome-bin" },
        fs: { command: "fs-bin", args: ["--root", "/tmp"] },
      },
    });

    await mgr.start();
    expect(mgr.configuredServers.sort()).toEqual(["chrome", "fs"]);
    expect(mgr.connectedServers.sort()).toEqual(["chrome", "fs"]);

    const names = mgr
      .getTools()
      .map((t) => t.name)
      .sort();
    expect(names).toEqual([
      "mcp__chrome__click",
      "mcp__chrome__navigate",
      "mcp__fs__read",
    ]);
    expect(fakeClients[0]?.capabilities.capabilities.extensions).toEqual({
      [MCP_APP_EXTENSION_ID]: {
        mimeTypes: [MCP_APP_MIME_TYPE],
      },
    });
  });

  it("preserves full MCP tool metadata from listTools", async () => {
    serverFixtures["apps-bin"] = {
      tools: [
        {
          name: "show_chart",
          title: "Show chart",
          description: "Render a chart",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string" } },
          },
          outputSchema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
          },
          annotations: { readOnlyHint: true },
          _meta: { ui: { resourceUri: "ui://apps/chart" } },
        },
      ],
      callImpl: () => ({ content: [] }),
    };
    const mgr = new McpClientManager({
      servers: { apps: { command: "apps-bin" } },
    });
    await mgr.start();

    const [tool] = mgr.getTools();
    expect(tool).toMatchObject({
      name: "mcp__apps__show_chart",
      originalName: "show_chart",
      title: "Show chart",
      outputSchema: { type: "object", properties: { ok: { type: "boolean" } } },
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: "ui://apps/chart" } },
    });
    expect(tool.raw).toMatchObject({
      _meta: { ui: { resourceUri: "ui://apps/chart" } },
    });
  });

  it("reads ui:// resources from the owning MCP server", async () => {
    serverFixtures["apps-bin"] = {
      tools: [{ name: "show" }],
      callImpl: () => ({ content: [] }),
      readResourceImpl: (uri) => ({
        contents: [
          { uri, mimeType: "text/html;profile=mcp-app", text: "<p>hi</p>" },
        ],
      }),
    };
    const mgr = new McpClientManager({
      servers: { apps: { command: "apps-bin" } },
    });
    await mgr.start();

    await expect(
      mgr.readResource("apps", "file:///etc/passwd"),
    ).rejects.toThrow(/Only ui:\/\//);
    await expect(
      mgr.readResourceForTool("mcp__apps__show", "ui://apps/show"),
    ).resolves.toEqual({
      contents: [
        {
          uri: "ui://apps/show",
          mimeType: "text/html;profile=mcp-app",
          text: "<p>hi</p>",
        },
      ],
    });
  });

  it("routes callTool to the correct server and returns its raw result", async () => {
    const calls: Array<{ tool: string; args: any }> = [];
    serverFixtures["a-bin"] = {
      tools: [{ name: "ping" }],
      callImpl: (name, args) => {
        calls.push({ tool: `a:${name}`, args });
        return { content: [{ type: "text", text: "pong-a" }] };
      },
    };
    serverFixtures["b-bin"] = {
      tools: [{ name: "ping" }],
      callImpl: (name, args) => {
        calls.push({ tool: `b:${name}`, args });
        return { content: [{ type: "text", text: "pong-b" }] };
      },
    };

    const mgr = new McpClientManager({
      servers: {
        a: { command: "a-bin" },
        b: { command: "b-bin" },
      },
    });
    await mgr.start();

    const resultA = (await mgr.callTool("mcp__a__ping", { hello: 1 })) as any;
    const resultB = (await mgr.callTool("mcp__b__ping", { hello: 2 })) as any;

    expect(resultA.content[0].text).toBe("pong-a");
    expect(resultB.content[0].text).toBe("pong-b");
    expect(calls).toEqual([
      { tool: "a:ping", args: { hello: 1 } },
      { tool: "b:ping", args: { hello: 2 } },
    ]);
  });

  it(
    "injects per-request identity only for trusted org-scoped first-party HTTP servers",
    async () => {
      process.env.A2A_SECRET = "test-a2a-secret";
      serverFixtures["http https://assets.example.com/_agent-native/mcp"] = {
        tools: [{ name: "generate-asset" }],
        callImpl: () => ({ content: [{ type: "text", text: "ok" }] }),
      };
      serverFixtures["http https://third-party.example.com/mcp"] = {
        tools: [{ name: "search" }],
        callImpl: () => ({ content: [{ type: "text", text: "ok" }] }),
      };
      const mgr = new McpClientManager({
        servers: {
          "org_org-123_assets": {
            type: "http",
            url: "https://assets.example.com/_agent-native/mcp",
            headers: { Authorization: "Bearer static-service-token" },
            firstParty: true,
            firstPartyOrgId: "org-123",
          },
          "org_org-123_zapier": {
            type: "http",
            url: "https://third-party.example.com/mcp",
            headers: { Authorization: "Bearer third-party-token" },
          },
        },
      });
      await mgr.start();

      await runWithRequestContext(
        { userEmail: "alice@example.com", orgId: "org-123" },
        async () => {
          await mgr.callTool("mcp__org_org-123_assets__generate-asset", {});
          await mgr.callTool("mcp__org_org-123_zapier__search", {});
        },
      );

      expect(httpCallHeaders).toHaveLength(2);
      expect(httpCallHeaders[0].Authorization).toMatch(/^Bearer /);
      expect(httpCallHeaders[0].Authorization).not.toBe(
        "Bearer static-service-token",
      );
      const firstPartyPayload = decodeJwtPayload(
        httpCallHeaders[0].Authorization.replace(/^Bearer\s+/i, ""),
      );
      expect(firstPartyPayload.aud).toBe(
        "https://assets.example.com/_agent-native/mcp",
      );
      expect(httpCallHeaders[0]["x-agent-native-mcp-inline-apps"]).toBe("1");
      expect(httpCallHeaders[1].Authorization).toBe("Bearer third-party-token");
      expect(
        httpCallHeaders[1]["x-agent-native-mcp-inline-apps"],
      ).toBeUndefined();
      const assetsTransport = fakeClients[0]!.getTransport() as FakeHttp;
      expect(
        headersFromUnknown(assetsTransport.requestInit?.headers).Authorization,
      ).toBeUndefined();
    },
    FIRST_A2A_SIGNING_TIMEOUT_MS,
  );

  it("does not inject identity into user-scoped first-party HTTP servers", async () => {
    process.env.A2A_SECRET = "test-a2a-secret";
    serverFixtures["http https://assets.example.com/_agent-native/mcp"] = {
      tools: [{ name: "generate-asset" }],
      callImpl: () => ({ content: [{ type: "text", text: "ok" }] }),
    };
    const mgr = new McpClientManager({
      servers: {
        user_abcdef1234_assets: {
          type: "http",
          url: "https://assets.example.com/_agent-native/mcp",
          headers: { Authorization: "Bearer static-user-token" },
          firstParty: true,
        },
      },
    });
    await mgr.start();

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-123" },
      () => mgr.callTool("mcp__user_abcdef1234_assets__generate-asset", {}),
    );

    expect(httpCallHeaders[0].Authorization).toBe("Bearer static-user-token");
  });

  it("mints a first-party org service identity without request context", async () => {
    process.env.A2A_SECRET = "test-a2a-secret";
    serverFixtures["http https://assets.example.com/_agent-native/mcp"] = {
      tools: [{ name: "generate-asset" }],
      callImpl: () => ({ content: [{ type: "text", text: "ok" }] }),
    };
    const mgr = new McpClientManager({
      servers: {
        "org_org-123_assets": {
          type: "http",
          url: "https://assets.example.com/_agent-native/mcp",
          firstParty: true,
          firstPartyOrgId: "org-123",
        },
      },
    });
    await mgr.start();

    const assetsTransport = fakeClients[0]!.getTransport() as FakeHttp;
    await assetsTransport.recordRequestHeaders();

    const authorization = httpCallHeaders[0].Authorization;
    expect(authorization).toMatch(/^Bearer /);
    const payload = decodeJwtPayload(authorization.replace(/^Bearer\s+/i, ""));
    expect(payload.sub).toBe("svc-mcp-client@service.org-123");
    expect(payload.org_id).toBe("org-123");
    expect(payload.scope).toBe("mcp-connect");
    expect(payload.agent_native_first_party_mcp).toBe(true);
    expect(payload.aud).toBe("https://assets.example.com/_agent-native/mcp");
  });

  it("throws a clear error for unknown server prefixes", async () => {
    const mgr = new McpClientManager({
      servers: { a: { command: "a-bin" } },
    });
    serverFixtures["a-bin"] = {
      tools: [{ name: "ping" }],
      callImpl: () => ({ content: [] }),
    };
    await mgr.start();

    await expect(mgr.callTool("mcp__missing__ping", {})).rejects.toThrow(
      /not connected/,
    );
    await expect(mgr.callTool("not-an-mcp-tool", {})).rejects.toThrow(
      /does not look like an MCP tool/,
    );
    await expect(mgr.callTool("mcp__a__doesnotexist", {})).rejects.toThrow(
      /does not expose tool "doesnotexist"/,
    );
  });

  it("reports errors for servers that fail to connect", async () => {
    // No fixture for "bad-bin" → listTools returns empty. We simulate a crash
    // by overriding connect on the fake client for this one run.
    serverFixtures["good-bin"] = {
      tools: [{ name: "ok" }],
      callImpl: () => ({ content: [{ type: "text", text: "ok" }] }),
    };

    // Patch FakeClient.connect to throw for "boom-bin".
    const origConnect = FakeClient.prototype.connect;
    FakeClient.prototype.connect = async function (transport: FakeStdio) {
      if (transport.key === "boom-bin") throw new Error("spawn failed");
      return origConnect.call(this, transport);
    };

    try {
      const mgr = new McpClientManager({
        servers: {
          good: { command: "good-bin" },
          broken: { command: "boom-bin" },
        },
      });
      await mgr.start();

      expect(mgr.configuredServers.sort()).toEqual(["broken", "good"]);
      expect(mgr.connectedServers).toEqual(["good"]);
      const status = mgr.getStatus();
      expect(status.errors.broken).toContain("spawn failed");
      expect(status.totalTools).toBe(1);
    } finally {
      FakeClient.prototype.connect = origConnect;
    }
  });

  it("retries unchanged servers left in an error state on reconfigure", async () => {
    serverFixtures["flaky-bin"] = {
      tools: [{ name: "ok" }],
      callImpl: () => ({ content: [{ type: "text", text: "ok" }] }),
    };
    const origConnect = FakeClient.prototype.connect;
    let failNextConnect = true;
    FakeClient.prototype.connect = async function (transport: FakeStdio) {
      if (transport.key === "flaky-bin" && failNextConnect) {
        failNextConnect = false;
        throw new Error("temporary handshake failure");
      }
      return origConnect.call(this, transport);
    };

    try {
      const config = {
        servers: {
          flaky: { command: "flaky-bin" },
        },
      };
      const mgr = new McpClientManager(config);
      await mgr.start();

      expect(mgr.connectedServers).toEqual([]);
      expect(mgr.getStatus().errors.flaky).toContain(
        "temporary handshake failure",
      );

      const summary = await mgr.reconfigure(config);

      expect(summary.reconnected).toEqual(["flaky"]);
      expect(summary.unchanged).toEqual([]);
      expect(mgr.connectedServers).toEqual(["flaky"]);
      expect(mgr.getStatus().errors).toEqual({});
    } finally {
      FakeClient.prototype.connect = origConnect;
    }
  });

  it("formats non-MCP JSON HTTP handshakes without dumping raw validation output", async () => {
    const origConnect = FakeClient.prototype.connect;
    FakeClient.prototype.connect = async function (transport: FakeTransport) {
      if (transport.key === "http https://httpbin.org/post") {
        throw new Error(
          '[{"code":"invalid_union","path":["jsonrpc"],"message":"Invalid input: expected \\"2.0\\""},{"code":"unrecognized_keys","keys":["args","headers","origin","url"],"message":"Unrecognized keys"}]',
        );
      }
      return origConnect.call(this, transport);
    };

    try {
      const mgr = new McpClientManager({
        servers: {
          broken: { type: "http", url: "https://httpbin.org/post" },
        },
      });
      await mgr.start();

      const status = mgr.getStatus();
      expect(status.connectedServers).toEqual([]);
      expect(status.errors.broken).toBe(
        "That URL returned JSON, but not an MCP JSON-RPC response. Check that you pasted the Streamable HTTP endpoint, often ending in /mcp.",
      );
      expect(status.errors.broken).not.toContain("invalid_union");
    } finally {
      FakeClient.prototype.connect = origConnect;
    }
  });

  it("times out stalled MCP handshakes so startup can continue", async () => {
    vi.useFakeTimers();
    process.env.AGENT_NATIVE_MCP_CLIENT_CONNECT_TIMEOUT_MS = "25";
    const origConnect = FakeClient.prototype.connect;
    FakeClient.prototype.connect = async function (transport: FakeTransport) {
      if (transport.key === "http https://stalled.example.com/mcp") {
        // Attach the transport (as the real SDK does at the start of connect)
        // before stalling, so the manager can close it on timeout.
        await origConnect.call(this, transport);
        await new Promise(() => {
          // Intentionally never resolves.
        });
      }
      return origConnect.call(this, transport);
    };

    try {
      serverFixtures["good-bin"] = {
        tools: [{ name: "ok" }],
        callImpl: () => ({ content: [] }),
      };
      const mgr = new McpClientManager({
        servers: {
          stalled: { type: "http", url: "https://stalled.example.com/mcp" },
          good: { command: "good-bin" },
        },
      });
      const start = mgr.start();
      await vi.advanceTimersByTimeAsync(25);
      await start;

      expect(mgr.connectedServers).toEqual(["good"]);
      expect(mgr.getStatus().errors.stalled).toBe(
        "Could not reach that MCP server. Check the URL and make sure it is publicly reachable from this app.",
      );
      expect(
        (fakeClients[0]?.getTransport() as FakeHttp | undefined)?.closed,
      ).toBe(true);
    } finally {
      FakeClient.prototype.connect = origConnect;
      vi.useRealTimers();
    }
  });

  it("attaches transport.onerror before connect so SDK transport errors don't leak as unhandled rejections", async () => {
    // The MCP SDK's StreamableHTTPClientTransport has fire-and-forget code
    // paths (initial SSE stream open, scheduled reconnects) that route
    // errors through `this.onerror?.(...)`. On AWS Lambda the long-lived
    // socket gets reaped ~60s after the function returns, surfacing as a
    // `socket hang up` unhandled rejection — see `processStream()` in
    // @modelcontextprotocol/sdk/client/streamableHttp.js. The manager must
    // attach a transport.onerror handler BEFORE client.connect() so those
    // errors are captured even when Client's wiring hasn't run yet.
    const seenOnError: Array<((error: unknown) => void) | undefined> = [];
    const origConnect = FakeClient.prototype.connect;
    FakeClient.prototype.connect = async function (transport: FakeTransport) {
      seenOnError.push((transport as FakeHttp).onerror);
      return origConnect.call(this, transport);
    };

    try {
      serverFixtures["http https://example.com/mcp"] = {
        tools: [{ name: "ping" }],
        callImpl: () => ({ content: [] }),
      };
      const mgr = new McpClientManager({
        servers: {
          remote: { type: "http", url: "https://example.com/mcp" },
        },
      });
      await mgr.start();

      expect(seenOnError).toHaveLength(1);
      expect(typeof seenOnError[0]).toBe("function");

      // Calling the handler with a synthetic socket error must not throw —
      // the no-op recorder swallows transport errors during connect so the
      // SDK's `this.onerror?.(error); throw error;` pattern can't fire an
      // unhandled rejection before Client.connect() wires its own handler.
      expect(() => seenOnError[0]?.(new Error("socket hang up"))).not.toThrow();
    } finally {
      FakeClient.prototype.connect = origConnect;
    }
  });

  it("contains SDK close rejections after failed handshakes", async () => {
    const origConnect = FakeClient.prototype.connect;
    const origClose = FakeClient.prototype.close;
    FakeClient.prototype.connect = async function (_transport: FakeTransport) {
      void this.close();
      throw new Error("bad handshake");
    };
    FakeClient.prototype.close = async function () {
      throw new Error("late close failed");
    };
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const mgr = new McpClientManager({
        servers: {
          broken: { command: "boom-bin" },
        },
      });
      await mgr.start();
      await new Promise((resolve) => setImmediate(resolve));

      const status = mgr.getStatus();
      expect(status.errors.broken).toContain("bad handshake");
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      FakeClient.prototype.connect = origConnect;
      FakeClient.prototype.close = origClose;
    }
  });
});
