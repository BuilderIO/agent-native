import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  McpClientManager,
  parseMcpToolName,
  MCP_TOOL_PREFIX,
} from "./manager.js";

// Fake MCP Client + StdioClientTransport. These stand in for the real
// @modelcontextprotocol/sdk exports via vi.mock below.

type FakeTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

const serverFixtures: Record<
  string,
  { tools: FakeTool[]; callImpl: (name: string, args: any) => any }
> = {};

class FakeClient {
  private transport: FakeStdio | null = null;
  constructor(
    public info: any,
    public capabilities: any,
  ) {}
  async connect(transport: FakeStdio) {
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
  async close() {
    this.transport?.close();
  }
}

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

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: FakeClient,
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: FakeStdio,
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
});
