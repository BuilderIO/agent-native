import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashEmail } from "./remote-store.js";
import {
  buildMergedConfig,
  formatMcpConnectError,
  McpConfigUnreadableError,
  mountMcpServersRoutes,
  startMcpConfigRefresh,
} from "./routes.js";

const mockedSettings = vi.hoisted(() => ({
  all: {} as Record<string, Record<string, unknown>>,
  readError: null as Error | null,
  reads: 0,
  emitter: null as null | import("node:events").EventEmitter,
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

vi.mock("../settings/store.js", async () => {
  const { EventEmitter } = await import("node:events");
  mockedSettings.emitter = new EventEmitter();
  return {
    getSetting: async (key: string) => mockedSettings.all[key] ?? null,
    putSetting: async (key: string, value: Record<string, unknown>) => {
      mockedSettings.all[key] = value;
    },
    deleteSetting: async (key: string) => {
      const existed = key in mockedSettings.all;
      delete mockedSettings.all[key];
      return existed;
    },
    getAllSettings: async () => {
      mockedSettings.reads += 1;
      if (mockedSettings.readError) throw mockedSettings.readError;
      return mockedSettings.all;
    },
    getSettingsEmitter: () => mockedSettings.emitter,
  };
});

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
  mockedSettings.readError = null;
  mockedSettings.reads = 0;
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

describe("startMcpConfigRefresh", () => {
  it("re-reads the settings table only on a write or the backstop", async () => {
    // `buildMergedConfig` scans the whole settings table. On an idle app that
    // used to be a full-table round trip every 60s per app, forever, just to
    // diff a signature that had not changed since boot.
    vi.useFakeTimers();
    const manager = {
      getConfig: () => ({ servers: {} }),
      reconfigure: vi.fn(async () => {}),
    };
    const stop = startMcpConfigRefresh(manager as never)!;
    try {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockedSettings.reads).toBe(1);

      // Idle: no settings write, no scan.
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockedSettings.reads).toBe(1);

      mockedSettings.emitter!.emit("settings", { source: "settings" });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockedSettings.reads).toBe(2);

      // Backstop still catches a write made by another process.
      await vi.advanceTimersByTimeAsync(6 * 60_000);
      expect(mockedSettings.reads).toBe(3);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it("starts no timer where in-process sweeps are disabled", async () => {
    // Billed per warm container, and the first tick always scans the whole
    // settings table because it starts dirty.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NETLIFY", "true");
    vi.useFakeTimers();
    const manager = {
      getConfig: () => ({ servers: {} }),
      reconfigure: vi.fn(async () => {}),
    };
    try {
      expect(startMcpConfigRefresh(manager as never)).toBeNull();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(mockedSettings.reads).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a failed refresh on the next interval", async () => {
    vi.useFakeTimers();
    const reconfigure = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary manager failure"))
      .mockResolvedValue(undefined);
    const manager = {
      getConfig: () => ({ servers: { stale: {} } }),
      reconfigure,
    };
    const stop = startMcpConfigRefresh(manager as never)!;
    try {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockedSettings.reads).toBe(1);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockedSettings.reads).toBe(2);
      expect(reconfigure).toHaveBeenCalledTimes(2);
    } finally {
      stop();
      vi.useRealTimers();
    }
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

  it("reports an unreadable settings table instead of an empty config", async () => {
    mockedSettings.readError = new Error("connect ECONNREFUSED");

    // `null` means "zero MCP servers configured". An unreachable settings table
    // must not be able to produce that answer.
    await expect(buildMergedConfig()).rejects.toThrow(McpConfigUnreadableError);
  });
});

describe("MCP server routes", () => {
  it("serializes route access behind deferred manager hydration", async () => {
    getSessionMock.mockResolvedValue(null);
    getOrgContextMock.mockRejectedValue(new Error("no org"));
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const nitroApp = createNitroApp();
    const manager = {
      getStatus: vi.fn(() => ({
        connectedServers: [],
        configuredServers: [],
        errors: {},
        tools: [],
      })),
      reconfigure: vi.fn(),
    };
    mountMcpServersRoutes(nitroApp, manager as any, {
      waitUntilReady: () => ready,
    });

    const pending = dispatchMountedRoute(
      nitroApp,
      "/_agent-native/mcp/servers/test",
      "POST",
      { url: "https://mcp.example.test/mcp" },
    );
    await Promise.resolve();
    expect(getSessionMock).not.toHaveBeenCalled();

    release();
    await expect(pending).resolves.toMatchObject({ status: 401 });
    expect(getSessionMock).toHaveBeenCalledOnce();
  });

  it("reconnects a scoped existing server by reconfiguring the manager", async () => {
    getSessionMock.mockResolvedValue({ email: "alice@example.com" });
    getOrgContextMock.mockResolvedValue({
      email: "alice@example.com",
      orgId: "acme",
      role: "member",
    });

    const server = {
      id: "demo",
      name: "demo",
      url: "https://mcp.example.test/mcp",
      createdAt: 1,
      description: "Demo server",
    };
    mockedSettings.all["o:acme:mcp-servers-remote"] = {
      servers: [server],
    };

    const mergedId = "org_acme_demo";
    let status = {
      connectedServers: [],
      configuredServers: [mergedId],
      errors: {
        [mergedId]: "Streamable HTTP error: non-200 status code 401",
      },
      tools: [] as Array<{ source: string; name: string; description: string }>,
    };
    const manager = {
      getStatus: () => status,
      reconfigure: vi.fn(
        async (nextConfig: { servers?: Record<string, unknown> }) => {
          expect(nextConfig?.servers).toMatchObject({
            [mergedId]: {
              type: "http",
              url: "https://mcp.example.test/mcp",
              description: "Demo server",
            },
          });
          status = {
            connectedServers: [mergedId],
            configuredServers: [mergedId],
            errors: {},
            tools: [
              {
                source: mergedId,
                name: `mcp__${mergedId}__ping`,
                description: "Ping",
              },
            ],
          };
        },
      ),
    };
    const nitroApp = createNitroApp();
    mountMcpServersRoutes(nitroApp, manager as any);

    const response = await dispatchMountedRoute(
      nitroApp,
      "/_agent-native/mcp/servers/demo/reconnect?scope=org",
      "POST",
    );

    expect(response.status).toBe(200);
    expect(manager.reconfigure).toHaveBeenCalledOnce();
    expect(response.body).toEqual({
      ok: true,
      server: {
        id: "demo",
        scope: "org",
        name: "demo",
        url: "https://mcp.example.test/mcp",
        headers: undefined,
        authMode: "none",
        description: "Demo server",
        firstParty: false,
        createdAt: 1,
        mergedId,
        status: {
          state: "connected",
          toolCount: 1,
        },
      },
    });
  });

  it("returns the formatted connection cause when reconnect still fails", async () => {
    getSessionMock.mockResolvedValue({ email: "alice@example.com" });
    getOrgContextMock.mockResolvedValue({
      email: "alice@example.com",
      orgId: "acme",
      role: "member",
    });

    const server = {
      id: "demo",
      name: "demo",
      url: "https://mcp.example.test/mcp",
      createdAt: 1,
      description: "Demo server",
    };
    mockedSettings.all["o:acme:mcp-servers-remote"] = {
      servers: [server],
    };

    const mergedId = "org_acme_demo";
    const manager = {
      getStatus: () => ({
        connectedServers: [],
        configuredServers: [mergedId],
        errors: {
          [mergedId]: "Streamable HTTP error: non-200 status code 401",
        },
        tools: [],
      }),
      reconfigure: vi.fn(async () => {}),
    };
    const nitroApp = createNitroApp();
    mountMcpServersRoutes(nitroApp, manager as any);

    const response = await dispatchMountedRoute(
      nitroApp,
      "/_agent-native/mcp/servers/demo/reconnect?scope=org",
      "POST",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      server: {
        id: "demo",
        scope: "org",
        name: "demo",
        url: "https://mcp.example.test/mcp",
        headers: undefined,
        authMode: "none",
        description: "Demo server",
        firstParty: false,
        createdAt: 1,
        mergedId,
        status: {
          state: "error",
          error:
            "The MCP server rejected the request. Reconnect or update the required Authorization header.",
        },
      },
    });
  });

  it("requires an active org to reconnect an org-scoped server", async () => {
    getSessionMock.mockResolvedValue({ email: "alice@example.com" });
    getOrgContextMock.mockRejectedValue(new Error("no org"));

    mockedSettings.all["o:acme:mcp-servers-remote"] = {
      servers: [
        {
          id: "demo",
          name: "demo",
          url: "https://mcp.example.test/mcp",
          createdAt: 1,
        },
      ],
    };

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
      "/_agent-native/mcp/servers/demo/reconnect?scope=org",
      "POST",
    );

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: "Authentication required",
    });
    expect(manager.reconfigure).not.toHaveBeenCalled();
  });

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
