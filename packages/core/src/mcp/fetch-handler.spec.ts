import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createMCPServerForRequest: vi.fn(() => ({ server: true })),
  fetch: vi.fn(
    async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", result: { ok: true } }), {
        headers: { "content-type": "application/json" },
      }),
  ),
}));

vi.mock("./build-server.js", () => ({
  createMCPServerForRequest: mocks.createMCPServerForRequest,
}));
vi.mock("@modelcontextprotocol/server", () => ({
  createMcpHandler: (factory: () => unknown) => {
    factory();
    return { fetch: mocks.fetch };
  },
}));
vi.mock("../app-config/store.js", () => ({
  getAppConfig: () => ({ observability: { mcpDebugInitialize: false } }),
}));
vi.mock("./analytics.js", () => ({ trackMcpInitialize: vi.fn() }));

const { handleMcpFetchRequest } = await import("./fetch-handler.js");

describe("handleMcpFetchRequest", () => {
  it("keeps the Fetch adapter free of Node and H3 imports", async () => {
    const source = await readFile(
      new URL("./fetch-handler.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/(?:from|import\s*\()\s*["'](?:node:|h3)/);
  });

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

  it("parses a Fetch request body when a framework did not pre-parse it", async () => {
    const body = { jsonrpc: "2.0", id: 2, method: "tools/list" };
    const request = new Request("https://example.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    await handleMcpFetchRequest(request, { name: "test", actions: {} } as any, {
      requestMeta: { transport: "http" },
    });

    expect(mocks.fetch).toHaveBeenLastCalledWith(request, { parsedBody: body });
  });
});
