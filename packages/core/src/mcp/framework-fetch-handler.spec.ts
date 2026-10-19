import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createMCPServerForRequest: vi.fn(() => ({ server: true })),
  trackMcpInitialize: vi.fn(),
  fetch: vi.fn(
    async (_request?: Request) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", result: { ok: true } }), {
        headers: { "content-type": "application/json" },
      }),
  ),
}));

vi.mock("./build-server.js", () => ({
  createMCPServerForRequest: mocks.createMCPServerForRequest,
}));
vi.mock("@modelcontextprotocol/server", () => ({
  isJsonContentType: (header: string | null | undefined) =>
    header?.toLowerCase().split(";", 1)[0]?.trim() === "application/json",
  createMcpHandler: (factory: () => unknown) => {
    factory();
    return { fetch: mocks.fetch };
  },
}));
vi.mock("../app-config/store.js", () => ({
  getAppConfig: () => ({ observability: { mcpDebugInitialize: false } }),
}));
vi.mock("./analytics.js", () => ({
  trackMcpInitialize: mocks.trackMcpInitialize,
}));

const { handleMcpFetchRequest } = await import("./framework-fetch-handler.js");

describe("handleMcpFetchRequest", () => {
  it("passes the authenticated identity, metadata, and parsed body unchanged", async () => {
    const body = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    const request = new Request("https://example.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const config = { name: "test", actions: {} } as any;
    const identity = { userEmail: "caller@example.com", orgId: "org-1" };
    const requestMeta = {
      origin: "https://example.com",
      transport: "http",
    } as const;

    const response = await handleMcpFetchRequest(request, config, {
      identity,
      requestMeta,
      parsedBody: body,
    });

    expect(response.status).toBe(200);
    expect(mocks.createMCPServerForRequest).toHaveBeenCalledWith(
      config,
      identity,
      requestMeta,
    );
    expect(mocks.fetch).toHaveBeenCalledWith(request, { parsedBody: body });
  });

  it("leaves an unparsed Fetch request body to the MCP transport", async () => {
    const body = { jsonrpc: "2.0", id: 2, method: "tools/list" };
    const request = new Request("https://example.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    await handleMcpFetchRequest(request, { name: "test", actions: {} } as any, {
      requestMeta: { transport: "http" },
    });

    expect(mocks.fetch).toHaveBeenLastCalledWith(request, undefined);
  });

  it("tracks initialize requests from an unparsed native Fetch request", async () => {
    const body = {
      jsonrpc: "2.0",
      id: 3,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "Test Client", version: "1.2.3" },
      },
    };
    const request = new Request("https://example.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const config = { name: "test", version: "2.0.0", actions: {} } as any;
    const identity = { userEmail: "caller@example.com", orgId: "org-1" };
    const requestMeta = {
      clientName: "Native Fetch Client",
      transport: "http",
    } as const;
    mocks.fetch.mockImplementationOnce(async (receivedRequest) => {
      expect(await receivedRequest?.json()).toEqual(body);
      return new Response(JSON.stringify({ jsonrpc: "2.0", result: {} }), {
        headers: { "content-type": "application/json" },
      });
    });

    const response = await handleMcpFetchRequest(request, config, {
      identity,
      requestMeta,
    });

    expect(response.status).toBe(200);
    expect(mocks.fetch).toHaveBeenLastCalledWith(request, undefined);
    expect(mocks.trackMcpInitialize).toHaveBeenCalledWith({
      source: "http",
      serverName: "test",
      serverVersion: "2.0.0",
      clientName: "Test Client",
      clientVersion: "1.2.3",
      clientUserAgent: "Native Fetch Client",
      protocolVersion: "2025-03-26",
      userId: "caller@example.com",
    });
  });

  it("leaves malformed bodies to the MCP transport", async () => {
    const request = new Request("https://example.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    const response = await handleMcpFetchRequest(
      request,
      { name: "test", actions: {} } as any,
      { requestMeta: { transport: "http" } },
    );

    expect(response.status).toBe(200);
    expect(mocks.fetch).toHaveBeenLastCalledWith(request, undefined);
  });
});
