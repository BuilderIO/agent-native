import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(
    async (_request?: Request, _options?: { parsedBody?: unknown }) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", result: { ok: true } }), {
        headers: { "content-type": "application/json" },
      }),
  ),
}));

vi.mock("@modelcontextprotocol/server", () => ({
  isJsonContentType: (header: string | null | undefined) =>
    header?.toLowerCase().split(";", 1)[0]?.trim() === "application/json",
  createMcpHandler: (factory: () => unknown) => {
    factory();
    return { fetch: mocks.fetch };
  },
}));

const { handleMcpFetchRequest } = await import("./fetch-handler.js");

describe("Web MCP Fetch adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the provided server factory and forwards a parsed body", async () => {
    const request = new Request("https://example.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const parsedBody = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    const createServer = vi.fn(() => ({ server: true }));

    const response = await handleMcpFetchRequest(request, {
      createServer,
      parsedBody,
    });

    expect(response.status).toBe(200);
    expect(createServer).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledWith(request, { parsedBody });
  });

  it("observes parsed initialize requests through a host callback", async () => {
    const initializeRequest = {
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", clientInfo: { name: "test" } },
    };
    const request = new Request("https://example.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(initializeRequest),
    });
    const onInitialize = vi.fn();

    await handleMcpFetchRequest(request, {
      createServer: () => ({ server: true }),
      parsedBody: initializeRequest,
      onInitialize,
    });

    expect(onInitialize).toHaveBeenCalledWith(initializeRequest);
  });
});
