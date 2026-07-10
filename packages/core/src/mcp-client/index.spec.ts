import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ActionEntry } from "../agent/production-agent.js";
import {
  extractMcpToolResultImages,
  classifyMcpToolCall,
  evaluateMcpToolCallPolicy,
  isMcpActionResult,
  mcpToolsToActionEntries,
  syncMcpActionEntries,
} from "./index.js";
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
      annotations?: Record<string, unknown>;
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

  it("threads MCP readOnlyHint annotations into ActionEntry metadata", async () => {
    serverFixtures["x-bin"] = {
      tools: [
        {
          name: "inspect",
          description: "Inspect state",
          annotations: { readOnlyHint: true },
        },
        {
          name: "mutate",
          description: "Mutate state",
          annotations: { readOnlyHint: false },
        },
      ],
      callImpl: () => ({ content: [{ type: "text", text: "ok" }] }),
    };
    const mgr = new McpClientManager({
      servers: { x: { command: "x-bin" } },
    });
    await mgr.start();

    const entries = mcpToolsToActionEntries(mgr);

    expect(entries["mcp__x__inspect"].readOnly).toBe(true);
    expect(entries["mcp__x__mutate"].readOnly).toBeUndefined();
  });

  it("updates existing MCP ActionEntry metadata when the manager tool set changes", () => {
    const target: Record<string, ActionEntry> = {
      mcp__x__inspect: {
        tool: {
          description: "Old description",
          parameters: { type: "object", properties: {} },
        },
        http: false,
        run: async () => "old",
      },
    };
    const manager = {
      getTools: () => [
        {
          source: "x",
          name: "mcp__x__inspect",
          originalName: "inspect",
          description: "New description",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"],
          },
          annotations: { readOnlyHint: true },
          raw: { annotations: { readOnlyHint: true } },
        },
      ],
      callTool: vi.fn(),
      readResourceForTool: vi.fn(),
    } as unknown as McpClientManager;

    syncMcpActionEntries(manager, target);

    expect(target["mcp__x__inspect"].tool).toEqual({
      description: "New description",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    });
    expect(target["mcp__x__inspect"].readOnly).toBe(true);
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

  it("does not throw when the underlying call errors — returns an MCP result", async () => {
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
    const result = await entries["mcp__x__fail"].run({});
    expect(isMcpActionResult(result)).toBe(true);
    if (!isMcpActionResult(result)) throw new Error("Expected MCP result");
    expect(result.text).toContain("Error calling MCP tool mcp__x__fail");
    expect(result.text).toContain("spawned process crashed");
    expect(result.raw).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: expect.stringContaining("spawned process crashed"),
        },
      ],
    });
  });

  it("blocks mutating combined computer actions in read-only mode", async () => {
    const callImpl = vi.fn(() => ({
      content: [{ type: "text", text: "ok" }],
    }));
    serverFixtures["computer-bin"] = {
      tools: [{ name: "computer" }],
      callImpl,
    };
    const mgr = new McpClientManager({
      servers: { "computer-use-mcp": { command: "computer-bin" } },
    });
    await mgr.start();
    const entry = mcpToolsToActionEntries(mgr, {
      invocationPolicy: { mode: "read-only" },
    })["mcp__computer-use-mcp__computer"];

    const screenshot = await entry.run({ action: "screenshot" });
    const click = await entry.run({ action: "left_click", x: 10, y: 20 });
    const ambiguous = await entry.run({ action: "custom_gesture" });

    expect(callImpl).toHaveBeenCalledTimes(1);
    expect(callImpl).toHaveBeenCalledWith("computer", {
      action: "screenshot",
    });
    expect(isMcpActionResult(click) && click.text).toContain(
      "unavailable in read-only mode",
    );
    expect(isMcpActionResult(ambiguous) && ambiguous.text).toContain(
      "not a recognized safe observation operation",
    );
    expect(isMcpActionResult(screenshot) && screenshot.text).toBe("ok");
  });

  it("blocks browser interaction tools but permits observation tools", async () => {
    const callImpl = vi.fn(() => ({
      content: [{ type: "text", text: "ok" }],
    }));
    serverFixtures["browser-bin"] = {
      tools: [
        { name: "browser_click" },
        { name: "browser_type" },
        { name: "browser_navigate" },
        { name: "browser_observe" },
        { name: "browser_read" },
        { name: "browser_screenshot" },
      ],
      callImpl,
    };
    const mgr = new McpClientManager({
      servers: { browser: { command: "browser-bin" } },
    });
    await mgr.start();
    const entries = mcpToolsToActionEntries(mgr, {
      invocationPolicy: { mode: "read-only" },
    });

    for (const operation of ["click", "type", "navigate"]) {
      const result = await entries[`mcp__browser__browser_${operation}`].run(
        {},
      );
      expect(isMcpActionResult(result) && result.text).toContain(
        "unavailable in read-only mode",
      );
    }
    for (const operation of ["observe", "read", "screenshot"]) {
      const result = await entries[`mcp__browser__browser_${operation}`].run(
        {},
      );
      expect(isMcpActionResult(result) && result.text).toBe("ok");
    }
    expect(callImpl).toHaveBeenCalledTimes(3);
  });

  it("keeps ordinary MCP tools usable while honoring explicit mutation hints", async () => {
    const callImpl = vi.fn(() => ({
      content: [{ type: "text", text: "ok" }],
    }));
    serverFixtures["data-bin"] = {
      tools: [
        { name: "lookup" },
        { name: "inspect", annotations: { readOnlyHint: true } },
        { name: "update", annotations: { readOnlyHint: false } },
      ],
      callImpl,
    };
    const mgr = new McpClientManager({
      servers: { data: { command: "data-bin" } },
    });
    await mgr.start();
    const entries = mcpToolsToActionEntries(mgr, {
      invocationPolicy: { mode: "read-only" },
    });

    expect(isMcpActionResult(await entries.mcp__data__lookup.run({}))).toBe(
      true,
    );
    expect(isMcpActionResult(await entries.mcp__data__inspect.run({}))).toBe(
      true,
    );
    const update = await entries.mcp__data__update.run({});
    expect(isMcpActionResult(update) && update.text).toContain(
      "unavailable in read-only mode",
    );
    expect(callImpl).toHaveBeenCalledTimes(2);
  });
});

describe("MCP tool call policy", () => {
  const tool = (source: string, originalName: string, annotations?: any) =>
    ({ source, originalName, annotations }) as any;

  it("classifies runtime computer actions ahead of incomplete annotations", () => {
    expect(
      classifyMcpToolCall(tool("computer-use-mcp", "computer"), {
        action: "screenshot",
      }),
    ).toMatchObject({ family: "computer", effect: "read" });
    expect(
      classifyMcpToolCall(tool("computer-use-mcp", "computer"), {
        action: "left_click",
      }),
    ).toMatchObject({ family: "computer", effect: "write" });
  });

  it("fails closed for unknown browser operations in read-only policy", () => {
    expect(
      evaluateMcpToolCallPolicy(
        { mode: "read-only" },
        tool("browser", "browser_magic"),
        {},
      ),
    ).toMatchObject({ family: "browser", effect: "unknown", allowed: false });
  });

  it("fails closed for deceptively neutral unannotated MCP tools", () => {
    expect(
      evaluateMcpToolCallPolicy(
        { mode: "read-only" },
        tool("neutral-service", "interact"),
        {},
      ),
    ).toMatchObject({ family: "other", effect: "unknown", allowed: false });
    expect(
      evaluateMcpToolCallPolicy(
        { mode: "read-only" },
        tool("neutral-service", "lookup_records"),
        {},
      ),
    ).toMatchObject({ family: "other", effect: "read", allowed: true });
  });
});

describe("extractMcpToolResultImages", () => {
  it("converts MCP image content parts into engine image parts", () => {
    const images = extractMcpToolResultImages({
      content: [
        { type: "text", text: "Here is the screenshot" },
        { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
        { type: "image", data: "d29ybGQ=", mimeType: "image/jpeg" },
      ],
    });
    expect(images).toEqual([
      { data: "aGVsbG8=", mediaType: "image/png" },
      { data: "d29ybGQ=", mediaType: "image/jpeg" },
    ]);
  });

  it("applies the shared caps (count and base64 size)", () => {
    const oversize = "A".repeat(2_000_001);
    const many = Array.from({ length: 6 }, () => ({
      type: "image",
      data: "aGVsbG8=",
      mimeType: "image/png",
    }));
    expect(
      extractMcpToolResultImages({
        content: [{ type: "image", data: oversize, mimeType: "image/png" }],
      }),
    ).toEqual([]);
    expect(extractMcpToolResultImages({ content: many })).toHaveLength(4);
  });

  it("skips unsupported mime types and malformed parts", () => {
    expect(
      extractMcpToolResultImages({
        content: [
          { type: "image", data: "aGVsbG8=", mimeType: "image/tiff" },
          { type: "image" },
          { type: "text", text: "no image" },
        ],
      }),
    ).toEqual([]);
  });

  it("returns nothing for error results and non-result values", () => {
    expect(
      extractMcpToolResultImages({
        isError: true,
        content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
      }),
    ).toEqual([]);
    expect(extractMcpToolResultImages("text")).toEqual([]);
    expect(extractMcpToolResultImages(null)).toEqual([]);
    expect(extractMcpToolResultImages({})).toEqual([]);
  });
});
