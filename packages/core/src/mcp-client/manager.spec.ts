import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  McpClientManager,
  parseMcpToolName,
  MCP_TOOL_PREFIX,
} from "./manager.js";
import { MCP_APP_EXTENSION_ID, MCP_APP_MIME_TYPE } from "../action.js";

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
  async listTools() {
    const spec = serverFixtures[this.transport!.key];
    return { tools: spec?.tools ?? [] };
  }
  async callTool({ name, arguments: args }: { name: string; arguments: any }) {
    const spec = serverFixtures[this.transport!.key];
    if (!spec) throw new Error(`No fixture for ${this.transport!.key}`);
    return spec.callImpl(name, args);
  }
  async readResource({ uri }: { uri: string }) {
    const spec = serverFixtures[this.transport!.key];
    if (!spec?.readResourceImpl) throw new Error("resources/read unsupported");
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
  constructor(url: URL) {
    this.key = `http ${url.toString()}`;
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
