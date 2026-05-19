import { describe, it, expect, vi, beforeEach } from "vitest";
import { isMcpActionResult, mcpToolsToActionEntries } from "./index.js";
import { McpClientManager } from "./manager.js";

// Reuse the stdio/client fakes from manager.spec.ts so the ActionEntry
// wrapper can exercise a real McpClientManager end-to-end.

const serverFixtures: Record<
  string,
  {
    tools: Array<{
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
      _meta?: Record<string, unknown>;
    }>;
    callImpl: (n: string, a: any) => any;
    readResourceImpl?: (uri: string) => any;
  }
> = {};

class FakeClient {
  private transport: FakeStdio | null = null;
  constructor(_info: any, _capabilities: any) {}
  async connect(transport: FakeStdio) {
    this.transport = transport;
  }
  async listTools() {
    return { tools: serverFixtures[this.transport!.key]?.tools ?? [] };
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
  async close() {}
}

class FakeStdio {
  key: string;
  constructor(opts: { command: string; args?: string[] }) {
    this.key = `${opts.command} ${(opts.args ?? []).join(" ")}`.trim();
  }
  close() {}
}

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: FakeClient,
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: FakeStdio,
}));

describe("mcpToolsToActionEntries", () => {
  beforeEach(() => {
    for (const k of Object.keys(serverFixtures)) delete serverFixtures[k];
  });

  it("wraps every MCP tool as an agent-only ActionEntry", async () => {
    serverFixtures["x-bin"] = {
      tools: [
        {
          name: "ping",
          description: "Ping",
          inputSchema: { type: "object" } as any,
        },
        {
          name: "pong",
          description: "Pong",
          inputSchema: { type: "object" } as any,
        },
      ],
      callImpl: () => ({ content: [{ type: "text", text: "ok" }] }),
    };
    const mgr = new McpClientManager({
      servers: { x: { command: "x-bin" } },
    });
    await mgr.start();

    const entries = mcpToolsToActionEntries(mgr);
    expect(Object.keys(entries).sort()).toEqual([
      "mcp__x__ping",
      "mcp__x__pong",
    ]);
    for (const entry of Object.values(entries)) {
      // MCP tools must never be auto-exposed as HTTP endpoints.
      expect(entry.http).toBe(false);
      expect(typeof entry.run).toBe("function");
    }
  });

  it("flattens text content blocks into the tool result string", async () => {
    serverFixtures["x-bin"] = {
      tools: [{ name: "ping" }],
      callImpl: () => ({
        content: [
          { type: "text", text: "line one" },
          { type: "text", text: "line two" },
        ],
      }),
    };
    const mgr = new McpClientManager({
      servers: { x: { command: "x-bin" } },
    });
    await mgr.start();
    const entries = mcpToolsToActionEntries(mgr);
    const result = await entries["mcp__x__ping"].run({});
    expect(isMcpActionResult(result)).toBe(true);
    if (!isMcpActionResult(result)) throw new Error("Expected MCP result");
    expect(result.text).toBe("line one\nline two");
    expect(result.raw).toMatchObject({
      content: [
        { type: "text", text: "line one" },
        { type: "text", text: "line two" },
      ],
    });
  });

  it("prefixes error-flagged results with 'Error:'", async () => {
    serverFixtures["x-bin"] = {
      tools: [{ name: "boom" }],
      callImpl: () => ({
        content: [{ type: "text", text: "server exploded" }],
        isError: true,
      }),
    };
    const mgr = new McpClientManager({
      servers: { x: { command: "x-bin" } },
    });
    await mgr.start();
    const entries = mcpToolsToActionEntries(mgr);
    const result = await entries["mcp__x__boom"].run({});
    expect(isMcpActionResult(result)).toBe(true);
    if (!isMcpActionResult(result)) throw new Error("Expected MCP result");
    expect(result.text).toBe("Error: server exploded");
  });

  it("preserves MCP App result metadata and reads the ui:// resource", async () => {
    serverFixtures["x-bin"] = {
      tools: [
        {
          name: "render",
          description: "Render UI",
          _meta: { ui: { resourceUri: "ui://x/render" } },
        } as any,
      ],
      callImpl: () => ({
        content: [{ type: "text", text: "Rendered" }],
        structuredContent: { ok: true },
        _meta: { trace: "abc" },
      }),
      readResourceImpl: (uri) => ({
        contents: [
          {
            uri,
            mimeType: "text/html;profile=mcp-app",
            text: "<!doctype html><button>Run</button>",
            _meta: {
              ui: {
                csp: { connectDomains: ["https://api.example.com"] },
              },
            },
          },
        ],
      }),
    };
    const mgr = new McpClientManager({
      servers: { x: { command: "x-bin" } },
    });
    await mgr.start();
    const entries = mcpToolsToActionEntries(mgr);
    const result = await entries["mcp__x__render"].run({ id: "1" });

    expect(isMcpActionResult(result)).toBe(true);
    if (!isMcpActionResult(result)) throw new Error("Expected MCP result");
    expect(result.text).toBe("Rendered");
    expect(result.mcpApp).toMatchObject({
      serverId: "x",
      originalToolName: "render",
      resourceUri: "ui://x/render",
      toolInput: { id: "1" },
      toolResult: {
        structuredContent: { ok: true },
        _meta: { trace: "abc" },
      },
      resource: {
        uri: "ui://x/render",
        mimeType: "text/html;profile=mcp-app",
        text: "<!doctype html><button>Run</button>",
      },
    });
  });

  it("does not throw when the underlying call errors — returns a string", async () => {
    serverFixtures["x-bin"] = {
      tools: [{ name: "fail" }],
      callImpl: () => {
        throw new Error("spawned process crashed");
      },
    };
    const mgr = new McpClientManager({
      servers: { x: { command: "x-bin" } },
    });
    await mgr.start();
    const entries = mcpToolsToActionEntries(mgr);
    const result = (await entries["mcp__x__fail"].run({})) as string;
    expect(result).toContain("Error calling MCP tool mcp__x__fail");
    expect(result).toContain("spawned process crashed");
  });
});
