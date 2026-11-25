import { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import { handleMcpFetchRequest } from "./fetch-handler.js";

const MODERN_VERSION = "2026-07-28";
const LEGACY_VERSION = "2025-06-18";
const HEADER_MISMATCH_CODE = -32020;

function modernEnvelopeMeta() {
  return {
    "io.modelcontextprotocol/protocolVersion": MODERN_VERSION,
    "io.modelcontextprotocol/clientInfo": {
      name: "sdk-contract-test",
      version: "1.0.0",
    },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
}

function createEchoServer() {
  const server = new McpServer({
    name: "agent-native-test",
    version: "1.0.0",
  });
  server.registerTool(
    "echo_note",
    { description: "Echo a note" },
    async () => ({
      content: [{ type: "text", text: "echoed" }],
    }),
  );
  return server;
}

async function parseRpcResponse(response: Response): Promise<any> {
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  if (contentType.includes("text/event-stream")) {
    const dataLine = raw
      .split(/\r?\n/)
      .find((line) => line.startsWith("data:"));
    if (!dataLine) {
      throw new Error(`Expected SSE data payload, got: ${raw}`);
    }
    return JSON.parse(dataLine.slice("data:".length).trim());
  }
  return JSON.parse(raw);
}

async function postMcp(
  body: Record<string, unknown>,
  headers: Record<string, string>,
  options?: {
    createServer?: () => McpServer;
    onInitialize?: (request: unknown) => void;
  },
) {
  const request = new Request("https://example.com/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const response = await handleMcpFetchRequest(request, {
    createServer: options?.createServer ?? createEchoServer,
    onInitialize: options?.onInitialize,
  });
  return {
    status: response.status,
    json: await parseRpcResponse(response),
  };
}

describe("handleMcpFetchRequest with real MCP SDK 2.4.0", () => {
  it("supports dual-era 2025-06-18 legacy initialize and 2026-07-28 stateless calls on the same handler", async () => {
    const onInitialize = vi.fn();

    const init = await postMcp(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: LEGACY_VERSION,
          capabilities: {},
          clientInfo: { name: "legacy-client", version: "1.0.0" },
        },
      },
      {},
      { onInitialize },
    );
    expect(init.status).toBe(200);
    expect(init.json.error).toBeUndefined();
    expect(init.json.result.protocolVersion).toBe(LEGACY_VERSION);
    expect(onInitialize).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "initialize",
        params: expect.objectContaining({ protocolVersion: LEGACY_VERSION }),
      }),
    );

    const legacyCall = await postMcp(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "echo_note", arguments: {} },
      },
      { "mcp-protocol-version": LEGACY_VERSION },
    );
    expect(legacyCall.status).toBe(200);
    expect(legacyCall.json.error).toBeUndefined();
    expect(legacyCall.json.result.content).toEqual([
      { type: "text", text: "echoed" },
    ]);

    const modernList = await postMcp(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
        params: { _meta: modernEnvelopeMeta() },
      },
      {
        "mcp-protocol-version": MODERN_VERSION,
        "mcp-method": "tools/list",
      },
    );
    expect(modernList.status).toBe(200);
    expect(modernList.json.error).toBeUndefined();
    expect(modernList.json.result.tools.map((t: any) => t.name)).toEqual([
      "echo_note",
    ]);

    const modernCall = await postMcp(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "echo_note",
          arguments: {},
          _meta: modernEnvelopeMeta(),
        },
      },
      {
        "mcp-protocol-version": MODERN_VERSION,
        "mcp-method": "tools/call",
        "mcp-name": "echo_note",
      },
    );
    expect(modernCall.status).toBe(200);
    expect(modernCall.json.error).toBeUndefined();
    expect(modernCall.json.result.content).toEqual([
      { type: "text", text: "echoed" },
    ]);
  });

  it("rejects mismatched or missing Mcp-Method, Mcp-Name, and protocol-version headers with -32020 before invoking the server factory", async () => {
    const toolCallBody = {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "echo_note",
        arguments: {},
        _meta: modernEnvelopeMeta(),
      },
    };

    const cases: Array<{ label: string; headers: Record<string, string> }> = [
      {
        label: "mismatched Mcp-Method",
        headers: {
          "mcp-protocol-version": MODERN_VERSION,
          "mcp-method": "tools/list",
          "mcp-name": "echo_note",
        },
      },
      {
        label: "missing Mcp-Method",
        headers: {
          "mcp-protocol-version": MODERN_VERSION,
          "mcp-name": "echo_note",
        },
      },
      {
        label: "missing Mcp-Name",
        headers: {
          "mcp-protocol-version": MODERN_VERSION,
          "mcp-method": "tools/call",
        },
      },
      {
        label: "mismatched Mcp-Name",
        headers: {
          "mcp-protocol-version": MODERN_VERSION,
          "mcp-method": "tools/call",
          "mcp-name": "other_tool",
        },
      },
      {
        label: "mismatched MCP-Protocol-Version",
        headers: {
          "mcp-protocol-version": LEGACY_VERSION,
          "mcp-method": "tools/call",
          "mcp-name": "echo_note",
        },
      },
    ];

    for (const testCase of cases) {
      const createServer = vi.fn(createEchoServer);
      const result = await postMcp(toolCallBody, testCase.headers, {
        createServer,
      });
      expect(result.status, testCase.label).toBe(400);
      expect(result.json.error?.code, testCase.label).toBe(
        HEADER_MISMATCH_CODE,
      );
      expect(createServer, testCase.label).not.toHaveBeenCalled();
    }
  });
});
