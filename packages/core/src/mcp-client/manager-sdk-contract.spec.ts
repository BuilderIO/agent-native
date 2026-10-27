import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { McpClientManager } from "./manager.js";

/**
 * These run the real SDK client against an in-process MCP server, because the
 * reconnect route reads the state the SDK leaves behind: a request refused
 * over HTTP reaches the transport's `onerror`, and the manager records it as
 * a connection error. A refused tool list then leaves the server as a refused
 * connect leaves it, with no tools to offer or call. If a future SDK stops
 * reporting the refusal, these fail and the manager has to detect it itself.
 */
const URL = "http://mcp.example.test/mcp";

type Refusal = (request: Request, body: any) => Response | undefined;

function serve(refuse: { current?: Refusal }, methods: string[] = []) {
  const handler = createMcpHandler(
    () => {
      const server = new McpServer({ name: "docs", version: "1.0.0" });
      server.registerTool("search", { description: "Search" }, async () => ({
        content: [{ type: "text", text: "found" }],
      }));
      return server;
    },
    { legacy: "stateless", responseMode: "auto" },
  );
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.method === "POST") {
        const body = await request.clone().json();
        methods.push(body?.method);
        const refused = refuse.current?.(request, body);
        if (refused) return refused;
      }
      return handler.fetch(request);
    },
  );
}

const unauthorized = (status: number) => () =>
  Response.json({ error: "invalid_token" }, { status });

const managers: McpClientManager[] = [];
async function connect() {
  const manager = new McpClientManager({
    servers: { docs: { type: "http", url: URL } },
  });
  managers.push(manager);
  await manager.start();
  return manager;
}

const SEARCH = "mcp__docs__search";

function serverState(manager: McpClientManager) {
  const status = manager.getStatus();
  return {
    connected: status.connectedServers.includes("docs"),
    error: status.errors.docs,
    tools: manager.getTools().map(({ name }) => name),
  };
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.stop()));
  vi.unstubAllGlobals();
});

describe("McpClientManager with the real MCP SDK", () => {
  it("force-refreshes and retries once when an OAuth token receives a 401", async () => {
    const refuse: { current?: Refusal } = {};
    const methods: string[] = [];
    const authorizationHeaders: string[] = [];
    serve(refuse, methods);
    const refresh = vi.fn(async () => "<NEW_ACCESS_TOKEN>");
    const manager = new McpClientManager({
      servers: {
        docs: {
          type: "http",
          url: URL,
          headers: { Authorization: "Bearer <OLD_ACCESS_TOKEN>" },
          oauthAccessRefresh: { identity: "oauth-test", refresh },
        },
      },
    });
    managers.push(manager);
    await manager.start();

    refuse.current = (request, body) => {
      if (body?.method !== "tools/call") return;
      const authorization = request.headers.get("authorization") ?? "";
      authorizationHeaders.push(authorization);
      return authorization === "Bearer <OLD_ACCESS_TOKEN>"
        ? unauthorized(401)()
        : undefined;
    };

    await expect(manager.callTool(SEARCH, {})).resolves.toMatchObject({
      content: [{ type: "text", text: "found" }],
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(methods.filter((method) => method === "tools/call")).toHaveLength(2);
    expect(authorizationHeaders).toEqual([
      "Bearer <OLD_ACCESS_TOKEN>",
      "Bearer <NEW_ACCESS_TOKEN>",
    ]);
  });

  it.each([
    ["an absent token", null],
    ["an unchanged token", "<OLD_ACCESS_TOKEN>"],
  ] as const)(
    "preserves the 401 without retrying when refresh returns %s",
    async (_description, refreshedToken) => {
      const refuse: { current?: Refusal } = {};
      const methods: string[] = [];
      serve(refuse, methods);
      const refresh = vi.fn(async () => refreshedToken);
      const manager = new McpClientManager({
        servers: {
          docs: {
            type: "http",
            url: URL,
            headers: { Authorization: "Bearer <OLD_ACCESS_TOKEN>" },
            oauthAccessRefresh: { identity: "oauth-test", refresh },
          },
        },
      });
      managers.push(manager);
      await manager.start();
      refuse.current = (_request, body) =>
        body?.method === "tools/call" ? unauthorized(401)() : undefined;

      await expect(manager.callTool(SEARCH, {})).rejects.toMatchObject({
        status: 401,
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(methods.filter((method) => method === "tools/call")).toHaveLength(
        1,
      );
    },
  );

  it("keeps an existing OAuth transport when its refresh identity is stable", async () => {
    const refuse: { current?: Refusal } = {};
    const methods: string[] = [];
    serve(refuse, methods);
    const config = (refresh: () => Promise<string | null>) => ({
      type: "http" as const,
      url: URL,
      headers: { Authorization: "Bearer <ACCESS_TOKEN>" },
      oauthAccessRefresh: { identity: "oauth-test", refresh },
    });
    const manager = new McpClientManager({
      servers: { docs: config(async () => "<ACCESS_TOKEN>") },
    });
    managers.push(manager);
    await manager.start();
    const requestCount = methods.length;

    await expect(
      manager.reconfigure({
        servers: { docs: config(async () => "<ACCESS_TOKEN>") },
      }),
    ).resolves.toMatchObject({ unchanged: ["docs"], reconnected: [] });
    expect(methods).toHaveLength(requestCount);
  });

  it.each([401, 403])(
    "leaves a server whose tool list gets HTTP %i as a refused connect leaves it",
    async (status) => {
      const refuse: { current?: Refusal } = {};
      const methods: string[] = [];
      serve(refuse, methods);
      const manager = await connect();
      expect(serverState(manager)).toEqual({
        connected: true,
        error: undefined,
        tools: [SEARCH],
      });

      refuse.current = unauthorized(status);
      await expect(manager.refreshTools("docs")).rejects.toMatchObject({
        status,
      });

      expect(serverState(manager)).toEqual({
        connected: false,
        error: expect.stringMatching(new RegExp(`^HTTP ${status}: `)),
        tools: [],
      });
      expect(manager.getConnectErrorStatus("docs")).toBeUndefined();
      await expect(manager.callTool(SEARCH, {})).rejects.toThrow(
        `MCP server "docs" is not connected: HTTP ${status}: `,
      );
      expect(methods).not.toContain("tools/call");
      const refusedAtConnect = await connect();
      expect(serverState(refusedAtConnect)).toEqual({
        connected: false,
        error: expect.stringContaining(String(status)),
        tools: [],
      });
      expect(refusedAtConnect.getConnectErrorStatus("docs")).toBe(status);
    },
  );

  it("keeps the connection when the tool list fails without an HTTP refusal", async () => {
    const refuse: { current?: Refusal } = {};
    serve(refuse);
    const manager = await connect();

    refuse.current = (_request, body) =>
      body?.method === "tools/list"
        ? Response.json({
            jsonrpc: "2.0",
            id: body.id,
            error: { code: -32603, message: "listing failed" },
          })
        : undefined;
    await expect(manager.refreshTools("docs")).rejects.toThrow(
      "listing failed",
    );

    expect(serverState(manager)).toEqual({
      connected: true,
      error: undefined,
      tools: [SEARCH],
    });
    await expect(manager.callTool(SEARCH, {})).resolves.toMatchObject({
      content: [{ type: "text", text: "found" }],
    });
  });
});
