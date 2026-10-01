import { beforeEach, describe, expect, it, vi } from "vitest";

const mockServerState = vi.hoisted(() => ({
  setResponseHeader: vi.fn(),
  setResponseStatus: vi.fn(),
  validateMcpDirectoryProfile: vi.fn(),
  verifyAuth: vi.fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getMethod: () => "POST",
  getRequestHeader: () => undefined,
  setResponseHeader: mockServerState.setResponseHeader,
  setResponseStatus: mockServerState.setResponseStatus,
}));

vi.mock("../server/framework-request-handler.js", () => ({
  getH3App: (nitroApp: any) => nitroApp.h3,
}));

vi.mock("../server/auth.js", () => ({
  isLoopbackRequest: () => false,
}));

vi.mock("../server/h3-helpers.js", () => ({
  readBody: vi.fn(),
}));

vi.mock("./build-server.js", () => ({
  buildLinkArtifacts: vi.fn(),
  createMCPServerForRequest: vi.fn(),
  selectMcpActionSurface: vi.fn(),
  validateMcpDirectoryProfile: mockServerState.validateMcpDirectoryProfile,
  validateMcpDirectoryWidgetDomain: vi.fn(),
  getAccessTokens: vi.fn(),
  resolveOrgIdFromDomain: vi.fn(),
  verifyAuth: mockServerState.verifyAuth,
}));

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
  });

  it("contains directory profile validation failures at the directory route", async () => {
    mockServerState.validateMcpDirectoryProfile.mockImplementationOnce(() => {
      throw new Error("missing MCP annotations");
    });
    mockServerState.verifyAuth.mockResolvedValueOnce({ authed: false });
    const use = vi.fn();
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      mountMCP({ h3: { use } }, {
        actions: {},
        directoryProfile: { connectorCatalog: ["broken"] },
      } as any),
    ).not.toThrow();

    const [directoryPath, directoryHandler] = use.mock.calls[0]!;
    const event = {};
    const directoryResult = await directoryHandler(event);
    expect(directoryPath).toBe("/mcp/directory");
    expect(directoryResult).toEqual({
      error: "MCP_DIRECTORY_PROFILE_INVALID",
      message:
        "The MCP directory is unavailable because its catalog configuration is invalid.",
    });
    expect(mockServerState.setResponseStatus).toHaveBeenCalledWith(event, 503);
    expect(mockServerState.setResponseHeader).toHaveBeenCalledWith(
      event,
      "Cache-Control",
      "no-store",
    );
    expect(logError).toHaveBeenCalledWith(
      "[mcp] MCP directory profile validation failed:",
      expect.any(Error),
    );

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

    logError.mockRestore();
  });

  it("mounts the public and legacy protocol paths by default", () => {
    const use = vi.fn();
    mountMCP({ h3: { use } }, { actions: {} } as any);

    expect(use.mock.calls.map(([path]) => path)).toEqual([
      "/_agent-native/mcp",
      "/mcp",
    ]);
  });

  it("does not add the public alias to a custom route prefix", () => {
    const use = vi.fn();
    mountMCP({ h3: { use } }, { actions: {} } as any, "/custom");

    expect(use.mock.calls.map(([path]) => path)).toEqual(["/custom/mcp"]);
  });

  it("mounts the curated directory before the broader public MCP prefix", () => {
    const use = vi.fn();
    mountMCP({ h3: { use } }, { actions: {}, directoryProfile: {} } as any);

    expect(use.mock.calls.map(([path]) => path)).toEqual([
      "/mcp/directory",
      "/_agent-native/mcp",
      "/mcp",
    ]);
  });
});
