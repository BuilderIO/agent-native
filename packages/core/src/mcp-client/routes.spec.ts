import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashEmail } from "./remote-store.js";
import {
  buildMergedConfig,
  formatMcpConnectError,
  mountMcpServersRoutes,
} from "./routes.js";

const mockedSettings = vi.hoisted(() => ({
  all: {} as Record<string, Record<string, unknown>>,
}));
const getSessionMock = vi.hoisted(() => vi.fn());
const getOrgContextMock = vi.hoisted(() => vi.fn());

vi.mock("../server/auth.js", () => ({
  getSession: getSessionMock,
}));

vi.mock("../org/context.js", () => ({
  getOrgContext: getOrgContextMock,
}));

vi.mock("../server/framework-request-handler.js", () => ({
  getH3App: (app: any) => app.h3,
}));

vi.mock("../settings/store.js", () => ({
  getAllSettings: async () => mockedSettings.all,
}));

vi.mock("./config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config.js")>();
  return {
    ...actual,
    loadMcpConfig: () => null,
    autoDetectMcpConfig: () => null,
  };
});

vi.mock("./hub-client.js", () => ({
  fetchHubServers: async () => ({}),
}));

vi.mock("./workspace-servers.js", () => ({
  loadWorkspaceMcpServers: async () => ({}),
}));

beforeEach(() => {
  mockedSettings.all = {};
  getSessionMock.mockReset();
  getOrgContextMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("formatMcpConnectError", () => {
  it("does not surface raw HTML responses", () => {
    expect(formatMcpConnectError("<!doctype html><html>Not found</html>")).toBe(
      "That URL returned a web page instead of an MCP response. Check that you pasted the Streamable HTTP endpoint, often ending in /mcp.",
    );
  });

  it("explains Streamable HTTP handshake failures", () => {
    expect(
      formatMcpConnectError("Streamable HTTP error: non-200 status code"),
    ).toBe(
      "The server did not complete the Streamable HTTP MCP handshake. Check the URL and any required authorization headers.",
    );
  });

  it("prioritizes auth failures over generic Streamable HTTP failures", () => {
    expect(
      formatMcpConnectError("Streamable HTTP error: non-200 status code 401"),
    ).toBe(
      "The MCP server rejected the request. Reconnect or update the required Authorization header.",
    );
  });

  it("explains non-MCP JSON responses", () => {
    expect(
      formatMcpConnectError(
        '[{"code":"invalid_union","path":["jsonrpc"],"message":"Invalid input"},{"code":"unrecognized_keys","keys":["args","origin","url"]}]',
      ),
    ).toBe(
      "That URL returned JSON, but not an MCP JSON-RPC response. Check that you pasted the Streamable HTTP endpoint, often ending in /mcp.",
    );
  });
});

describe("buildMergedConfig built-in MCP capabilities", () => {
  it("merges enabled user and org built-ins with scoped visibility keys", async () => {
    mockedSettings.all = {
      "u:alice@example.com:mcp-builtin-capabilities": {
        enabledIds: ["browser-chrome-devtools"],
      },
      "o:acme:mcp-builtin-capabilities": {
        enabledIds: ["browser-playwright"],
      },
    };

    const cfg = await buildMergedConfig();
    const userKey = `user_${hashEmail("alice@example.com")}_chrome-devtools`;
    expect(cfg?.servers[userKey]).toEqual({
      type: "stdio",
      command: "npx",
      args: [
        "-y",
        "chrome-devtools-mcp@0.26.0",
        "--autoConnect",
        "--no-usage-statistics",
      ],
      description:
        "Attach to a live Chrome browser through Chrome DevTools MCP.",
    });
    expect(cfg?.servers.org_acme_playwright).toMatchObject({
      type: "stdio",
      command: "npx",
      args: ["-y", "@playwright/mcp@0.0.75"],
    });
  });

  it("keeps browser built-ins exclusive while merging settings", async () => {
    mockedSettings.all = {
      "u:alice@example.com:mcp-builtin-capabilities": {
        enabledIds: ["browser-chrome-devtools", "browser-playwright"],
      },
    };

    const cfg = await buildMergedConfig();
    const chromeKey = `user_${hashEmail("alice@example.com")}_chrome-devtools`;
    const playwrightKey = `user_${hashEmail("alice@example.com")}_playwright`;
    expect(cfg?.servers[chromeKey]).toBeUndefined();
    expect(cfg?.servers[playwrightKey]).toMatchObject({
      args: ["-y", "@playwright/mcp@0.0.75"],
    });
  });

  it("skips enabled local built-ins in production runtimes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mockedSettings.all = {
      "u:alice@example.com:mcp-builtin-capabilities": {
        enabledIds: ["browser-chrome-devtools"],
      },
    };

    await expect(buildMergedConfig()).resolves.toBeNull();
  });
});

describe("MCP server routes", () => {
  it("requires authentication before dry-running arbitrary MCP URLs", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    getOrgContextMock.mockRejectedValueOnce(new Error("no org"));

    const nitroApp = createNitroApp();
    const manager = {
      getStatus: () => ({
        connectedServers: [],
        configuredServers: [],
        errors: {},
        tools: [],
      }),
      reconfigure: vi.fn(),
    };
    mountMcpServersRoutes(nitroApp, manager as any);

    const response = await dispatchMountedRoute(
      nitroApp,
      "/_agent-native/mcp/servers/test",
      "POST",
      { url: "https://mcp.example.test/mcp" },
    );

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required" });
    expect(manager.reconfigure).not.toHaveBeenCalled();
  });

  it("does not list local built-ins in production runtimes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mockedSettings.all = {
      "u:alice@example.com:mcp-builtin-capabilities": {
        enabledIds: ["browser-chrome-devtools"],
      },
    };
    getSessionMock.mockResolvedValue({ email: "alice@example.com" });
    getOrgContextMock.mockRejectedValue(new Error("no org"));

    const nitroApp = createNitroApp();
    const manager = {
      getStatus: () => ({
        connectedServers: [],
        configuredServers: [],
        errors: {},
        tools: [],
      }),
      reconfigure: vi.fn(),
    };
    mountMcpServersRoutes(nitroApp, manager as any);

    const response = await dispatchMountedRoute(
      nitroApp,
      "/_agent-native/mcp/builtin",
      "GET",
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      capabilities: [],
      user: { enabledIds: [] },
    });
  });

  it("mediates MCP App tool calls through the same server only", async () => {
    getSessionMock.mockResolvedValue({ email: "alice@example.com" });
    getOrgContextMock.mockRejectedValue(new Error("no org"));

    const nitroApp = createNitroApp();
    const manager = {
      hasServer: (serverId: string) => serverId === "apps",
      getToolsForServer: (serverId: string) =>
        serverId === "apps"
          ? [
              {
                source: "apps",
                name: "mcp__apps__render",
                originalName: "render",
                description: "Render",
                inputSchema: { type: "object" },
                raw: { name: "render" },
              },
            ]
          : [],
      callTool: vi.fn(async () => ({
        content: [{ type: "text", text: "ok" }],
      })),
      readResource: vi.fn(),
      getStatus: () => ({
        connectedServers: ["apps"],
        configuredServers: ["apps"],
        errors: {},
        tools: [{ source: "apps", name: "mcp__apps__render" }],
      }),
      reconfigure: vi.fn(),
    };
    mountMcpServersRoutes(nitroApp, manager as any);

    const ok = await dispatchMountedRoute(
      nitroApp,
      "/_agent-native/mcp/apps/call-tool",
      "POST",
      { serverId: "apps", toolName: "render", arguments: { id: "1" } },
    );

    expect(ok.status).toBe(200);
    expect(manager.callTool).toHaveBeenCalledWith("mcp__apps__render", {
      id: "1",
    });
    expect(ok.body).toEqual({ content: [{ type: "text", text: "ok" }] });

    const blocked = await dispatchMountedRoute(
      nitroApp,
      "/_agent-native/mcp/apps/call-tool",
      "POST",
      { serverId: "apps", toolName: "mcp__other__render", arguments: {} },
    );
    expect(blocked.status).toBe(400);
    expect(blocked.body).toEqual({
      error: "serverId and same-server toolName are required",
    });
  });

  it("requires authentication for MCP App routes outside production too", async () => {
    getSessionMock.mockResolvedValue(null);
    getOrgContextMock.mockRejectedValue(new Error("no org"));

    const nitroApp = createNitroApp();
    const manager = {
      hasServer: () => true,
      getToolsForServer: () => [],
      getStatus: () => ({
        connectedServers: [],
        configuredServers: [],
        errors: {},
        tools: [],
      }),
      reconfigure: vi.fn(),
    };
    mountMcpServersRoutes(nitroApp, manager as any);

    const response = await dispatchMountedRoute(
      nitroApp,
      "/_agent-native/mcp/apps/list-tools",
      "POST",
      { serverId: "apps" },
    );

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required" });
  });

  it("blocks MCP App calls to model-only tools", async () => {
    getSessionMock.mockResolvedValue({ email: "alice@example.com" });
    getOrgContextMock.mockRejectedValue(new Error("no org"));

    const nitroApp = createNitroApp();
    const manager = {
      hasServer: (serverId: string) => serverId === "apps",
      getToolsForServer: (serverId: string) =>
        serverId === "apps"
          ? [
              {
                source: "apps",
                name: "mcp__apps__hidden",
                originalName: "hidden",
                description: "Hidden",
                inputSchema: { type: "object" },
                raw: {
                  name: "hidden",
                  _meta: { ui: { visibility: ["model"] } },
                },
              },
            ]
          : [],
      callTool: vi.fn(),
      readResource: vi.fn(),
      getStatus: () => ({
        connectedServers: ["apps"],
        configuredServers: ["apps"],
        errors: {},
        tools: [{ source: "apps", name: "mcp__apps__hidden" }],
      }),
      reconfigure: vi.fn(),
    };
    mountMcpServersRoutes(nitroApp, manager as any);

    const response = await dispatchMountedRoute(
      nitroApp,
      "/_agent-native/mcp/apps/call-tool",
      "POST",
      { serverId: "apps", toolName: "hidden", arguments: {} },
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "MCP tool is not available in this request scope",
    });
    expect(manager.callTool).not.toHaveBeenCalled();
  });

  it("allows MCP Apps to read only ui:// resources from visible servers", async () => {
    getSessionMock.mockResolvedValue({ email: "alice@example.com" });
    getOrgContextMock.mockRejectedValue(new Error("no org"));

    const nitroApp = createNitroApp();
    const manager = {
      hasServer: () => true,
      getToolsForServer: () => [
        {
          source: "apps",
          name: "mcp__apps__render",
          originalName: "render",
          description: "Render",
          inputSchema: { type: "object" },
          raw: { name: "render" },
        },
      ],
      callTool: vi.fn(),
      readResource: vi.fn(async () => ({
        contents: [
          {
            uri: "ui://apps/render",
            mimeType: "text/html;profile=mcp-app",
            text: "<button>Run</button>",
          },
        ],
      })),
      getStatus: () => ({
        connectedServers: ["apps"],
        configuredServers: ["apps"],
        errors: {},
        tools: [{ source: "apps", name: "mcp__apps__render" }],
      }),
      reconfigure: vi.fn(),
    };
    mountMcpServersRoutes(nitroApp, manager as any);

    const ok = await dispatchMountedRoute(
      nitroApp,
      "/_agent-native/mcp/apps/read-resource",
      "POST",
      { serverId: "apps", uri: "ui://apps/render" },
    );
    expect(ok.status).toBe(200);
    expect(manager.readResource).toHaveBeenCalledWith(
      "apps",
      "ui://apps/render",
    );

    const blocked = await dispatchMountedRoute(
      nitroApp,
      "/_agent-native/mcp/apps/read-resource",
      "POST",
      { serverId: "apps", uri: "https://example.com/render.html" },
    );
    expect(blocked.status).toBe(400);
    expect(blocked.body).toEqual({
      error: "serverId and ui:// uri are required",
    });
  });

  it("blocks MCP App resource reads when the server has no app-visible tools", async () => {
    getSessionMock.mockResolvedValue({ email: "alice@example.com" });
    getOrgContextMock.mockRejectedValue(new Error("no org"));

    const nitroApp = createNitroApp();
    const manager = {
      hasServer: () => true,
      getToolsForServer: () => [
        {
          source: "apps",
          name: "mcp__apps__hidden",
          originalName: "hidden",
          description: "Hidden",
          inputSchema: { type: "object" },
          raw: {
            name: "hidden",
            _meta: { ui: { visibility: ["model"] } },
          },
        },
      ],
      callTool: vi.fn(),
      readResource: vi.fn(),
      getStatus: () => ({
        connectedServers: ["apps"],
        configuredServers: ["apps"],
        errors: {},
        tools: [{ source: "apps", name: "mcp__apps__hidden" }],
      }),
      reconfigure: vi.fn(),
    };
    mountMcpServersRoutes(nitroApp, manager as any);

    const response = await dispatchMountedRoute(
      nitroApp,
      "/_agent-native/mcp/apps/read-resource",
      "POST",
      { serverId: "apps", uri: "ui://apps/render" },
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "MCP server is not available in this request scope",
    });
    expect(manager.readResource).not.toHaveBeenCalled();
  });
});

function createNitroApp() {
  return {
    h3: {
      handlers: [] as Array<{ base: string; handler: (event: any) => unknown }>,
      use(base: string, handler: (event: any) => unknown) {
        this.handlers.push({ base, handler });
      },
    },
  };
}

async function dispatchMountedRoute(
  nitroApp: ReturnType<typeof createNitroApp>,
  pathname: string,
  method: string,
  body?: unknown,
) {
  const mounted = nitroApp.h3.handlers.find((entry) =>
    pathname.startsWith(entry.base),
  );
  if (!mounted) throw new Error(`No mounted handler for ${pathname}`);
  const relativePath = pathname.slice(mounted.base.length) || "/";
  const url = `https://app.test${relativePath}`;
  const requestBody = body === undefined ? undefined : JSON.stringify(body);
  const headers = {
    host: "app.test",
    "content-type": "application/json",
  };
  const event = {
    method,
    url: new URL(url),
    path: relativePath,
    context: {},
    req: new Request(url, {
      method,
      body: requestBody,
      headers,
    }),
    res: {
      status: 200,
      headers: new Headers(),
    },
    node: {
      req: {
        method,
        url: relativePath,
        headers,
      },
      res: {
        statusCode: 200,
        setHeader() {},
        end() {},
      },
    },
  };
  const responseBody = await mounted.handler(event);
  return {
    body: responseBody,
    status: event.res.status || event.node.res.statusCode,
  };
}
