import { beforeEach, describe, expect, it, vi } from "vitest";

const mockServerState = vi.hoisted(() => ({
  McpDirectoryProfileValidationError: class extends Error {
    readonly code = "MCP_DIRECTORY_PROFILE_INVALID";
  },
  McpIdentityVerificationUnavailableError: class extends Error {},
  registerAuthPublicPaths: vi.fn(),
  setResponseHeader: vi.fn(),
  setResponseStatus: vi.fn(),
  validateMcpDirectoryProfile: vi.fn(),
  verifyAuth: vi.fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getMethod: () => "POST",
  getRequestHeader: () => undefined,
  getHeader: () => undefined,
  setResponseHeader: mockServerState.setResponseHeader,
  setResponseStatus: mockServerState.setResponseStatus,
}));

vi.mock("../server/framework-request-handler.js", () => ({
  getH3App: (nitroApp: any) => nitroApp.h3,
}));

vi.mock("../server/auth.js", () => ({
  getConfiguredLoginHtml: vi.fn(),
  getSession: vi.fn(),
  isLoopbackRequest: () => false,
  registerAuthPublicPaths: mockServerState.registerAuthPublicPaths,
}));

vi.mock("../server/h3-helpers.js", () => ({
  readBody: vi.fn(),
}));

vi.mock("./build-server.js", () => ({
  buildLinkArtifacts: vi.fn(),
  createMCPServerForRequest: vi.fn(),
  McpDirectoryProfileValidationError:
    mockServerState.McpDirectoryProfileValidationError,
  McpIdentityVerificationUnavailableError:
    mockServerState.McpIdentityVerificationUnavailableError,
  selectMcpActionSurface: vi.fn(),
  validateMcpDirectoryProfile: mockServerState.validateMcpDirectoryProfile,
  validateMcpDirectoryWidgetDomain: vi.fn(),
  getAccessTokens: vi.fn(),
  resolveOrgIdFromDomain: vi.fn(),
  verifyAuth: mockServerState.verifyAuth,
}));

const approvalRoute = vi.hoisted(() => ({ mounted: [] as unknown[] }));
vi.mock("./approval-route.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./approval-route.js")>();
  return {
    ...original,
    mountMcpApprovalRoute: (
      ...args: Parameters<typeof original.mountMcpApprovalRoute>
    ) => {
      approvalRoute.mounted.push(args[1]);
      return original.mountMcpApprovalRoute(...args);
    },
  };
});

vi.mock("./oauth-route.js", () => ({
  buildMcpOAuthChallenge: vi.fn(),
  getMcpOAuthAudiences: vi.fn(),
  getMcpOAuthIssuer: vi.fn(),
  getMcpOAuthProtectedResourceMetadataUrl: vi.fn(),
  getMcpOAuthResource: vi.fn(),
}));

const { mountMCP } = await import("./server.js");

describe("mountMCP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    approvalRoute.mounted.length = 0;
  });

  it("defers directory validation until after authentication without breaking plugin mount", async () => {
    mockServerState.verifyAuth.mockResolvedValue({ authed: false });
    const use = vi.fn();

    expect(() =>
      mountMCP({ h3: { use } }, {
        actions: {},
        directoryProfile: { connectorCatalog: ["broken"] },
      } as any),
    ).not.toThrow();

    const directoryHandler = use.mock.calls.find(
      ([path]) => path === "/mcp/directory",
    )?.[1];
    expect(directoryHandler).toBeTypeOf("function");
    const event = {};
    const directoryResult = await directoryHandler(event);
    expect(directoryResult).toMatchObject({ error: "Unauthorized" });
    expect(mockServerState.setResponseStatus).toHaveBeenCalledWith(event, 401);
    expect(mockServerState.validateMcpDirectoryProfile).not.toHaveBeenCalled();

    const generalHandler = use.mock.calls.find(
      ([path]) => path === "/mcp",
    )?.[1];
    expect(generalHandler).toBeTypeOf("function");
    const generalEvent = { url: { pathname: "/" } };
    const generalResult = await generalHandler(generalEvent);
    expect(generalResult).toMatchObject({ error: "Unauthorized" });
    expect(mockServerState.setResponseStatus).toHaveBeenCalledWith(
      generalEvent,
      401,
    );
  });

  it("returns 503 when MCP organization identity evidence is unavailable", async () => {
    mockServerState.verifyAuth.mockRejectedValue(
      new mockServerState.McpIdentityVerificationUnavailableError(),
    );
    const use = vi.fn();
    mountMCP({ h3: { use } }, { actions: {} } as any);
    const handler = use.mock.calls.find(([path]) => path === "/mcp")?.[1];
    const event = { url: { pathname: "/" } };

    const result = await handler(event);

    expect(result).toEqual({
      error: "Service Unavailable",
      message: "Organization membership could not be verified. Retry shortly.",
    });
    expect(mockServerState.setResponseStatus).toHaveBeenCalledWith(event, 503);
  });

  // A prefix mount also matches every path under it, so the approval review
  // page must be mounted before the MCP endpoint that contains its path.
  it("mounts the approval review page, then the public and legacy protocol paths by default", () => {
    const use = vi.fn();
    mountMCP({ h3: { use } }, { actions: {} } as any);

    expect(use.mock.calls.map(([path]) => path)).toEqual([
      "/_agent-native/mcp/approvals",
      "/_agent-native/mcp",
      "/mcp",
    ]);
    expect(mockServerState.registerAuthPublicPaths).toHaveBeenCalledWith(
      ["/_agent-native/mcp/approvals/:id(uuidv4)"],
      { use },
    );
  });

  it("serves the review page on a custom route prefix, without the public alias", () => {
    const use = vi.fn();
    mountMCP({ h3: { use } }, { actions: {} } as any, "/custom");

    expect(use.mock.calls.map(([path]) => path)).toEqual([
      "/custom/mcp/approvals",
      "/custom/mcp",
    ]);
    // The review page serves its own sign-in, so the auth guard lets it
    // through wherever it is mounted.
    expect(mockServerState.registerAuthPublicPaths).toHaveBeenCalledWith(
      ["/custom/mcp/approvals/:id(uuidv4)"],
      { use },
    );
  });

  it.each(["", "/workspace"])(
    "registers the canonical approval exception with base path %s",
    (basePath) => {
      vi.stubEnv("APP_BASE_PATH", basePath);
      vi.stubEnv(
        "AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX",
        "/framework",
      );
      try {
        const use = vi.fn();
        mountMCP(
          { h3: { use } },
          { actions: {} } as any,
          `${basePath}/framework`,
        );
        expect(mockServerState.registerAuthPublicPaths).toHaveBeenCalledWith(
          ["/_agent-native/mcp/approvals/:id(uuidv4)"],
          { use },
        );
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  it("sends review links to the app's own page only when the app renders one", () => {
    const use = vi.fn();
    mountMCP({ h3: { use } }, { actions: {} } as any);
    mountMCP({ h3: { use } }, {
      actions: {},
      appApprovalPage: true,
    } as any);

    expect(approvalRoute.mounted).toEqual([
      expect.objectContaining({ appPage: false }),
      expect.objectContaining({ appPage: true }),
    ]);
  });

  it("refuses the app's own review page under a route prefix it doesn't read", () => {
    const use = vi.fn();
    expect(() =>
      mountMCP(
        { h3: { use } },
        { actions: {}, appApprovalPage: true } as any,
        "/custom",
      ),
    ).toThrow("appApprovalPage needs MCP mounted under /_agent-native");
    expect(use).not.toHaveBeenCalled();
  });

  it("mounts the curated directory before the broader public MCP prefix", () => {
    const use = vi.fn();
    mountMCP({ h3: { use } }, { actions: {}, directoryProfile: {} } as any);

    expect(use.mock.calls.map(([path]) => path)).toEqual([
      "/_agent-native/mcp/approvals",
      "/mcp/directory",
      "/_agent-native/mcp",
      "/mcp",
    ]);
  });
});
