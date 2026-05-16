import { beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  mockedSettings.all = {};
  getSessionMock.mockReset();
  getOrgContextMock.mockReset();
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
